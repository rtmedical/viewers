import {
  HangingProtocolStore,
  IHangingProtocolSyncClient,
  MemoryStorage,
  StoredProtocolRecord,
} from './hpPersistence';
import {
  AUTO_APPLY_BUDGET_MS,
  beginStudySession,
  describeSync,
  emptyAutoApplyState,
  markApplied,
  markReaderAdjusted,
  resolveConflictAs,
  resolveProtocolForStudy,
  shouldAutoApply,
  syncOnce,
} from './hpSync';

const T0 = 1_700_000_000_000;
const SYNC_POINT = T0;

const record = (
  id: string,
  updatedAt: number,
  over: Partial<StoredProtocolRecord> = {}
): StoredProtocolRecord => ({
  id,
  protocol: { name: id },
  updatedAt,
  updatedBy: 'ana',
  version: 1,
  ...over,
});

/** A client whose pull/push can be made to fail. */
class FakeClient implements IHangingProtocolSyncClient {
  pushed: StoredProtocolRecord[][] = [];
  constructor(
    private remote: StoredProtocolRecord[] = [],
    private failOn: 'none' | 'pull' | 'push' = 'none'
  ) {}
  async pull(): Promise<StoredProtocolRecord[]> {
    if (this.failOn === 'pull') {
      throw new Error('ECONNREFUSED');
    }
    return [...this.remote];
  }
  async push(records: StoredProtocolRecord[]): Promise<void> {
    if (this.failOn === 'push') {
      throw new Error('503 Service Unavailable');
    }
    this.pushed.push(records);
  }
}

const newStore = (now = T0) =>
  new HangingProtocolStore({ storage: new MemoryStorage(), now: () => now });

describe('hpSync — pulling', () => {
  it('installs a protocol the client has never seen', async () => {
    const store = newStore();
    const report = await syncOnce({
      store,
      client: new FakeClient([record('mama-2v', T0 + 500)]),
      lastSyncedAt: SYNC_POINT,
      now: T0 + 1000,
    });

    expect(report.pulled).toEqual(['mama-2v']);
    expect(store.get('mama-2v')).toBeDefined();
    expect(report.lastSyncedAt).toBe(T0 + 1000);
  });

  // Re-stamping a pulled record would make every pull look like a local edit and push it
  // straight back, forever.
  it('installs the server record verbatim, keeping its version and author', async () => {
    const store = newStore();
    const remote = record('torax', T0 + 500, { version: 7, updatedBy: 'bruno' });
    await syncOnce({
      store,
      client: new FakeClient([remote]),
      lastSyncedAt: SYNC_POINT,
      now: T0 + 1000,
    });

    const stored = store.get('torax')!;
    expect(stored.version).toBe(7);
    expect(stored.updatedBy).toBe('bruno');
    expect(stored.updatedAt).toBe(T0 + 500);
  });

  it('takes the remote record when only the remote changed', async () => {
    const store = newStore(T0 - 5000);
    store.save('torax', { name: 'antigo' }, 'ana');
    const report = await syncOnce({
      store,
      client: new FakeClient([record('torax', T0 + 500, { protocol: { name: 'novo' } })]),
      lastSyncedAt: SYNC_POINT,
      now: T0 + 1000,
    });

    expect(report.pulled).toEqual(['torax']);
    expect(store.get('torax')!.protocol).toEqual({ name: 'novo' });
  });

  it('propagates a remote deletion as a tombstone', async () => {
    const store = newStore(T0 - 5000);
    store.save('obsoleto', {}, 'ana');
    await syncOnce({
      store,
      client: new FakeClient([record('obsoleto', T0 + 500, { deleted: true })]),
      lastSyncedAt: SYNC_POINT,
      now: T0 + 1000,
    });

    expect(store.get('obsoleto')).toBeUndefined();
    expect(store.listAll().find(r => r.id === 'obsoleto')!.deleted).toBe(true);
  });
});

