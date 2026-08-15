import {
  assessExam,
  categoryMeta,
  classifyNodule,
  describeAssessment,
  formatCategory,
  GROWTH_THRESHOLD_MM,
  hasGrown,
  meanDiameterMm,
  NoduleFinding,
} from './lungRads';

const solid = (over: Partial<NoduleFinding> = {}): NoduleFinding => ({
  texture: 'solid',
  longAxisMm: 10,
  shortAxisMm: 10,
  context: 'baseline',
  ...over,
});

/** Builds a nodule whose rounded mean diameter is exactly `mm`. */
const sized = (mm: number, over: Partial<NoduleFinding> = {}): NoduleFinding =>
  solid({ longAxisMm: mm, shortAxisMm: mm, ...over });

describe('lungRads — the measurement rule is part of the classification', () => {
  it('is the mean of long and short axis', () => {
    expect(meanDiameterMm(10, 6)).toBe(8);
  });

  // 7.2 x 4.1 has a mean of 5.65. Rounded it is 6 — category 3, a 6-month CT. Unrounded
  // it stays under 6 and the patient goes back to annual screening.
  it('ROUNDS to the nearest whole millimetre, as the standard says', () => {
    expect(meanDiameterMm(7.2, 4.1)).toBe(6);
    expect(classifyNodule(solid({ longAxisMm: 7.2, shortAxisMm: 4.1 })).category).toBe('3');
  });

  it('rounds down below the half', () => {
    expect(meanDiameterMm(6.4, 4.4)).toBe(5);
    expect(classifyNodule(solid({ longAxisMm: 6.4, shortAxisMm: 4.4 })).category).toBe('2');
  });

  it('refuses measurements it cannot use', () => {
    expect(meanDiameterMm(0, 5)).toBe(0);
    expect(meanDiameterMm(NaN, 5)).toBe(0);
    const result = classifyNodule(solid({ longAxisMm: 0, shortAxisMm: 0 }));
    expect(result.category).toBe('0');
    expect(result.error).toMatch(/Medidas/);
  });
});

describe('lungRads — solid nodules at baseline', () => {
  it('under 6 mm is category 2', () => {
    expect(classifyNodule(sized(5)).category).toBe('2');
  });

  it('6 to under 8 mm is category 3', () => {
    expect(classifyNodule(sized(6)).category).toBe('3');
    expect(classifyNodule(sized(7)).category).toBe('3');
  });

  it('8 to under 15 mm is 4A', () => {
    expect(classifyNodule(sized(8)).category).toBe('4A');
    expect(classifyNodule(sized(14)).category).toBe('4A');
  });

  it('15 mm and over is 4B', () => {
    expect(classifyNodule(sized(15)).category).toBe('4B');
    expect(classifyNodule(sized(40)).category).toBe('4B');
  });

  it('a perifissural nodule under 10 mm is a lymph node, not a finding', () => {
    expect(classifyNodule(sized(9, { perifissural: true })).category).toBe('2');
    expect(classifyNodule(sized(9)).category).toBe('4A');
  });

  it('benign calcification or fat is category 1 at any size', () => {
    expect(classifyNodule(sized(25, { benignFeatures: true })).category).toBe('1');
  });
});

