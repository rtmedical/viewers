/**
 * Storage commitment: who is responsible for the images — pure core (RTV-101).
 *
 * The DIMSE association is an adapter. What is here is the state machine, and the state
 * machine exists to answer exactly one question: **may the local copy be deleted?**
 *
 * `localDatasource.ts` (RTV-194) already refuses to offer a delete until the PACS has the
 * study. This is the part that establishes what "has" means.
 *
 * ## A successful send is not a commitment
 *
 * A C-STORE that returns success means the bytes were accepted by the receiving
 * application. It does not mean they were written to durable storage, that they survived
 * the receiver's own ingestion, or that anyone will be able to retrieve them tomorrow.
 * Storage commitment exists precisely because those are different claims, and deleting on
 * the strength of the send is the standard route to losing a study.
 *
 * ## No answer is not an answer
 *
 * The N-EVENT-REPORT comes back on a **separate association**, possibly minutes or hours
 * later. A request that has not been answered is `pending` — not failed, and certainly not
 * committed. Timing out into either of those is how a study is either deleted early or
 * re-sent forever.
 *
 * ## A response is not a blanket yes
 *
 * The report carries a successful list and a failed list. A study is committed when
 * **every one of its instances** is in the successful list. Treating the arrival of a
 * response as commitment of the study silently abandons whatever is in the failure list —
 * and the failure list is where the instance that did not survive transcoding ends up.
 *
 * ## The transaction UID is the only thing tying the answer to the question
 *
 * Reports arrive out of band. Matching one to "the most recent pending request" is a
 * plausible-looking shortcut that, under load, marks the wrong study committed.
 *
 * Framework-free, no `@ohif/*`, no timers — the clock is a parameter.
 */

export type CommitmentState = 'not-requested' | 'pending' | 'committed' | 'partial' | 'failed';

export const STATE_LABELS: Record<CommitmentState, string> = {
  'not-requested': 'sem solicitação',
  pending: 'aguardando resposta',
  committed: 'comprometido',
  partial: 'parcialmente comprometido',
  failed: 'recusado',
};

export interface CommitmentRequest {
  transactionUid: string;
  studyInstanceUid: string;
  /** Every SOP instance the request covers. */
  sopInstanceUids: string[];
  /** Archive AE title the request went to. */
  remoteAe: string;
  requestedAt: number;
  state: CommitmentState;
  /** Instances the archive accepted responsibility for. */
  committedUids: string[];
  /** Instances it refused, with the reason it gave. */
  failures: Array<{ sopInstanceUid: string; reason: string }>;
  respondedAt?: number;
}

export interface CommitmentReport {
  transactionUid: string;
  successfulUids: string[];
  failures: Array<{ sopInstanceUid: string; reason: string }>;
  receivedAt: number;
}

const text = (value: unknown): string => String(value ?? '').trim();
const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};

export interface RequestResult {
  request: CommitmentRequest | null;
  ok: boolean;
  reason?: string;
}

/**
 * Opens a commitment request.
 *
 * The transaction UID is required and must be unique: it is the only thing that will tie an
 * out-of-band report back to this request.
 */
export function requestCommitment(input: {
  transactionUid: string;
  studyInstanceUid: string;
  sopInstanceUids: string[];
  remoteAe: string;
  requestedAt: number;
}, existing: CommitmentRequest[] = []): RequestResult {
  const transactionUid = text(input?.transactionUid);
  const instances = (input?.sopInstanceUids ?? []).map(text).filter(Boolean);

  if (!transactionUid) {
    return { request: null, ok: false, reason: 'Solicitação sem Transaction UID — não haveria como casar a resposta.' };
  }
  if (existing.some(r => r && r.transactionUid === transactionUid)) {
    return {
      request: null,
      ok: false,
      reason: 'Transaction UID já em uso. Reaproveitá-lo faz a resposta de uma solicitação valer para outra.',
    };
  }
  if (!text(input?.studyInstanceUid)) {
    return { request: null, ok: false, reason: 'Solicitação sem estudo.' };
  }
  if (!instances.length) {
    return { request: null, ok: false, reason: 'Solicitação sem instâncias.' };
  }
  if (!text(input?.remoteAe)) {
    return { request: null, ok: false, reason: 'Solicitação sem AE de destino.' };
  }

  return {
    ok: true,
    request: {
      transactionUid,
      studyInstanceUid: text(input.studyInstanceUid),
      sopInstanceUids: instances,
      remoteAe: text(input.remoteAe),
      requestedAt: num(input.requestedAt),
      state: 'pending',
      committedUids: [],
      failures: [],
    },
  };
}

export interface ApplyResult {
  request: CommitmentRequest;
  ok: boolean;
  reason?: string;
}

/**
 * Applies an N-EVENT-REPORT to the request it belongs to.
 *
 * Matched only by transaction UID. Attaching a report to the most recent pending request
 * because the UID is unfamiliar is the shortcut that marks the wrong study committed under
 * load, and it looks like resilience.
 */
