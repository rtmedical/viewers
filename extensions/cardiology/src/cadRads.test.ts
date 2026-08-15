import {
  areaStenosisFromDiameter,
  assessSegment,
  assessStudy,
  CADRADS_MANAGEMENT,
  CadRadsCategory,
  describeStudy,
  diameterStenosis,
  formatCategory,
  SegmentInput,
} from './cadRads';

/** A segment with a given diameter stenosis. */
const segment = (
  stenosis: number,
  over: Partial<SegmentInput> = {}
): SegmentInput => ({
  segmentId: 'LAD prox',
  measurement: { minimal: 1 - stenosis, reference: 1, basis: 'diameter' },
  calcification: 'none',
  referenceChoice: 'interpolated',
  ...over,
});

describe('cadRads — diameter and area differ by a square', () => {
  it('computes diameter stenosis from diameters', () => {
    expect(diameterStenosis({ minimal: 1, reference: 2, basis: 'diameter' })).toBeCloseTo(0.5, 9);
  });

  // A 50% diameter stenosis is a 75% area stenosis.
  it('converts an area ratio instead of treating it as a diameter ratio', () => {
    expect(diameterStenosis({ minimal: 25, reference: 100, basis: 'area' })).toBeCloseTo(0.5, 9);
    expect(areaStenosisFromDiameter(0.5)).toBeCloseTo(0.75, 9);
  });

  // Quoting an area reduction into a diameter table moves the patient up two categories.
  it('and the two would land in DIFFERENT CAD-RADS categories', () => {
    const asArea = assessSegment(
      segment(0, { measurement: { minimal: 25, reference: 100, basis: 'area' } })
    );
    const misreadAsDiameter = assessSegment(
      segment(0, { measurement: { minimal: 25, reference: 100, basis: 'diameter' } })
    );
    expect(asArea.category).toBe('3');
    expect(misreadAsDiameter.category).toBe('4A');
  });

  it('clamps a minimal larger than the reference to zero stenosis', () => {
    expect(diameterStenosis({ minimal: 3, reference: 2, basis: 'diameter' })).toBe(0);
  });

  it('is NaN for unusable measurements rather than a number', () => {
    expect(Number.isNaN(diameterStenosis({ minimal: 1, reference: 0, basis: 'diameter' }))).toBe(true);
    expect(Number.isNaN(areaStenosisFromDiameter(2))).toBe(true);
  });
});

describe('cadRads — the bands', () => {
  const categoryFor = (stenosis: number) => assessSegment(segment(stenosis)).category;

  it('maps stenosis to the published categories', () => {
    expect(categoryFor(0)).toBe('0');
    expect(categoryFor(0.1)).toBe('1');
    expect(categoryFor(0.3)).toBe('2');
    expect(categoryFor(0.55)).toBe('3');
    expect(categoryFor(0.8)).toBe('4A');
  });

  it('is right at the boundaries', () => {
    expect(categoryFor(0.24)).toBe('1');
    expect(categoryFor(0.25)).toBe('2');
    expect(categoryFor(0.49)).toBe('2');
    expect(categoryFor(0.5)).toBe('3');
    expect(categoryFor(0.69)).toBe('3');
    expect(categoryFor(0.7)).toBe('4A');
  });

  it('an occlusion is category 5, decided before the arithmetic', () => {
    const result = assessSegment(segment(0.1, { occluded: true }));
    expect(result.category).toBe('5');
    expect(result.rationale).toMatch(/Oclusão total/);
  });

  it('states the percentage in the rationale', () => {
    expect(assessSegment(segment(0.55)).rationale).toMatch(/55% de estenose de diâmetro/);
  });
});

describe('cadRads — calcium blooming and the honest refusal', () => {
  // The characteristic CTA error is a confident 70% through a heavily calcified segment,
  // and it sends patients to catheterisation.
  it('REFUSES to give a percentage through a severely calcified segment', () => {
    const result = assessSegment(segment(0.8, { calcification: 'severe' }));
    expect(result.assessable).toBe(false);
    expect(result.stenosis).toBeNull();
    expect(result.category).toBe('N');
    expect(result.modifiers).toContain('N');
    expect(result.rationale).toMatch(/florescimento infla a estenose aparente/);
  });

  it('warns but still measures through moderate calcification', () => {
    const result = assessSegment(segment(0.8, { calcification: 'moderate' }));
    expect(result.assessable).toBe(true);
    expect(result.category).toBe('4A');
    expect(result.warnings.join(' ')).toMatch(/tende a superestimar/);
  });

  it('says nothing about mild or absent calcification', () => {
    expect(assessSegment(segment(0.8, { calcification: 'mild' })).warnings).toEqual([]);
  });

  it('returns N for unusable measurements too', () => {
    const result = assessSegment(
      segment(0, { measurement: { minimal: 1, reference: 0, basis: 'diameter' } })
    );
    expect(result.category).toBe('N');
    expect(result.rationale).toMatch(/inválidas/);
  });
});

