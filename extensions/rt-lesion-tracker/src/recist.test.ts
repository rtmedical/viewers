import { ANATOMIC_SITES, findSite, kindForSite, NODAL_SITES, organForSite } from './anatomies';
import {
  assessNonTarget,
  assessTarget,
  assessTimepoints,
  isMeasurable,
  LesionMeasurement,
  MEASURABLE_NODAL_SHORT_AXIS_MM,
  MEASURABLE_NON_NODAL_MM,
  overallResponse,
  recistDiameterMm,
  RESPONSE_LABELS,
  sumOfDiameters,
  TARGET_MAX_PER_ORGAN,
  TARGET_MAX_TOTAL,
  validateTargetSelection,
} from './recist';

const solid = (id: string, mm: number, organ = 'liver'): LesionMeasurement => ({
  lesionId: id,
  kind: 'nonNodal',
  longestDiameterMm: mm,
  organ,
});

const nodal = (id: string, shortAxisMm: number): LesionMeasurement => ({
  lesionId: id,
  kind: 'nodal',
  shortAxisMm,
  organ: 'lymphNode',
});

describe('anatomic sites', () => {
  it('ships 38 sites', () => {
    expect(ANATOMIC_SITES).toHaveLength(38);
  });

  it('has unique ids', () => {
    const ids = ANATOMIC_SITES.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('groups every lymph-node station under one organ', () => {
    // RECIST treats lymph nodes as a single organ for the two-per-organ rule,
    // however far apart the stations are.
    expect(NODAL_SITES.length).toBeGreaterThan(1);
    expect(new Set(NODAL_SITES.map(s => s.organ))).toEqual(new Set(['lymphNode']));
  });

  it('defaults an unknown site to non-nodal', () => {
    // The safe direction: longest diameter and the 10 mm floor. Defaulting to nodal
    // would silently switch a solid organ to short-axis measurement.
    expect(kindForSite('somethingNew')).toBe('nonNodal');
    expect(kindForSite(undefined)).toBe('nonNodal');
    expect(kindForSite('nodeCervical')).toBe('nodal');
  });

  it('resolves organ keys', () => {
    expect(organForSite('nodeInguinal')).toBe('lymphNode');
    expect(organForSite('lung')).toBe('lung');
    expect(organForSite('unknown')).toBe('unknown');
    expect(findSite('lung')?.label).toBe('Lung');
  });
});

describe('recistDiameterMm', () => {
  it('uses the SHORT axis for nodes and the longest diameter otherwise', () => {
    // Summing longest diameters for nodes would overstate every sum in the study.
    expect(recistDiameterMm({ lesionId: 'n', kind: 'nodal', shortAxisMm: 12, longestDiameterMm: 30 })).toBe(12);
    expect(recistDiameterMm(solid('a', 25))).toBe(25);
  });

  it('counts an absent lesion as zero', () => {
    expect(recistDiameterMm({ lesionId: 'a', kind: 'nonNodal', absent: true })).toBe(0);
  });

  it('is NaN when the measurement is missing or nonsensical', () => {
    expect(recistDiameterMm({ lesionId: 'a', kind: 'nonNodal' })).toBeNaN();
    expect(recistDiameterMm({ lesionId: 'a', kind: 'nodal', shortAxisMm: -3 })).toBeNaN();
    expect(recistDiameterMm(undefined as never)).toBeNaN();
  });
});

describe('isMeasurable', () => {
  it('applies 10 mm for solid lesions and 15 mm short axis for nodes', () => {
    expect(isMeasurable(solid('a', MEASURABLE_NON_NODAL_MM))).toBe(true);
    expect(isMeasurable(solid('a', MEASURABLE_NON_NODAL_MM - 0.1))).toBe(false);
    expect(isMeasurable(nodal('n', MEASURABLE_NODAL_SHORT_AXIS_MM))).toBe(true);
    expect(isMeasurable(nodal('n', 12))).toBe(false);
  });
});

describe('sumOfDiameters', () => {
  it('adds the counting diameters', () => {
    expect(sumOfDiameters([solid('a', 20), solid('b', 15), nodal('n', 18)]).mm).toBe(53);
  });

  it('is not evaluable when a lesion could not be measured', () => {
    // Dropping it would compare a 2-lesion sum against a 3-lesion baseline and
    // manufacture a response.
    const sum = sumOfDiameters([
      solid('a', 20),
      { lesionId: 'b', kind: 'nonNodal', notEvaluable: true },
      solid('c', 15),
    ]);
    expect(sum.notEvaluable).toBe(true);
    expect(sum.mm).toBeNull();
    expect(sum.blockedBy).toEqual(['b']);
  });

  it('is not evaluable for an empty set', () => {
    expect(sumOfDiameters([]).notEvaluable).toBe(true);
  });

  it('counts absent lesions as zero rather than blocking', () => {
    const sum = sumOfDiameters([solid('a', 20), { lesionId: 'b', kind: 'nonNodal', absent: true }]);
    expect(sum.mm).toBe(20);
    expect(sum.notEvaluable).toBe(false);
  });
});

describe('validateTargetSelection', () => {
  it('accepts a valid selection', () => {
    expect(
      validateTargetSelection([solid('a', 20, 'liver'), solid('b', 15, 'lung'), nodal('n', 20)])
    ).toEqual([]);
  });

  it('rejects more than five target lesions', () => {
    const many = Array.from({ length: 6 }, (_u, i) => solid(`l${i}`, 20, `organ${i}`));
    const issues = validateTargetSelection(many);
    expect(issues.map(i => i.code)).toContain('tooMany');
    expect(issues.find(i => i.code === 'tooMany')?.message).toContain(String(TARGET_MAX_TOTAL));
  });

  it('rejects more than two in one organ', () => {
    const issues = validateTargetSelection([
      solid('a', 20, 'liver'),
      solid('b', 20, 'liver'),
      solid('c', 20, 'liver'),
    ]);
    const issue = issues.find(i => i.code === 'tooManyInOrgan');
    expect(issue).toBeDefined();
    expect(issue?.lesionIds).toEqual(['c']);
    expect(issue?.message).toContain(String(TARGET_MAX_PER_ORGAN));
  });

  it('treats all nodal stations as one organ', () => {
    const issues = validateTargetSelection([nodal('n1', 20), nodal('n2', 20), nodal('n3', 20)]);
    expect(issues.some(i => i.code === 'tooManyInOrgan')).toBe(true);
  });

  it('flags lesions below the measurability floor', () => {
    const issues = validateTargetSelection([solid('a', 8, 'liver')]);
    expect(issues.map(i => i.code)).toContain('notMeasurable');
  });

  it('handles nullish input', () => {
    expect(validateTargetSelection(undefined as never)).toEqual([]);
  });
});

describe('assessTarget', () => {
  const at = (measurements: LesionMeasurement[], baselineSumMm: number, nadirSumMm: number) =>
    assessTarget({ measurements, baselineSumMm, nadirSumMm });

  it('calls complete response when everything resolved', () => {
    const result = at(
      [
        { lesionId: 'a', kind: 'nonNodal', absent: true },
        nodal('n', 8),
      ],
      100,
      100
    );
    // The node is still visible at 8 mm, but RECIST counts sub-10 mm as resolved.
    expect(result.response).toBe('CR');
  });

  it('does not call CR while a node is still 10 mm or larger', () => {
    // 10 mm short axis is the cutoff, and it is exclusive: at exactly 10 the node is
    // still pathological. The sum fell from 100 to 10, so this is a deep PR -- the
    // point is only that it is not CR.
    const result = at([{ lesionId: 'a', kind: 'nonNodal', absent: true }, nodal('n', 10)], 100, 100);
    expect(result.response).not.toBe('CR');
    expect(result.response).toBe('PR');
  });

  it('calls partial response at exactly 30% below baseline', () => {
    expect(at([solid('a', 70)], 100, 100).response).toBe('PR');
    expect(at([solid('a', 71)], 100, 100).response).toBe('SD');
  });

  it('measures PR against BASELINE, not nadir', () => {
    // Baseline 100, nadir 90, now 65: 35% below baseline -> PR. Against the nadir it
    // is a 28% DECREASE, so nothing about PD applies here; the next test is the case
    // where the two disagree.
    expect(at([solid('a', 65)], 100, 90).response).toBe('PR');
  });

  it('measures PD against NADIR, not baseline, and PD beats PR', () => {
    // 100 -> 50 -> 70. Still 30% below baseline, but 40% above nadir: progression.
    const result = at([solid('a', 70)], 100, 50);
    expect(result.response).toBe('PD');
    expect(result.rationale).toContain('above nadir');
  });

  it('requires BOTH 20% and 5 mm for progression', () => {
    // A 4 mm nadir growing to 5 mm is 25% — measurement noise, not an event.
    expect(at([solid('a', 5)], 20, 4).response).not.toBe('PD');
    // 20 -> 25 is 25% and +5 mm: both thresholds met.
    expect(at([solid('a', 25)], 40, 20).response).toBe('PD');
  });

  it('does not call PD on a big relative jump that is under 5 mm', () => {
    expect(at([solid('a', 6)], 30, 4).response).toBe('PR');
  });

  it('is not evaluable when any lesion is not evaluable', () => {
    const result = at([solid('a', 20), { lesionId: 'b', kind: 'nonNodal', notEvaluable: true }], 100, 100);
    expect(result.response).toBe('NE');
    expect(result.rationale).toContain('b');
  });

  it('reports the changes it used', () => {
    const result = at([solid('a', 60)], 100, 80);
    expect(result.changeFromBaseline).toBeCloseTo(-0.4, 6);
    expect(result.changeFromNadir).toBeCloseTo(-0.25, 6);
    expect(result.absoluteChangeFromNadirMm).toBe(-20);
  });
});

describe('assessNonTarget', () => {
  it('is CR when there is no non-target disease at all', () => {
    expect(assessNonTarget({ present: false })).toBe('CR');
  });

  it('is CR when everything resolved', () => {
    expect(assessNonTarget({ allResolved: true })).toBe('CR');
  });

  it('is PD on unequivocal progression', () => {
    expect(assessNonTarget({ unequivocalProgression: true })).toBe('PD');
  });

  it('lets progression win over not-evaluable', () => {
    // Unequivocal progression is a finding; it does not become uncertain because a
    // different lesion was missed.
    expect(assessNonTarget({ unequivocalProgression: true, notEvaluable: true })).toBe('PD');
  });

  it('is NE when something could not be assessed', () => {
    expect(assessNonTarget({ notEvaluable: true })).toBe('NE');
  });

  it('is Non-CR/Non-PD otherwise', () => {
    expect(assessNonTarget({})).toBe('Non-CR/Non-PD');
  });
});

describe('overallResponse — the RECIST 1.1 table', () => {
  it.each([
    ['CR', 'CR', false, 'CR'],
    ['CR', 'Non-CR/Non-PD', false, 'PR'],
    ['CR', 'NE', false, 'PR'],
    ['PR', 'Non-CR/Non-PD', false, 'PR'],
    ['PR', 'NE', false, 'PR'],
    ['SD', 'Non-CR/Non-PD', false, 'SD'],
    ['SD', 'NE', false, 'SD'],
    ['NE', 'Non-CR/Non-PD', false, 'NE'],
    ['PD', 'CR', false, 'PD'],
    ['CR', 'PD', false, 'PD'],
    ['SD', 'PD', false, 'PD'],
  ])('target %s + non-target %s -> %s', (target, nonTarget, newLesions, expected) => {
    expect(
      overallResponse({ target: target as never, nonTarget: nonTarget as never, newLesions })
        .response
    ).toBe(expected);
  });

  it('makes CR target with residual non-target disease a PR, not a CR', () => {
    // The row people get wrong most often.
    const result = overallResponse({ target: 'CR', nonTarget: 'Non-CR/Non-PD' });
    expect(result.response).toBe('PR');
    expect(result.rationale).toContain('non-target disease persists');
  });

  it('makes any new lesion progression regardless of everything else', () => {
    for (const target of ['CR', 'PR', 'SD', 'NE'] as const) {
      const result = overallResponse({ target, nonTarget: 'CR', newLesions: true });
      expect(result.response).toBe('PD');
      expect(result.rationale).toBe('New lesions.');
    }
  });

  it('has a label for every response code', () => {
    for (const code of ['CR', 'PR', 'SD', 'PD', 'NE'] as const) {
      expect(RESPONSE_LABELS[code]).toBeTruthy();
    }
  });
});

describe('assessTimepoints', () => {
  it('carries baseline and nadir forward', () => {
    const results = assessTimepoints([
      { id: 'baseline', measurements: [solid('a', 100)] },
      { id: 'fu1', measurements: [solid('a', 50)] },
      { id: 'fu2', measurements: [solid('a', 70)] },
    ]);

    expect(results[0].isBaseline).toBe(true);
    expect(results[0].overall).toBe('NE');
    expect(results[1].overall).toBe('PR');
    expect(results[1].nadirMm).toBe(50);
    // 70 is 30% below baseline but 40% above the 50 mm nadir: progression.
    expect(results[2].overall).toBe('PD');
    expect(results[2].nadirMm).toBe(50);
  });

  it('does not let a not-evaluable scan move the nadir', () => {
    // An unmeasurable scan is missing information, not evidence of shrinkage.
    const results = assessTimepoints([
      { id: 'baseline', measurements: [solid('a', 100)] },
      { id: 'fu1', measurements: [{ lesionId: 'a', kind: 'nonNodal', notEvaluable: true }] },
      { id: 'fu2', measurements: [solid('a', 60)] },
    ]);
    expect(results[1].overall).toBe('NE');
    expect(results[1].nadirMm).toBe(100);
    expect(results[2].nadirMm).toBe(60);
    expect(results[2].overall).toBe('PR');
  });

  it('propagates new lesions as progression', () => {
    const results = assessTimepoints([
      { id: 'baseline', measurements: [solid('a', 100)] },
      { id: 'fu1', measurements: [solid('a', 40)], newLesions: true },
    ]);
    expect(results[1].overall).toBe('PD');
    expect(results[1].target.response).toBe('PR');
  });

  it('propagates non-target progression', () => {
    const results = assessTimepoints([
      { id: 'baseline', measurements: [solid('a', 100)] },
      {
        id: 'fu1',
        measurements: [solid('a', 40)],
        nonTarget: { unequivocalProgression: true },
      },
    ]);
    expect(results[1].overall).toBe('PD');
  });

  it('handles a not-evaluable baseline', () => {
    const results = assessTimepoints([
      { id: 'baseline', measurements: [{ lesionId: 'a', kind: 'nonNodal', notEvaluable: true }] },
      { id: 'fu1', measurements: [solid('a', 50)] },
    ]);
    expect(results[0].target.response).toBe('NE');
    // The first evaluable sum becomes the baseline for later comparisons.
    expect(results[1].nadirMm).toBe(50);
  });

  it('handles empty and nullish input', () => {
    expect(assessTimepoints([])).toEqual([]);
    expect(assessTimepoints(undefined as never)).toEqual([]);
  });
});
