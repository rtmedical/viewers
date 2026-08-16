import {
  ACTION_THRESHOLD_MM,
  amendDecision,
  belowActionThreshold,
  couchShiftFromFusion,
  describeCorrection,
  PLAN_REFERENCES,
  PortalCorrection,
  recordCorrection,
  REFERENCE_LABELS,
  shiftMagnitudeMm,
  summariseCorrections,
} from './portalCorrection';

const T0 = 1_700_000_000_000;

const input = (over: Record<string, unknown> = {}) => ({
  id: 'pc-1',
  fusionId: 'f-1',
  courseId: 'c-1',
  fraction: 5,
  acquiredAt: T0,
  reference: 'drr' as const,
  fusionShiftMm: { lateralMm: 2, longitudinalMm: -3, verticalMm: 1 },
  decision: { kind: 'applied' as const, by: 'tec.silva', at: T0 },
  matchedBy: 'tec.silva',
  ...over,
});

const correction = (over: Record<string, unknown> = {}): PortalCorrection =>
  recordCorrection(input(over)).correction as PortalCorrection;

describe('portalCorrection — the two conventions point in opposite directions', () => {
  // Not a small error: it doubles the displacement.
  it('negates every axis', () => {
    expect(couchShiftFromFusion({ lateralMm: 2, longitudinalMm: -3, verticalMm: 1 })).toEqual({
      lateralMm: -2,
      longitudinalMm: 3,
      verticalMm: -1,
    });
  });

  it('derives the couch shift instead of accepting it, so the two cannot disagree', () => {
    const record = correction();
    expect(record.fusionShiftMm.lateralMm).toBe(2);
    expect(record.couchShiftMm.lateralMm).toBe(-2);
  });

  // The wrong-signed shift is the right size, which is why nothing looks wrong.
  it('produces a shift of the same magnitude in the other direction', () => {
    const record = correction();
    expect(shiftMagnitudeMm(record.couchShiftMm)).toBeCloseTo(shiftMagnitudeMm(record.fusionShiftMm), 10);
  });

  it('keeps the two as separate fields, not one field with a convention', () => {
    const record = correction();
    expect(Object.keys(record)).toEqual(expect.arrayContaining(['fusionShiftMm', 'couchShiftMm']));
  });
});

describe('portalCorrection — recorded is not applied', () => {
  it('requires a decision', () => {
    const result = recordCorrection(input({ decision: undefined }));
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/Deslocamento medido não é deslocamento aplicado/);
  });

  it('requires who decided, once it is not pending', () => {
    expect(recordCorrection(input({ decision: { kind: 'applied' } })).ok).toBe(false);
    expect(recordCorrection(input({ decision: { kind: 'pending' } })).ok).toBe(true);
  });

  // Indistinguishable from an oversight in the record.
  it('requires a reason for a refusal', () => {
    const result = recordCorrection(input({ decision: { kind: 'declined', by: 'tec.silva' } }));
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/indistinguível de um esquecimento no registro/);
  });

  it('accepts a refusal with a reason', () => {
    expect(
      recordCorrection(
        input({ decision: { kind: 'declined', by: 'tec.silva', reason: 'abaixo do limiar' } })
      ).ok
    ).toBe(true);
  });
});

describe('portalCorrection — the reference decides what the number means', () => {
  it('accepts a plan reference without comment', () => {
    expect(recordCorrection(input()).warnings).toEqual([]);
    expect(PLAN_REFERENCES).toEqual(['drr', 'planning-ct']);
  });

  // Drift since yesterday is not displacement from the plan.
  it('warns when the match was against a previous portal', () => {
    const result = recordCorrection(input({ reference: 'previous-portal' }));
    expect(result.ok).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/mede a deriva desde aquela imagem, não o deslocamento em relação ao plano/);
    expect(result.warnings.join(' ')).toMatch(/Não serve para a estatística de erro sistemático/);
  });

  it('refuses a missing reference', () => {
    expect(recordCorrection(input({ reference: undefined })).ok).toBe(false);
  });
});

