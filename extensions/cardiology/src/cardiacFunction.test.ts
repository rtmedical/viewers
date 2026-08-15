import {
  analyseFunction,
  bodySurfaceAreaM2,
  categoriseEf,
  compareStudies,
  describeFunction,
  FunctionInput,
  indexToBsa,
  MYOCARDIAL_DENSITY_G_ML,
  PAPILLARY_LABELS,
  summationOfDisks,
} from './cardiacFunction';

const GEOMETRY = { thicknessMm: 8, gapMm: 2 };

/** A ten-slice stack whose areas taper from base to apex. */
const areas = (peakCm2: number) =>
  Array.from({ length: 10 }, (_, i) => peakCm2 * (1 - i / 12));

const contours = (peakCm2: number, epiPeakCm2?: number) =>
  areas(peakCm2).map((endocardialAreaCm2, i) => ({
    endocardialAreaCm2,
    ...(epiPeakCm2 !== undefined ? { epicardialAreaCm2: areas(epiPeakCm2)[i] } : {}),
  }));

const input = (over: Partial<FunctionInput> = {}): FunctionInput => ({
  endDiastole: contours(30, 45),
  endSystole: contours(12),
  geometry: GEOMETRY,
  papillaryConvention: 'inBloodPool',
  basalSliceRule: 'mostBasalWithFullRim',
  ...over,
});

describe('cardiacFunction — the slice gap', () => {
  it('uses thickness plus gap as the disk height', () => {
    const result = summationOfDisks([10, 10], GEOMETRY);
    expect(result.diskHeightMm).toBe(10);
    expect(result.volumeMl).toBeCloseTo(20, 9);
  });

  // The error is invisible in the ejection fraction, and present in every volume compared
  // against a published threshold.
  it('dropping the gap would lose 20% of the volume on an 8/2 stack', () => {
    const correct = summationOfDisks([10, 10], GEOMETRY).volumeMl;
    const withoutGap = summationOfDisks([10, 10], { thicknessMm: 8, gapMm: 0 }).volumeMl;
    expect(withoutGap / correct).toBeCloseTo(0.8, 9);
  });

  it('and would leave the ejection fraction untouched, which is why it hides', () => {
    const withGap = analyseFunction(input());
    const withoutGap = analyseFunction(input({ geometry: { thicknessMm: 8, gapMm: 0 } }));
    expect(withoutGap.ef).toBeCloseTo(withGap.ef, 9);
    expect(withoutGap.edvMl).toBeLessThan(withGap.edvMl * 0.85);
  });

  // A default of zero would be silently wrong on the majority of real stacks.
  it('REQUIRES the gap, with no default', () => {
    const result = summationOfDisks([10], { thicknessMm: 8 } as never);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/subestima o volume/);
  });

  it('refuses an empty stack', () => {
    expect(summationOfDisks([], GEOMETRY).failure).toBe('noSlices');
  });

  it('ignores non-finite areas rather than producing NaN', () => {
    expect(summationOfDisks([10, NaN, 10], GEOMETRY).sliceCount).toBe(2);
  });
});

