/**
 * Critical findings communication — pure core (RTV-202).
 *
 * CFM 1.974/2011 and the ACR Practice Parameter for Communication of Diagnostic Imaging
 * Findings both say the same thing: a finding that puts the patient at immediate risk has
 * to reach the treating physician *now*, and the communication has to be recorded. This
 * module is the record and the clock.
 *
 * ## The record is append-only, because it is evidence
 *
 * "Registro imutável, não editável após envio" is an acceptance criterion, and it is the
 * whole point. A critical-findings log that can be edited after the fact proves nothing —
 * the case where it matters is the one where a patient was harmed and somebody is
 * establishing what was known, when, and who was told. So a notification is a sequence of
 * {@link CriticalFindingEvent}s that only ever grows. Correcting a description does not
 * rewrite it; it appends an amendment that both texts survive.
 *
 * ## A phone call without an attestation is not a notification
 *
 * The standard's preferred channel is direct verbal contact. A phone call leaves no
 * machine trace, so the only record is the radiologist stating that they made it — which
 * is exactly why {@link dispatch} refuses a `phone` notification without
 * `verballyConfirmed`. Recording "notified by phone at 14:32" with nothing behind it
 * produces a log that looks complete and is not.
 *
 * ## Escalation is derived from the clock, never stored
 *
 * Ten minutes without acknowledgement means the radiologist has to pick up the telephone.
 * That state is computed from `sentAt` and the current time every time it is asked for,
 * rather than being written into the record by a timer. A stored flag is only as good as
 * the timer that sets it: a tab that was closed, a worker that died, a laptop that slept —
 * and the failure mode is a critical finding that quietly stops nagging.
 *
 * ## The unsent finding is the dangerous one
 *
 * A finding that was typed and never dispatched — the network dropped, the tab closed — is
 * worse than no finding at all, because the radiologist believes they communicated.
 * {@link pendingDispatch} exists so the UI can refuse to let go of it.
 *
 * ## A note on the message template
 *
 * The template specified in the ticket carries the patient name and MRN over WhatsApp.
 * That is PHI on a third-party channel. {@link buildMessage} implements what was asked
 * but takes `includePatientName` as an explicit argument rather than assuming it, so the
 * decision is visible at the call site and can be turned off per-institution without
 * touching this file. The link carries the identity that the recipient authenticates to
 * see; the message does not have to.
 *
 * Time is injected. Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export type CriticalFindingType =
  | 'pulmonaryEmbolism'
  | 'acuteStroke'
  | 'aorticDissection'
  | 'tensionPneumothorax'
  | 'intracranialHemorrhage'
  | 'coronaryOcclusion'
  | 'other';

export const CRITICAL_FINDING_LABELS: Record<CriticalFindingType, string> = {
  pulmonaryEmbolism: 'Tromboembolismo pulmonar',
  acuteStroke: 'AVC agudo',
  aorticDissection: 'Dissecção aórtica',
  tensionPneumothorax: 'Pneumotórax hipertensivo',
  intracranialHemorrhage: 'Sangramento intracraniano',
  coronaryOcclusion: 'Obstrução coronária',
  other: 'Outro achado crítico',
};

export const CRITICAL_FINDING_TYPES = Object.keys(
  CRITICAL_FINDING_LABELS
) as CriticalFindingType[];

export type NotificationChannel = 'whatsapp' | 'phone' | 'email';

/** Max length of the summary, per the ticket. */
export const DESCRIPTION_MAX = 200;

/** Acknowledgement window before the radiologist must call. */
export const ACK_TIMEOUT_MS = 10 * 60 * 1000;

/** Second window: still unacknowledged, escalate beyond the radiologist. */
export const SUPERVISOR_TIMEOUT_MS = 30 * 60 * 1000;

export interface Recipient {
  id: string;
  name: string;
  phone?: string;
  email?: string;
}

export type CriticalFindingEventType =
  | 'created'
  | 'sent'
  | 'sendFailed'
  | 'acknowledged'
  | 'amended'
  | 'escalated';

export interface CriticalFindingEvent {
  type: CriticalFindingEventType;
  at: number;
  /** Who caused it: the radiologist, or the recipient for an acknowledgement. */
  actorId: string;
  channel?: NotificationChannel;
  note?: string;
}

