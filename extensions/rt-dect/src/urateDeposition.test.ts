import {
  compareUrateVolumes,
  CORTEX_PROXIMITY_MM,
  judgeCandidate,
  quantifyUrate,
  SPECKLE_VOLUME_MM3,
  TOPHUS_HU_MAX,
  UrateCandidate,
} from './urateDeposition';

/** HU pair with a given ratio and mean attenuation. */
const withRatio = (ratio: number, meanHu: number) => {
  const high = (2 * (meanHu + 1000)) / (1 + ratio) - 1000;
  return { huLow: ratio * (high + 1000) - 1000, huHigh: high };
};

/** A convincing tophus: uric acid ratio, in the tophus attenuation band. */
const TOPHUS = withRatio(1.1, 160);
/** Calcium ratio at the same attenuation. */
const CALCIC = withRatio(1.45, 160);

const candidate = (over: Partial<UrateCandidate> = {}): UrateCandidate => ({
  id: 'c1',
  ...TOPHUS,
  volumeMm3: 500,
  site: 'periarticular',
  ...over,
});

describe('urateDeposition — accepting a real tophus', () => {
  it('accepts a periarticular deposit with a uric acid ratio', () => {
    const verdict = judgeCandidate(candidate());
    expect(verdict.accepted).toBe(true);
    expect(verdict.volumeMm3).toBe(500);
    expect(verdict.exclusion).toBeUndefined();
  });

  it('accepts one in a joint or a tendon too', () => {
    expect(judgeCandidate(candidate({ site: 'joint' })).accepted).toBe(true);
    expect(judgeCandidate(candidate({ site: 'tendon' })).accepted).toBe(true);
  });

  it('rejects a calcified deposit at the same attenuation', () => {
    const verdict = judgeCandidate(candidate({ ...CALCIC }));
    expect(verdict.accepted).toBe(false);
    expect(verdict.exclusion).toBe('notUrate');
  });

  it('rejects a deposit above the tophus attenuation band', () => {
    const verdict = judgeCandidate(candidate({ ...withRatio(1.1, TOPHUS_HU_MAX + 200) }));
    expect(verdict.accepted).toBe(false);
    expect(verdict.exclusion).toBe('notUrate');
  });
});

describe('urateDeposition — gout lives where the ratio is least reliable', () => {
  // Tophi sit at 130-170 HU, barely above the 100 HU floor the classifier enforces.
  it('rejects a deposit whose attenuation is below the ratio floor', () => {
    const verdict = judgeCandidate(candidate({ ...withRatio(1.1, 40) }));
    expect(verdict.accepted).toBe(false);
    expect(verdict.exclusion).toBe('belowRatioFloor');
    expect(verdict.message).toMatch(/baixa demais/);
  });

  it('accepts one just inside the band', () => {
    expect(judgeCandidate(candidate({ ...withRatio(1.1, 130) })).accepted).toBe(true);
  });
});

describe('urateDeposition — the five known false positives', () => {
  // Keratin has a urate-like ratio, so the classifier is not wrong — it is being asked the
  // wrong question. Location has to be checked first.
  it('excludes the nail bed even though it classifies as urate', () => {
    expect(judgeCandidate(candidate({ site: 'nailBed' })).exclusion).toBe('nailBed');
    expect(judgeCandidate(candidate({ site: 'nailBed' })).message).toMatch(/queratina/);
    // The same voxel pair, elsewhere, is accepted.
    expect(judgeCandidate(candidate({ site: 'joint' })).accepted).toBe(true);
  });

  it('excludes skin', () => {
    expect(judgeCandidate(candidate({ site: 'skin' })).exclusion).toBe('skin');
  });

  it('excludes subchondral change in advanced osteoarthritis', () => {
    expect(judgeCandidate(candidate({ site: 'subchondral' })).exclusion).toBe('subchondral');
  });

  // Size AND proximity together: either alone throws away real periarticular tophi.
  it('excludes submillimetre speckle at the cortical margin', () => {
    const verdict = judgeCandidate(
      candidate({ volumeMm3: SPECKLE_VOLUME_MM3 - 1, distanceToCortexMm: 1 })
    );
    expect(verdict.exclusion).toBe('corticalSpeckle');
  });

  it('keeps a SMALL deposit that is not at the cortex', () => {
    expect(
      judgeCandidate(candidate({ volumeMm3: SPECKLE_VOLUME_MM3 - 1, distanceToCortexMm: 8 }))
        .accepted
    ).toBe(true);
  });

  it('keeps a LARGE deposit that is at the cortex', () => {
    expect(
      judgeCandidate(candidate({ volumeMm3: 400, distanceToCortexMm: CORTEX_PROXIMITY_MM }))
        .accepted
    ).toBe(true);
  });

  it('excludes vascular calcification next to a joint', () => {
    const verdict = judgeCandidate(
      candidate({ site: 'vessel', ...withRatio(1.1, TOPHUS_HU_MAX + 100) })
    );
    expect(verdict.exclusion).toBe('vascularCalcification');
  });
});

