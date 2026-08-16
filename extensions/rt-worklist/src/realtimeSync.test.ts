import {
  applyEvents,
  arrivalNotice,
  DEFAULT_SYNC,
  describeConnection,
  initialSyncState,
  nextBackoffMs,
  nextTransport,
  onConnect,
  onDisconnect,
  StudyEvent,
  SyncState,
  TRANSPORT_ORDER,
  trustworthiness,
} from './realtimeSync';

const T0 = 1_700_000_000_000;

const study = (uid: string, over: Partial<StudyEvent> = {}): StudyEvent => ({
  studyInstanceUid: uid,
  patientName: 'João Silva',
  modality: 'CT',
  priority: 'routine',
  arrivedAt: T0,
  ...over,
});

/** A state that has completed its first catch-up and is live. */
const live = (over: Partial<SyncState> = {}): SyncState => ({
  ...initialSyncState(T0),
  state: 'live',
  resyncRequired: false,
  resyncSince: null,
  disconnectedAt: null,
  lastEventAt: T0,
  ...over,
});

describe('realtimeSync — backoff and transport fallback', () => {
  it('walks the backoff and holds at the last step', () => {
    expect(nextBackoffMs(0)).toBe(1000);
    expect(nextBackoffMs(2)).toBe(4000);
    expect(nextBackoffMs(99)).toBe(30000);
  });

  // Deterministic here; the spread that stops every client reconnecting on the same tick
  // belongs to the adapter that owns the timer.
  it('takes jitter as an injected function', () => {
    expect(nextBackoffMs(0, DEFAULT_SYNC, base => base / 2)).toBe(500);
  });

  it('stays on a transport until it has failed enough', () => {
    expect(nextTransport('websocket', 1)).toBe('websocket');
    expect(nextTransport('websocket', 3)).toBe('sse');
    expect(nextTransport('sse', 3)).toBe('polling');
  });

  it('has nowhere to fall back to after polling', () => {
    expect(nextTransport('polling', 99)).toBe('polling');
    expect(TRANSPORT_ORDER).toEqual(['websocket', 'sse', 'polling']);
  });
});

describe('realtimeSync — reconnecting is not resuming', () => {
  it('records when the outage started', () => {
    const dropped = onDisconnect(live(), T0 + 1000);
    expect(dropped.state).toBe('offline');
    expect(dropped.disconnectedAt).toBe(T0 + 1000);
  });

  it('keeps the original outage start across repeated failures', () => {
    let state = onDisconnect(live(), T0 + 1000);
    state = onDisconnect(state, T0 + 5000);
    expect(state.disconnectedAt).toBe(T0 + 1000);
  });

  // The studies broadcast during the outage went to nobody.
  it('comes back needing a catch-up, not live', () => {
    const dropped = onDisconnect(live(), T0 + 1000);
    const result = onConnect(dropped, T0 + 60_000);
    expect(result.state.state).not.toBe('live');
    expect(result.state.resyncRequired).toBe(true);
    expect(result.resync).not.toBeNull();
    expect(result.message).toMatch(/a lista fica permanentemente curta, e nada na tela indica isso/);
  });

  // Overlapping is cheap and deduplicated; missing a study is not.
  it('reaches back before the outage by the grace window', () => {
    const dropped = onDisconnect(live(), T0 + 1000);
    expect(onConnect(dropped, T0 + 60_000).resync!.since).toBe(T0 + 1000 - DEFAULT_SYNC.resyncGraceMs);
  });

  it('starts already needing a catch-up on the very first connection', () => {
    expect(initialSyncState(T0).resyncRequired).toBe(true);
  });

  it('reports degraded once it has fallen back to polling', () => {
    const dropped = { ...onDisconnect(live(), T0), transport: 'polling' as const };
    expect(onConnect(dropped, T0 + 1000).state.state).toBe('degraded');
  });
});

