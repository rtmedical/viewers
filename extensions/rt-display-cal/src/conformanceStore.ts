/**
 * Visual-conformance audit trail (RTV-211) — pure store over an injectable
 * StorageLike (localStorage in the browser, in-memory in tests), following the
 * hpPersistence pattern (extensions/rtmedical-theme). The timestamp is injected
 * by the caller as an ISO-8601 string so every method is deterministic.
 *
 * SCOPE NOTE (see gsdf.ts): these records document a VISUAL QA session against
 * GSDF/TG18 targets — they are not photometer measurements and do not certify
 * PS3.14 luminance conformance.
 */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** In-memory StorageLike for tests / non-browser fallback. */
export class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

export const CONFORMANCE_STORE_KEY = 'rt-display-cal-records';

export interface ConformanceCheckInput {
  /** Workstation identity (hostname / screen), best-effort from the caller. */
  station: string;
  /** Operator identity, best-effort from userAuthenticationService. */
  user: string;
  /** Checklist question id → yes(true)/no(false). */
  answers: Record<string, boolean>;
  /** Overall verdict (typically: every answer true). */
  passed: boolean;
  notes?: string;
  /** ISO-8601 timestamp, injected by the caller (keeps the store pure). */
  now: string;
}

export interface ConformanceRecord {
  /** 1-based sequence number within this station's store. */
  id: number;
  station: string;
  user: string;
  answers: Record<string, boolean>;
  passed: boolean;
  notes: string;
  /** ISO-8601 timestamp of the check. */
  recordedAt: string;
}

export class ConformanceStore {
  private storage: StorageLike;

  constructor(opts: { storage?: StorageLike } = {}) {
    const browserStorage =
      typeof globalThis !== 'undefined' && (globalThis as any).localStorage
        ? ((globalThis as any).localStorage as StorageLike)
        : undefined;
    this.storage = opts.storage ?? browserStorage ?? new MemoryStorage();
  }

  /**
   * All records, oldest first. Corrupted storage (bad JSON, non-array, or
   * malformed elements) degrades to skipping the bad entries — a tampered
   * localStorage must never take down the page or the CSV export.
   */
  listRecords(): ConformanceRecord[] {
    try {
      const parsed = JSON.parse(this.storage.getItem(CONFORMANCE_STORE_KEY) || '[]');
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.filter(
        (r: unknown): r is ConformanceRecord =>
          !!r &&
          typeof r === 'object' &&
          typeof (r as ConformanceRecord).recordedAt === 'string' &&
          !!(r as ConformanceRecord).answers &&
          typeof (r as ConformanceRecord).answers === 'object'
      );
    } catch {
      return [];
    }
  }

  /**
   * Appends one check to the audit trail and returns the stored record.
   * Known limit: concurrent tabs race on the read-modify-write (localStorage
   * has no CAS) — the last writer wins; acceptable for per-station visual QA.
   */
  recordConformanceCheck(input: ConformanceCheckInput): ConformanceRecord {
    const records = this.listRecords();
    const record: ConformanceRecord = {
      id: records.length + 1,
      station: input.station,
      user: input.user,
      answers: { ...input.answers },
      passed: input.passed,
      notes: input.notes ?? '',
      recordedAt: input.now,
    };
    records.push(record);
    this.storage.setItem(CONFORMANCE_STORE_KEY, JSON.stringify(records));
    return record;
  }
}

/**
 * RFC-4180 escaping — notes are free text (commas/quotes/newlines). Fields
 * starting with a formula trigger (= + - @) are prefixed with a quote so a
 * crafted note cannot become an active formula when the CSV opens in Excel.
 */
function csvEscape(value: string): string {
  const deFormula = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(deFormula) ? `"${deFormula.replace(/"/g, '""')}"` : deFormula;
}

/**
 * Audit-trail CSV: one row per record; the answer columns are the union of all
 * checklist question ids (sorted) so exports stay stable if questions evolve.
 */
export function exportCsv(records: ConformanceRecord[]): string {
  const questionIds = Array.from(
    new Set(records.flatMap(record => Object.keys(record.answers)))
  ).sort();
  const header = ['recordedAt', 'station', 'user', 'passed', ...questionIds, 'notes'];
  const lines = [header.map(csvEscape).join(',')];
  for (const record of records) {
    const row = [
      record.recordedAt,
      record.station,
      record.user,
      record.passed ? 'PASS' : 'FAIL',
      ...questionIds.map(id =>
        record.answers[id] === undefined ? '' : record.answers[id] ? 'yes' : 'no'
      ),
      record.notes,
    ];
    lines.push(row.map(csvEscape).join(','));
  }
  return lines.join('\r\n');
}