describe('urateDeposition — quantification reports what it threw away', () => {
  const mixed = () => [
    candidate({ id: 'tophus1', volumeMm3: 800 }),
    candidate({ id: 'tophus2', volumeMm3: 400, site: 'joint' }),
    candidate({ id: 'nail', volumeMm3: 120, site: 'nailBed' }),
    candidate({ id: 'speckle', volumeMm3: 4, distanceToCortexMm: 1 }),
  ];

  it('sums only the accepted deposits', () => {
    const result = quantifyUrate(mixed());
    expect(result.urateVolumeMm3).toBe(1200);
    expect(result.accepted.map(v => v.id)).toEqual(['tophus1', 'tophus2']);
  });

  // A volume that silently includes nail-bed artefact does not shrink when the patient
  // improves, and the therapy looks like it failed.
  it('reports the excluded volume next to the number, with the reasons', () => {
    const result = quantifyUrate(mixed());
    expect(result.excludedVolumeMm3).toBe(124);
    expect(result.exclusionCounts).toEqual({ nailBed: 1, corticalSpeckle: 1 });
    expect(result.message).toMatch(/Volume de urato 1\.20 cm³/);
    expect(result.message).toMatch(/Excluídos 0\.12 cm³ como artefato/);
    expect(result.message).toMatch(/1× nailBed/);
  });

  it('says so plainly when there is nothing at all', () => {
    expect(quantifyUrate([]).message).toBe('Sem depósitos candidatos.');
    expect(quantifyUrate([]).ok).toBe(true);
  });

  it('omits the artefact clause when nothing was excluded', () => {
    const result = quantifyUrate([candidate({ volumeMm3: 1000 })]);
    expect(result.message).toBe('Volume de urato 1.00 cm³.');
  });

  // Motion shows as a smear this module cannot see, but it can refuse to hand back a
  // number the reader would compare against a prior.
  it('refuses to stand behind a motion-degraded study', () => {
    const result = quantifyUrate(mixed(), { motionDegraded: true });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/NÃO é comparável com exames prévios/);
    // The volume is still computed, for display; it is the comparability that is refused.
    expect(result.urateVolumeMm3).toBe(1200);
  });
});

describe('urateDeposition — following a patient on therapy', () => {
  const study = (volumeMm3: number, artefactMm3 = 0, motionDegraded = false) =>
    quantifyUrate(
      [
        candidate({ id: 'a', volumeMm3 }),
        ...(artefactMm3 ? [candidate({ id: 'n', volumeMm3: artefactMm3, site: 'nailBed' })] : []),
      ],
      { motionDegraded }
    );

  it('reports a reduction under urate-lowering therapy', () => {
    const comparison = compareUrateVolumes(study(2000), study(1200));
    expect(comparison.direction).toBe('reduced');
    expect(comparison.message).toMatch(/reduzido em 40%/);
  });

  it('reports an increase', () => {
    expect(compareUrateVolumes(study(1000), study(1600)).direction).toBe('increased');
  });

  it('calls a small change stable rather than treatment effect', () => {
    expect(compareUrateVolumes(study(1000), study(1050)).direction).toBe('stable');
  });

  it('refuses to compare against a motion-degraded study', () => {
    const comparison = compareUrateVolumes(study(2000), study(1200, 0, true));
    expect(comparison.direction).toBe('notComparable');
    expect(comparison.message).toMatch(/degradado por movimento/);
  });

  // A follow-up where twice as much was thrown away is not measuring the same thing, and
  // the difference will read as treatment response.
  it('refuses when the excluded fraction changed a lot between the studies', () => {
    const comparison = compareUrateVolumes(study(2000, 0), study(1200, 1200));
    expect(comparison.direction).toBe('notComparable');
    expect(comparison.message).toMatch(/fração excluída como artefato mudou muito/);
  });

  it('still compares when the excluded fraction is similar', () => {
    expect(compareUrateVolumes(study(2000, 200), study(1200, 120)).direction).toBe('reduced');
  });
});
