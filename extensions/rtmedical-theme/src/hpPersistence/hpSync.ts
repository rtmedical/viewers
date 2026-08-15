/**
 * Hanging-protocol sync engine and auto-apply gate — pure core (RTV-149).
 *
 * RTV-24 built the pieces: a local store with per-record version and timestamps, a
 * two-record {@link resolveConflict}, and the `IHangingProtocolSyncClient` seam. This is
 * the orchestration on top — what a full sync actually does, and when a protocol is
 * allowed to change the reader's layout.
 *
 * ## The 2-second criterion is "never wait for the network", not "make it fast"
 *
 * A study opens and the layout has to be there. If applying a protocol means waiting on
 * the Connect API, then every network hiccup is a blank viewport, and a timeout is a
 * blank viewport for however long the timeout is. So the read path is **cache-only**:
 * {@link resolveProtocolForStudy} never awaits anything, and sync runs beside it.
 * The cache is the source of truth for display; the server is how the cache gets better
 * over time.
 *
 * ## A protocol that arrives late must not re-apply
 *
 * This is the decision that shapes the module. If a sync completes thirty seconds into a
 * read and brings down a newer protocol for the study on screen, re-applying it would
 * throw away every window/level, scroll and layout change the reader has made — mid-read,
 * with no warning, and for a study they are actively interpreting. **A stale layout is
 * much less harmful than a layout that moves under them.** So {@link shouldAutoApply}
 * refuses once a session has applied a protocol, and newly synced protocols take effect
 * on the *next* study.
 *
 * ## A failed push must not advance the sync point
 *
 * `lastSyncedAt` is what {@link resolveConflict} measures "changed since" against. Advance
 * it after a push that did not actually land and the local edit now looks *older* than the
 * sync point — so the next sync classifies it as unchanged, remote wins, and the reader's
 * protocol is silently overwritten by the version they edited away from. {@link syncOnce}
 * therefore advances the sync point only when the whole exchange succeeded, and reports
 * what did not.
 *
 * ## Conflicts are surfaced, never auto-merged
 *
 * When both sides changed since the last sync, `resolveConflict` names a probable winner
 * but the engine does **not** write it. A hanging protocol is somebody's deliberate
 * arrangement of a reading; picking for them and saying nothing means the loser finds out
 * by noticing their layout is different. Conflicts come back in
 * {@link SyncReport.conflicts} for the UI to ask about.
 *
 * Framework-free; clock and client are injected. Zero-fork per RTV-114.
 */

import {
  HangingProtocolStore,
  IHangingProtocolSyncClient,
  resolveConflict,
  StoredProtocolRecord,
} from './hpPersistence';

export interface SyncConflict {
  id: string;
  local: StoredProtocolRecord;
  remote: StoredProtocolRecord;
  /** What `resolveConflict` would pick. Offered as a suggestion, never applied. */
  suggested: StoredProtocolRecord;
}

export interface SyncReport {
  /** Records taken from the server into the local cache. */
  pulled: string[];
  /** Local records sent to the server. */
  pushed: string[];
  /** Both sides changed; waiting on the user. Nothing was written for these. */
  conflicts: SyncConflict[];
  /** New sync point, or the previous one when the exchange did not fully succeed. */
  lastSyncedAt: number;
  /** True when pull or push failed; the sync point did not advance. */
  failed: boolean;
  error?: string;
}

export interface SyncOptions {
  store: HangingProtocolStore;
  client: IHangingProtocolSyncClient;
  /** Epoch ms of the last successful sync. */
  lastSyncedAt: number;
  /** Epoch ms now. Injected — nothing here reads the clock. */
  now: number;
}

const errorText = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  const text = String(error ?? '').trim();
  return text || 'Falha de sincronização';
};

const byId = (records: StoredProtocolRecord[]): Map<string, StoredProtocolRecord> => {
  const map = new Map<string, StoredProtocolRecord>();
  for (const record of records ?? []) {
    if (record?.id) {
      map.set(record.id, record);
    }
  }
  return map;
};

