import {
  buildLongitudinalReport,
  classifyVdt,
  computeVdt,
  DAY_MS,
  DEFAULT_DIAMETER_UNCERTAINTY_MM,
  describeVdt,
  diameterFromVolumeMm3,
  matchPriorNodules,
  measurementVolumeMm3,
  MIN_INTERVAL_DAYS,
  NoduleMeasurement,
  TrackedNodule,
  VDT_BENIGN_DAYS,
  VDT_SUSPICIOUS_DAYS,
  volumeFromDiameterMm,
} from './vdt';

const T0 = 1_700_000_000_000;
const at = (dayOffset: number) => T0 + dayOffset * DAY_MS;

const nodule = (diameterMm: number, dayOffset: number): NoduleMeasurement => ({
  diameterMm,
  acquiredAt: at(dayOffset),
});

describe('vdt — volume and diameter', () => {
  it('uses the sphere-equivalent volume', () => {
    expect(volumeFromDiameterMm(10)).toBeCloseTo((Math.PI / 6) * 1000, 6);
  });

  it('round-trips diameter through volume', () => {
    expect(diameterFromVolumeMm3(volumeFromDiameterMm(7.3))).toBeCloseTo(7.3, 9);
  });

  it('is zero for a non-positive or nonsense diameter', () => {
    expect(volumeFromDiameterMm(0)).toBe(0);
    expect(volumeFromDiameterMm(-3)).toBe(0);
    expect(volumeFromDiameterMm(NaN)).toBe(0);
  });

  // A segmented volume is the measurement VDT actually wants; the sphere assumption is
  // the approximation that causes most of the error.
  it('prefers a segmented volume over a diameter', () => {
    expect(measurementVolumeMm3({ diameterMm: 10, volumeMm3: 42, acquiredAt: T0 })).toBe(42);
    expect(measurementVolumeMm3({ diameterMm: 10, volumeMm3: 0, acquiredAt: T0 })).toBeCloseTo(
      volumeFromDiameterMm(10),
      6
    );
  });
});

describe('vdt — the arithmetic', () => {
  it('a doubling of volume over the interval IS the interval', () => {
    const prior: NoduleMeasurement = { volumeMm3: 100, acquiredAt: at(0) };
    const current: NoduleMeasurement = { volumeMm3: 200, acquiredAt: at(365) };
    expect(computeVdt(prior, current).days).toBeCloseTo(365, 6);
  });

  it('a quadrupling over the interval halves it', () => {
    const prior: NoduleMeasurement = { volumeMm3: 100, acquiredAt: at(0) };
    const current: NoduleMeasurement = { volumeMm3: 400, acquiredAt: at(400) };
    expect(computeVdt(prior, current).days).toBeCloseTo(200, 6);
  });

  it('reports the interval and the volume change', () => {
    const result = computeVdt(
      { volumeMm3: 100, acquiredAt: at(0) },
      { volumeMm3: 150, acquiredAt: at(180) }
    );
    expect(result.intervalDays).toBeCloseTo(180, 6);
    expect(result.volumeChangeFraction).toBeCloseTo(0.5, 9);
    expect(result.outcome).toBe('growing');
  });
});

describe('vdt — refusals', () => {
  // Printing −412 days next to a threshold of 400 invites exactly the wrong reading.
  it('a shrinking nodule has NO doubling time, not a negative one', () => {
    const result = computeVdt(nodule(8, 0), nodule(6, 200));
    expect(result.outcome).toBe('shrinking');
    expect(result.days).toBeNull();
    expect(result.suspicion).toBe('notApplicable');
    expect(describeVdt(result)).toMatch(/regrediu/);
    expect(describeVdt(result)).not.toMatch(/-/);
  });

  it('an unchanged nodule has no doubling time either', () => {
    const result = computeVdt(nodule(8, 0), nodule(8, 200));
    expect(result.outcome).toBe('stable');
    expect(result.days).toBeNull();
    expect(describeVdt(result)).toMatch(/inalterado/);
  });

  // A 2% volume change over three weeks is noise; the arithmetic would happily turn it
  // into a very short doubling time.
  it('refuses an interval too short to assess growth', () => {
    const result = computeVdt(nodule(8, 0), nodule(8.2, 20));
    expect(result.outcome).toBe('intervalTooShort');
    expect(result.days).toBeNull();
    expect(result.message).toMatch(new RegExp(`${MIN_INTERVAL_DAYS}`));
  });

  it('the minimum interval is configurable', () => {
    const result = computeVdt(nodule(8, 0), nodule(9, 20), { minIntervalDays: 10 });
    expect(result.outcome).toBe('growing');
  });

  it('refuses a current study that is not after the prior', () => {
    expect(computeVdt(nodule(8, 200), nodule(9, 0)).outcome).toBe('invalidInput');
    expect(computeVdt(nodule(8, 0), nodule(9, 0)).outcome).toBe('invalidInput');
  });

  it('refuses measurements it cannot use', () => {
    expect(computeVdt(nodule(0, 0), nodule(9, 200)).outcome).toBe('invalidInput');
    expect(computeVdt(undefined as never, nodule(9, 200)).outcome).toBe('invalidInput');
    expect(describeVdt(computeVdt(nodule(0, 0), nodule(9, 200)))).toMatch(/insuficientes/);
  });
});