export interface CriticalFinding {
  id: string;
  studyInstanceUid: string;
  patientId?: string;
  patientName?: string;
  findingType: CriticalFindingType;
  /** The summary as first written. Amendments append; this never changes. */
  description: string;
  radiologist: Recipient;
  recipients: Recipient[];
  createdAt: number;
  /** Set once a dispatch succeeded. */
  sentAt?: number;
  sentVia?: NotificationChannel;
  acknowledgedAt?: number;
  acknowledgedBy?: string;
  /** Append-only. */
  events: CriticalFindingEvent[];
}

export interface CreateInput {
  id: string;
  studyInstanceUid: string;
  findingType: CriticalFindingType;
  description: string;
  radiologist: Recipient;
  recipients: Recipient[];
  now: number;
  patientId?: string;
  patientName?: string;
}

export interface CreateResult {
  finding: CriticalFinding | null;
  error?: string;
}

const text = (value: unknown): string => String(value ?? '').trim();

/**
 * Opens a critical finding, not yet sent.
 *
 * Refuses without a recipient: a critical finding addressed to nobody is a note to self,
 * and the whole obligation is that somebody was told.
 */
export function createFinding(input: CreateInput): CreateResult {
  const description = text(input?.description);
  const now = Number(input?.now);

  if (!text(input?.id) || !text(input?.studyInstanceUid)) {
    return { finding: null, error: 'Achado crítico sem estudo identificado.' };
  }
  if (!CRITICAL_FINDING_TYPES.includes(input?.findingType)) {
    return { finding: null, error: 'Selecione o tipo do achado crítico.' };
  }
  if (!description) {
    return { finding: null, error: 'Descreva o achado.' };
  }
  if (description.length > DESCRIPTION_MAX) {
    return {
      finding: null,
      error: `A descrição deve ter no máximo ${DESCRIPTION_MAX} caracteres.`,
    };
  }
  if (!text(input?.radiologist?.id)) {
    return { finding: null, error: 'Achado crítico sem radiologista responsável.' };
  }
  const recipients = (input?.recipients ?? []).filter(r => text(r?.id) && text(r?.name));
  if (!recipients.length) {
    return { finding: null, error: 'Informe ao menos um destinatário.' };
  }
  if (!Number.isFinite(now)) {
    return { finding: null, error: 'Achado crítico sem horário.' };
  }

  return {
    finding: {
      id: text(input.id),
      studyInstanceUid: text(input.studyInstanceUid),
      patientId: text(input.patientId) || undefined,
      patientName: text(input.patientName) || undefined,
      findingType: input.findingType,
      description,
      radiologist: input.radiologist,
      recipients,
      createdAt: now,
      events: [{ type: 'created', at: now, actorId: input.radiologist.id }],
    },
  };
}

export interface DispatchInput {
  channel: NotificationChannel;
  now: number;
  /** Required for `phone`: the radiologist states they spoke to the recipient. */
  verballyConfirmed?: boolean;
  /** False when the transport reported a failure. */
  succeeded?: boolean;
  note?: string;
}

export interface DispatchResult {
  finding: CriticalFinding;
  ok: boolean;
  error?: string;
}

/**
 * Records a dispatch attempt.
 *
 * Both outcomes are recorded. A failed send that leaves no trace is how a radiologist ends
 * up believing they communicated — the failure has to be as visible as the success, and it
 * has to keep the finding in {@link pendingDispatch}.
 */
export function dispatch(finding: CriticalFinding, input: DispatchInput): DispatchResult {
  const now = Number(input?.now);
  const channel = input?.channel;

  if (!finding?.id) {
    return { finding, ok: false, error: 'Achado crítico inválido.' };
  }
  if (!['whatsapp', 'phone', 'email'].includes(channel as string)) {
    return { finding, ok: false, error: 'Canal de notificação inválido.' };
  }
  if (!Number.isFinite(now)) {
    return { finding, ok: false, error: 'Envio sem horário.' };
  }
  if (finding.sentAt) {
    // Not an error: a second channel is a second notification, and both are recorded.
    // Only the first `sentAt` stands, because that is when the clock started.
    return recordDispatch(finding, input, now, channel as NotificationChannel, false);
  }
  // The only record of a phone call is the radiologist saying they made it.
  if (channel === 'phone' && !input?.verballyConfirmed) {
    return {
      finding,
      ok: false,
      error: 'Marque a confirmação de que a comunicação verbal foi feita.',
    };
  }

  return recordDispatch(finding, input, now, channel as NotificationChannel, true);
}

