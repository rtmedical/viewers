/**
 * Viewer access audit trail — pure core (RTV-206).
 *
 * LGPD Art. 37, ANVISA RDC 657/2022 and SBIS NGS v5.2 all require an auditable record
 * of who touched health data, when, and what they did. The Connect backend already has
 * an `audit_logs` table for RIS operations; what was missing is the *viewer* side —
 * opening a study, exporting an image, creating a measurement.
 *
 * ## The design decision that matters: no free text
 *
 * An audit event carries **structured fields only**. There is no `description` string.
 *
 * The tempting alternative is a free-text detail field plus a regex that scrubs PHI out
 * of it. That is a false sense of security: PHI in free text is unbounded (a nickname,
 * a room number, a fragment of a report), regexes catch the shapes you thought of, and
 * the failures are silent and permanent — an audit log is append-only and often
 * replicated off-site. Refusing free text means there is nothing to scrub.
 *
 * So {@link createAuditEvent} accepts a fixed set of keys, coerces each to a scalar, and
 * **drops** anything else. Callers that need more detail add a typed field here, on
 * purpose, with review.
 *
 * ## The other one: the queue must not lose events
 *
 * An audit trail that drops events when the network blips is not an audit trail. The
 * queue buffers, retries with backoff, and when it is finally full it drops the
 * **newest** event and says so — never the oldest. The oldest events are the ones a
 * reviewer is reconstructing a timeline from, and a gap at the start is worse than a
 * gap at the end.
 *
 * Framework-free and time-injectable. Zero-fork per RTV-114.
 */

export type AuditEventType =
  | 'study.opened'
  | 'study.closed'
  | 'study.exported'
  | 'series.viewed'
  | 'measurement.created'
  | 'measurement.deleted'
  | 'report.signed'
  | 'image.printed'
  | 'access.denied'
  | 'access.breakGlass';

export const AUDIT_EVENT_TYPES: AuditEventType[] = [
  'study.opened',
  'study.closed',
  'study.exported',
  'series.viewed',
  'measurement.created',
  'measurement.deleted',
  'report.signed',
  'image.printed',
  'access.denied',
  'access.breakGlass',
];

/**
 * The only fields an event may carry, beyond the mandatory ones.
 *
 * Every key here is a bounded, non-narrative value. Adding one is a deliberate act:
 * it should be reviewable as "could this ever hold clinical narrative?".
 */
export const ALLOWED_DETAIL_KEYS = [
  'seriesInstanceUid',
  'sopInstanceUid',
  'modality',
  'exportFormat',
  'measurementTool',
  'destinationAet',
  'reasonCode',
  'viewportCount',
  'pageCount',
] as const;

export type AuditDetailKey = (typeof ALLOWED_DETAIL_KEYS)[number];

export interface AuditEventInput {
  type: AuditEventType;
  userId: string;
  /** Epoch ms. Injected so events are deterministic in tests and replayable. */
  timestamp: number;
  studyInstanceUid?: string;
  patientId?: string;
  ipAddress?: string;
  userAgent?: string;
  detail?: Partial<Record<AuditDetailKey, unknown>> & Record<string, unknown>;
}

export interface AuditEvent {
  type: AuditEventType;
  userId: string;
  timestamp: number;
  /** ISO form, for a human reading the log. */
  isoTime: string;
  studyInstanceUid?: string;
  patientId?: string;
  ipAddress?: string;
  userAgent?: string;
  detail: Partial<Record<AuditDetailKey, string | number | boolean>>;
  /** Keys that were dropped because they are not on the allowlist. */
  droppedKeys: string[];
}

const MAX_SCALAR_LENGTH = 128;

/** Coerces a value to a bounded scalar, or null when it is not one. */
function toScalar(value: unknown): string | number | boolean | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    // Truncating rather than rejecting: a long UID is still useful, and the cap is what
    // stops a narrative from being smuggled through a field that is meant to hold one.
    return trimmed.slice(0, MAX_SCALAR_LENGTH);
  }
  return null;
}

/**
 * Builds an audit event, dropping anything not on the allowlist.
 *
 * Returns `null` when the event has no type or no user: an event that cannot say who
 * did what is not worth storing, and storing it would make the log look complete when
 * it is not.
 */
export function createAuditEvent(input: AuditEventInput): AuditEvent | null {
  const type = input?.type;
  const userId = String(input?.userId ?? '').trim();
  if (!AUDIT_EVENT_TYPES.includes(type) || !userId) {
    return null;
  }

  const timestamp = Number(input?.timestamp);
  const when = Number.isFinite(timestamp) ? timestamp : 0;

  const detail: Partial<Record<AuditDetailKey, string | number | boolean>> = {};
  const droppedKeys: string[] = [];
  for (const [key, value] of Object.entries(input?.detail ?? {})) {
    if (!(ALLOWED_DETAIL_KEYS as readonly string[]).includes(key)) {
      droppedKeys.push(key);
      continue;
    }
    const scalar = toScalar(value);
    if (scalar === null) {
      droppedKeys.push(key);
      continue;
    }
    detail[key as AuditDetailKey] = scalar;
  }

  return {
    type,
    userId,
    timestamp: when,
    isoTime: new Date(when).toISOString(),
    studyInstanceUid: toScalar(input?.studyInstanceUid) as string | undefined,
    patientId: toScalar(input?.patientId) as string | undefined,
    ipAddress: toScalar(input?.ipAddress) as string | undefined,
    userAgent: toScalar(input?.userAgent) as string | undefined,
    detail,
    droppedKeys,
  };
}

