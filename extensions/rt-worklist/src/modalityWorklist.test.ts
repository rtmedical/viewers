import {
  ambiguousEntries,
  splitPatientName,
  checkQuery,
  describeStep,
  groupByProcedure,
  matchStudyToStep,
  SAFE_LIST_LENGTH,
  ScheduledProcedureStep,
  selectionGuard,
  unscheduledStep,
} from './modalityWorklist';

const T0 = new Date('2026-03-10T09:00:00Z').getTime();

const step = (over: Partial<ScheduledProcedureStep> = {}): ScheduledProcedureStep => ({
  spsId: 'SPS-1',
  accessionNumber: 'ACC-1',
  requestedProcedureId: 'RP-1',
  studyInstanceUid: '1.2.study.1',
  modality: 'CT',
  stationAeTitle: 'CT_SALA1',
  scheduledAt: T0,
  description: 'TC de tórax',
  patient: { patientId: 'P-1', patientName: 'Maria Souza', birthDate: '19800101', sex: 'F' },
  ...over,
});

describe('modalityWorklist — the query decides how safe the list is', () => {
  it('accepts a query narrowed by station, modality and date', () => {
    const result = checkQuery({
      modality: 'CT',
      stationAeTitle: 'CT_SALA1',
      fromAt: T0,
      toAt: T0 + 86_400_000,
    });
    expect(result.ok).toBe(true);
    expect(result.narrowingKeys).toBe(3);
  });

  // The only trace is a station name nobody reads until the physicist asks.
  it('warns loudly when the station filter is missing', () => {
    const result = checkQuery({ modality: 'CT', fromAt: T0, toAt: T0 + 1 });
    expect(result.ok).toBe(false);
    expect(result.warnings.join(' ')).toMatch(/o exame acaba feito na máquina errada/);
  });

  it('warns without a modality and without a date window', () => {
    expect(checkQuery({ stationAeTitle: 'CT_SALA1', fromAt: T0, toAt: T0 + 1 }).warnings.join(' ')).toMatch(
      /sem modalidade/
    );
    expect(checkQuery({ modality: 'CT', stationAeTitle: 'CT_SALA1' }).warnings.join(' ')).toMatch(
      /histórico inteiro/
    );
  });

  it('accepts a targeted lookup by patient or accession without the other keys', () => {
    expect(checkQuery({ patientId: 'P-1' }).ok).toBe(true);
    expect(checkQuery({ accessionNumber: 'ACC-1' }).ok).toBe(true);
    expect(SAFE_LIST_LENGTH).toBe(40);
  });
});

describe('modalityWorklist — the pairs a tired eye conflates', () => {
  it('flags two different patients with similar names', () => {
    const pairs = ambiguousEntries([
      step(),
      step({ spsId: 'SPS-2', patient: { patientId: 'P-2', patientName: 'Mario Souza' } }),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].reason).toMatch(/Nomes parecidos de pacientes diferentes/);
  });

  // A trailing-character comparison misses exactly this pair: the last letter of the given
  // name sits inside the window, so "MARIASOUZA" and "MARIOSOUZA" differ in the last six.
  it('compares the surname as a token, not as trailing characters', () => {
    expect(splitPatientName('Maria Souza')).toEqual({ family: 'SOUZA', given: 'MARIA' });
    expect(splitPatientName('Souza^Maria')).toEqual({ family: 'SOUZA', given: 'MARIA' });
  });

  it('does not flag two clearly different names', () => {
    expect(
      ambiguousEntries([
        step(),
        step({ spsId: 'SPS-2', patient: { patientId: 'P-2', patientName: 'João Pereira' } }),
      ])
    ).toEqual([]);
  });

  it('flags the same patient with two identical steps, where only the time differs', () => {
    const pairs = ambiguousEntries([step(), step({ spsId: 'SPS-2', scheduledAt: T0 + 3_600_000 })]);
    expect(pairs[0].reason).toMatch(/só o horário distingue/);
  });

  it('does not flag the same patient with two different procedures', () => {
    expect(
      ambiguousEntries([step(), step({ spsId: 'SPS-2', description: 'TC de abdome' })])
    ).toEqual([]);
  });
});

describe('modalityWorklist — selecting the wrong entry is undetectable afterwards', () => {
  it('states exactly what the study will inherit', () => {
    const guard = selectionGuard(step(), [step()]);
    expect(guard.inherits).toEqual({
      patientId: 'P-1',
      patientName: 'Maria Souza',
      accessionNumber: 'ACC-1',
      studyInstanceUid: '1.2.study.1',
    });
    expect(guard.message).toMatch(/^As imagens vão herdar: Maria Souza \(P-1\)/);
  });

  // Every field ends up internally consistent, so no validator can find a contradiction.
  it('demands confirmation when a lookalike is on the same list, and says why', () => {
    const list = [step(), step({ spsId: 'SPS-2', patient: { patientId: 'P-2', patientName: 'Mario Souza' } })];
    const guard = selectionGuard(list[0], list);
    expect(guard.requiresConfirmation).toBe(true);
    expect(guard.lookalikes).toHaveLength(1);
    expect(guard.message).toMatch(/todos os campos ficam internamente consistentes entre si/);
  });

  it('is quiet on an unambiguous list', () => {
    const list = [step(), step({ spsId: 'SPS-2', patient: { patientId: 'P-2', patientName: 'João Pereira' } })];
    expect(selectionGuard(list[0], list).requiresConfirmation).toBe(false);
  });
});

