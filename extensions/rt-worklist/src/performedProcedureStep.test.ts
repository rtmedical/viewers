import {
  ABANDONED_AFTER_MS,
  assessStaleness,
  checkTransfer,
  compareProtocols,
  completeStep,
  describePerformedStep,
  discontinueStep,
  DISCONTINUATION_REASONS,
  INCIDENT_REASONS,
  orderClosure,
  PerformedProcedureStep,
  PerformedSeries,
  STALE_AFTER_MS,
  startStep,
  STATUS_LABELS,
} from './performedProcedureStep';

const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;

const series = (n = 3): PerformedSeries[] =>
  Array.from({ length: n }, (_, i) => ({
    seriesInstanceUid: `1.2.series.${i}`,
    modality: 'CT',
    protocolName: 'Tórax sem contraste',
    instanceCount: 100,
  }));

const started = (over: Record<string, unknown> = {}): PerformedProcedureStep =>
  startStep({
    ppsId: 'PPS-1',
    spsId: 'SPS-1',
    studyInstanceUid: '1.2.study',
    patientId: 'P-1',
    stationAeTitle: 'CT_SALA1',
    startedAt: T0,
    performedProtocol: 'Tórax sem contraste',
    scheduledProtocol: 'Tórax sem contraste',
    ...over,
  }).step as PerformedProcedureStep;

describe('performedProcedureStep — opening a step', () => {
  it('starts in progress', () => {
    expect(started().status).toBe('in-progress');
  });

  // Filling it from the scheduled step is the obvious shortcut.
  it('refuses without a performed protocol and says what the shortcut costs', () => {
    const result = startStep({
      ppsId: 'P',
      studyInstanceUid: '1.2',
      patientId: 'P-1',
      stationAeTitle: 'A',
      startedAt: T0,
      performedProtocol: '',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/fatura o que não foi feito/);
  });

  it('accepts an unscheduled step but flags the reconciliation', () => {
    const result = startStep({
      ppsId: 'P',
      studyInstanceUid: '1.2',
      patientId: 'P-1',
      stationAeTitle: 'A',
      startedAt: T0,
      performedProtocol: 'Trauma',
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/precisa ser reconciliado com o RIS depois/);
  });

  it('refuses without identifiers or a start time', () => {
    expect(startStep({ ppsId: '', studyInstanceUid: '1', patientId: 'P', stationAeTitle: 'A', startedAt: T0, performedProtocol: 'X' }).ok).toBe(false);
    expect(startStep({ ppsId: 'P', studyInstanceUid: '1', patientId: 'P', stationAeTitle: 'A', startedAt: NaN, performedProtocol: 'X' }).ok).toBe(false);
  });
});

describe('performedProcedureStep — terminal states are terminal', () => {
  it('completes with the series that came out', () => {
    const result = completeStep(started(), { endedAt: T0 + HOUR, series: series(3) });
    expect(result.ok).toBe(true);
    expect(result.step.status).toBe('completed');
    expect(result.step.series).toHaveLength(3);
  });

  // Would turn an aborted examination into a finished one in the record.
  it('refuses to complete a step that was discontinued', () => {
    const stopped = discontinueStep(started(), { endedAt: T0 + HOUR, reason: 'contrast-reaction', series: series(1) }).step;
    const result = completeStep(stopped, { endedAt: T0 + 2 * HOUR, series: series(3) });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/uma mensagem atrasada não pode transformar um exame interrompido em concluído/);
  });

  it('refuses to complete with no series at all', () => {
    const result = completeStep(started(), { endedAt: T0 + HOUR, series: [] });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/o passo foi interrompido, não concluído/);
  });

  it('refuses to reopen a completed step', () => {
    const done = completeStep(started(), { endedAt: T0 + HOUR, series: series() }).step;
    expect(discontinueStep(done, { endedAt: T0 + 2 * HOUR, reason: 'equipment-failure' }).ok).toBe(false);
  });
});

describe('performedProcedureStep — discontinued is not empty', () => {
  // Three series are diagnostic and belong to the patient.
  it('keeps the series acquired before the stop', () => {
    const result = discontinueStep(started(), {
      endedAt: T0 + HOUR,
      reason: 'patient-refused',
      series: series(3),
    });
    expect(result.ok).toBe(true);
    expect(result.step.series).toHaveLength(3);
  });

  // A contrast reaction is an incident; a patient who could not tolerate is a rebooking.
  it('requires a coded reason and separates incidents from rebookings', () => {
    expect(discontinueStep(started(), { endedAt: T0, reason: '' as never }).reason).toMatch(
      /o registro precisa distinguir os dois/
    );
    expect(INCIDENT_REASONS).toContain('contrast-reaction');
    expect(INCIDENT_REASONS).not.toContain('patient-refused');
  });

  it('carries a free note beside the coded reason', () => {
    const result = discontinueStep(started(), {
      endedAt: T0,
      reason: 'equipment-failure',
      note: 'Tubo desarmou no meio da terceira série',
    });
    expect(result.step.discontinuationNote).toMatch(/Tubo desarmou/);
  });
});