describe('lungRads — new, existing and growing are different rule sets', () => {
  // The unsafe direction is the tempting one: assuming baseline under-calls every new
  // nodule between 4 and 8 mm.
  it('REFUSES to classify without an exam context', () => {
    const result = classifyNodule({ ...sized(5), context: undefined as never });
    expect(result.category).toBe('0');
    expect(result.error).toMatch(/Contexto do exame/);
  });

  it('the same 5 mm nodule is 2 at baseline and 3 if new', () => {
    expect(classifyNodule(sized(5, { context: 'baseline' })).category).toBe('2');
    expect(classifyNodule(sized(5, { context: 'new' })).category).toBe('3');
  });

  it('a new nodule under 4 mm is still category 2', () => {
    expect(classifyNodule(sized(3, { context: 'new' })).category).toBe('2');
  });

  it('a new nodule of 6 to under 8 mm is 4A, not 3', () => {
    expect(classifyNodule(sized(6, { context: 'new' })).category).toBe('4A');
    expect(classifyNodule(sized(6, { context: 'baseline' })).category).toBe('3');
  });

  it('a new nodule of 8 mm or more is 4B', () => {
    expect(classifyNodule(sized(9, { context: 'new' })).category).toBe('4B');
  });

  it('growth is a 1.5 mm increase in mean diameter', () => {
    expect(hasGrown(7.5, 6)).toBe(true);
    expect(hasGrown(7.4, 6)).toBe(false);
    expect(GROWTH_THRESHOLD_MM).toBe(1.5);
  });

  it('a stable existing nodule keeps its baseline band', () => {
    expect(
      classifyNodule(sized(7, { context: 'existing', priorMeanDiameterMm: 6.5 })).category
    ).toBe('3');
  });

  it('a growing existing nodule jumps to 4A under 8 mm and 4B at or over', () => {
    expect(
      classifyNodule(sized(7, { context: 'existing', priorMeanDiameterMm: 5 })).category
    ).toBe('4A');
    expect(
      classifyNodule(sized(10, { context: 'existing', priorMeanDiameterMm: 7 })).category
    ).toBe('4B');
  });

  it('growth outranks the plain size band it would otherwise fall in', () => {
    // 10 mm stable would be 4A; growing it is 4B.
    expect(
      classifyNodule(sized(10, { context: 'existing', priorMeanDiameterMm: 9.5 })).category
    ).toBe('4A');
  });
});

describe('lungRads — part-solid is classified by the SOLID component', () => {
  const partSolid = (totalMm: number, solidMm?: number, over: Partial<NoduleFinding> = {}) =>
    classifyNodule({
      texture: 'partSolid',
      longAxisMm: totalMm,
      shortAxisMm: totalMm,
      solidComponentMm: solidMm,
      context: 'baseline',
      ...over,
    });

  it('under 6 mm total is category 2 regardless', () => {
    expect(partSolid(5, 3).category).toBe('2');
  });

  // Classifying on total size is the single easiest way to under-call a cancer here.
  it('the same 12 mm total is 4A or 4B depending on the solid component', () => {
    expect(partSolid(12, 3).category).toBe('3');
    expect(partSolid(12, 6).category).toBe('4A');
    expect(partSolid(12, 9).category).toBe('4B');
  });

  it('refuses a part-solid 6 mm or larger with no solid measurement', () => {
    const result = partSolid(12, undefined);
    expect(result.category).toBe('0');
    expect(result.error).toMatch(/componente sólido/);
  });

  it('a growing solid component escalates on its own', () => {
    expect(
      partSolid(12, 3, { context: 'existing', priorSolidComponentMm: 1 }).category
    ).toBe('4A');
    expect(
      partSolid(12, 5, { context: 'existing', priorSolidComponentMm: 3 }).category
    ).toBe('4B');
  });

  it('names the solid component in the rationale', () => {
    expect(partSolid(12, 9).rationale).toMatch(/componente sólido de 9 mm/);
  });
});

describe('lungRads — ground glass', () => {
  const ggn = (mm: number, over: Partial<NoduleFinding> = {}) =>
    classifyNodule({
      texture: 'groundGlass',
      longAxisMm: mm,
      shortAxisMm: mm,
      context: 'baseline',
      ...over,
    });

  it('under 30 mm is category 2', () => {
    expect(ggn(25).category).toBe('2');
  });

  it('30 mm or more at baseline is category 3', () => {
    expect(ggn(30).category).toBe('3');
  });

  it('30 mm or more but stable stays category 2', () => {
    expect(ggn(35, { context: 'existing', priorMeanDiameterMm: 34.5 }).category).toBe('2');
  });

  it('30 mm or more and growing is category 3', () => {
    expect(ggn(35, { context: 'existing', priorMeanDiameterMm: 30 }).category).toBe('3');
  });
});

