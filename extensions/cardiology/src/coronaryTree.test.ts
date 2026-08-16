import {
  assessSegmentContext,
  checkModelAmbiguity,
  coverage,
  describeSegment,
  DOMINANCE_LABELS,
  findSegment,
  MIN_ASSESSABLE_MM,
  MODEL_CONFLICTS,
  parentChain,
  SCCT_SEGMENTS,
  SEGMENT_MODELS,
  SegmentContext,
  segmentsFor,
  territoryOf,
  VESSEL_LABELS,
} from './coronaryTree';

const ctx = (over: Partial<SegmentContext> = {}): SegmentContext => ({
  id: 7,
  diameterMm: 3,
  occludedSegments: [],
  dominance: 'right',
  model: 'scct-18',
  ...over,
});

describe('coronaryTree — the model', () => {
  it('has eighteen segments with unique ids', () => {
    expect(SCCT_SEGMENTS).toHaveLength(18);
    expect(new Set(SCCT_SEGMENTS.map(s => s.id)).size).toBe(18);
  });

  it('gives every segment a vessel and a territory', () => {
    for (const segment of SCCT_SEGMENTS) {
      expect(VESSEL_LABELS[segment.vessel]).toBeDefined();
      expect(segment.territory).toBeTruthy();
    }
  });

  it('walks the chain back to the ostium', () => {
    expect(parentChain(8).map(s => s.id)).toEqual([7, 6, 5]);
    expect(parentChain(1)).toEqual([]);
  });

  it('never loops on a malformed chain', () => {
    expect(parentChain(14).map(s => s.id)).toEqual([13, 11, 5]);
  });
});

describe('coronaryTree — dominance decides who owns the posterior descending', () => {
  it('puts the PDA on the right in right dominance and drops the left one', () => {
    const right = segmentsFor('right').map(s => s.id);
    expect(right).toContain(4);
    expect(right).not.toContain(15);
  });

  it('does the reverse in left dominance', () => {
    const left = segmentsFor('left').map(s => s.id);
    expect(left).toContain(15);
    expect(left).not.toContain(4);
  });

  it('keeps both in codominance', () => {
    const both = segmentsFor('codominant').map(s => s.id);
    expect(both).toContain(4);
    expect(both).toContain(15);
  });

  // The territory is the same either way, which is exactly why the mistake reads plausibly.
  it('gives both posterior descendings the inferior wall', () => {
    expect(findSegment(4)!.territory).toBe('inferior');
    expect(findSegment(15)!.territory).toBe('inferior');
  });

  it('says which artery the PDA came off in this patient', () => {
    expect(territoryOf(4, 'right')!.message).toMatch(/nasce da coronária direita nesta dominância direita/);
    expect(territoryOf(15, 'left')!.message).toMatch(/nasce da circunflexa nesta dominância esquerda/);
  });

  it('says when the segment does not exist in this dominance', () => {
    expect(territoryOf(15, 'right')!.message).toMatch(/não existe em dominância direita/);
    expect(territoryOf(99, 'right')).toBeNull();
  });
});

describe('coronaryTree — a segment number without a model is ambiguous', () => {
  // Two different vessels, one label.
  it('flags segment 4', () => {
    const check = checkModelAmbiguity(4, 'scct-18');
    expect(check.ambiguous).toBe(true);
    expect(check.message).toMatch(/Descendente posterior direita.*CD distal/);
    expect(check.message).toMatch(/uma comparação entre exames compara duas artérias diferentes/);
  });

  it('flags the segments the older model does not have', () => {
    for (const id of [15, 16, 17, 18]) {
      expect(MODEL_CONFLICTS[id].aha).toBe('não existe');
    }
  });

  it('is quiet on a segment that means the same in both', () => {
    expect(checkModelAmbiguity(7, 'scct-18').ambiguous).toBe(false);
  });

  it('names the model the report is using', () => {
    expect(checkModelAmbiguity(4, 'aha-15').message).toMatch(
      new RegExp(`Este laudo usa ${SEGMENT_MODELS['aha-15']}`)
    );
  });
});

