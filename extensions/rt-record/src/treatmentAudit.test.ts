import { ExternalBeamRecord, markProvenance, TreatmentRecord } from './manualTreatment';
import {
  amendRecord,
  AuditEntry,
  describeEntry,
  diffRecords,
  doseImpact,
  insertRecord,
  restoreRecord,
  RETIRE_REASONS,
  retireRecord,
  stateAt,
  summariseWithAudit,
} from './treatmentAudit';

const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;

const provenance = markProvenance({
  reason: 'export-failed',
  enteredBy: 'tec.silva',
  enteredAt: T0,
}).provenance!;

const record = (over: Partial<ExternalBeamRecord> = {}): ExternalBeamRecord => ({
  kind: 'external-beam',
  id: 'r1',
  courseId: 'c1',
  fractionNumber: 5,
  deliveredAt: T0 - HOUR,
  doseGy: 2,
  beams: [{ name: 'AP' }],
  machine: 'TrueBeam-1',
  provenance,
  ...over,
});

describe('treatmentAudit — "edited" is not an audit entry', () => {
  it('records the old and the new value side by side', () => {
    const result = amendRecord(record(), { doseGy: 2.2 } as never, {
      by: 'fis.costa',
      at: T0 + HOUR,
      reason: 'Conferido contra a folha de tratamento',
      entryId: 'e2',
    });
    expect(result.ok).toBe(true);
    expect(result.entry!.changes).toEqual([{ field: 'doseGy', from: 2, to: 2.2 }]);
  });

  // Six months later the diff alone will not say whether it was a typo.
  it('refuses an amendment with no reason', () => {
    const result = amendRecord(record(), { doseGy: 3 } as never, {
      by: 'x',
      at: T0,
      reason: '',
      entryId: 'e',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/erro de digitação ou uma entrega diferente/);
  });

  it('refuses an amendment with no author, and a no-op', () => {
    expect(amendRecord(record(), { doseGy: 3 } as never, { by: '', at: T0, reason: 'x', entryId: 'e' }).ok).toBe(false);
    expect(amendRecord(record(), {}, { by: 'x', at: T0, reason: 'y', entryId: 'e' }).reason).toBe('Nada mudou.');
  });

  it('never lets an amendment move a record to another course', () => {
    const result = amendRecord(record(), { courseId: 'c9' } as never, {
      by: 'x',
      at: T0,
      reason: 'tentativa',
      entryId: 'e',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/baixando o registro e inserindo no curso certo/);
  });

  it('diffs nested fields by value', () => {
    const changes = diffRecords(record(), record({ beams: [{ name: 'PA' }] }));
    expect(changes.map(c => c.field)).toEqual(['beams']);
  });
});

describe('treatmentAudit — deleting is never deleting', () => {
  it('writes a tombstone instead of removing the record', () => {
    const result = retireRecord(record(), {
      by: 'fis.costa',
      at: T0 + HOUR,
      reason: 'superseded-by-machine-record',
      entryId: 'e2',
    });
    expect(result.ok).toBe(true);
    expect(result.record).toBeNull();
    expect(result.entry!.action).toBe('retire');
    expect(result.entry!.reason).toBe(RETIRE_REASONS['superseded-by-machine-record']);
  });

  // A user cannot make it untrue that the linac delivered something.
  it('refuses to retire a machine record and says where the conversation starts', () => {
    const result = retireRecord(record({ provenance: { origin: 'delivered' } }), {
      by: 'fis.costa',
      at: T0,
      reason: 'entered-in-error',
      entryId: 'e',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/a conversa começa na máquina/);
  });

  it('requires a coded reason and an author', () => {
    expect(retireRecord(record(), { by: '', at: T0, reason: 'duplicate', entryId: 'e' }).ok).toBe(false);
    expect(retireRecord(record(), { by: 'x', at: T0, reason: 'porque sim' as never, entryId: 'e' }).ok).toBe(false);
  });

  it('keeps a free-text note next to the coded reason', () => {
    const result = retireRecord(record(), {
      by: 'x',
      at: T0,
      reason: 'duplicate',
      note: 'igual ao r7',
      entryId: 'e',
    });
    expect(result.entry!.reason).toMatch(/Duplicata.*igual ao r7/);
  });
});

describe('treatmentAudit — replaying the log', () => {
  const log: AuditEntry[] = [
    insertRecord(record({ id: 'a', doseGy: 2 }), 'tec', T0, 'e1').entry!,
    insertRecord(record({ id: 'b', doseGy: 2 }), 'tec', T0 + HOUR, 'e2').entry!,
    amendRecord(record({ id: 'b', doseGy: 2 }), { doseGy: 3 } as never, {
      by: 'fis',
      at: T0 + 2 * HOUR,
      reason: 'conferência',
      entryId: 'e3',
    }).entry!,
    retireRecord(record({ id: 'a', doseGy: 2 }), {
      by: 'fis',
      at: T0 + 3 * HOUR,
      reason: 'duplicate',
      entryId: 'e4',
    }).entry!,
  ];

  it('gives the current state', () => {
    const state = stateAt(log, T0 + 10 * HOUR);
    expect(state.active.map(r => r.id)).toEqual(['b']);
    expect(state.active[0].doseGy).toBe(3);
    expect(state.retired.map(t => t.record.id)).toEqual(['a']);
  });

  // A current-state table cannot answer what the total read when the boost was approved.
  it('gives the state as it was before the amendment', () => {
    const state = stateAt(log, T0 + HOUR);
    expect(state.active.map(r => r.id).sort()).toEqual(['a', 'b']);
    expect(state.active.find(r => r.id === 'b')!.doseGy).toBe(2);
    expect(state.retired).toEqual([]);
  });

  it('gives an empty state before anything happened', () => {
    expect(stateAt(log, T0 - HOUR).active).toEqual([]);
  });

  it('brings a retired record back on restore', () => {
    const restored = restoreRecord(record({ id: 'a', doseGy: 2 }), {
      by: 'fis',
      at: T0 + 4 * HOUR,
      reason: 'baixa indevida',
      entryId: 'e5',
    }).entry!;
    const state = stateAt([...log, restored], T0 + 5 * HOUR);
    expect(state.active.map(r => r.id).sort()).toEqual(['a', 'b']);
    expect(state.retired).toEqual([]);
  });

  it('refuses a restore with no reason', () => {
    expect(restoreRecord(record(), { by: 'x', at: T0, reason: '', entryId: 'e' }).ok).toBe(false);
  });
});

describe('treatmentAudit — the dose impact is surfaced, not implied', () => {
  const before: TreatmentRecord[] = [record({ id: 'a', doseGy: 2 }), record({ id: 'b', doseGy: 2 })];

  // The summary simply shows a different number, with nothing saying it used to show another.
  it('states the before and the after', () => {
    const impact = doseImpact(before, [record({ id: 'b', doseGy: 2 })]);
    expect(impact.changed).toBe(true);
    expect(impact.deltaGy).toBeCloseTo(-2, 6);
    expect(impact.message).toMatch(/passa de 4\.00 Gy para 2\.00 Gy \(-2\.00 Gy\)/);
  });

  it('is quiet when the dose did not move', () => {
    expect(doseImpact(before, [record({ id: 'a', doseGy: 2 }), record({ id: 'b', doseGy: 2 })]).changed).toBe(false);
  });
});

describe('treatmentAudit — the retired dose is reported, not hidden', () => {
  it('says how much is outside the total and why that matters', () => {
    const state = {
      active: [record({ id: 'b', doseGy: 2 })],
      retired: [{ record: record({ id: 'a', doseGy: 2 }), retiredAt: T0, by: 'fis', reason: 'Duplicata' }],
    };
    const summary = summariseWithAudit(state);
    expect(summary.totalGy).toBeCloseTo(2, 6);
    expect(summary.retiredGy).toBeCloseTo(2, 6);
    expect(summary.message).toMatch(/faria o número cair sem ninguém saber por quê/);
  });

  it('says nothing extra when nothing was retired', () => {
    const summary = summariseWithAudit({ active: [record({ doseGy: 2 })], retired: [] });
    expect(summary.retiredCount).toBe(0);
    expect(summary.message).not.toMatch(/baixado/);
  });
});

describe('treatmentAudit — the log line', () => {
  it('shows both values on an amendment', () => {
    const entry = amendRecord(record(), { doseGy: 2.2 } as never, {
      by: 'fis.costa',
      at: T0,
      reason: 'conferência',
      entryId: 'e',
    }).entry!;
    expect(describeEntry(entry)).toBe('Alterado por fis.costa — conferência. doseGy: 2 -> 2.2');
  });

  it('says the record is still in the history on a retire', () => {
    const entry = retireRecord(record(), { by: 'fis', at: T0, reason: 'duplicate', entryId: 'e' }).entry!;
    expect(describeEntry(entry)).toMatch(/O registro continua no histórico/);
  });

  it('handles insert and restore', () => {
    expect(describeEntry(insertRecord(record(), 'tec', T0, 'e').entry!)).toBe('Inserido por tec.');
    expect(
      describeEntry(restoreRecord(record(), { by: 'fis', at: T0, reason: 'engano', entryId: 'e' }).entry!)
    ).toMatch(/^Restaurado por fis/);
  });
});