/** Where flushed events go. Returns true when the batch was accepted. */
export type AuditSink = (events: AuditEvent[]) => Promise<boolean> | boolean;

export interface AuditQueueOptions {
  sink: AuditSink;
  /** Events held before the queue starts shedding. */
  capacity?: number;
  /** Events per flush. */
  batchSize?: number;
  /** Consecutive failures after which the queue stops trying until the next enqueue. */
  maxAttempts?: number;
}

export const AUDIT_QUEUE_CAPACITY = 500;
export const AUDIT_BATCH_SIZE = 50;

export interface FlushResult {
  sent: number;
  remaining: number;
  failed: boolean;
}

/**
 * A durable-ish buffer in front of the audit sink.
 *
 * Not persisted here: persistence belongs to whatever storage the shell has (and, for a
 * real deployment, should be the server's problem after a synchronous first hop). What
 * this owns is the ordering and the shedding policy.
 */
export function createAuditQueue(options: AuditQueueOptions) {
  const capacity = Math.max(1, Math.floor(Number(options?.capacity) || AUDIT_QUEUE_CAPACITY));
  const batchSize = Math.max(1, Math.floor(Number(options?.batchSize) || AUDIT_BATCH_SIZE));
  const maxAttempts = Math.max(1, Math.floor(Number(options?.maxAttempts) || 3));

  const buffer: AuditEvent[] = [];
  let dropped = 0;
  let attempts = 0;

  /**
   * Sends one batch. Extracted as a local function rather than a method so `flushAll`
   * does not depend on `this` binding, and so the whole flush path is one place.
   */
  async function flushOnce(): Promise<FlushResult> {
    if (!buffer.length) {
      return { sent: 0, remaining: 0, failed: false };
    }
    if (attempts >= maxAttempts) {
      return { sent: 0, remaining: buffer.length, failed: true };
    }

    const batch = buffer.splice(0, batchSize);
    let accepted = false;
    try {
      accepted = (await options.sink(batch)) !== false;
    } catch (error) {
      // Binding named on purpose: the optional catch binding inside an async function
      // with an await in the try breaks @babel/plugin-transform-regenerator on this
      // toolchain ("Cannot read properties of null"). A sink that throws is a failure
      // like any other.
      accepted = false;
    }

    if (!accepted) {
      // Back at the FRONT, so ordering survives a failure.
      buffer.unshift(...batch);
      attempts += 1;
      return { sent: 0, remaining: buffer.length, failed: true };
    }

    attempts = 0;
    return { sent: batch.length, remaining: buffer.length, failed: false };
  }

  return {
    /** Events waiting to be sent. */
    size: () => buffer.length,
    /** How many events were shed because the queue was full. */
    droppedCount: () => dropped,

    /**
     * Adds an event. When the queue is full the **newest** event is dropped, not the
     * oldest: a reviewer reconstructing a timeline needs the beginning, and a gap at
     * the start is worse than a gap at the end.
     */
    enqueue(event: AuditEvent | null): boolean {
      if (!event) {
        return false;
      }
      if (buffer.length >= capacity) {
        dropped += 1;
        return false;
      }
      buffer.push(event);
      attempts = 0;
      return true;
    },

    /**
     * Sends one batch. A rejected or throwing sink puts the events **back at the front**
     * so ordering survives a failure; after `maxAttempts` consecutive failures the queue
     * stops trying until something new is enqueued, so a dead endpoint does not spin.
     */
    flush: flushOnce,

    /**
     * Sends everything, stopping at the first failure.
     *
     * Bounded rather than `while (true)`: every accepted batch removes at least one
     * event, so the buffer length is a hard ceiling on iterations, and a bug in the
     * flush path cannot turn into a spin.
     */
    async flushAll(): Promise<FlushResult> {
      let sent = 0;
      let last: FlushResult = { sent: 0, remaining: buffer.length, failed: false };
      const maxIterations = Math.max(1, buffer.length);
      // The loop condition carries the exit rather than a `break` -- same regenerator
      // limitation as the catch binding above.
      let done = false;
      for (let i = 0; i < maxIterations && !done; i++) {
        last = await flushOnce();
        sent += last.sent;
        done = last.failed || !last.remaining;
      }
      return { sent, remaining: last.remaining, failed: last.failed };
    },
  };
}

/** One-line rendering for a log viewer. */
export function describeEvent(event: AuditEvent): string {
  if (!event) {
    return '';
  }
  const parts = [event.isoTime, event.userId, event.type];
  if (event.studyInstanceUid) {
    parts.push(`study ${event.studyInstanceUid}`);
  }
  const detail = Object.entries(event.detail ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  if (detail) {
    parts.push(detail);
  }
  return parts.join(' · ');
}
