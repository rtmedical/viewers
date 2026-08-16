import {
  BrachyRecord,
  describeRecord,
  ExternalBeamRecord,
  findDuplicates,
  markProvenance,
  MISSING_REASONS,
  summariseCourse,
  TreatmentRecord,
  validateBrachy,
  validateExternalBeam,
} from './manualTreatment';

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

const manualProvenance = markProvenance({
  reason: 'export-failed',
  enteredBy: 'tec.silva',
  enteredAt: NOW,
}).provenance!;

const ebrt = (over: Partial<ExternalBeamRecord> = {}): ExternalBeamRecord => ({
  kind: 'external-beam',
  id: 'r1',
  courseId: 'c1',
  fractionNumber: 5,
  deliveredAt: NOW - DAY,
  doseGy: 2,
  beams: [{ name: 'AP', monitorUnits: 120, energyMv: 6 }],
  machine: 'TrueBeam-1',
  provenance: manualProvenance,
  ...over,
});

const brachy = (over: Partial<BrachyRecord> = {}): BrachyRecord => ({
  kind: 'brachy',
  id: 'b1',
  courseId: 'c1',
  insertionNumber: 1,
  deliveredAt: NOW - DAY,
  doseGy: 7,
  nuclide: 'Ir-192',
  totalDwellSec: 340,
  sourceStrength: 40000,
  applicator: 'Tandem e ovoides',
  provenance: manualProvenance,
  ...over,
});

describe('manualTreatment — why it is missing changes what it means', () => {
  // One is a data transfer to chase; the other is equipment probably still failing.
  it('requires a coded reason and explains the difference', () => {
    const result = markProvenance({ reason: '' as never, enteredBy: 'x', enteredAt: NOW });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/transferência de dado a cobrar/);
    expect(result.reason).toMatch(/falha de equipamento que provavelmente continua acontecendo/);
  });

  it('requires who typed it and when', () => {
    expect(markProvenance({ reason: 'export-failed', enteredBy: '', enteredAt: NOW }).ok).toBe(false);
    expect(markProvenance({ reason: 'export-failed', enteredBy: 'x', enteredAt: NaN }).ok).toBe(false);
  });

  it('keeps a free-text note alongside the coded reason, never instead of it', () => {
    const result = markProvenance({
      reason: 'external-facility',
      enteredBy: 'dr.souza',
      enteredAt: NOW,
      note: 'Hospital X, protocolo anexado',
    });
    expect(result.provenance!.reason).toBe('external-facility');
    expect(result.provenance!.note).toMatch(/Hospital X/);
  });

  it('offers the closed list', () => {
    expect(Object.keys(MISSING_REASONS)).toContain('external-facility');
    expect(Object.keys(MISSING_REASONS)).toContain('export-failed');
  });
});

describe('manualTreatment — external beam', () => {
  it('accepts a complete fraction', () => {
    const result = validateExternalBeam(ebrt(), NOW);
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  // The problem is a manual record that looks delivered, not the manual record itself.
  it('refuses a record not marked as manual', () => {
    const result = validateExternalBeam(ebrt({ provenance: { origin: 'delivered' } }), NOW);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/indistinguível de um entregue é o problema, não a solução/);
  });

  it('refuses a missing dose, a bad fraction number and a future date', () => {
    expect(validateExternalBeam(ebrt({ doseGy: 0 }), NOW).ok).toBe(false);
    expect(validateExternalBeam(ebrt({ fractionNumber: 0 }), NOW).ok).toBe(false);
    expect(validateExternalBeam(ebrt({ deliveredAt: NOW + DAY }), NOW).ok).toBe(false);
  });

  it('warns without beams instead of refusing', () => {
    const result = validateExternalBeam(ebrt({ beams: [] }), NOW);
    expect(result.ok).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/não poderá ser conferida contra o plano feixe a feixe/);
  });

  it('warns when there is no machine', () => {
    expect(validateExternalBeam(ebrt({ machine: '' }), NOW).warnings.join(' ')).toMatch(
      /estatística por acelerador vai ignorar/
    );
  });

  it('warns when entry precedes delivery', () => {
    const provenance = markProvenance({
      reason: 'export-failed',
      enteredBy: 'x',
      enteredAt: NOW - 5 * DAY,
    }).provenance!;
    expect(validateExternalBeam(ebrt({ provenance }), NOW).warnings.join(' ')).toMatch(
      /Inserido antes da data de entrega/
    );
  });
});

