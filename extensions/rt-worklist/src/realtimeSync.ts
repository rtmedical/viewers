/**
 * Real-time worklist updates: transport fallback, reconnection and catch-up — pure core
 * (RTV-189).
 *
 * The sockets themselves are adapters. What is here is the part that decides *when the list
 * on screen can be trusted*, which is the actual product requirement: the feature exists so
 * that nobody presses F5, and a list nobody refreshes is only safe if it is either current
 * or visibly not.
 *
 * ## Reconnecting is not resuming
 *
 * The failure this module exists to prevent. A push channel that drops for ninety seconds
 * and comes back does not receive the studies that arrived during those ninety seconds —
 * they were broadcast to nobody. Resuming the socket and carrying on leaves the worklist
 * **permanently missing** those exams, with no gap visible anywhere: the list looks normal,
 * it is just short. In an emergency department that is the whole risk in one sentence.
 *
 * So every reconnection sets {@link SyncState.resyncRequired} and a window to re-query, and
 * the state does not go back to `live` until the catch-up has been applied.
 *
 * ## Degraded has to be visible, or it is worse than nothing
 *
 * Polling every thirty seconds is a legitimate fallback and it means the list can be half a
 * minute stale. That is fine when the user knows, and dangerous when they have been told
 * the list updates itself. `degraded` is a first-class state for that reason, not a quiet
 * internal detail.
 *
 * ## The same study will arrive twice
 *
 * Catch-up and push overlap by construction — the grace window makes sure of it, because
 * missing a study is worse than seeing it twice. Deduplication is therefore not an
 * optimisation: a duplicated row in an urgent worklist reads as a second patient.
 *
 * ## Nothing scrolls under the reader
 *
 * A row appearing above the one someone is about to click moves their target. The badge
 * says how many arrived; the reader decides when to look.
 *
 * Framework-free, no `@ohif/*`, no timers — the clock is passed in, so the whole state
 * machine is testable without waiting.
 */

export type Transport = 'websocket' | 'sse' | 'polling';

export const TRANSPORT_ORDER: Transport[] = ['websocket', 'sse', 'polling'];

export const TRANSPORT_LABELS: Record<Transport, string> = {
  websocket: 'WebSocket',
  sse: 'SSE',
  polling: 'polling',
};

export type ConnectionState = 'connecting' | 'live' | 'degraded' | 'offline';

export interface SyncConfig {
  /** Backoff steps, milliseconds. The last one repeats. */
  backoffMs: number[];
  /** Attempts on one transport before falling back to the next. */
  attemptsPerTransport: number;
  /** Polling period once the channel has degraded that far. */
  pollIntervalMs: number;
  /**
   * How far before the disconnect the catch-up query reaches back.
   *
   * Deliberately generous: overlapping is cheap and deduplicated, and missing a study is
   * not.
   */
  resyncGraceMs: number;
  /** No event for this long on a live channel means the channel is probably dead. */
  silenceTimeoutMs: number;
}

export const DEFAULT_SYNC: SyncConfig = {
  backoffMs: [1000, 2000, 4000, 8000, 16000, 30000],
  attemptsPerTransport: 3,
  pollIntervalMs: 30000,
  resyncGraceMs: 60000,
  silenceTimeoutMs: 120000,
};

export interface SyncState {
  transport: Transport;
  state: ConnectionState;
  /** Failed attempts on the current transport. */
  attempt: number;
  /** Last time anything was received, epoch ms. */
  lastEventAt: number | null;
  /** When the current outage started. */
  disconnectedAt: number | null;
  /** True until a catch-up query has been applied. */
  resyncRequired: boolean;
  /** Lower bound for the catch-up query. */
  resyncSince: number | null;
  /** Study UIDs already shown, for deduplication. */
  seen: string[];
}

export function initialSyncState(at: number): SyncState {
  return {
    transport: 'websocket',
    state: 'connecting',
    attempt: 0,
    lastEventAt: null,
    disconnectedAt: Number(at),
    resyncRequired: true,
    resyncSince: Number(at),
    seen: [],
  };
}

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Delay before the next attempt.
 *
 * Jitter is injected rather than generated here: a deterministic backoff is testable, and
 * the spread that stops every client reconnecting on the same tick belongs to the adapter
 * that owns the timer.
 */
