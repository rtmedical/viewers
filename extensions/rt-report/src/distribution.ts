/**
 * Multi-channel report distribution — pure core (RTV-110).
 *
 * Deciding *what may travel by which channel*, *whether a delivery actually closed the
 * loop*, and *who is holding a superseded report*. The transports themselves — SMTP, the
 * WhatsApp Business API, the portal, the print spooler — are adapters and are not here.
 *
 * ## A channel that does not authenticate the recipient may not carry the report
 *
 * This is the rule the module exists to enforce. A laudo is health data, which the LGPD
 * treats as sensitive personal data, and the channels differ in kind rather than in
 * convenience: a portal knows who logged in; an email address and a phone number are
 * strings someone typed at a reception desk, frequently shared with a family member and
 * frequently stale.
 *
 * So an unauthenticated channel may carry a **notification** — "your report is ready, log
 * in to read it" — and never the content or an attachment. {@link planDistribution} refuses
 * the combination rather than downgrading it silently, because a silent downgrade is how a
 * report ends up in a WhatsApp group.
 *
 * ## Sent is not delivered, delivered is not read
 *
 * An SMTP relay accepting a message means the message left the building. A distribution
 * system that treats that as "the referring physician has the result" is the mechanism by
 * which a critical finding goes unacted on while the audit log says it was communicated.
 * Only an acknowledged read closes a communication loop, and
 * {@link closesCommunicationLoop} is the single place that says so — `safetyNet.ts`
 * (RTV-229) depends on that answer.
 *
 * ## A retry must not become a second disclosure
 *
 * The dangerous retry is the one after an ambiguous timeout, where the first message may
 * well have been delivered. Sending again is not idempotent in the way a failed API call
 * is: a second copy of a report to a shared phone is a second disclosure to whoever else
 * reads that phone. Every attempt carries a key derived from report, version, channel and
 * recipient, and {@link isDuplicate} answers before the adapter is called.
 *
 * ## An amendment makes every prior recipient wrong
 *
 * Whoever received version 1 is acting on a report that has since changed. Producing that
 * list is not a reporting nicety; it is the only way the amendment reaches the people the
 * original reached. {@link supersededDeliveries} produces it.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export type Channel = 'portal' | 'email' | 'whatsapp' | 'sms' | 'print' | 'fax';

export interface ChannelProfile {
  /** Whether the channel establishes who is receiving, rather than trusting a string. */
  authenticatesRecipient: boolean;
  /** Whether the report itself may travel on it. */
  mayCarryContent: boolean;
  /** Whether the transport can report delivery back. */
  reportsDelivery: boolean;
  label: string;
}

export const CHANNELS: Record<Channel, ChannelProfile> = {
  portal: {
    authenticatesRecipient: true,
    mayCarryContent: true,
    reportsDelivery: true,
    label: 'portal autenticado',
  },
  email: {
    authenticatesRecipient: false,
    mayCarryContent: false,
    reportsDelivery: true,
    label: 'e-mail',
  },
  whatsapp: {
    authenticatesRecipient: false,
    mayCarryContent: false,
    reportsDelivery: true,
    label: 'WhatsApp',
  },
  sms: {
    authenticatesRecipient: false,
    mayCarryContent: false,
    reportsDelivery: true,
    label: 'SMS',
  },
  // Handed to a person at the counter against an identity check, which is an
  // authentication step even though nothing digital happened.
  print: {
    authenticatesRecipient: true,
    mayCarryContent: true,
    reportsDelivery: false,
    label: 'impressão retirada no balcão',
  },
  fax: {
    authenticatesRecipient: false,
    mayCarryContent: true,
    reportsDelivery: false,
    label: 'fax',
  },
};

export type Payload = 'notification' | 'report';

export interface Recipient {
  id: string;
  name: string;
  /** e-mail, phone, portal account, physical destination. */
  address: string;
  /** Whether the address was verified as belonging to this person. */
  verified: boolean;
  /** When it was verified, epoch ms. */
  verifiedAt?: number;
  /** Set when the contact is known to be shared, e.g. a household phone. */
  shared?: boolean;
}

/** A contact verified longer ago than this is stale. */
export const VERIFICATION_VALIDITY_MS = 365 * 24 * 3_600_000;

export interface DistributionRequest {
  reportId: string;
  reportVersion: number;
  channel: Channel;
  payload: Payload;
  recipient: Recipient;
  /** Whether this report carries a critical finding. */
  critical?: boolean;
}

export interface PlannedDelivery {
  key: string;
  request: DistributionRequest;
  warnings: string[];
}

export interface RefusedDelivery {
  request: DistributionRequest;
  reason: string;
}

export interface DistributionPlan {
  allowed: PlannedDelivery[];
  refused: RefusedDelivery[];
  message: string;
}