describe('manualTreatment — brachytherapy has its own shape', () => {
  it('accepts a complete insertion', () => {
    expect(validateBrachy(brachy(), NOW).ok).toBe(true);
  });

  // A single form invites typing a beam count into a dwell record.
  it('requires the nuclide and the dwell time, which external beam does not have', () => {
    expect(validateBrachy(brachy({ nuclide: '' }), NOW).errors.join(' ')).toMatch(/Radionuclídeo ausente/);
    expect(validateBrachy(brachy({ totalDwellSec: 0 }), NOW).ok).toBe(false);
  });

  it('numbers insertions, not fractions', () => {
    expect(validateBrachy(brachy({ insertionNumber: 0 }), NOW).errors.join(' ')).toMatch(
      /Número de inserção/
    );
  });

  // The only independent check available on a typed record.
  it('warns without source strength and says what is lost', () => {
    const result = validateBrachy(brachy({ sourceStrength: undefined }), NOW);
    expect(result.ok).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/única checagem independente disponível num registro digitado/);
  });
});

describe('manualTreatment — the two kinds of evidence stay apart', () => {
  const records: TreatmentRecord[] = [
    ebrt({ id: 'd1', doseGy: 2, provenance: { origin: 'delivered' } }),
    ebrt({ id: 'd2', doseGy: 2, provenance: { origin: 'delivered' } }),
    ebrt({ id: 'm1', doseGy: 2 }),
    brachy({ id: 'm2', doseGy: 7 }),
  ];

  it('adds the total but reports the split', () => {
    const summary = summariseCourse(records);
    expect(summary.totalGy).toBeCloseTo(13, 6);
    expect(summary.deliveredGy).toBeCloseTo(4, 6);
    expect(summary.manualGy).toBeCloseTo(9, 6);
  });

  // Only one of them is a measurement.
  it('says what the difference between them is', () => {
    expect(summariseCourse(records).message).toMatch(
      /um registro manual é a lembrança de alguém, digitada depois/
    );
  });

  it('counts the coded reasons', () => {
    const summary = summariseCourse(records);
    expect(summary.manualReasons).toEqual([
      { reason: 'export-failed', label: MISSING_REASONS['export-failed'], count: 2 },
    ]);
  });

  it('counts brachy insertions separately', () => {
    expect(summariseCourse(records).brachyInsertions).toBe(1);
  });

  it('says nothing extra when every record came from the machine', () => {
    const summary = summariseCourse([ebrt({ provenance: { origin: 'delivered' } })]);
    expect(summary.message).toBe('2.00 Gy no total.');
  });
});

describe('manualTreatment — double counting', () => {
  // The cumulative dose crosses the prescription without anything looking wrong.
  it('catches the same fraction arriving twice', () => {
    const existing = [ebrt({ id: 'd1', fractionNumber: 5, provenance: { origin: 'delivered' } })];
    const check = findDuplicates(ebrt({ id: 'm1', fractionNumber: 5 }), existing);
    expect(check.duplicate).toBe(true);
    expect(check.message).toMatch(/passar da prescrição sem nada parecer errado/);
  });

  it('catches two records close in time even with different numbering', () => {
    const existing = [ebrt({ id: 'd1', fractionNumber: 4, provenance: { origin: 'delivered' } })];
    expect(findDuplicates(ebrt({ id: 'm1', fractionNumber: 5 }), existing).duplicate).toBe(true);
  });

  it('does not confuse a brachy insertion with an external fraction', () => {
    const existing = [brachy({ id: 'b1', insertionNumber: 5, deliveredAt: NOW - DAY })];
    expect(findDuplicates(ebrt({ id: 'm1', fractionNumber: 5 }), existing).duplicate).toBe(false);
  });

  it('does not flag a different course', () => {
    const existing = [ebrt({ id: 'd1', courseId: 'c2' })];
    expect(findDuplicates(ebrt({ id: 'm1' }), existing).duplicate).toBe(false);
  });

  it('does not flag a fraction days apart', () => {
    const existing = [ebrt({ id: 'd1', fractionNumber: 4, deliveredAt: NOW - 5 * DAY })];
    expect(findDuplicates(ebrt({ id: 'm1', fractionNumber: 5 }), existing).duplicate).toBe(false);
  });
});

describe('manualTreatment — the readout', () => {
  it('marks a manual fraction with its reason', () => {
    expect(describeRecord(ebrt())).toBe(
      'Fração 5 · 2 Gy · 1 feixe(s) · manual (O acelerador não exportou o registro)'
    );
  });

  it('describes a brachy insertion by nuclide and dwell time', () => {
    expect(describeRecord(brachy())).toMatch(/^Inserção 1 · 7 Gy · Ir-192 · 340s · manual/);
  });

  it('leaves a delivered record unmarked', () => {
    expect(describeRecord(ebrt({ provenance: { origin: 'delivered' } }))).not.toMatch(/manual/);
  });
});