export function nextBackoffMs(
  attempt: number,
  config: SyncConfig = DEFAULT_SYNC,
  jitter: (base: number) => number = base => base
): number {
  const steps = config.backoffMs.length ? config.backoffMs : DEFAULT_SYNC.backoffMs;
  const index = Math.min(steps.length - 1, Math.max(0, Math.floor(num(attempt) || 0)));
  return Math.max(0, jitter(steps[index]));
}

/** Falls back to the next transport after enough failures on the current one. */
export function nextTransport(current: Transport, attempt: number, config: SyncConfig = DEFAULT_SYNC): Transport {
  if (attempt < Math.max(1, config.attemptsPerTransport)) {
    return current;
  }
  const index = TRANSPORT_ORDER.indexOf(current);
  return TRANSPORT_ORDER[Math.min(TRANSPORT_ORDER.length - 1, index + 1)];
}

/**
 * The channel dropped.
 *
 * Records when, because that timestamp is what the catch-up query will reach back to. An
 * outage with no recorded start cannot be caught up from, only guessed at.
 */
export function onDisconnect(state: SyncState, at: number, config: SyncConfig = DEFAULT_SYNC): SyncState {
  const attempt = state.attempt + 1;
  return {
    ...state,
    state: 'offline',
    attempt,
    transport: nextTransport(state.transport, attempt, config),
    disconnectedAt: state.disconnectedAt === null ? Number(at) : state.disconnectedAt,
    resyncRequired: true,
    resyncSince:
      state.resyncSince === null
        ? Number(at) - Math.max(0, config.resyncGraceMs)
        : state.resyncSince,
  };
}

export interface ConnectResult {
  state: SyncState;
  /** The catch-up query the caller must run before trusting the list. */
  resync: { since: number } | null;
  message: string;
}

/**
 * The channel came back.
 *
 * Does **not** return to `live`. The studies broadcast during the outage went to nobody,
 * and resuming without a catch-up leaves the list permanently short with nothing on screen
 * indicating it.
 */
export function onConnect(state: SyncState, at: number, config: SyncConfig = DEFAULT_SYNC): ConnectResult {
  const since =
    state.resyncSince !== null
      ? state.resyncSince
      : Number(at) - Math.max(0, config.resyncGraceMs);

  return {
    state: {
      ...state,
      state: state.transport === 'polling' ? 'degraded' : 'connecting',
      attempt: 0,
      disconnectedAt: null,
      resyncRequired: true,
      resyncSince: since,
    },
    resync: { since },
    message:
      'Canal restabelecido. Os estudos que chegaram durante a queda foram transmitidos para ninguém — ' +
      'sem a consulta de recuperação a lista fica permanentemente curta, e nada na tela indica isso.',
  };
}

export interface StudyEvent {
  studyInstanceUid: string;
  patientName?: string;
  modality?: string;
  priority?: 'routine' | 'urgent' | 'emergency';
  arrivedAt: number;
}

export interface ApplyResult {
  state: SyncState;
  /** Events that were not already known. */
  fresh: StudyEvent[];
  duplicates: number;
}

/**
 * Applies a batch of events, dropping the ones already shown.
 *
 * Catch-up and push overlap on purpose. A duplicated row in an urgent worklist reads as a
 * second patient, so deduplication is a correctness requirement rather than a tidiness one.
 */
export function applyEvents(
  state: SyncState,
  events: StudyEvent[],
  at: number,
  options: { fromResync?: boolean; maxSeen?: number } = {}
): ApplyResult {
  const seen = new Set(state.seen);
  const fresh: StudyEvent[] = [];
  let duplicates = 0;

  for (const event of events ?? []) {
    const uid = String(event?.studyInstanceUid ?? '').trim();
    if (!uid) {
      continue;
    }
    if (seen.has(uid)) {
      duplicates++;
      continue;
    }
    seen.add(uid);
    fresh.push(event);
  }

  // Bounded, oldest first out: an all-day worklist session would otherwise grow the set
  // without limit, and the studies at risk of a duplicate are always the recent ones.
  const maxSeen = Math.max(100, Math.floor(num(options.maxSeen) || 5000));
  const seenList = [...seen];
  const trimmed = seenList.length > maxSeen ? seenList.slice(seenList.length - maxSeen) : seenList;

  const resolved = options.fromResync === true;
  return {
    state: {
      ...state,
      lastEventAt: Number(at),
      seen: trimmed,
      resyncRequired: resolved ? false : state.resyncRequired,
      state: resolved
        ? state.transport === 'polling'
          ? 'degraded'
          : 'live'
        : state.state,
    },
    fresh,
    duplicates,
  };
}