const text = (value: unknown): string => String(value ?? '').trim();

/**
 * A key that identifies this exact disclosure.
 *
 * Includes the version: distributing an amended report to someone who received the
 * original is a *new* disclosure and must not be suppressed as a duplicate.
 */
export function deliveryKey(request: DistributionRequest): string {
  return [
    text(request?.reportId),
    String(Number(request?.reportVersion) || 0),
    text(request?.channel),
    text(request?.payload),
    text(request?.recipient?.id),
    text(request?.recipient?.address).toLowerCase(),
  ].join('|');
}

/**
 * Which requests may proceed.
 *
 * Refuses rather than downgrades. Turning a refused "report by WhatsApp" into a silent
 * "notification by WhatsApp" would satisfy the rule and hide from the sender that the
 * recipient is not getting what they were told they would get.
 */
export function planDistribution(
  requests: DistributionRequest[],
  now: number
): DistributionPlan {
  const allowed: PlannedDelivery[] = [];
  const refused: RefusedDelivery[] = [];

  for (const request of requests ?? []) {
    const profile = CHANNELS[request?.channel];
    const warnings: string[] = [];

    if (!profile) {
      refused.push({ request, reason: `Canal desconhecido: ${text(request?.channel)}.` });
      continue;
    }
    if (!text(request?.reportId) || !Number.isFinite(Number(request?.reportVersion))) {
      refused.push({ request, reason: 'Envio sem laudo ou sem versão identificada.' });
      continue;
    }
    if (!text(request?.recipient?.address)) {
      refused.push({ request, reason: 'Destinatário sem endereço.' });
      continue;
    }

    if (request.payload === 'report' && !profile.mayCarryContent) {
      refused.push({
        request,
        reason:
          `${profile.label} não autentica o destinatário, então não pode levar o laudo. ` +
          'Um endereço de e-mail ou um número de telefone é uma string digitada no balcão, muitas vezes compartilhada. ' +
          'Envie a notificação por este canal e o conteúdo pelo portal.',
      });
      continue;
    }

    if (!request.recipient.verified) {
      refused.push({
        request,
        reason: `Contato de ${request.recipient.name || request.recipient.id} não verificado — enviar para o contato errado é a falha que importa.`,
      });
      continue;
    }

    const verifiedAt = Number(request.recipient.verifiedAt);
    if (Number.isFinite(verifiedAt) && now - verifiedAt > VERIFICATION_VALIDITY_MS) {
      warnings.push(
        `Contato verificado há mais de um ano. Números e e-mails mudam de dono; reconfirme antes de um envio sensível.`
      );
    }

    if (request.recipient.shared && request.payload === 'report') {
      refused.push({
        request,
        reason:
          'Contato marcado como compartilhado. Enviar o laudo para um telefone de família expõe o resultado a quem mais lê aquele aparelho.',
      });
      continue;
    }

    if (request.critical && !profile.reportsDelivery) {
      warnings.push(
        `${profile.label} não devolve confirmação de entrega, e este laudo tem achado crítico. A comunicação não se fecha por aqui.`
      );
    }

    allowed.push({ key: deliveryKey(request), request, warnings });
  }

  return {
    allowed,
    refused,
    message: `${allowed.length} envio(s) liberado(s), ${refused.length} recusado(s).`,
  };
}

export type DeliveryStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed';

export const STATUS_LABELS: Record<DeliveryStatus, string> = {
  queued: 'na fila',
  sent: 'enviado',
  delivered: 'entregue',
  read: 'lido',
  failed: 'falhou',
};

const STATUS_ORDER: DeliveryStatus[] = ['queued', 'sent', 'delivered', 'read'];

export interface DeliveryRecord {
  key: string;
  reportId: string;
  reportVersion: number;
  channel: Channel;
  payload: Payload;
  recipientId: string;
  status: DeliveryStatus;
  attempts: number;
  updatedAt: number;
  /** Set when someone confirmed receipt out of band, e.g. a phone call. */
  acknowledgedBy?: string;
  error?: string;
}

/**
 * Whether this delivery closed the communication loop.
 *
 * Only a read, or an out-of-band acknowledgement someone recorded. An SMTP relay accepting
 * a message says the message left the building — treating that as "the referring physician
 * has the result" is how a critical finding goes unacted on while the log says it was
 * communicated.
 */
export function closesCommunicationLoop(record: DeliveryRecord): boolean {
  if (!record) {
    return false;
  }
  return record.status === 'read' || Boolean(text(record.acknowledgedBy));
}

export interface AdvanceResult {
  record: DeliveryRecord;
  ok: boolean;
  reason?: string;
}