describe('cardiacFunction — volumes and ejection fraction', () => {
  it('computes EDV, ESV, SV and EF', () => {
    const result = analyseFunction(input());
    expect(result.ok).toBe(true);
    expect(result.edvMl).toBeGreaterThan(result.esvMl);
    expect(result.svMl).toBeCloseTo(result.edvMl - result.esvMl, 9);
    expect(result.ef).toBeCloseTo(result.svMl / result.edvMl, 9);
  });

  it('catches contours swapped between the phases', () => {
    const result = analyseFunction(input({ endDiastole: contours(12), endSystole: contours(30) }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/trocados entre as fases/);
  });

  it('warns when the slice count differs between phases', () => {
    const result = analyseFunction(input({ endSystole: contours(12).slice(0, 9) }));
    expect(result.warnings.join(' ')).toMatch(/corte basal mudou entre as fases/);
  });

  it('computes mass at end diastole from the epicardial contour', () => {
    const result = analyseFunction(input());
    expect(result.massG).not.toBeNull();
    const epi = summationOfDisks(areas(45), GEOMETRY).volumeMl;
    const endo = summationOfDisks(areas(30), GEOMETRY).volumeMl;
    expect(result.massG).toBeCloseTo((epi - endo) * MYOCARDIAL_DENSITY_G_ML, 6);
  });

  it('leaves mass null without an epicardial contour', () => {
    expect(analyseFunction(input({ endDiastole: contours(30) })).massG).toBeNull();
  });

  it('warns rather than guessing on a partial epicardial contour', () => {
    const partial = contours(30, 45).map((c, i) => (i > 5 ? { endocardialAreaCm2: c.endocardialAreaCm2 } : c));
    const result = analyseFunction(input({ endDiastole: partial }));
    expect(result.massG).toBeNull();
    expect(result.warnings.join(' ')).toMatch(/epicárdico incompleto/);
  });
});

describe('cardiacFunction — the papillary convention is a required argument', () => {
  // A default would be a silent decision about somebody's ejection fraction.
  it('REFUSES without it', () => {
    const result = analyseFunction(input({ papillaryConvention: undefined as never }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/10–20%/);
  });

  it('carries it into the result and the readout', () => {
    const result = analyseFunction(input({ papillaryConvention: 'inMyocardium' }));
    expect(result.papillaryConvention).toBe('inMyocardium');
    expect(describeFunction(result)).toMatch(/papilares no miocárdio/);
  });

  // The reader has no way to see this from the images.
  it('refuses to compare two studies traced differently', () => {
    const a = analyseFunction(input({ papillaryConvention: 'inBloodPool' }));
    const b = analyseFunction(input({ papillaryConvention: 'inMyocardium' }));
    const comparison = compareStudies(a, b);
    expect(comparison.comparable).toBe(false);
    expect(comparison.message).toMatch(/seria da convenção, não do paciente/);
  });

  it('compares happily within a convention', () => {
    const a = analyseFunction(input());
    const b = analyseFunction(input({ endSystole: contours(9) }));
    const comparison = compareStudies(a, b);
    expect(comparison.comparable).toBe(true);
    expect(comparison.efChange).toBeGreaterThan(0);
    expect(comparison.message).toMatch(/pontos percentuais/);
  });

  it('reports the mass change when both sides have one', () => {
    const a = analyseFunction(input());
    const b = analyseFunction(input({ endDiastole: contours(30, 50) }));
    expect(compareStudies(a, b).massChangeG).toBeGreaterThan(0);
  });

  it('leaves the mass change null when one side lacks it', () => {
    const a = analyseFunction(input({ endDiastole: contours(30) }));
    expect(compareStudies(a, analyseFunction(input())).massChangeG).toBeNull();
  });

  it('labels both conventions', () => {
    expect(PAPILLARY_LABELS.inBloodPool).toMatch(/pool sanguíneo/);
    expect(PAPILLARY_LABELS.inMyocardium).toMatch(/miocárdio/);
  });
});

describe('cardiacFunction — the basal slice rule is recorded, not solved', () => {
  it('warns when it was not recorded', () => {
    const result = analyseFunction(input({ basalSliceRule: undefined }));
    expect(result.basalSliceRule).toBe('unrecorded');
    expect(result.warnings.join(' ')).toMatch(/maior fonte de variabilidade interobservador/);
  });

  it('is quiet when it was', () => {
    expect(analyseFunction(input()).warnings).toEqual([]);
  });
});

describe('cardiacFunction — indexing and categories', () => {
  it('indexes to body surface area', () => {
    const volumes = analyseFunction(input());
    const bsa = bodySurfaceAreaM2(70, 175);
    const indexed = indexToBsa(volumes, bsa)!;
    expect(indexed.edviMlM2).toBeCloseTo(volumes.edvMl / bsa, 9);
    expect(indexed.massIndexGM2).toBeCloseTo(volumes.massG! / bsa, 9);
  });

  it('returns null rather than dividing by a missing BSA', () => {
    expect(indexToBsa(analyseFunction(input()), 0)).toBeNull();
    expect(bodySurfaceAreaM2(0, 175)).toBe(0);
  });

  // The normal lower limit is sex-specific, which is why sex is an argument rather than a
  // constant hidden in a threshold.
  it('uses a sex-specific lower limit of normal', () => {
    expect(categoriseEf(0.53, 'male')).toBe('normal');
    expect(categoriseEf(0.53, 'female')).toBe('mildlyReduced');
  });

  it('bands the reduced ranges', () => {
    expect(categoriseEf(0.45, 'male')).toBe('mildlyReduced');
    expect(categoriseEf(0.35, 'male')).toBe('moderatelyReduced');
    expect(categoriseEf(0.2, 'male')).toBe('severelyReduced');
    expect(categoriseEf(NaN)).toBe('severelyReduced');
  });
});

describe('cardiacFunction — the readout', () => {
  it('carries the volumes, the EF, the mass and the convention', () => {
    const text = describeFunction(analyseFunction(input()), 'male');
    expect(text).toMatch(/^VDF \d+ mL · VSF \d+ mL · VS \d+ mL · FE \d+% \(\w+\)/);
    expect(text).toMatch(/massa \d+ g/);
    expect(text).toMatch(/papilares no pool sanguíneo/);
  });

  it('shows the reason when the analysis failed', () => {
    expect(describeFunction(analyseFunction(input({ papillaryConvention: undefined as never })))).toMatch(
      /Convenção de músculos papilares/
    );
  });

  it('survives a nullish result', () => {
    expect(describeFunction(undefined as never)).toBe('');
  });
});