describe('realtimeSync — the same study will arrive twice', () => {
  it('drops the ones already shown', () => {
    const first = applyEvents(live(), [study('1.2.3'), study('1.2.4')], T0 + 1);
    const second = applyEvents(first.state, [study('1.2.4'), study('1.2.5')], T0 + 2);
    expect(first.fresh).toHaveLength(2);
    expect(second.fresh.map(e => e.studyInstanceUid)).toEqual(['1.2.5']);
    expect(second.duplicates).toBe(1);
  });

  it('ignores events with no study UID', () => {
    expect(applyEvents(live(), [study('')], T0).fresh).toEqual([]);
  });

  it('clears the catch-up flag only when the batch was the catch-up', () => {
    const dropped = onDisconnect(live(), T0);
    const reconnected = onConnect(dropped, T0 + 1000).state;
    expect(applyEvents(reconnected, [study('1.2.3')], T0 + 2000).state.resyncRequired).toBe(true);
    expect(
      applyEvents(reconnected, [study('1.2.3')], T0 + 2000, { fromResync: true }).state.resyncRequired
    ).toBe(false);
  });

  it('goes live once the catch-up lands, or degraded on polling', () => {
    const reconnected = onConnect(onDisconnect(live(), T0), T0 + 1000).state;
    expect(applyEvents(reconnected, [], T0 + 2000, { fromResync: true }).state.state).toBe('live');
    expect(
      applyEvents({ ...reconnected, transport: 'polling' }, [], T0 + 2000, { fromResync: true }).state.state
    ).toBe('degraded');
  });

  // The studies at risk of a duplicate are always the recent ones.
  it('bounds the seen set without letting a duplicate through in the meantime', () => {
    let state = live();
    for (let i = 0; i < 150; i++) {
      state = applyEvents(state, [study(`uid-${i}`)], T0 + i, { maxSeen: 100 }).state;
    }
    expect(state.seen.length).toBeLessThanOrEqual(100);
    expect(applyEvents(state, [study('uid-149')], T0, { maxSeen: 100 }).fresh).toEqual([]);
  });
});

describe('realtimeSync — degraded has to be visible', () => {
  it('trusts a live channel that is hearing things', () => {
    expect(trustworthiness(live(), T0 + 1000).trustworthy).toBe(true);
  });

  it('does not trust a list whose catch-up has not been applied', () => {
    const reconnected = onConnect(onDisconnect(live(), T0), T0 + 1000).state;
    const trust = trustworthiness(reconnected, T0 + 2000);
    expect(trust.trustworthy).toBe(false);
    expect(trust.message).toMatch(/possivelmente incompleta/);
  });

  it('does not trust an offline channel', () => {
    expect(trustworthiness(onDisconnect(live(), T0), T0 + 1000).trustworthy).toBe(false);
  });

  // Fine when the user knows; dangerous when they were told it updates itself.
  it('trusts polling but states the staleness', () => {
    const trust = trustworthiness(live({ state: 'degraded', transport: 'polling' }), T0);
    expect(trust.trustworthy).toBe(true);
    expect(trust.stalenessMs).toBe(DEFAULT_SYNC.pollIntervalMs);
    expect(trust.message).toMatch(/pode estar até esse tempo atrasada/);
  });

  // A silent channel and a dead one are indistinguishable from here.
  it('stops trusting a live channel that has gone quiet', () => {
    const trust = trustworthiness(live(), T0 + DEFAULT_SYNC.silenceTimeoutMs + 1000);
    expect(trust.trustworthy).toBe(false);
    expect(trust.message).toMatch(/canal silencioso e um canal morto são indistinguíveis/);
  });
});

describe('realtimeSync — nothing scrolls under the reader', () => {
  // A row appearing above the one someone is about to click moves their target.
  it('never auto-scrolls', () => {
    expect(arrivalNotice([study('1')]).autoScroll).toBe(false);
  });

  it('counts arrivals for the badge', () => {
    expect(arrivalNotice([study('1'), study('2')]).count).toBe(2);
  });

  it('separates the urgent ones and names the first', () => {
    const notice = arrivalNotice([
      study('1'),
      study('2', { priority: 'emergency', patientName: 'Ana', modality: 'CT Crânio' }),
    ]);
    expect(notice.urgent).toHaveLength(1);
    expect(notice.message).toMatch(/2 novo\(s\) estudo\(s\), 1 urgente\(s\): Ana — CT Crânio/);
  });

  it('says nothing when nothing arrived', () => {
    expect(arrivalNotice([]).message).toBe('');
  });
});

describe('realtimeSync — the indicator', () => {
  it('is quiet when everything is fine', () => {
    expect(describeConnection(live(), T0 + 1000)).toBe('Ao vivo por WebSocket.');
  });

  it('names the transport and the problem otherwise', () => {
    const reconnected = onConnect(onDisconnect(live(), T0), T0 + 1000).state;
    expect(describeConnection(reconnected, T0 + 2000)).toMatch(/^WebSocket · Lista possivelmente incompleta/);
  });
});