export function applyReport(request: CommitmentRequest, report: CommitmentReport): ApplyResult {
  if (!request || !report) {
    return { request, ok: false, reason: 'Solicitação ou resposta ausente.' };
  }
  if (text(request.transactionUid) !== text(report.transactionUid)) {
    return {
      request,
      ok: false,
      reason:
        'Transaction UID não confere. A resposta chega fora de banda, e casá-la com "a solicitação pendente mais recente" ' +
        'marca o estudo errado como comprometido — e parece robustez.',
    };
  }

  const successful = new Set((report.successfulUids ?? []).map(text).filter(Boolean));
  const failures = (report.failures ?? []).filter(f => f && text(f.sopInstanceUid));
  const committedUids = request.sopInstanceUids.filter(uid => successful.has(uid));
  const everyone = committedUids.length === request.sopInstanceUids.length;
  const none = committedUids.length === 0;

  return {
    ok: true,
    request: {
      ...request,
      state: everyone ? 'committed' : none ? 'failed' : 'partial',
      committedUids,
      failures,
      respondedAt: num(report.receivedAt),
    },
  };
}

export interface DeletionVerdict {
  mayDelete: boolean;
  /** Instances that are safe to delete locally. */
  deletableUids: string[];
  reason: string;
}

/**
 * Whether the local copy may go.
 *
 * The one question the whole module answers. Note that a partial commitment yields a
 * partial deletion list rather than a blanket yes or no: the instances the archive accepted
 * are safe and the ones it refused are the only copies left.
 */
export function mayDeleteLocal(request: CommitmentRequest): DeletionVerdict {
  if (!request) {
    return { mayDelete: false, deletableUids: [], reason: 'Sem solicitação de commitment.' };
  }

  switch (request.state) {
    case 'committed':
      return {
        mayDelete: true,
        deletableUids: [...request.sopInstanceUids],
        reason: `${request.remoteAe} assumiu a responsabilidade por todas as ${request.sopInstanceUids.length} instância(s).`,
      };
    case 'partial':
      return {
        mayDelete: false,
        deletableUids: [...request.committedUids],
        reason:
          `${request.committedUids.length} de ${request.sopInstanceUids.length} instância(s) comprometidas. ` +
          'As recusadas continuam existindo só aqui — apagar o estudo inteiro perde exatamente as que não sobreviveram.',
      };
    case 'pending':
      return {
        mayDelete: false,
        deletableUids: [],
        reason:
          'Aguardando resposta. Sem resposta não é resposta: o relatório chega numa associação separada, às vezes horas depois.',
      };
    case 'failed':
      return {
        mayDelete: false,
        deletableUids: [],
        reason: `${request.remoteAe} recusou a responsabilidade. A única cópia é esta.`,
      };
    default:
      return {
        mayDelete: false,
        deletableUids: [],
        reason:
          'Nenhum commitment solicitado. Um C-STORE bem sucedido significa que os bytes foram aceitos, não que foram gravados de forma durável — ' +
          'apagar com base no envio é a rota padrão para perder um estudo.',
      };
  }
}

export interface AgeAssessment {
  ageMs: number;
  overdue: boolean;
  message: string;
}

/** A commitment with no answer after this deserves a chase, milliseconds. */
export const COMMITMENT_OVERDUE_MS = 24 * 3_600_000;

/**
 * How long a request has been unanswered.
 *
 * Overdue is a prompt to re-send the request, never a reason to change the state. The state
 * only moves when the archive says something.
 */
export function assessAge(
  request: CommitmentRequest,
  now: number,
  overdueMs = COMMITMENT_OVERDUE_MS
): AgeAssessment {
  const ageMs = Math.max(0, num(now) - num(request?.requestedAt));
  if (request?.state !== 'pending') {
    return { ageMs, overdue: false, message: '' };
  }
  const limit = Number.isFinite(num(overdueMs)) ? num(overdueMs) : COMMITMENT_OVERDUE_MS;
  if (ageMs <= limit) {
    return { ageMs, overdue: false, message: '' };
  }
  return {
    ageMs,
    overdue: true,
    message:
      `Sem resposta há ${(ageMs / 3_600_000).toFixed(0)}h. Reenvie a solicitação — o estado continua "aguardando", ` +
      'porque tempo decorrido não é uma resposta do arquivo e transformá-lo em falha faria o estudo ser reenviado para sempre, ' +
      'enquanto transformá-lo em sucesso faria a cópia local ser apagada cedo.',
  };
}

export interface ResendPlan {
  /** Instances worth requesting again. */
  uids: string[];
  safe: boolean;
  message: string;
}

/**
 * What to re-request.
 *
 * Re-requesting commitment is safe and idempotent; deleting is not. So the retry path is
 * always "ask again", never "assume and clean up".
 */
export function planResend(request: CommitmentRequest): ResendPlan {
  if (!request) {
    return { uids: [], safe: false, message: 'Sem solicitação.' };
  }
  const outstanding = request.sopInstanceUids.filter(uid => !request.committedUids.includes(uid));
  if (!outstanding.length) {
    return { uids: [], safe: true, message: 'Tudo comprometido — nada a reenviar.' };
  }
  return {
    uids: outstanding,
    safe: true,
    message:
      `${outstanding.length} instância(s) sem commitment. Reenviar a solicitação é idempotente; apagar não é, ` +
      'então o caminho de retentativa é sempre perguntar de novo.',
  };
}

/** One line for the commitment column. */
export function describeCommitment(request: CommitmentRequest, now?: number): string {
  if (!request) {
    return STATE_LABELS['not-requested'];
  }
  const verdict = mayDeleteLocal(request);
  const age = Number.isFinite(num(now)) ? assessAge(request, num(now)) : { message: '' };
  const suffix = age.message ? ` ${age.message}` : '';
  return `${STATE_LABELS[request.state]} em ${request.remoteAe}: ${verdict.reason}${suffix}`;
}