describe('portalCorrection — correcting inside the noise', () => {
  // Leaves the systematic component untouched and adds to the random one.
  it('flags a shift below the action threshold and says what it costs', () => {
    const note = belowActionThreshold(
      correction({ fusionShiftMm: { lateralMm: 1, longitudinalMm: 0.5, verticalMm: 0 } })
    );
    expect(note.below).toBe(true);
    expect(note.message).toMatch(/move o paciente por uma quantidade aleatória a cada dia/);
    expect(note.message).toMatch(/pesa três vezes e meia mais/);
  });

  it('says nothing about a shift worth making', () => {
    expect(belowActionThreshold(correction()).below).toBe(false);
    expect(ACTION_THRESHOLD_MM).toBe(3);
  });

  it('honours a custom threshold', () => {
    expect(belowActionThreshold(correction(), 10).below).toBe(true);
  });
});

describe('portalCorrection — measured and applied are summarised apart', () => {
  const corrections = [
    correction({ id: 'a', fraction: 1, fusionShiftMm: { lateralMm: 4, longitudinalMm: 0, verticalMm: 0 } }),
    correction({
      id: 'b',
      fraction: 2,
      fusionShiftMm: { lateralMm: 6, longitudinalMm: 0, verticalMm: 0 },
      decision: { kind: 'declined', by: 'tec', reason: 'paciente instável' },
    }),
    correction({ id: 'c', fraction: 3, decision: { kind: 'pending' } }),
  ];

  it('counts the three decisions', () => {
    const summary = summariseCorrections(corrections);
    expect(summary).toMatchObject({ fractions: 3, applied: 1, declined: 1, pending: 1 });
  });

  // A summary built from the measured displacements describes a treatment that did not happen.
  it('reports the applied mean apart from the measured mean', () => {
    const summary = summariseCorrections(corrections);
    expect(summary.appliedMeanMm!.lateralMm).toBeCloseTo(-4, 6);
    expect(summary.measuredMeanMm!.lateralMm).toBeCloseTo(-4, 6);
    expect(summary.message).toMatch(/descreve um tratamento que não aconteceu/);
  });

  it('says nothing extra when everything was applied', () => {
    const summary = summariseCorrections([corrections[0]]);
    expect(summary.message).not.toMatch(/não aconteceu/);
    expect(summary.appliedMeanMm).not.toBeNull();
  });

  it('returns null means with nothing to average', () => {
    expect(summariseCorrections([]).appliedMeanMm).toBeNull();
  });
});

describe('portalCorrection — only the decision is editable', () => {
  // Editing the displacement turns a measurement into an opinion with no record of which.
  it('changes the decision and lists the change', () => {
    const result = amendDecision(correction({ decision: { kind: 'pending' } }), {
      kind: 'applied',
      by: 'tec.silva',
      at: T0,
    });
    expect(result.ok).toBe(true);
    expect(result.correction!.decision.kind).toBe('applied');
    expect(result.changes[0]).toEqual({ field: 'decision.kind', from: 'pending', to: 'applied' });
  });

  it('leaves the measured displacement untouched', () => {
    const before = correction();
    const after = amendDecision(before, { kind: 'declined', by: 'x', reason: 'y' }).correction!;
    expect(after.fusionShiftMm).toEqual(before.fusionShiftMm);
    expect(after.couchShiftMm).toEqual(before.couchShiftMm);
  });

  it('refuses a nameless decision and a reasonless refusal', () => {
    expect(amendDecision(correction(), { kind: 'applied' }).ok).toBe(false);
    expect(amendDecision(correction(), { kind: 'declined', by: 'x' }).ok).toBe(false);
  });
});

describe('portalCorrection — the timeline line', () => {
  it('states the couch shift, the reference and the decision', () => {
    expect(describeCorrection(correction())).toBe(
      `Fração 5 · mesa -2.0/3.0/-1.0 mm (3.7 mm) vs ${REFERENCE_LABELS.drr} · aplicada por tec.silva`
    );
  });

  it('says who refused and why', () => {
    const record = correction({
      decision: { kind: 'declined', by: 'tec.silva', reason: 'abaixo do limiar' },
    });
    expect(describeCorrection(record)).toMatch(/recusada por tec\.silva — abaixo do limiar$/);
  });
});