describe('coronaryTree — a stenosis distal to an occlusion is not a stenosis', () => {
  it('reports a plain segment as measurable', () => {
    const result = assessSegmentContext(ctx());
    expect(result.reportable).toBe(true);
    expect(result.message).toMatch(/DA média.*mensurável/);
  });

  // Same failure as the carotid near-occlusion, and the same reassuring number.
  it('refuses a percentage distal to a total occlusion', () => {
    const result = assessSegmentContext(ctx({ id: 8, occludedSegments: [6] }));
    expect(result.reportable).toBe(false);
    expect(result.refusals.join(' ')).toMatch(/uma referência que encolheu junto/);
    expect(result.refusals.join(' ')).toMatch(/mesma falha da quase-oclusão carotídea/);
  });

  it('treats the occluded segment itself as an occlusion, not a percentage', () => {
    const result = assessSegmentContext(ctx({ id: 6, occludedSegments: [6] }));
    expect(result.warnings.join(' ')).toMatch(/oclusão total, não uma porcentagem/);
    expect(result.reportable).toBe(true);
  });

  it('does not care about an occlusion in another vessel', () => {
    expect(assessSegmentContext(ctx({ id: 7, occludedSegments: [1] })).reportable).toBe(true);
  });
});

describe('coronaryTree — below a calibre a percentage is noise', () => {
  // Not conservative: it produces a downstream test for an unmeasurable finding.
  it('refuses a small branch and says what reporting it costs', () => {
    const result = assessSegmentContext(ctx({ id: 10, diameterMm: 1.0 }));
    expect(result.reportable).toBe(false);
    expect(result.refusals.join(' ')).toMatch(
      /reportá-la não é conservador, gera uma investigação a jusante/
    );
    expect(MIN_ASSESSABLE_MM).toBe(1.5);
  });

  it('accepts a segment at the limit', () => {
    expect(assessSegmentContext(ctx({ id: 10, diameterMm: 1.6 })).reportable).toBe(true);
  });

  it('does not refuse when the calibre was not measured', () => {
    expect(assessSegmentContext(ctx({ diameterMm: undefined })).reportable).toBe(true);
  });

  it('refuses a segment that does not exist in this dominance', () => {
    const result = assessSegmentContext(ctx({ id: 15, dominance: 'right' }));
    expect(result.exists).toBe(false);
    expect(result.reportable).toBe(false);
  });

  it('refuses an unknown segment number', () => {
    expect(assessSegmentContext(ctx({ id: 42 })).exists).toBe(false);
  });
});

describe('coronaryTree — a segment left out is not a normal segment', () => {
  it('lists what nobody mentioned', () => {
    const result = coverage('right', [1, 2, 3, 5, 6, 7], [8]);
    expect(result.complete).toBe(false);
    expect(result.missing).toContain(11);
    expect(result.message).toMatch(/não tem como distinguir "sem lesão" de "não olhado"/);
  });

  it('counts a non-evaluable segment as mentioned', () => {
    const all = segmentsFor('right').map(s => s.id);
    expect(coverage('right', all.slice(1), [all[0]]).complete).toBe(true);
  });

  it('expects only the segments this dominance has', () => {
    const result = coverage('right', segmentsFor('right').map(s => s.id));
    expect(result.complete).toBe(true);
    expect(result.message).toMatch(new RegExp(DOMINANCE_LABELS.right));
  });
});

describe('coronaryTree — the panel line', () => {
  it('names the segment, the vessel and the territory', () => {
    expect(describeSegment(ctx({ id: 12 }))).toMatch(
      /^Primeira marginal obtusa \(circunflexa, parede lateral\) — mensurável\./
    );
  });

  it('carries the model ambiguity as a warning', () => {
    expect(describeSegment(ctx({ id: 4 }))).toMatch(/compara duas artérias diferentes/);
  });
});