describe('hpSync — pushing', () => {
  it('sends a locally edited protocol', async () => {
    const store = newStore(T0 + 500);
    store.save('torax', { name: 'meu' }, 'ana');
    const client = new FakeClient([record('torax', T0 - 1000)]);

    const report = await syncOnce({ store, client, lastSyncedAt: SYNC_POINT, now: T0 + 1000 });

    expect(report.pushed).toEqual(['torax']);
    expect(client.pushed[0][0].protocol).toEqual({ name: 'meu' });
  });

  it('sends a protocol the server does not have', async () => {
    const store = newStore(T0 + 500);
    store.save('novo-local', {}, 'ana');
    const report = await syncOnce({
      store,
      client: new FakeClient([]),
      lastSyncedAt: SYNC_POINT,
      now: T0 + 1000,
    });
    expect(report.pushed).toEqual(['novo-local']);
  });

  // list() hides tombstones; a locally deleted protocol that never reaches the server
  // comes straight back on the next pull.
  it('pushes a local DELETION, not just edits', async () => {
    const store = newStore(T0 + 500);
    store.save('obsoleto', {}, 'ana');
    store.remove('obsoleto', 'ana');
    const client = new FakeClient([]);

    const report = await syncOnce({ store, client, lastSyncedAt: SYNC_POINT, now: T0 + 1000 });

    expect(report.pushed).toEqual(['obsoleto']);
    expect(client.pushed[0][0].deleted).toBe(true);
  });

  it('sends nothing when nothing changed since the sync point', async () => {
    const store = newStore(T0 - 5000);
    store.save('torax', {}, 'ana');
    const client = new FakeClient([record('torax', T0 - 5000)]);

    const report = await syncOnce({ store, client, lastSyncedAt: SYNC_POINT, now: T0 + 1000 });

    expect(report.pushed).toEqual([]);
    expect(client.pushed).toEqual([]);
    expect(describeSync(report)).toBe('Protocolos já sincronizados.');
  });
});

describe('hpSync — conflicts are surfaced, never auto-merged', () => {
  const bothChanged = async () => {
    const store = newStore(T0 + 500);
    store.save('torax', { name: 'local' }, 'ana');
    const client = new FakeClient([
      record('torax', T0 + 800, { protocol: { name: 'remoto' }, updatedBy: 'bruno' }),
    ]);
    const report = await syncOnce({ store, client, lastSyncedAt: SYNC_POINT, now: T0 + 1000 });
    return { store, client, report };
  };

  it('reports the conflict with both sides and a suggestion', async () => {
    const { report } = await bothChanged();
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0].local.protocol).toEqual({ name: 'local' });
    expect(report.conflicts[0].remote.protocol).toEqual({ name: 'remoto' });
    expect(report.conflicts[0].suggested.protocol).toEqual({ name: 'remoto' });
  });

  // Picking for them and saying nothing means the loser finds out by noticing their
  // layout changed.
  it('writes NEITHER side and pushes nothing', async () => {
    const { store, client } = await bothChanged();
    expect(store.get('torax')!.protocol).toEqual({ name: 'local' });
    expect(client.pushed).toEqual([]);
  });

  it('mentions the pending decision in the status line', async () => {
    const { report } = await bothChanged();
    expect(describeSync(report)).toMatch(/1 conflito\(s\) aguardando decisão/);
  });

  it('applying the user choice stamps it as a fresh edit, so it syncs next round', async () => {
    const { store, report } = await bothChanged();
    const resolved = resolveConflictAs(store, report.conflicts[0], 'remote', T0 + 2000, 'ana');

    expect(resolved.protocol).toEqual({ name: 'remoto' });
    expect(resolved.updatedAt).toBe(T0 + 2000);
    // Above both sides, so neither can out-version it on the next exchange.
    expect(resolved.version).toBeGreaterThan(report.conflicts[0].local.version);
    expect(resolved.version).toBeGreaterThan(report.conflicts[0].remote.version);
    expect(store.get('torax')!.protocol).toEqual({ name: 'remoto' });
  });

  it('can keep the local side just as easily', async () => {
    const { store, report } = await bothChanged();
    resolveConflictAs(store, report.conflicts[0], 'local', T0 + 2000, 'ana');
    expect(store.get('torax')!.protocol).toEqual({ name: 'local' });
  });
});

describe('hpSync — failure must not lose local work', () => {
  it('a failed pull changes nothing and does not advance the sync point', async () => {
    const store = newStore(T0 + 500);
    store.save('torax', { name: 'meu' }, 'ana');

    const report = await syncOnce({
      store,
      client: new FakeClient([], 'pull'),
      lastSyncedAt: SYNC_POINT,
      now: T0 + 1000,
    });

    expect(report.failed).toBe(true);
    expect(report.error).toMatch(/ECONNREFUSED/);
    expect(report.lastSyncedAt).toBe(SYNC_POINT);
    expect(store.get('torax')!.protocol).toEqual({ name: 'meu' });
  });

  // The nasty one. Advancing the sync point after a push that never landed makes the
  // local edit look OLDER than the sync point, so the next round classifies it as
  // unchanged, remote wins, and the reader's protocol is silently overwritten.
  it('a failed push does NOT advance the sync point', async () => {
    const store = newStore(T0 + 500);
    store.save('torax', { name: 'meu' }, 'ana');

    const report = await syncOnce({
      store,
      client: new FakeClient([], 'push'),
      lastSyncedAt: SYNC_POINT,
      now: T0 + 1000,
    });

    expect(report.failed).toBe(true);
    expect(report.pushed).toEqual([]);
    expect(report.lastSyncedAt).toBe(SYNC_POINT);
  });

  it('and the retry still classifies the local edit as a local change', async () => {
    const store = newStore(T0 + 500);
    store.save('torax', { name: 'meu' }, 'ana');

    const failed = await syncOnce({
      store,
      client: new FakeClient([record('torax', T0 - 9000)], 'push'),
      lastSyncedAt: SYNC_POINT,
      now: T0 + 1000,
    });

    const retry = await syncOnce({
      store,
      client: new FakeClient([record('torax', T0 - 9000)]),
      lastSyncedAt: failed.lastSyncedAt,
      now: T0 + 5000,
    });

    expect(retry.pushed).toEqual(['torax']);
    expect(store.get('torax')!.protocol).toEqual({ name: 'meu' });
  });

  it('says local changes were preserved rather than just "erro"', async () => {
    const report = await syncOnce({
      store: newStore(),
      client: new FakeClient([], 'pull'),
      lastSyncedAt: SYNC_POINT,
      now: T0 + 1000,
    });
    expect(describeSync(report)).toMatch(/Alterações locais preservadas/);
  });
});

