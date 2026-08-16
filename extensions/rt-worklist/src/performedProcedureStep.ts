/**
 * The performed procedure step — pure core (RTV-100).
 *
 * `modalityWorklist.ts` (RTV-99) models what was *scheduled*. This is what was *done*, and
 * the gap between the two is where the interesting failures are.
 *
 * ## A missing final MPPS leaves the room occupied forever
 *
 * The step goes to IN PROGRESS when the examination starts and nothing ever moves it on if
 * the console crashes, the network drops, or the technologist walks away. The scheduler
 * then cannot distinguish an abandoned examination from one still running: the room shows
 * busy, the order never closes, and the patient appears to be on the table.
 *
 * Elapsed time does not resolve it. A long step is a long examination or a dead one, and
 * from outside they are the same — the same shape as the unanswered storage commitment in
 * `storageCommitment.ts` (RTV-101) and the silent channel in `realtimeSync.ts` (RTV-189).
 * {@link assessStaleness} prompts a human to close it and refuses to close it on its own.
 *
 * ## Performed is not scheduled, and copying one into the other bills for what was not done
 *
 * The final MPPS carries the protocol that actually ran and the series that actually came
 * out. Filling those fields from the scheduled step is the obvious shortcut and it is
 * wrong in a specific, expensive direction: an examination scheduled with contrast and
 * performed without it bills as contrast-enhanced, and the report is written against a
 * protocol that did not happen.
 *
 * ## Discontinued is not failed, and it is not empty
 *
 * An examination stopped after three series has three series. They are diagnostic, they
 * belong to the patient, and they have to be stored and read. Treating DISCONTINUED as
 * "nothing happened" discards them; treating it as COMPLETED reports a partial study as a
 * whole one. The reason separates the cases that need follow-up — a contrast reaction is
 * an incident, a patient who could not tolerate the position is a rebooking.
 *
 * ## The instance count is the earliest sign that images were lost
 *
 * The final MPPS says how many series and instances the modality produced. Comparing that
 * against what the archive received is the cheapest possible detection of a transfer that
 * dropped something, and it is available before anyone opens the study.
 *
 * Framework-free, no `@ohif/*`, no timers.
 */

export type MppsStatus = 'in-progress' | 'completed' | 'discontinued';

export const STATUS_LABELS: Record<MppsStatus, string> = {
  'in-progress': 'em andamento',
  completed: 'concluído',
  discontinued: 'interrompido',
};

export const DISCONTINUATION_REASONS = {
  'patient-refused': 'Paciente desistiu ou não tolerou',
  'contrast-reaction': 'Reação ao contraste',
  'equipment-failure': 'Falha de equipamento',
  'clinical-decision': 'Interrompido por decisão clínica',
  'wrong-patient': 'Iniciado no paciente errado',
  'incorrect-worklist-entry': 'Iniciado na entrada errada da lista de trabalho',
} as const;

export type DiscontinuationReason = keyof typeof DISCONTINUATION_REASONS;

/** Reasons that are incidents rather than rebookings. */
export const INCIDENT_REASONS: DiscontinuationReason[] = [
  'contrast-reaction',
  'wrong-patient',
  'incorrect-worklist-entry',
];

export interface PerformedSeries {
  seriesInstanceUid: string;
  modality: string;
  /** Protocol that actually ran, not the one that was scheduled. */
  protocolName: string;
  instanceCount: number;
}

export interface PerformedProcedureStep {
  /** Performed Procedure Step ID (0040,0253). */
  ppsId: string;
  /** Scheduled step this closes. Empty for an unscheduled examination. */
  spsId: string;
  studyInstanceUid: string;
  patientId: string;
  stationAeTitle: string;
  status: MppsStatus;
  startedAt: number;
  endedAt?: number;
  /** Protocol actually performed. */
  performedProtocol: string;
  /** Protocol that was scheduled, kept for comparison. */
  scheduledProtocol?: string;
  series: PerformedSeries[];
  discontinuationReason?: DiscontinuationReason;
  discontinuationNote?: string;
}