/**
 * One full exchange: pull, resolve, write the unambiguous winners, push local changes.
 *
 * The order matters. Pull first so a local push cannot clobber a remote change the client
 * has not seen; resolve before writing anything so a conflict is detected before either
 * side is touched; push last so what goes up is the merged state.
 */
export async function syncOnce(options: SyncOptions): Promise<SyncReport> {
  // No `??` anywhere in this function body: @babel/plugin-transform-regenerator on this
  // toolchain throws "Expected values to be strictly equal: '??' !== '||'" when it
  // explodes an async function containing nullish coalescing, and it blames the import
  // line. Same family of trap as the optional catch binding below.
  const { store, client, lastSyncedAt, now } = options || ({} as SyncOptions);
  const report: SyncReport = {
    pulled: [],
    pushed: [],
    conflicts: [],
    lastSyncedAt,
    failed: false,
  };

  let remoteRecords: StoredProtocolRecord[] = [];
  let failure: string | null = null;
  try {
    const pulled = await client.pull();
    remoteRecords = Array.isArray(pulled) ? pulled : [];
  } catch (error) {
    // Named binding: optional catch binding inside an async function breaks the
    // regenerator transform on this toolchain.
    failure = errorText(error);
  }

  if (failure !== null) {
    return { ...report, failed: true, error: failure };
  }

  // listAll, not list: `list()` hides tombstones, and a locally deleted protocol that
  // never reaches the server comes straight back on the next pull. RTV-24 wrote the
  // tombstone precisely so the removal could propagate; this is the code that propagates
  // it.
  const local = byId(store.listAll());
  const remote = byId(remoteRecords);
  const toPush: StoredProtocolRecord[] = [];

  for (const [id, remoteRecord] of remote) {
    const localRecord = local.get(id);
    if (!localRecord) {
      // Server has something we have never seen. Nothing local to lose.
      store.saveRecord(remoteRecord);
      report.pulled.push(id);
    } else {
      const outcome = resolveConflict(localRecord, remoteRecord, lastSyncedAt);
      if (outcome.resolution === 'remote') {
        store.saveRecord(remoteRecord);
        report.pulled.push(id);
      } else if (outcome.resolution === 'conflict') {
        // Surfaced, not written — see the module note.
        report.conflicts.push({
          id,
          local: localRecord,
          remote: remoteRecord,
          suggested: outcome.winner,
        });
      } else if (localRecord.updatedAt > lastSyncedAt) {
        toPush.push(localRecord);
      }
    }
  }

  for (const [id, localRecord] of local) {
    if (!remote.has(id) && localRecord.updatedAt > lastSyncedAt) {
      toPush.push(localRecord);
    }
  }

  if (toPush.length) {
    try {
      await client.push(toPush);
      report.pushed = toPush.map(r => r.id);
    } catch (error) {
      failure = errorText(error);
    }
  }

  if (failure !== null) {
    // The pulled records are already in the cache and that is fine — they are the
    // server's own state. What must not happen is advancing the sync point, which would
    // make the unpushed local edits look older than the last sync and let the next round
    // overwrite them silently.
    return { ...report, failed: true, error: failure };
  }

  return { ...report, lastSyncedAt: now, failed: false };
}

/**
 * Resolution of a conflict by the user.
 *
 * Writing the chosen record with a fresh `updatedAt` is deliberate: the choice is itself
 * an edit, and stamping it now means the *next* sync pushes it rather than seeing two
 * old timestamps and re-raising the same conflict forever.
 */
export function resolveConflictAs(
  store: HangingProtocolStore,
  conflict: SyncConflict,
  choice: 'local' | 'remote',
  now: number,
  user: string
): StoredProtocolRecord {
  const chosen = choice === 'remote' ? conflict.remote : conflict.local;
  const record: StoredProtocolRecord = {
    ...chosen,
    updatedAt: now,
    updatedBy: user || chosen.updatedBy,
    version: Math.max(conflict.local.version ?? 0, conflict.remote.version ?? 0) + 1,
  };
  store.saveRecord(record);
  return record;
}

export interface AutoApplyState {
  /** Study currently on screen. */
  studyInstanceUid?: string;
  /** True once a protocol has been applied for this study session. */
  applied: boolean;
  /** True once the reader changed the layout by hand. */
  readerAdjusted: boolean;
}

