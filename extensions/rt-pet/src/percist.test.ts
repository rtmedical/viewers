import {
  assessPercist,
  compareTmtv,
  computeTmtv,
  describePercist,
  isMeasurable,
  liverThreshold,
  PERCIST_ABSOLUTE_CHANGE,
  PERCIST_RELATIVE_CHANGE,
  PercistInput,
  TMTV_METHOD_LABELS,
  TmtvVoxel,
} from './percist';

const LIVER = { sulMean: 2.0, sulSd: 0.3 };
// 1.5 * 2.0 + 2 * 0.3 = 3.6

const input = (over: Partial<PercistInput> = {}): PercistInput => ({
  baselineSulPeak: 10,
  currentSulPeak: 10,
  baselineLiver: LIVER,
  currentLiver: LIVER,
  baselineUptakeMin: 60,
  currentUptakeMin: 62,
  ...over,
});

describe('percist — measurable before responding', () => {
  it('computes 1.5x liver mean plus 2 SD', () => {
    expect(liverThreshold(LIVER)).toBeCloseTo(3.6, 9);
  });

  // A "response" measured on sub-threshold uptake is measuring normal variation.
  it('a lesion at or below the liver threshold is not measurable', () => {
    expect(isMeasurable(3.6, LIVER).measurable).toBe(false);
    expect(isMeasurable(3.7, LIVER).measurable).toBe(true);
    expect(isMeasurable(3.0, LIVER).message).toMatch(/não mensurável por PERCIST/);
  });

  it('refuses without a liver reference', () => {
    expect(isMeasurable(10, { sulMean: 0, sulSd: 0 }).message).toMatch(/Referência hepática/);
    expect(Number.isNaN(liverThreshold(undefined as never))).toBe(true);
  });

  it('returns NE when the baseline lesion was never measurable', () => {
    const result = assessPercist(input({ baselineSulPeak: 3.0 }));
    expect(result.response).toBe('NE');
    expect(result.rationale).toMatch(/^Baseline:/);
  });
});

describe('percist — the two conditions', () => {
  it('needs BOTH a 30% change and 0.8 absolute units', () => {
    expect(PERCIST_RELATIVE_CHANGE).toBe(0.3);
    expect(PERCIST_ABSOLUTE_CHANGE).toBe(0.8);
  });

  it('calls a big drop a partial metabolic response', () => {
    const result = assessPercist(input({ baselineSulPeak: 10, currentSulPeak: 6 }));
    expect(result.response).toBe('PMR');
    expect(result.changeFraction).toBeCloseTo(-0.4, 9);
    expect(result.rationale).toMatch(/atende aos dois critérios/);
  });

  it('calls a big rise progressive disease', () => {
    expect(assessPercist(input({ baselineSulPeak: 10, currentSulPeak: 15 })).response).toBe('PMD');
  });

  // 30% of a small number is a small number. Reporting it as a response is how a treatment
  // gets credited with an effect it did not have.
  it('a full 30% drop that is only 0.78 units is STABLE, not a response', () => {
    // Needs a cooler liver, or a lesion this small would not be measurable at all — which
    // is itself the standard protecting against the same mistake one step earlier.
    const coolLiver = { sulMean: 1.0, sulSd: 0.1 }; // threshold 1.7
    const result = assessPercist(
      input({
        baselineSulPeak: 2.6,
        currentSulPeak: 1.82,
        baselineLiver: coolLiver,
        currentLiver: coolLiver,
      })
    );
    expect(Math.abs(result.changeFraction)).toBeGreaterThanOrEqual(0.3);
    expect(Math.abs(result.changeAbsolute)).toBeLessThan(0.8);
    expect(result.response).toBe('SMD');
    expect(result.rationale).toMatch(/não atinge o piso absoluto de 0\.8/);
  });

  it('the same 30% on a big lesion IS a response, because the absolute change is real', () => {
    const result = assessPercist(input({ baselineSulPeak: 10, currentSulPeak: 7 }));
    expect(Math.abs(result.changeFraction)).toBeCloseTo(0.3, 9);
    expect(result.response).toBe('PMR');
  });

  it('a small relative change is stable even when large in absolute terms', () => {
    const result = assessPercist(input({ baselineSulPeak: 40, currentSulPeak: 36 }));
    expect(result.response).toBe('SMD');
    expect(result.rationale).toMatch(/abaixo dos 30%/);
  });

  it('calls no change stable', () => {
    expect(assessPercist(input()).response).toBe('SMD');
  });
});

describe('percist — complete response', () => {
  it('is declared when uptake falls below the CURRENT liver threshold', () => {
    const result = assessPercist(input({ currentSulPeak: 3.0 }));
    expect(result.response).toBe('CMR');
    expect(result.rationale).toMatch(/abaixo do limiar hepático/);
  });

  // The patient's own liver moved too, so the current scan's reference is the right one.
  it('uses the current scan liver, not the baseline one', () => {
    const hotterLiver = { sulMean: 3.0, sulSd: 0.5 }; // threshold 5.5
    const result = assessPercist(input({ currentSulPeak: 5.0, currentLiver: hotterLiver }));
    expect(result.response).toBe('CMR');
    // Against the baseline liver (3.6) the same 5.0 would still be measurable.
    expect(assessPercist(input({ currentSulPeak: 5.0 })).response).not.toBe('CMR');
  });

  it('accepts an explicit complete resolution', () => {
    const result = assessPercist(input({ completeResolution: true }));
    expect(result.response).toBe('CMR');
    expect(result.changeFraction).toBe(-1);
  });
});