describe('cadRads — the reference diameter is a choice', () => {
  it('warns when it was not recorded', () => {
    expect(
      assessSegment(segment(0.4, { referenceChoice: undefined })).warnings.join(' ')
    ).toMatch(/proximal, distal e interpolada dão respostas diferentes/);
  });

  // In exactly the patients with the most disease.
  it('flags a proximal reference in a diffusely diseased vessel', () => {
    const result = assessSegment(
      segment(0.4, { referenceChoice: 'proximal', diffuseDisease: true })
    );
    expect(result.warnings.join(' ')).toMatch(/sai subestimada/);
  });

  it('does not flag a proximal reference in a focally diseased vessel', () => {
    expect(
      assessSegment(segment(0.4, { referenceChoice: 'proximal' })).warnings
    ).toEqual([]);
  });
});

describe('cadRads — modifiers', () => {
  it('carries stent, graft and high-risk plaque', () => {
    const result = assessSegment(
      segment(0.4, { stented: true, graft: true, highRiskPlaque: true })
    );
    expect(result.modifiers).toEqual(expect.arrayContaining(['S', 'G', 'HRP']));
  });

  it('formats them onto the category', () => {
    expect(formatCategory('4A', ['S', 'HRP'])).toBe('CAD-RADS 4A/S/HRP');
    expect(formatCategory('1')).toBe('CAD-RADS 1');
  });

  it('does not print a redundant N on a category N', () => {
    expect(formatCategory('N', ['N'])).toBe('CAD-RADS N');
  });

  it('deduplicates', () => {
    expect(formatCategory('2', ['S', 'S'])).toBe('CAD-RADS 2/S');
  });
});

describe('cadRads — the study category', () => {
  it('is the most severe segment, and names it', () => {
    const study = assessStudy([
      { ...segment(0.1), segmentId: 'RCA' },
      { ...segment(0.75), segmentId: 'LAD prox' },
      { ...segment(0.3), segmentId: 'CX' },
    ]);
    expect(study.category).toBe('4A');
    expect(study.drivingSegmentId).toBe('LAD prox');
  });

  // "I could not assess a segment" is a stronger statement than anything I could assess,
  // because the unassessed segment might be the worst one.
  it('N OUTRANKS everything, so a clean study with one blind segment is not normal', () => {
    const study = assessStudy([
      { ...segment(0.05), segmentId: 'RCA' },
      { ...segment(0.05), segmentId: 'LAD prox', calcification: 'severe' },
    ]);
    expect(study.category).toBe('N');
    expect(study.nonDiagnosticSegments).toEqual(['LAD prox']);
    expect(describeStudy(study)).toMatch(/Segmentos não avaliáveis: LAD prox/);
  });

  it('is 0 for a clean study', () => {
    expect(assessStudy([segment(0)]).category).toBe('0');
  });

  // The arithmetic on one segment cannot see this.
  it('promotes to 4B for left main or three-vessel disease', () => {
    const study = assessStudy([segment(0.8)], { leftMainOrThreeVessel: true });
    expect(study.category).toBe('4B');
    expect(study.management).toMatch(/Angiografia invasiva/);
  });

  it('does not promote a non-severe study to 4B', () => {
    expect(assessStudy([segment(0.3)], { leftMainOrThreeVessel: true }).category).toBe('2');
  });

  it('does not promote a non-diagnostic study to 4B', () => {
    const study = assessStudy([segment(0.8, { calcification: 'severe' })], {
      leftMainOrThreeVessel: true,
    });
    expect(study.category).toBe('N');
  });

  it('adds the exception modifier when asked', () => {
    expect(assessStudy([segment(0.1)], { exception: true }).modifiers).toContain('E');
  });

  it('is N with no segments at all', () => {
    expect(assessStudy([]).category).toBe('N');
  });

  it('deduplicates warnings across segments', () => {
    const study = assessStudy([
      segment(0.4, { referenceChoice: undefined }),
      segment(0.5, { referenceChoice: undefined }),
    ]);
    expect(study.warnings).toHaveLength(1);
  });
});

describe('cadRads — the recommendation travels with the category', () => {
  it('every category has one', () => {
    for (const category of ['0', '1', '2', '3', '4A', '4B', '5', 'N'] as CadRadsCategory[]) {
      expect(CADRADS_MANAGEMENT[category].length).toBeGreaterThan(15);
    }
  });

  it('the line has the category and the action', () => {
    const text = describeStudy(assessStudy([segment(0.75)]));
    expect(text).toMatch(/^CAD-RADS 4A —/);
    expect(text).toMatch(/angiografia invasiva/i);
  });

  it('survives a nullish assessment', () => {
    expect(describeStudy(undefined as never)).toBe('');
  });
});