const text = (value: unknown): string => String(value ?? '').trim();
const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};

export interface StartResult {
  step: PerformedProcedureStep | null;
  ok: boolean;
  reason?: string;
  warnings: string[];
}

/** Opens a performed step. */
export function startStep(input: {
  ppsId: string;
  spsId?: string;
  studyInstanceUid: string;
  patientId: string;
  stationAeTitle: string;
  startedAt: number;
  performedProtocol: string;
  scheduledProtocol?: string;
}): StartResult {
  const warnings: string[] = [];

  if (!text(input?.ppsId) || !text(input?.studyInstanceUid) || !text(input?.patientId)) {
    return { step: null, ok: false, reason: 'Passo sem identificador, estudo ou paciente.', warnings };
  }
  if (!Number.isFinite(num(input?.startedAt))) {
    return { step: null, ok: false, reason: 'Passo sem horário de início.', warnings };
  }
  if (!text(input?.performedProtocol)) {
    return {
      step: null,
      ok: false,
      reason:
        'Passo sem protocolo executado. Preencher com o protocolo agendado é o atalho óbvio e fatura o que não foi feito.',
      warnings,
    };
  }
  if (!text(input?.spsId)) {
    warnings.push(
      'Passo sem referência a um agendamento — exame não agendado. É legítimo, e precisa ser reconciliado com o RIS depois.'
    );
  }

  return {
    ok: true,
    warnings,
    step: {
      ppsId: text(input.ppsId),
      spsId: text(input.spsId),
      studyInstanceUid: text(input.studyInstanceUid),
      patientId: text(input.patientId),
      stationAeTitle: text(input.stationAeTitle),
      status: 'in-progress',
      startedAt: num(input.startedAt),
      performedProtocol: text(input.performedProtocol),
      scheduledProtocol: text(input.scheduledProtocol) || undefined,
      series: [],
    },
  };
}

export interface TransitionResult {
  step: PerformedProcedureStep;
  ok: boolean;
  reason?: string;
}

/**
 * Closes a step as completed.
 *
 * Terminal states are terminal: a second N-SET arriving late must not reopen a step, and it
 * must not silently overwrite a discontinuation with a completion — which would turn an
 * aborted examination into a finished one in the record.
 */
export function completeStep(
  step: PerformedProcedureStep,
  input: { endedAt: number; series: PerformedSeries[] }
): TransitionResult {
  if (!step) {
    return { step, ok: false, reason: 'Passo ausente.' };
  }
  if (step.status !== 'in-progress') {
    return {
      step,
      ok: false,
      reason:
        `Passo já está "${STATUS_LABELS[step.status]}". Estado terminal é terminal — uma mensagem atrasada não pode ` +
        'transformar um exame interrompido em concluído no registro.',
    };
  }
  const series = (input?.series ?? []).filter(s => s && text(s.seriesInstanceUid));
  if (!series.length) {
    return {
      step,
      ok: false,
      reason: 'Conclusão sem nenhuma série. Se nada foi adquirido, o passo foi interrompido, não concluído.',
    };
  }

  return {
    ok: true,
    step: { ...step, status: 'completed', endedAt: num(input.endedAt), series },
  };
}

/**
 * Closes a step as discontinued.
 *
 * The series acquired before the stop are kept: an examination halted after three series
 * has three series, they are diagnostic, and they belong to the patient.
 */
export function discontinueStep(
  step: PerformedProcedureStep,
  input: {
    endedAt: number;
    reason: DiscontinuationReason;
    note?: string;
    series?: PerformedSeries[];
  }
): TransitionResult {
  if (!step) {
    return { step, ok: false, reason: 'Passo ausente.' };
  }
  if (step.status !== 'in-progress') {
    return { step, ok: false, reason: `Passo já está "${STATUS_LABELS[step.status]}".` };
  }
  if (!input?.reason || !DISCONTINUATION_REASONS[input.reason]) {
    return {
      step,
      ok: false,
      reason:
        'Interrupção exige motivo da lista. Reação ao contraste é um incidente e paciente que não tolerou a posição é um reagendamento — ' +
        'o registro precisa distinguir os dois.',
    };
  }

  return {
    ok: true,
    step: {
      ...step,
      status: 'discontinued',
      endedAt: num(input.endedAt),
      // Kept, not discarded: they are diagnostic and they belong to the patient.
      series: (input.series ?? step.series).filter(s => s && text(s.seriesInstanceUid)),
      discontinuationReason: input.reason,
      discontinuationNote: text(input.note) || undefined,
    },
  };
}

