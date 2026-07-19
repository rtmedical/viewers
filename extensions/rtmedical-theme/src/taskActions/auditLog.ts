/**
 * RTV-154 — lightweight audit logger for task actions.
 *
 * Keeps a bounded in-memory ring buffer and forwards every entry to an optional
 * external sink (e.g. a POST to the Connect API). A failing sink can never break
 * the user action — transport errors are swallowed. The clock is injectable so
 * tests are deterministic.
 */
import type { AuditEntry, AuditLogger, AuditSink } from './types';

export interface CreateAuditLoggerOptions {
  /** External transport; receives every entry. Must not throw (errors swallowed). */
  sink?: AuditSink;
  /** Injectable clock — defaults to Date.now. */
  now?: () => number;
  /** Max buffered entries (oldest dropped past this). */
  capacity?: number;
}

const DEFAULT_CAPACITY = 500;

export function createAuditLogger(options: CreateAuditLoggerOptions = {}): AuditLogger {
  const { sink, now = () => Date.now(), capacity = DEFAULT_CAPACITY } = options;
  const entries: AuditEntry[] = [];

  function log(entry: Omit<AuditEntry, 'timestamp'> & { timestamp?: number }): AuditEntry {
    const full: AuditEntry = {
      action: entry.action,
      actor: entry.actor,
      status: entry.status,
      detail: entry.detail,
      timestamp: entry.timestamp ?? now(),
    };

    entries.push(full);
    if (entries.length > capacity) {
      entries.splice(0, entries.length - capacity);
    }

    if (sink) {
      try {
        sink(full);
      } catch (error) {
        // Audit transport must never break the user's action; drop the error.
        void error;
      }
    }

    return full;
  }

  return {
    log,
    getEntries: () => entries.slice(),
    clear: () => {
      entries.length = 0;
    },
  };
}

/** A no-op logger (used as the default when no audit logger is supplied). */
export const NOOP_AUDIT_LOGGER: Pick<AuditLogger, 'log'> = {
  // `timestamp` last so an explicit `undefined` from a caller cannot leak through.
  log: (entry) => ({ ...entry, timestamp: entry.timestamp ?? 0 }),
};
