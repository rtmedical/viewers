/**
 * Hanging-protocol persistence (RTV-24) — local store + conflict resolution,
 * behind a mockable remote-sync seam.
 *
 * Delivered here (framework-free, tested):
 *   - HangingProtocolStore: offline CRUD over a Storage-like backend
 *     (localStorage in the browser / SQLite-backed shim in RTVW desktop), with
 *     per-record version + updatedAt/updatedBy and a change audit log.
 *   - resolveConflict: timestamp+user resolution between a local and a remote
 *     record relative to the last sync point.
 *   - IHangingProtocolSyncClient + MockHangingProtocolSyncClient: the seam for
 *     the RT Connect (Laravel) REST endpoint. The real client is a follow-up
 *     (backend not local). Zero-fork (RTV-114).
 *
 * The clock and storage are injectable so the logic is deterministic in tests.
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** In-memory StorageLike for tests / non-browser (RTVW pre-SQLite) fallback. */
export class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

export interface StoredProtocolRecord {
  id: string;
  protocol: unknown;
  updatedAt: number;
  updatedBy: string;
  version: number;
  deleted?: boolean;
}

export interface AuditEntry {
  id: string;
  action: 'save' | 'remove';
  user: string;
  at: number;
  version: number;
}

const STORE_KEY = 'rt-hanging-protocols';
const AUDIT_KEY = 'rt-hanging-protocols-audit';

export class HangingProtocolStore {
  private storage: StorageLike;
  private now: () => number;

  constructor(opts: { storage?: StorageLike; now?: () => number } = {}) {
    const browserStorage =
      typeof globalThis !== 'undefined' && (globalThis as any).localStorage
        ? ((globalThis as any).localStorage as StorageLike)
        : undefined;
    this.storage = opts.storage ?? browserStorage ?? new MemoryStorage();
    this.now = opts.now ?? (() => Date.now());
  }

  private readAll(): Record<string, StoredProtocolRecord> {
    try {
      return JSON.parse(this.storage.getItem(STORE_KEY) || '{}');
    } catch {
      return {};
    }
  }

  private writeAll(records: Record<string, StoredProtocolRecord>): void {
    this.storage.setItem(STORE_KEY, JSON.stringify(records));
  }

  private appendAudit(entry: AuditEntry): void {
    let log: AuditEntry[];
    try {
      log = JSON.parse(this.storage.getItem(AUDIT_KEY) || '[]');
    } catch {
      log = [];
    }
    log.push(entry);
    this.storage.setItem(AUDIT_KEY, JSON.stringify(log));
  }

  /** Active (non-deleted) records. */
  list(): StoredProtocolRecord[] {
    return Object.values(this.readAll()).filter(r => !r.deleted);
  }

  get(id: string): StoredProtocolRecord | undefined {
    const record = this.readAll()[id];
    return record && !record.deleted ? record : undefined;
  }

  /** Upsert a protocol; bumps version and records an audit entry. Works offline. */
  save(id: string, protocol: unknown, user: string): StoredProtocolRecord {
    const records = this.readAll();
    const previous = records[id];
    const record: StoredProtocolRecord = {
      id,
      protocol,
      updatedAt: this.now(),
      updatedBy: user,
      version: (previous?.version ?? 0) + 1,
    };
    records[id] = record;
    this.writeAll(records);
    this.appendAudit({ id, action: 'save', user, at: record.updatedAt, version: record.version });
    return record;
  }

  /** Soft-delete (tombstone) so a remote sync can propagate the removal. */
  remove(id: string, user: string): void {
    const records = this.readAll();
    const previous = records[id];
    if (!previous || previous.deleted) {
      return;
    }
    const version = previous.version + 1;
    const at = this.now();
    records[id] = { ...previous, deleted: true, updatedAt: at, updatedBy: user, version };
    this.writeAll(records);
    this.appendAudit({ id, action: 'remove', user, at, version });
  }

  getAuditLog(): AuditEntry[] {
    try {
      return JSON.parse(this.storage.getItem(AUDIT_KEY) || '[]');
    } catch {
      return [];
    }
  }
}

export type ConflictResolution = 'local' | 'remote' | 'conflict';

export interface ConflictResult {
  resolution: ConflictResolution;
  /** The record that should win (latest by updatedAt on a true conflict). */
  winner: StoredProtocolRecord;
}

/**
 * Resolves a local vs remote record relative to the last successful sync time.
 * - only one side changed since lastSyncedAt → that side wins
 * - both changed → conflict; the later updatedAt is surfaced as the winner for
 *   the user to confirm
 */
export function resolveConflict(
  local: StoredProtocolRecord,
  remote: StoredProtocolRecord,
  lastSyncedAt: number
): ConflictResult {
  const localChanged = local.updatedAt > lastSyncedAt;
  const remoteChanged = remote.updatedAt > lastSyncedAt;

  if (localChanged && !remoteChanged) {
    return { resolution: 'local', winner: local };
  }
  if (remoteChanged && !localChanged) {
    return { resolution: 'remote', winner: remote };
  }
  if (!localChanged && !remoteChanged) {
    // Neither changed since sync — keep the higher version deterministically.
    return { resolution: 'local', winner: local.version >= remote.version ? local : remote };
  }
  return { resolution: 'conflict', winner: local.updatedAt >= remote.updatedAt ? local : remote };
}

/** Remote sync seam — implemented against RT Connect (Laravel) in a follow-up. */
export interface IHangingProtocolSyncClient {
  pull(): Promise<StoredProtocolRecord[]>;
  push(records: StoredProtocolRecord[]): Promise<void>;
}

/** In-memory mock so the viewer-side flow is testable without the backend. */
export class MockHangingProtocolSyncClient implements IHangingProtocolSyncClient {
  constructor(private remote: StoredProtocolRecord[] = []) {}
  async pull(): Promise<StoredProtocolRecord[]> {
    return [...this.remote];
  }
  async push(records: StoredProtocolRecord[]): Promise<void> {
    for (const record of records) {
      const idx = this.remote.findIndex(r => r.id === record.id);
      if (idx === -1) {
        this.remote.push(record);
      } else {
        this.remote[idx] = record;
      }
    }
  }
}