export interface ProtocolComparison {
  matches: boolean;
  performed: string;
  scheduled: string | null;
  message: string;
}

/**
 * Performed protocol against scheduled.
 *
 * The mismatch is not an error to correct — it is the fact the record exists to carry. What
 * is wrong is copying one into the other, because then a study scheduled with contrast and
 * performed without it bills as contrast-enhanced and is reported against a protocol that
 * did not happen.
 */
export function compareProtocols(step: PerformedProcedureStep): ProtocolComparison {
  const performed = text(step?.performedProtocol);
  const scheduled = text(step?.scheduledProtocol);

  if (!scheduled) {
    return {
      matches: true,
      performed,
      scheduled: null,
      message: 'Sem protocolo agendado registrado para comparar.',
    };
  }
  if (performed === scheduled) {
    return { matches: true, performed, scheduled, message: '' };
  }
  return {
    matches: false,
    performed,
    scheduled,
    message:
      `Executado "${performed}" contra agendado "${scheduled}". A diferença não é um erro a corrigir — é o fato que o registro existe para carregar. ` +
      'O erro seria copiar um no outro: exame agendado com contraste e feito sem fatura como contrastado e é laudado contra um protocolo que não aconteceu.',
  };
}

export interface StalenessAssessment {
  stale: boolean;
  elapsedMs: number;
  /** Never changes the status. */
  suggestedAction: 'none' | 'confirm-with-room' | 'close-manually';
  message: string;
}

/** An in-progress step older than this needs a human to look, milliseconds. */
export const STALE_AFTER_MS = 4 * 3_600_000;
/** Older than this and it is almost certainly abandoned. */
export const ABANDONED_AFTER_MS = 12 * 3_600_000;

/**
 * How long a step has been open.
 *
 * Never closes it. A long step is a long examination or a dead one and from outside they
 * are the same, so the only safe output is a prompt for someone who can look at the room.
 */
export function assessStaleness(
  step: PerformedProcedureStep,
  now: number,
  config: { staleAfterMs?: number; abandonedAfterMs?: number } = {}
): StalenessAssessment {
  const elapsedMs = Math.max(0, num(now) - num(step?.startedAt));
  if (step?.status !== 'in-progress') {
    return { stale: false, elapsedMs, suggestedAction: 'none', message: '' };
  }
  const staleAfter = Number.isFinite(num(config.staleAfterMs)) ? num(config.staleAfterMs) : STALE_AFTER_MS;
  const abandonedAfter = Number.isFinite(num(config.abandonedAfterMs))
    ? num(config.abandonedAfterMs)
    : ABANDONED_AFTER_MS;

  if (elapsedMs < staleAfter) {
    return { stale: false, elapsedMs, suggestedAction: 'none', message: '' };
  }

  const hours = (elapsedMs / 3_600_000).toFixed(0);
  if (elapsedMs >= abandonedAfter) {
    return {
      stale: true,
      elapsedMs,
      suggestedAction: 'close-manually',
      message:
        `Aberto há ${hours}h em ${step.stationAeTitle}. Quase certamente abandonado, mas o sistema não fecha sozinho: ` +
        'exame longo e exame morto são a mesma coisa vistos daqui, e fechar por tempo transformaria um exame em curso em concluído no registro.',
    };
  }
  return {
    stale: true,
    elapsedMs,
    suggestedAction: 'confirm-with-room',
    message:
      `Aberto há ${hours}h em ${step.stationAeTitle}. Enquanto ficar assim a sala aparece ocupada, o pedido não fecha ` +
      'e o paciente parece estar na mesa. Confirme com a sala.',
  };
}