describe('vdt — measurement uncertainty is the whole point', () => {
  // On a 5 mm nodule the ±1 mm two radiologists routinely disagree by is a ±60% volume
  // swing, and VDT divides the interval into it.
  it('a small nodule produces an enormous confidence interval', () => {
    const result = computeVdt(nodule(5, 0), nodule(5.5, 180));
    expect(result.days).toBeGreaterThan(0);
    expect(result.upperDays! / result.lowerDays!).toBeGreaterThan(5);
  });

  it('a large nodule produces a tight one', () => {
    const small = computeVdt(nodule(5, 0), nodule(5.5, 180));
    const large = computeVdt(nodule(30, 0), nodule(33, 180));
    const spread = (r: typeof small) => r.upperDays! / r.lowerDays!;
    expect(spread(large)).toBeLessThan(spread(small));
  });

  it('the point estimate sits inside its own interval', () => {
    const result = computeVdt(nodule(12, 0), nodule(14, 240));
    expect(result.days).toBeGreaterThanOrEqual(result.lowerDays!);
    expect(result.days).toBeLessThanOrEqual(result.upperDays!);
  });

  it('a smaller stated uncertainty narrows the interval', () => {
    const loose = computeVdt(nodule(8, 0), nodule(9, 180), { diameterUncertaintyMm: 1 });
    const tight = computeVdt(nodule(8, 0), nodule(9, 180), { diameterUncertaintyMm: 0.2 });
    expect(tight.upperDays! - tight.lowerDays!).toBeLessThan(loose.upperDays! - loose.lowerDays!);
  });

  it('zero uncertainty collapses the interval onto the estimate', () => {
    const result = computeVdt(nodule(8, 0), nodule(9, 180), { diameterUncertaintyMm: 0 });
    expect(result.lowerDays).toBeCloseTo(result.days!, 6);
    expect(result.upperDays).toBeCloseTo(result.days!, 6);
  });

  // The honest output, and the one that leads to "repeat at 3 months" instead of to a
  // wrong confident number.
  it('flags a result whose interval straddles the suspicion threshold', () => {
    const result = computeVdt(nodule(6, 0), nodule(6.4, 180));
    expect(result.inconclusive).toBe(true);
    expect(describeVdt(result)).toMatch(/não respondem à pergunta/);
  });

  it('does not flag one that is unambiguously fast', () => {
    const result = computeVdt(nodule(10, 0), nodule(16, 120));
    expect(result.inconclusive).toBe(false);
    expect(result.suspicion).toBe('suspicious');
  });

  it('the default uncertainty is not pretend-precise', () => {
    expect(DEFAULT_DIAMETER_UNCERTAINTY_MM).toBeGreaterThanOrEqual(1);
  });

  it('always prints the interval, never the point estimate alone', () => {
    const text = describeVdt(computeVdt(nodule(10, 0), nodule(16, 120)));
    expect(text).toMatch(/incerteza de medida/);
    expect(text).toMatch(/–/);
  });
});

describe('vdt — suspicion thresholds', () => {
  it('follows the Fleischner-style bands', () => {
    expect(classifyVdt(200)).toBe('suspicious');
    expect(classifyVdt(500)).toBe('indeterminate');
    expect(classifyVdt(900)).toBe('probablyBenign');
    expect(VDT_SUSPICIOUS_DAYS).toBe(400);
    expect(VDT_BENIGN_DAYS).toBe(600);
  });

  it('is not applicable to a non-positive VDT', () => {
    expect(classifyVdt(-100)).toBe('notApplicable');
    expect(classifyVdt(NaN)).toBe('notApplicable');
  });

  it('honours custom thresholds', () => {
    const result = computeVdt(nodule(10, 0), nodule(11, 300), { suspiciousDays: 5000 });
    expect(result.suspicion).toBe('suspicious');
  });
});

