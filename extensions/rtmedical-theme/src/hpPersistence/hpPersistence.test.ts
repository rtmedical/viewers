import {
  HangingProtocolStore,
  MemoryStorage,
  resolveConflict,
  MockHangingProtocolSyncClient,
  type StoredProtocolRecord,
} from './hpPersistence';

const makeStore = () => {
  let clock = 1000;
  const tick = () => (clock += 10);
  const store = new HangingProtocolStore({ storage: new MemoryStorage(), now: () => tick() });
  return store;
};

describe('HangingProtocolStore', () => {
  it('saves offline, lists, and gets active records', () => {
    const store = makeStore();
    store.save('hp1', { id: 'hp1', name: 'A' }, 'alice');
    expect(store.list()).toHaveLength(1);
    expect(store.get('hp1')?.updatedBy).toBe('alice');
    expect(store.get('hp1')?.version).toBe(1);
  });

  it('bumps version on re-save', () => {
    const store = makeStore();
    store.save('hp1', { v: 1 }, 'alice');
    const r2 = store.save('hp1', { v: 2 }, 'bob');
    expect(r2.version).toBe(2);
    expect(r2.updatedBy).toBe('bob');
  });

  it('soft-deletes (tombstone) and hides from list/get', () => {
    const store = makeStore();
    store.save('hp1', {}, 'alice');
    store.remove('hp1', 'alice');
    expect(store.get('hp1')).toBeUndefined();
    expect(store.list()).toHaveLength(0);
  });

  it('records an audit log of every change', () => {
    const store = makeStore();
    store.save('hp1', {}, 'alice');
    store.save('hp1', {}, 'bob');
    store.remove('hp1', 'carol');
    const log = store.getAuditLog();
    expect(log.map(e => e.action)).toEqual(['save', 'save', 'remove']);
    expect(log.map(e => e.user)).toEqual(['alice', 'bob', 'carol']);
    expect(log.map(e => e.version)).toEqual([1, 2, 3]);
  });
});

describe('resolveConflict', () => {
  const rec = (over: Partial<StoredProtocolRecord>): StoredProtocolRecord => ({
    id: 'hp1',
    protocol: {},
    updatedAt: 100,
    updatedBy: 'u',
    version: 1,
    ...over,
  });

  it('local wins when only local changed since last sync', () => {
    const r = resolveConflict(rec({ updatedAt: 200 }), rec({ updatedAt: 50 }), 100);
    expect(r.resolution).toBe('local');
  });

  it('remote wins when only remote changed', () => {
    const r = resolveConflict(rec({ updatedAt: 50 }), rec({ updatedAt: 200 }), 100);
    expect(r.resolution).toBe('remote');
  });

  it('flags a conflict (latest updatedAt as winner) when both changed', () => {
    const r = resolveConflict(rec({ updatedAt: 300 }), rec({ updatedAt: 250 }), 100);
    expect(r.resolution).toBe('conflict');
    expect(r.winner.updatedAt).toBe(300);
  });

  it('keeps the higher version when neither changed', () => {
    const r = resolveConflict(rec({ updatedAt: 50, version: 2 }), rec({ updatedAt: 50, version: 3 }), 100);
    expect(r.resolution).toBe('local');
    expect(r.winner.version).toBe(3);
  });
});

describe('MockHangingProtocolSyncClient', () => {
  it('round-trips push/pull (the backend seam)', async () => {
    const client = new MockHangingProtocolSyncClient();
    const rec: StoredProtocolRecord = { id: 'hp1', protocol: {}, updatedAt: 1, updatedBy: 'a', version: 1 };
    await client.push([rec]);
    expect(await client.pull()).toEqual([rec]);
    await client.push([{ ...rec, version: 2 }]);
    expect((await client.pull())[0].version).toBe(2);
  });
});