describe('percist — a new lesion is progression regardless of the arithmetic', () => {
  it('overrides a large drop in the measured lesion', () => {
    const result = assessPercist(input({ baselineSulPeak: 10, currentSulPeak: 3.7, newLesion: true }));
    expect(result.response).toBe('PMD');
    expect(result.rationale).toMatch(/Nova lesão/);
  });

  it('overrides complete resolution too', () => {
    expect(
      assessPercist(input({ newLesion: true, completeResolution: true })).response
    ).toBe('PMD');
  });
});

describe('percist — uptake time gates everything', () => {
  it('returns NE when the two scans are more than 15 min apart', () => {
    const result = assessPercist(input({ baselineUptakeMin: 60, currentUptakeMin: 90 }));
    expect(result.response).toBe('NE');
    expect(result.rationale).toMatch(/acima do limite de 15 min/);
  });

  it('is checked before measurability, so the reason names the real problem', () => {
    const result = assessPercist(
      input({ baselineSulPeak: 3.0, baselineUptakeMin: 60, currentUptakeMin: 95 })
    );
    expect(result.rationale).toMatch(/captação/);
  });

  it('warns rather than refusing when the times were not recorded', () => {
    const result = assessPercist(
      input({ baselineUptakeMin: undefined, currentUptakeMin: undefined, currentSulPeak: 6 })
    );
    expect(result.response).toBe('PMR');
    expect(result.warnings[0]).toMatch(/não registrado/);
    expect(describePercist(result)).toMatch(/não registrado/);
  });
});

describe('percist — TMTV, where the threshold IS the answer', () => {
  const voxels: TmtvVoxel[] = [
    { suv: 12, volumeMl: 1 },
    { suv: 6, volumeMl: 1 },
    { suv: 4, volumeMl: 1 },
    { suv: 3, volumeMl: 1 },
    { suv: 1, volumeMl: 1 },
  ];

  it('41% of SUVmax keeps only what is above 4.92', () => {
    const result = computeTmtv(voxels, { method: 'suvMax41', suvMax: 12 });
    expect(result.threshold).toBeCloseTo(4.92, 6);
    expect(result.volumeMl).toBe(2);
  });

  it('a fixed SUV of 2.5 keeps much more', () => {
    expect(computeTmtv(voxels, { method: 'fixedSuv25' }).volumeMl).toBe(4);
  });

  it('the liver-based threshold sits somewhere else again', () => {
    const result = computeTmtv(voxels, { method: 'liverBased', liver: LIVER });
    expect(result.threshold).toBeCloseTo(3.6, 6);
    expect(result.volumeMl).toBe(3);
  });

  // The three thresholds disagree by around 2x on the same patient.
  it('the three methods disagree by about 2x on the same data', () => {
    const a = computeTmtv(voxels, { method: 'suvMax41', suvMax: 12 }).volumeMl;
    const b = computeTmtv(voxels, { method: 'fixedSuv25' }).volumeMl;
    expect(b / a).toBeGreaterThanOrEqual(2);
  });

  it('computes total lesion glycolysis alongside', () => {
    const result = computeTmtv(voxels, { method: 'suvMax41', suvMax: 12 });
    expect(result.tlg).toBe(18);
  });

  // A caller that has not decided which definition it is using has not asked a well-formed
  // question.
  it('has NO default method', () => {
    expect(computeTmtv(voxels, {} as never).ok).toBe(false);
    expect(computeTmtv(voxels, {} as never).reason).toMatch(/não informado/);
  });

  it('refuses 41% without a SUVmax and liver-based without a liver', () => {
    expect(computeTmtv(voxels, { method: 'suvMax41' }).reason).toMatch(/SUVmax/);
    expect(computeTmtv(voxels, { method: 'liverBased' }).reason).toMatch(/hepática/);
  });

  it('labels every method', () => {
    for (const key of Object.keys(TMTV_METHOD_LABELS)) {
      expect(TMTV_METHOD_LABELS[key as keyof typeof TMTV_METHOD_LABELS].length).toBeGreaterThan(3);
    }
  });

  it('handles an empty volume', () => {
    expect(computeTmtv([], { method: 'fixedSuv25' })).toMatchObject({ volumeMl: 0, ok: true });
  });
});

describe('percist — comparing TMTV across studies', () => {
  const voxels: TmtvVoxel[] = [
    { suv: 12, volumeMl: 1 },
    { suv: 6, volumeMl: 1 },
    { suv: 4, volumeMl: 1 },
  ];

  it('reports the change when the method matches', () => {
    const prior = computeTmtv(voxels, { method: 'fixedSuv25' });
    const current = computeTmtv(voxels.slice(0, 2), { method: 'fixedSuv25' });
    const comparison = compareTmtv(prior, current);
    expect(comparison.comparable).toBe(true);
    expect(comparison.changeFraction).toBeCloseTo(-1 / 3, 6);
  });

  // The difference would be entirely definitional, and it will be reported as response.
  it('REFUSES to compare across methods', () => {
    const prior = computeTmtv(voxels, { method: 'suvMax41', suvMax: 12 });
    const current = computeTmtv(voxels, { method: 'fixedSuv25' });
    const comparison = compareTmtv(prior, current);
    expect(comparison.comparable).toBe(false);
    expect(comparison.message).toMatch(/definicional, não biológica/);
  });

  it('refuses when a baseline volume is zero', () => {
    const prior = computeTmtv([], { method: 'fixedSuv25' });
    const current = computeTmtv(voxels, { method: 'fixedSuv25' });
    expect(compareTmtv(prior, current).comparable).toBe(false);
  });

  it('refuses when either side failed', () => {
    expect(compareTmtv(computeTmtv(voxels, {} as never), computeTmtv(voxels, { method: 'fixedSuv25' })).comparable).toBe(
      false
    );
  });
});