describe('modalityWorklist — an unscheduled examination is a real thing', () => {
  const base = {
    spsId: 'UNSCHED-1',
    studyInstanceUid: '1.2.study.9',
    modality: 'CT',
    stationAeTitle: 'CT_SALA1',
    startedAt: T0,
    patient: { patientId: 'P-9', patientName: 'Desconhecido Trauma' },
    reason: 'Politrauma, sala vermelha',
  };

  it('creates a marked step', () => {
    const result = unscheduledStep(base);
    expect(result.ok).toBe(true);
    expect(result.step!.unscheduled).toBe(true);
    expect(result.step!.unscheduledReason).toMatch(/Politrauma/);
  });

  // Inventing one produces an order the RIS never issued.
  it('leaves the accession empty rather than inventing one', () => {
    expect(unscheduledStep(base).step!.accessionNumber).toBe('');
  });

  it('still requires the patient — what is missing is the order, not the patient', () => {
    const result = unscheduledStep({ ...base, patient: { patientId: '', patientName: '' } });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/o que falta é o pedido, não o paciente/);
  });

  it('requires a reason so the reconciliation happens', () => {
    const result = unscheduledStep({ ...base, reason: '' });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/a reconciliação com o RIS não acontece/);
  });

  it('keeps unscheduled steps out of procedure grouping', () => {
    expect(groupByProcedure([step(), unscheduledStep(base).step!])).toHaveLength(1);
  });
});

describe('modalityWorklist — one requested procedure is not one step', () => {
  it('groups two steps under one procedure', () => {
    const groups = groupByProcedure([
      step({ spsId: 'SPS-1', description: 'TC de tórax' }),
      step({ spsId: 'SPS-2', description: 'TC de abdome' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].steps).toHaveLength(2);
  });

  it('keeps different procedures apart', () => {
    const groups = groupByProcedure([
      step(),
      step({ spsId: 'SPS-2', accessionNumber: 'ACC-2', requestedProcedureId: 'RP-2' }),
    ]);
    expect(groups).toHaveLength(2);
  });
});

describe('modalityWorklist — matching an arriving study back', () => {
  const list = [
    step(),
    step({ spsId: 'SPS-2', studyInstanceUid: '1.2.study.2', description: 'TC de abdome' }),
  ];

  it('matches on the study UID the RIS allocated', () => {
    const result = matchStudyToStep({ studyInstanceUid: '1.2.study.2' }, list);
    expect(result.ok).toBe(true);
    expect(result.step!.spsId).toBe('SPS-2');
  });

  it('falls back to accession plus patient', () => {
    const single = [step()];
    expect(matchStudyToStep({ accessionNumber: 'ACC-1', patientId: 'P-1' }, single).ok).toBe(true);
  });

  // The normal case of a multi-step procedure, not an exception.
  it('refuses when one accession covers several steps', () => {
    const result = matchStudyToStep({ accessionNumber: 'ACC-1', patientId: 'P-1' }, list);
    expect(result.ambiguous).toBe(true);
    expect(result.message).toMatch(/atribui as imagens ao passo errado/);
  });

  it('refuses a duplicated study UID as an inconsistent worklist', () => {
    const duplicated = [step(), step({ spsId: 'SPS-3' })];
    expect(matchStudyToStep({ studyInstanceUid: '1.2.study.1' }, duplicated).ambiguous).toBe(true);
  });

  // Trauma, or a study from another institution.
  it('treats no match as a legitimate state', () => {
    expect(matchStudyToStep({ studyInstanceUid: 'x' }, list).message).toMatch(
      /Estudo sem pedido é estado legítimo/
    );
  });
});

describe('modalityWorklist — the row', () => {
  it('shows time, patient, procedure and station', () => {
    expect(describeStep(step())).toBe(
      '09:00 · Maria Souza (P-1) · CT TC de tórax · CT_SALA1'
    );
  });

  it('marks an unscheduled row', () => {
    const unscheduled = unscheduledStep({
      spsId: 'U1',
      studyInstanceUid: '1.2.9',
      modality: 'CT',
      stationAeTitle: 'CT_SALA1',
      startedAt: T0,
      patient: { patientId: 'P-9', patientName: 'Trauma' },
      reason: 'Sala vermelha',
    }).step!;
    expect(describeStep(unscheduled)).toMatch(/NÃO AGENDADO \(Sala vermelha\)$/);
  });
});