describe('vdt — matching a nodule to its prior', () => {
  const track = (id: string, position: [number, number, number], d = 8): TrackedNodule => ({
    id,
    position,
    measurement: nodule(d, 0),
  });

  it('matches the nearest prior within the radius', () => {
    const report = matchPriorNodules(
      [track('c1', [10, 10, 10])],
      [track('p1', [12, 10, 10]), track('p2', [200, 0, 0])]
    );
    expect(report.matched).toEqual([{ currentId: 'c1', priorId: 'p1', distanceMm: 2 }]);
    expect(report.unmatchedPrior).toEqual(['p2']);
  });

  it('leaves a nodule unmatched when nothing is close enough', () => {
    const report = matchPriorNodules([track('c1', [0, 0, 0])], [track('p1', [0, 0, 100])]);
    expect(report.matched).toEqual([]);
    expect(report.unmatchedCurrent).toEqual(['c1']);
  });

  // A VDT computed across two different nodules is a number with no meaning and no
  // warning label. Leaving it unmatched costs the reader one click.
  it('REFUSES to choose between two equally plausible priors', () => {
    const report = matchPriorNodules(
      [track('c1', [0, 0, 0])],
      [track('p1', [4, 0, 0]), track('p2', [-5, 0, 0])]
    );
    expect(report.matched).toEqual([]);
    expect(report.ambiguous).toEqual([{ currentId: 'c1', candidates: ['p1', 'p2'] }]);
  });

  it('does choose when one prior is clearly closer', () => {
    const report = matchPriorNodules(
      [track('c1', [0, 0, 0])],
      [track('p1', [1, 0, 0]), track('p2', [14, 0, 0])]
    );
    expect(report.matched.map(m => m.priorId)).toEqual(['p1']);
    expect(report.ambiguous).toEqual([]);
  });

  it('never matches one prior to two current nodules', () => {
    const report = matchPriorNodules(
      [track('c1', [0, 0, 0]), track('c2', [1, 0, 0])],
      [track('p1', [0.5, 0, 0])]
    );
    expect(report.matched).toHaveLength(1);
    expect(report.unmatchedCurrent).toHaveLength(1);
  });

  it('handles empty inputs without throwing', () => {
    expect(matchPriorNodules([], [])).toEqual({
      matched: [],
      unmatchedCurrent: [],
      unmatchedPrior: [],
      ambiguous: [],
    });
  });
});

describe('vdt — the longitudinal report', () => {
  const current: TrackedNodule[] = [
    { id: 'c1', position: [0, 0, 0], measurement: nodule(12, 200), label: 'LSD' },
    { id: 'c2', position: [80, 0, 0], measurement: nodule(4, 200), label: 'LID' },
  ];
  const prior: TrackedNodule[] = [{ id: 'p1', position: [2, 0, 0], measurement: nodule(9, 0) }];

  it('computes a VDT for the matched nodule', () => {
    const rows = buildLongitudinalReport(current, prior);
    const row = rows.find(r => r.currentId === 'c1')!;
    expect(row.priorId).toBe('p1');
    expect(row.vdt!.outcome).toBe('growing');
    expect(row.priorDiameterMm).toBeCloseTo(9, 6);
    expect(row.currentDiameterMm).toBeCloseTo(12, 6);
  });

  // A nodule silently missing from a follow-up report is the failure this feature exists
  // to prevent.
  it('keeps a row for the unmatched nodule, flagged as possibly new', () => {
    const rows = buildLongitudinalReport(current, prior);
    const row = rows.find(r => r.currentId === 'c2')!;
    expect(row.vdt).toBeNull();
    expect(row.note).toMatch(/possivelmente novo/);
  });

  it('keeps a row for an ambiguous match, telling the reader to pair it', () => {
    const rows = buildLongitudinalReport(
      [{ id: 'c1', position: [0, 0, 0], measurement: nodule(12, 200) }],
      [
        { id: 'p1', position: [3, 0, 0], measurement: nodule(9, 0) },
        { id: 'p2', position: [-4, 0, 0], measurement: nodule(9, 0) },
      ]
    );
    expect(rows[0].vdt).toBeNull();
    expect(rows[0].note).toMatch(/pareie manualmente/);
    expect(rows[0].note).toMatch(/p1, p2/);
  });

  it('carries the label through', () => {
    expect(buildLongitudinalReport(current, prior)[0].label).toBe('LSD');
  });

  it('produces one row per current nodule, always', () => {
    expect(buildLongitudinalReport(current, [])).toHaveLength(2);
    expect(buildLongitudinalReport([], prior)).toEqual([]);
  });
});