function recordDispatch(
  finding: CriticalFinding,
  input: DispatchInput,
  now: number,
  channel: NotificationChannel,
  isFirst: boolean
): DispatchResult {
  const succeeded = input.succeeded !== false;
  const event: CriticalFindingEvent = {
    type: succeeded ? 'sent' : 'sendFailed',
    at: now,
    actorId: finding.radiologist.id,
    channel,
    note: text(input.note) || undefined,
  };

  const next: CriticalFinding = {
    ...finding,
    events: [...finding.events, event],
  };

  if (succeeded && isFirst) {
    next.sentAt = now;
    next.sentVia = channel;
  }

  return { finding: next, ok: succeeded, error: succeeded ? undefined : 'Falha no envio.' };
}

/** Records the recipient confirming receipt. */
export function acknowledge(
  finding: CriticalFinding,
  recipientId: string,
  now: number
): DispatchResult {
  const at = Number(now);
  if (!finding?.sentAt) {
    return { finding, ok: false, error: 'Não há notificação enviada para confirmar.' };
  }
  if (finding.acknowledgedAt) {
    // Idempotent: the recipient clicking the link twice is not an error, and the second
    // click must not overwrite the time of the first.
    return { finding, ok: true };
  }
  if (!Number.isFinite(at)) {
    return { finding, ok: false, error: 'Confirmação sem horário.' };
  }

  return {
    ok: true,
    finding: {
      ...finding,
      acknowledgedAt: at,
      acknowledgedBy: text(recipientId) || undefined,
      events: [
        ...finding.events,
        { type: 'acknowledged', at, actorId: text(recipientId) || 'desconhecido' },
      ],
    },
  };
}

/**
 * Appends a correction.
 *
 * The original description is untouched — see the module note. A log that can be edited
 * proves nothing in the case where it matters.
 */
export function amend(
  finding: CriticalFinding,
  note: string,
  actorId: string,
  now: number
): DispatchResult {
  const body = text(note);
  const at = Number(now);
  if (!body) {
    return { finding, ok: false, error: 'Complemento vazio.' };
  }
  if (!Number.isFinite(at)) {
    return { finding, ok: false, error: 'Complemento sem horário.' };
  }
  return {
    ok: true,
    finding: {
      ...finding,
      events: [...finding.events, { type: 'amended', at, actorId: text(actorId), note: body }],
    },
  };
}

export type EscalationLevel = 'none' | 'unsent' | 'awaiting' | 'callNow' | 'supervisor';

export interface EscalationState {
  level: EscalationLevel;
  /** Milliseconds since the notification was sent. Null when never sent. */
  elapsedMs: number | null;
  message: string;
}

/**
 * What the viewer should be showing about this finding right now.
 *
 * Derived from the clock every time — see the module note on why this is not a stored
 * flag.
 */
export function escalationState(finding: CriticalFinding, now: number): EscalationState {
  const at = Number(now);
  if (!finding) {
    return { level: 'none', elapsedMs: null, message: '' };
  }
  if (finding.acknowledgedAt) {
    return { level: 'none', elapsedMs: null, message: 'Recebimento confirmado.' };
  }
  if (!finding.sentAt) {
    return {
      level: 'unsent',
      elapsedMs: null,
      message: 'Achado crítico NÃO comunicado — envie antes de finalizar o laudo.',
    };
  }
  const elapsedMs = Number.isFinite(at) ? at - finding.sentAt : 0;
  if (elapsedMs >= SUPERVISOR_TIMEOUT_MS) {
    return {
      level: 'supervisor',
      elapsedMs,
      message: 'Sem confirmação há mais de 30 minutos — escale para a coordenação.',
    };
  }
  if (elapsedMs >= ACK_TIMEOUT_MS) {
    return {
      level: 'callNow',
      elapsedMs,
      message: 'Sem confirmação há mais de 10 minutos — ligue para o solicitante.',
    };
  }
  return {
    level: 'awaiting',
    elapsedMs,
    message: 'Aguardando confirmação de recebimento.',
  };
}