describe('lungRads — the 4X modifier', () => {
  it('escalates a category 3 or 4 with additional suspicious features', () => {
    const result = classifyNodule(sized(7, { suspiciousFeatures: ['espiculação'] }));
    expect(result.category).toBe('4X');
    expect(result.escalatedBy).toEqual(['espiculação']);
    expect(result.rationale).toMatch(/Escalonado por achados adicionais/);
  });

  // Escalating a definitely-benign nodule is a contradiction the reader should resolve,
  // not something the table papers over.
  it('does NOT escalate a category 1 or 2', () => {
    expect(classifyNodule(sized(4, { suspiciousFeatures: ['espiculação'] })).category).toBe('2');
    expect(
      classifyNodule(sized(20, { benignFeatures: true, suspiciousFeatures: ['x'] })).category
    ).toBe('1');
  });

  it('carries the same management as 4B', () => {
    expect(categoryMeta('4X').management).toBe(categoryMeta('4B').management);
  });

  it('ignores an empty feature list', () => {
    expect(classifyNodule(sized(7, { suspiciousFeatures: [] })).category).toBe('3');
  });
});

describe('lungRads — endobronchial', () => {
  it('is 4A whatever the size', () => {
    expect(classifyNodule(sized(3, { endobronchial: true })).category).toBe('4A');
  });
});

describe('lungRads — the exam category', () => {
  it('is the most suspicious nodule, and names it', () => {
    const exam = assessExam([
      { ...sized(4), id: 'n1' },
      { ...sized(16), id: 'n2' },
      { ...sized(7), id: 'n3' },
    ]);
    expect(exam.category).toBe('4B');
    expect(exam.drivingNoduleId).toBe('n2');
    expect(exam.nodules).toHaveLength(3);
  });

  it('is category 1 with no nodules at all', () => {
    expect(assessExam([]).category).toBe('1');
  });

  // "I could not see part of the lung" outranks anything I did see.
  it('category 0 OVERRIDES the maximum rather than joining it', () => {
    const exam = assessExam([sized(20)], { incomplete: true });
    expect(exam.category).toBe('0');
    // The 4B is still visible per-nodule, so the reader can see what is there.
    expect(exam.nodules[0].category).toBe('4B');
  });

  it('falls to category 0 when a nodule could not be classified', () => {
    const exam = assessExam([
      sized(5),
      { texture: 'partSolid', longAxisMm: 12, shortAxisMm: 12, context: 'baseline' },
    ]);
    expect(exam.category).toBe('0');
    expect(exam.errors).toHaveLength(1);
  });

  it('carries the S and C modifiers', () => {
    const exam = assessExam([sized(16)], { significantOtherFinding: true, priorLungCancer: true });
    expect(exam.modifiers).toEqual(['S', 'C']);
    expect(formatCategory(exam)).toBe('Lung-RADS 4B-SC');
  });

  it('formats without a suffix when there are no modifiers', () => {
    expect(formatCategory(assessExam([sized(4)]))).toBe('Lung-RADS 2');
  });
});

describe('lungRads — the recommendation travels with the category', () => {
  // Nobody manages a patient from a number.
  it('every category carries a management line', () => {
    for (const category of ['0', '1', '2', '3', '4A', '4B', '4X'] as const) {
      expect(categoryMeta(category).management.length).toBeGreaterThan(10);
    }
  });

  it('the follow-up interval matches the category', () => {
    expect(categoryMeta('2').followUpMonths).toBe(12);
    expect(categoryMeta('3').followUpMonths).toBe(6);
    expect(categoryMeta('4A').followUpMonths).toBe(3);
    // 4B is not a timed follow-up; it is a workup.
    expect(categoryMeta('4B').followUpMonths).toBeNull();
  });

  it('the reported line has the category, the risk and the action', () => {
    const text = describeAssessment(assessExam([sized(16)]));
    expect(text).toMatch(/Lung-RADS 4B/);
    expect(text).toMatch(/> 15%/);
    expect(text).toMatch(/amostragem tecidual/);
  });

  it('survives a nullish assessment', () => {
    expect(describeAssessment(undefined as never)).toBe('');
    expect(formatCategory(undefined as never)).toBe('');
  });
});