/**
 * Moves a delivery forward.
 *
 * Refuses to move backwards: a late "sent" webhook arriving after a "read" would otherwise
 * reopen a loop that was legitimately closed, and the follow-up list would grow entries
 * nobody can resolve.
 */
export function advanceStatus(
  record: DeliveryRecord,
  status: DeliveryStatus,
  at: number,
  error?: string
): AdvanceResult {
  if (!record) {
    return { record, ok: false, reason: 'Registro ausente.' };
  }
  if (!STATUS_LABELS[status]) {
    return { record, ok: false, reason: `Status desconhecido: ${String(status)}.` };
  }
  if (status === 'failed') {
    return {
      ok: true,
      record: { ...record, status, updatedAt: Number(at), error: text(error) || 'Falha no envio.' },
    };
  }
  if (record.status === 'failed') {
    return {
      ok: true,
      record: { ...record, status, updatedAt: Number(at), error: undefined },
    };
  }

  const from = STATUS_ORDER.indexOf(record.status);
  const to = STATUS_ORDER.indexOf(status);
  if (to <= from) {
    return {
      record,
      ok: false,
      reason:
        `Já está em "${STATUS_LABELS[record.status]}"; um webhook atrasado de "${STATUS_LABELS[status]}" não pode reabrir um ciclo fechado.`,
    };
  }
  return { ok: true, record: { ...record, status, updatedAt: Number(at) } };
}

/**
 * Whether this exact disclosure already happened.
 *
 * Checked before the adapter is called. The dangerous retry is the one after an ambiguous
 * timeout: the first message may well have arrived, and a second copy of a report to a
 * shared phone is a second disclosure.
 */
export function isDuplicate(key: string, history: DeliveryRecord[]): boolean {
  const target = text(key);
  return (history ?? []).some(r => r && r.key === target && r.status !== 'failed');
}

export interface SupersededDelivery {
  record: DeliveryRecord;
  heldVersion: number;
  currentVersion: number;
}

/**
 * Everyone holding a version older than the current one.
 *
 * The only way an amendment reaches the people the original reached. Failed deliveries are
 * excluded — nobody is holding those.
 */
export function supersededDeliveries(
  history: DeliveryRecord[],
  reportId: string,
  currentVersion: number
): SupersededDelivery[] {
  const id = text(reportId);
  const current = Number(currentVersion);
  const latestPerRecipient = new Map<string, DeliveryRecord>();

  for (const record of history ?? []) {
    if (!record || record.reportId !== id || record.status === 'failed') {
      continue;
    }
    if (record.payload !== 'report') {
      continue;
    }
    const existing = latestPerRecipient.get(record.recipientId);
    if (!existing || record.reportVersion > existing.reportVersion) {
      latestPerRecipient.set(record.recipientId, record);
    }
  }

  const result: SupersededDelivery[] = [];
  for (const record of latestPerRecipient.values()) {
    if (record.reportVersion < current) {
      result.push({ record, heldVersion: record.reportVersion, currentVersion: current });
    }
  }
  return result.sort((a, b) => a.record.recipientId.localeCompare(b.record.recipientId));
}

export interface LoopStatus {
  closed: boolean;
  message: string;
}

/**
 * Whether a critical finding has actually been communicated.
 *
 * Answers for the whole set of attempts rather than per delivery: five sent emails and no
 * read is not five-fifths of a communication.
 */
export function criticalCommunication(records: DeliveryRecord[]): LoopStatus {
  const list = (records ?? []).filter(Boolean);
  if (!list.length) {
    return { closed: false, message: 'Nenhuma tentativa de comunicação registrada.' };
  }
  const closing = list.find(closesCommunicationLoop);
  if (closing) {
    return {
      closed: true,
      message: closing.acknowledgedBy
        ? `Confirmado por ${closing.acknowledgedBy}.`
        : `Lido em ${CHANNELS[closing.channel]?.label ?? closing.channel}.`,
    };
  }
  const best = list.reduce((a, b) =>
    STATUS_ORDER.indexOf(b.status) > STATUS_ORDER.indexOf(a.status) ? b : a
  );
  return {
    closed: false,
    message:
      `${list.length} tentativa(s), a melhor em "${STATUS_LABELS[best.status]}". ` +
      'Enviado não é entregue e entregue não é lido — a comunicação de um achado crítico não se fecha aqui.',
  };
}

/** One line per delivery for the distribution panel. */
export function describeDelivery(record: DeliveryRecord): string {
  if (!record) {
    return '';
  }
  const channel = CHANNELS[record.channel]?.label ?? record.channel;
  const payload = record.payload === 'report' ? 'laudo' : 'notificação';
  const closed = closesCommunicationLoop(record) ? ' · ciclo fechado' : '';
  return `${payload} v${record.reportVersion} por ${channel}: ${STATUS_LABELS[record.status]}${closed}`;
}