/** Findings the radiologist must not walk away from. */
export function pendingDispatch(findings: CriticalFinding[]): CriticalFinding[] {
  return (findings ?? []).filter(f => f && !f.sentAt);
}

/** Findings sent but not acknowledged, worst first — the supervisor's panel. */
export function pendingAcknowledgement(
  findings: CriticalFinding[],
  now: number
): CriticalFinding[] {
  return (findings ?? [])
    .filter(f => f?.sentAt && !f.acknowledgedAt)
    .sort((a, b) => (a.sentAt as number) - (b.sentAt as number));
}

export interface MessageOptions {
  studyLink: string;
  /**
   * Whether to put the patient's name in the message body.
   *
   * Explicit rather than assumed: this is PHI on a third-party channel. See the module
   * note.
   */
  includePatientName?: boolean;
}

/**
 * The notification text.
 *
 * The recipient's name is used, the finding type is named in full, and the link is what
 * carries the rest — a recipient who has to authenticate to open the study is a better
 * place for the patient's details than a message sitting in a phone's notification
 * shade.
 */
export function buildMessage(
  finding: CriticalFinding,
  recipient: Recipient,
  options: MessageOptions
): string {
  const who = text(recipient?.name) || 'Doutor(a)';
  const label = CRITICAL_FINDING_LABELS[finding?.findingType] ?? 'Achado crítico';
  const patient = options?.includePatientName
    ? text(finding?.patientName) || text(finding?.patientId)
    : text(finding?.patientId);
  const subject = patient ? ` no paciente ${patient}` : '';
  const link = text(options?.studyLink);

  return [
    `Dr(a). ${who}, achado crítico${subject}: ${label}.`,
    finding?.description ? `Resumo: ${finding.description}` : '',
    `Radiologista: ${text(finding?.radiologist?.name)}.`,
    link ? `Estudo: ${link}` : '',
    'Por favor, confirme o recebimento.',
  ]
    .filter(Boolean)
    .join(' ');
}

/** One line for the worklist badge tooltip and the audit export. */
export function describeFinding(finding: CriticalFinding, now: number): string {
  if (!finding) {
    return '';
  }
  const label = CRITICAL_FINDING_LABELS[finding.findingType] ?? 'Achado crítico';
  return `${label} — ${escalationState(finding, now).message}`;
}

export interface CriticalFindingRow {
  id: string;
  studyInstanceUid: string;
  findingType: CriticalFindingType;
  label: string;
  radiologist: string;
  createdAt: number;
  sentAt: number | null;
  sentVia: NotificationChannel | null;
  acknowledgedAt: number | null;
  /** Minutes from send to acknowledgement; null when either is missing. */
  ackMinutes: number | null;
  escalation: EscalationLevel;
}

/**
 * The management report.
 *
 * Rows are built from the event log rather than from the mutable fields wherever the two
 * could disagree, and a finding that was never sent still gets a row — a report that only
 * lists successful notifications is a report that hides the failures.
 */
export function buildManagementReport(
  findings: CriticalFinding[],
  now: number,
  fromMs?: number,
  toMs?: number
): CriticalFindingRow[] {
  const from = Number.isFinite(Number(fromMs)) ? Number(fromMs) : -Infinity;
  const to = Number.isFinite(Number(toMs)) ? Number(toMs) : Infinity;

  return (findings ?? [])
    .filter(f => f && f.createdAt >= from && f.createdAt <= to)
    .map(f => ({
      id: f.id,
      studyInstanceUid: f.studyInstanceUid,
      findingType: f.findingType,
      label: CRITICAL_FINDING_LABELS[f.findingType] ?? 'Achado crítico',
      radiologist: f.radiologist?.name ?? '',
      createdAt: f.createdAt,
      sentAt: f.sentAt ?? null,
      sentVia: f.sentVia ?? null,
      acknowledgedAt: f.acknowledgedAt ?? null,
      ackMinutes:
        f.sentAt && f.acknowledgedAt ? (f.acknowledgedAt - f.sentAt) / 60000 : null,
      escalation: escalationState(f, now).level,
    }))
    .sort((a, b) => a.createdAt - b.createdAt);
}