describe('hpSync — auto-apply gate', () => {
  it('applies on a fresh study session', () => {
    const state = beginStudySession('1.2.3');
    expect(shouldAutoApply(state, '1.2.3', 'torax')).toEqual({ apply: true });
  });

  it('refuses with no protocol to apply', () => {
    expect(shouldAutoApply(beginStudySession('1.2.3'), '1.2.3', undefined).reason).toBe(
      'noProtocol'
    );
  });

  // A stale layout is much less harmful than a layout that moves under the reader.
  it('refuses once this session already applied one', () => {
    const state = markApplied(beginStudySession('1.2.3'));
    expect(shouldAutoApply(state, '1.2.3', 'torax')).toEqual({
      apply: false,
      reason: 'alreadyApplied',
    });
  });

  it('refuses harder once the reader touched the layout', () => {
    const state = markReaderAdjusted(beginStudySession('1.2.3'));
    expect(shouldAutoApply(state, '1.2.3', 'torax').reason).toBe('readerAdjusted');
  });

  it('reports readerAdjusted in preference to alreadyApplied, so the log is honest', () => {
    const state = markReaderAdjusted(markApplied(beginStudySession('1.2.3')));
    expect(shouldAutoApply(state, '1.2.3', 'torax').reason).toBe('readerAdjusted');
  });

  it('refuses to apply a protocol resolved for a different study', () => {
    const state = beginStudySession('1.2.3');
    expect(shouldAutoApply(state, '9.9.9', 'torax').reason).toBe('differentStudy');
  });

  // The only moment a freshly synced protocol gets to take effect.
  it('a new study session lets the newly synced protocol apply', () => {
    let state = markReaderAdjusted(markApplied(beginStudySession('1.2.3')));
    state = beginStudySession('4.5.6');
    expect(shouldAutoApply(state, '4.5.6', 'torax').apply).toBe(true);
  });

  it('an untouched empty state applies', () => {
    expect(shouldAutoApply(emptyAutoApplyState(), '1.2.3', 'torax').apply).toBe(true);
  });
});

describe('hpSync — resolving a protocol for a study', () => {
  const candidates = [
    { id: 'torax', score: 0.9 },
    { id: 'abdome', score: 0.4 },
  ];

  it('picks the best candidate above the threshold', () => {
    expect(resolveProtocolForStudy({ candidates, fallbackId: 'default' })).toEqual({
      protocolId: 'torax',
      score: 0.9,
      isFallback: false,
    });
  });

  it('sorts rather than trusting the caller ordering', () => {
    const shuffled = [{ id: 'abdome', score: 0.4 }, { id: 'torax', score: 0.9 }];
    expect(resolveProtocolForStudy({ candidates: shuffled, fallbackId: 'd' }).protocolId).toBe(
      'torax'
    );
  });

  it('falls back and says so when nothing clears the threshold', () => {
    const result = resolveProtocolForStudy({
      candidates: [{ id: 'abdome', score: 0.2 }],
      fallbackId: 'default',
    });
    expect(result).toEqual({ protocolId: 'default', score: 0.2, isFallback: true });
  });

  it('falls back with no candidates at all', () => {
    expect(resolveProtocolForStudy({ candidates: [], fallbackId: 'default' })).toEqual({
      protocolId: 'default',
      score: 0,
      isFallback: true,
    });
  });

  it('honours a custom threshold', () => {
    expect(
      resolveProtocolForStudy({ candidates, fallbackId: 'd', threshold: 0.95 }).isFallback
    ).toBe(true);
  });

  // The budget is met by never being able to block, not by racing a timer — a timer
  // would still leave the viewport empty for two seconds on a bad network.
  it('is synchronous, so the 2s budget cannot be missed', () => {
    const result = resolveProtocolForStudy({ candidates, fallbackId: 'd' });
    expect(result).not.toBeInstanceOf(Promise);
    expect(AUTO_APPLY_BUDGET_MS).toBe(2000);
  });
});