export const emptyAutoApplyState = (): AutoApplyState => ({
  applied: false,
  readerAdjusted: false,
});

export type AutoApplyRefusal =
  | 'alreadyApplied'
  | 'readerAdjusted'
  | 'noProtocol'
  | 'differentStudy';

export interface AutoApplyDecision {
  apply: boolean;
  reason?: AutoApplyRefusal;
}

/**
 * Whether a protocol may be applied right now.
 *
 * Refuses once the session has one, and refuses harder once the reader has touched the
 * layout — the two are separate refusals so a caller can log which one fired. Opening a
 * different study resets the session, which is the *only* moment a freshly synced
 * protocol gets to take effect.
 */
export function shouldAutoApply(
  state: AutoApplyState,
  studyInstanceUid: string,
  protocolId?: string
): AutoApplyDecision {
  if (!protocolId) {
    return { apply: false, reason: 'noProtocol' };
  }
  if (state?.studyInstanceUid && state.studyInstanceUid !== studyInstanceUid) {
    return { apply: false, reason: 'differentStudy' };
  }
  if (state?.readerAdjusted) {
    return { apply: false, reason: 'readerAdjusted' };
  }
  if (state?.applied) {
    return { apply: false, reason: 'alreadyApplied' };
  }
  return { apply: true };
}

/** A new study is open: the session resets and the newest cached protocols apply. */
export function beginStudySession(studyInstanceUid: string): AutoApplyState {
  return { studyInstanceUid, applied: false, readerAdjusted: false };
}

export function markApplied(state: AutoApplyState): AutoApplyState {
  return { ...state, applied: true };
}

/** Called on the first manual layout change; freezes auto-apply for this study. */
export function markReaderAdjusted(state: AutoApplyState): AutoApplyState {
  return { ...state, readerAdjusted: true };
}

export interface ResolveOptions {
  /** Ranked candidates from the matcher, best first. */
  candidates: Array<{ id: string; score: number }>;
  /** Used when nothing scores above the threshold. */
  fallbackId: string;
  threshold?: number;
}

export interface ResolvedProtocol {
  protocolId: string;
  score: number;
  /** True when nothing matched and the fallback was used. */
  isFallback: boolean;
}

export const AUTO_APPLY_BUDGET_MS = 2000;

/**
 * Picks the protocol for a study, from cached candidates only.
 *
 * Synchronous by construction: there is no client here and nothing to await. The 2-second
 * budget is met by never being able to block, not by racing a timer — a timer would still
 * leave the viewport empty for two seconds on a bad network.
 */
export function resolveProtocolForStudy(options: ResolveOptions): ResolvedProtocol {
  const threshold = Number.isFinite(Number(options?.threshold))
    ? Number(options.threshold)
    : 0.5;
  const ranked = [...(options?.candidates ?? [])]
    .filter(c => c && c.id)
    .sort((a, b) => Number(b.score) - Number(a.score));
  const best = ranked[0];

  if (best && Number(best.score) >= threshold) {
    return { protocolId: best.id, score: Number(best.score), isFallback: false };
  }
  return {
    protocolId: options?.fallbackId ?? '',
    score: best ? Number(best.score) : 0,
    isFallback: true,
  };
}

/** One line for the status area: what synced, what is waiting on the user. */
export function describeSync(report: SyncReport): string {
  if (!report) {
    return '';
  }
  if (report.failed) {
    return `Sincronização falhou: ${report.error ?? 'erro desconhecido'}. Alterações locais preservadas.`;
  }
  const parts: string[] = [];
  if (report.pulled.length) {
    parts.push(`${report.pulled.length} recebido(s)`);
  }
  if (report.pushed.length) {
    parts.push(`${report.pushed.length} enviado(s)`);
  }
  if (report.conflicts.length) {
    parts.push(`${report.conflicts.length} conflito(s) aguardando decisão`);
  }
  return parts.length ? `Protocolos: ${parts.join(', ')}.` : 'Protocolos já sincronizados.';
}