export interface Trustworthiness {
  trustworthy: boolean;
  /** Worst-case staleness the user should assume, milliseconds. */
  stalenessMs: number;
  message: string;
}

/**
 * Whether the list on screen can be relied on.
 *
 * The question the feature is actually answering. A user who has been told the list updates
 * itself and is looking at a degraded or un-caught-up channel is worse off than one who
 * knows they have to refresh.
 */
export function trustworthiness(
  state: SyncState,
  now: number,
  config: SyncConfig = DEFAULT_SYNC
): Trustworthiness {
  if (state.resyncRequired) {
    return {
      trustworthy: false,
      stalenessMs: state.disconnectedAt !== null ? Number(now) - state.disconnectedAt : Infinity,
      message: 'Lista possivelmente incompleta: a recuperação após a queda ainda não foi aplicada.',
    };
  }
  if (state.state === 'offline') {
    return {
      trustworthy: false,
      stalenessMs: state.disconnectedAt !== null ? Number(now) - state.disconnectedAt : Infinity,
      message: 'Sem conexão com o canal de atualização — a lista não está se atualizando sozinha.',
    };
  }
  if (state.state === 'degraded') {
    return {
      trustworthy: true,
      stalenessMs: config.pollIntervalMs,
      message: `Atualizando por ${TRANSPORT_LABELS.polling} a cada ${Math.round(config.pollIntervalMs / 1000)}s — a lista pode estar até esse tempo atrasada.`,
    };
  }
  const silent = state.lastEventAt !== null ? Number(now) - state.lastEventAt : 0;
  if (silent > config.silenceTimeoutMs) {
    return {
      trustworthy: false,
      stalenessMs: silent,
      message:
        `Nada recebido há ${Math.round(silent / 60000)} min. Um canal silencioso e um canal morto são indistinguíveis daqui — ` +
        'trate como suspeito e force uma recuperação.',
    };
  }
  return { trustworthy: true, stalenessMs: 0, message: '' };
}

export interface ArrivalNotice {
  /** Count for the badge. */
  count: number;
  /** Studies whose priority warrants a persistent notice. */
  urgent: StudyEvent[];
  /** Always false. */
  autoScroll: false;
  message: string;
}

/**
 * What to show when studies arrive.
 *
 * `autoScroll` is false in the type. A row appearing above the one someone is about to click
 * moves their target, and the click lands on a different patient — which is a worse outcome
 * than seeing the new study a few seconds later.
 */
export function arrivalNotice(fresh: StudyEvent[]): ArrivalNotice {
  const list = (fresh ?? []).filter(Boolean);
  const urgent = list.filter(e => e.priority === 'urgent' || e.priority === 'emergency');
  const first = urgent[0] ?? list[0];

  return {
    count: list.length,
    urgent,
    autoScroll: false,
    message: list.length
      ? urgent.length
        ? `${list.length} novo(s) estudo(s), ${urgent.length} urgente(s): ${first.patientName ?? ''} — ${first.modality ?? ''}`.trim()
        : `${list.length} novo(s) estudo(s).`
      : '',
  };
}

/** One line for the connection indicator. */
export function describeConnection(state: SyncState, now: number, config: SyncConfig = DEFAULT_SYNC): string {
  const trust = trustworthiness(state, now, config);
  const label = TRANSPORT_LABELS[state.transport];
  if (trust.trustworthy && !trust.message) {
    return `Ao vivo por ${label}.`;
  }
  return `${label} · ${trust.message}`;
}