describe('performedProcedureStep — performed is not scheduled', () => {
  it('is quiet when they agree', () => {
    expect(compareProtocols(started()).matches).toBe(true);
  });

  // Bills as contrast-enhanced and is reported against a protocol that did not happen.
  it('reports the difference as the fact, not as an error', () => {
    const step = started({ performedProtocol: 'Tórax sem contraste', scheduledProtocol: 'Tórax com contraste' });
    const result = compareProtocols(step);
    expect(result.matches).toBe(false);
    expect(result.message).toMatch(/não é um erro a corrigir — é o fato que o registro existe para carregar/);
    expect(result.message).toMatch(/fatura como contrastado/);
  });

  it('says so when there is nothing to compare against', () => {
    const step = started({ scheduledProtocol: undefined });
    expect(compareProtocols(step).message).toMatch(/Sem protocolo agendado registrado/);
  });
});

describe('performedProcedureStep — a missing final message leaves the room occupied', () => {
  it('is quiet for a step that just started', () => {
    expect(assessStaleness(started(), T0 + HOUR).stale).toBe(false);
  });

  it('prompts a check with the room after a few hours', () => {
    const result = assessStaleness(started(), T0 + STALE_AFTER_MS + HOUR);
    expect(result.suggestedAction).toBe('confirm-with-room');
    expect(result.message).toMatch(/a sala aparece ocupada, o pedido não fecha e o paciente parece estar na mesa/);
  });

  // From outside, a long examination and a dead one are the same.
  it('asks for a manual close after half a day and refuses to close it itself', () => {
    const step = started();
    const result = assessStaleness(step, T0 + ABANDONED_AFTER_MS + HOUR);
    expect(result.suggestedAction).toBe('close-manually');
    expect(step.status).toBe('in-progress');
    expect(result.message).toMatch(/o sistema não fecha sozinho/);
    expect(result.message).toMatch(/exame longo e exame morto são a mesma coisa vistos daqui/);
  });

  it('says nothing about a step that already closed', () => {
    const done = completeStep(started(), { endedAt: T0 + HOUR, series: series() }).step;
    expect(assessStaleness(done, T0 + 100 * HOUR).stale).toBe(false);
  });
});

describe('performedProcedureStep — the instance count is the earliest sign of loss', () => {
  const done = completeStep(started(), { endedAt: T0 + HOUR, series: series(3) }).step;

  it('agrees when everything arrived', () => {
    expect(checkTransfer(done, 300).consistent).toBe(true);
  });

  // By the time a reader notices a short series they are already reading it.
  it('detects a shortfall before anyone opens the study', () => {
    const result = checkTransfer(done, 280);
    expect(result.consistent).toBe(false);
    expect(result.missing).toBe(20);
    expect(result.message).toMatch(/quando o leitor percebe uma série curta, ele já está lendo/);
  });

  it('detects a surplus as a duplicate send', () => {
    expect(checkTransfer(done, 320).message).toMatch(/envio duplicado ou contagem desatualizada/);
  });
});

describe('performedProcedureStep — closing the order', () => {
  it('closes the scheduled step it referenced', () => {
    const done = completeStep(started(), { endedAt: T0 + HOUR, series: series() }).step;
    const closure = orderClosure(done);
    expect(closure.closes).toBe(true);
    expect(closure.message).toMatch(/Fecha o passo agendado SPS-1/);
  });

  // It creates work for the reconciliation instead of finishing it.
  it('closes nothing when there was no order', () => {
    const unscheduled = completeStep(started({ spsId: '' }), { endedAt: T0 + HOUR, series: series() }).step;
    const closure = orderClosure(unscheduled);
    expect(closure.closes).toBe(false);
    expect(closure.needsReconciliation).toBe(true);
    expect(closure.message).toMatch(/entra na fila de reconciliação/);
  });

  it('says the acquired series still belong to the patient after a stop', () => {
    const stopped = discontinueStep(started(), {
      endedAt: T0 + HOUR,
      reason: 'patient-refused',
      series: series(2),
    }).step;
    expect(orderClosure(stopped).message).toMatch(
      /2 série\(s\) adquirida\(s\) antes da parada continuam sendo do paciente/
    );
  });

  it('marks an incident as an incident', () => {
    const stopped = discontinueStep(started(), {
      endedAt: T0 + HOUR,
      reason: 'wrong-patient',
      series: series(1),
    }).step;
    const closure = orderClosure(stopped);
    expect(closure.isIncident).toBe(true);
    expect(closure.message).toMatch(/incidente, não como reagendamento/);
    expect(DISCONTINUATION_REASONS['wrong-patient']).toMatch(/paciente errado/);
  });

  it('does not close anything while in progress', () => {
    expect(orderClosure(started()).closes).toBe(false);
  });
});

describe('performedProcedureStep — the status board line', () => {
  it('states status, room, protocol and series', () => {
    expect(describePerformedStep(started())).toBe(
      `${STATUS_LABELS['in-progress']} · CT_SALA1 · Tórax sem contraste · 0 série(s).`
    );
  });

  it('appends the protocol mismatch and the staleness prompt', () => {
    const step = started({ performedProtocol: 'Tórax sem contraste', scheduledProtocol: 'Tórax com contraste' });
    const line = describePerformedStep(step, T0 + ABANDONED_AFTER_MS + HOUR);
    expect(line).toMatch(/fatura como contrastado/);
    expect(line).toMatch(/o sistema não fecha sozinho/);
  });
});