export interface TransferCheck {
  consistent: boolean;
  declaredInstances: number;
  receivedInstances: number;
  missing: number;
  message: string;
}

/**
 * The modality's own count against what the archive received.
 *
 * The cheapest detection of a transfer that dropped something, and available before anyone
 * opens the study — which is the point, because by the time a reader notices a short series
 * they are already reading it.
 */
export function checkTransfer(
  step: PerformedProcedureStep,
  receivedInstances: number
): TransferCheck {
  const declaredInstances = (step?.series ?? []).reduce(
    (sum, s) => sum + Math.max(0, Math.floor(num(s.instanceCount) || 0)),
    0
  );
  const received = Math.max(0, Math.floor(num(receivedInstances) || 0));
  const missing = declaredInstances - received;

  if (missing === 0) {
    return {
      consistent: true,
      declaredInstances,
      receivedInstances: received,
      missing: 0,
      message: '',
    };
  }
  if (missing > 0) {
    return {
      consistent: false,
      declaredInstances,
      receivedInstances: received,
      missing,
      message:
        `A modalidade declarou ${declaredInstances} instância(s) e o arquivo recebeu ${received}: faltam ${missing}. ` +
        'É a deteccão mais barata de uma transferência que perdeu alguma coisa, e ela está disponível antes de alguém abrir o estudo — ' +
        'quando o leitor percebe uma série curta, ele já está lendo.',
    };
  }
  return {
    consistent: false,
    declaredInstances,
    receivedInstances: received,
    missing,
    message: `O arquivo recebeu ${received} instância(s) e a modalidade declarou ${declaredInstances} — envio duplicado ou contagem desatualizada.`,
  };
}

export interface OrderClosure {
  closes: boolean;
  needsReconciliation: boolean;
  isIncident: boolean;
  message: string;
}

/**
 * Whether this step closes the order it belongs to.
 *
 * An unscheduled examination closes nothing, because there was no order — it creates work
 * for the reconciliation instead of finishing it.
 */
export function orderClosure(step: PerformedProcedureStep): OrderClosure {
  const hasOrder = Boolean(text(step?.spsId));
  const isIncident =
    step?.status === 'discontinued' &&
    Boolean(step.discontinuationReason) &&
    INCIDENT_REASONS.includes(step.discontinuationReason as DiscontinuationReason);

  if (step?.status === 'in-progress') {
    return {
      closes: false,
      needsReconciliation: !hasOrder,
      isIncident: false,
      message: 'Passo ainda em andamento.',
    };
  }

  const parts: string[] = [];
  if (!hasOrder) {
    parts.push('Exame não agendado: não fecha pedido nenhum e entra na fila de reconciliação com o RIS.');
  } else {
    parts.push(`Fecha o passo agendado ${step.spsId}.`);
  }
  if (step?.status === 'discontinued') {
    parts.push(
      `Interrompido: ${DISCONTINUATION_REASONS[step.discontinuationReason as DiscontinuationReason] ?? 'motivo não registrado'}. ` +
        `${step.series.length} série(s) adquirida(s) antes da parada continuam sendo do paciente e precisam ser guardadas e lidas.`
    );
    if (isIncident) {
      parts.push('Motivo classificado como incidente, não como reagendamento.');
    }
  }

  return {
    closes: hasOrder,
    needsReconciliation: !hasOrder,
    isIncident,
    message: parts.join(' '),
  };
}

/** One line for the room status board. */
export function describePerformedStep(step: PerformedProcedureStep, now?: number): string {
  const protocol = compareProtocols(step);
  const staleness = Number.isFinite(num(now))
    ? assessStaleness(step, num(now))
    : { message: '' };
  const base = `${STATUS_LABELS[step.status]} · ${step.stationAeTitle} · ${step.performedProtocol} · ${step.series.length} série(s)`;
  const extras = [protocol.message, staleness.message].filter(Boolean).join(' ');
  return extras ? `${base}. ${extras}` : `${base}.`;
}
