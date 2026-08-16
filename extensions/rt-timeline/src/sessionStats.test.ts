import {
  describeSession,
  groupSessions,
  orderEvents,
  SESSION_GAP_MINUTES,
  Session,
  SessionEvent,
  sessionConcerns,
  sessionStatistics,
  STATUS_KIND,
  STATUS_LABELS,
  validateEvent,
} from './sessionStats';

const T0 = new Date('2026-03-10T08:00:00Z').getTime();
const MIN = 60_000;
const HOUR = 3_600_000;

const ev = (over: Partial<SessionEvent> = {}): SessionEvent => ({
  id: `e-${over.at ?? 0}-${over.type ?? 'imaging'}`,
  at: T0,
  type: 'imaging',
  status: 'pass',
  ...over,
});

const session = (events: SessionEvent[]): Session => groupSessions(events)[0];

describe('sessionStats — an override with no name is not an override', () => {
  // The name is the difference between a decision and an unowned exception.
  it('refuses one', () => {
    const result = validateEvent(ev({ status: 'override' }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/exceção que ninguém assume/);
  });

  it('accepts one with a name', () => {
    expect(validateEvent(ev({ status: 'override', by: 'fis.costa' })).ok).toBe(true);
  });

  it('refuses an unknown status, a missing id and a missing time', () => {
    expect(validateEvent(ev({ status: 'talvez' as never })).ok).toBe(false);
    expect(validateEvent(ev({ id: '' })).ok).toBe(false);
    expect(validateEvent(ev({ at: NaN })).ok).toBe(false);
  });
});

describe('sessionStats — a session is a gap in time, not a date', () => {
  // Twice-daily treatment would collapse into one session that looks eight hours long.
  it('splits twice-daily treatment on the same calendar day', () => {
    const events = [
      ev({ at: T0, type: 'imaging' }),
      ev({ at: T0 + 5 * MIN, type: 'treatment' }),
      ev({ at: T0 + 8 * HOUR, type: 'imaging' }),
      ev({ at: T0 + 8 * HOUR + 5 * MIN, type: 'treatment' }),
    ];
    expect(groupSessions(events)).toHaveLength(2);
  });

  // The second half would look like a treatment with no setup imaging.
  it('keeps an evening session crossing midnight together', () => {
    const late = new Date('2026-03-10T23:50:00Z').getTime();
    const events = [
      ev({ at: late, type: 'imaging' }),
      ev({ at: late + 20 * MIN, type: 'treatment' }),
    ];
    const sessions = groupSessions(events);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].events).toHaveLength(2);
  });

  it('uses the configured gap', () => {
    const events = [ev({ at: T0 }), ev({ at: T0 + 90 * MIN })];
    expect(groupSessions(events, 60)).toHaveLength(2);
    expect(groupSessions(events, 120)).toHaveLength(1);
    expect(SESSION_GAP_MINUTES).toBe(240);
  });

  it('reports the span and the fractions covered', () => {
    const s = session([
      ev({ at: T0, fraction: 7 }),
      ev({ at: T0 + 12 * MIN, type: 'treatment', fraction: 7 }),
    ]);
    expect(s.durationMin).toBeCloseTo(12, 6);
    expect(s.fractions).toEqual([7]);
  });

  it('returns nothing for no events', () => {
    expect(groupSessions([])).toEqual([]);
  });
});

describe('sessionStats — when timestamps tie, imaging comes first', () => {
  // A sub-timeline showing the beam first says the therapist treated and then imaged.
  it('puts the setup image before the beam that shares its minute', () => {
    const ordered = orderEvents([
      ev({ id: 'beam', at: T0, type: 'treatment' }),
      ev({ id: 'kv', at: T0, type: 'imaging' }),
    ]);
    expect(ordered.map(e => e.id)).toEqual(['kv', 'beam']);
  });

  it('is otherwise ordered by time', () => {
    const ordered = orderEvents([ev({ id: 'b', at: T0 + MIN }), ev({ id: 'a', at: T0 })]);
    expect(ordered.map(e => e.id)).toEqual(['a', 'b']);
  });

  it('is stable for two events of the same type at the same time', () => {
    const ordered = orderEvents([ev({ id: 'z', at: T0 }), ev({ id: 'a', at: T0 })]);
    expect(ordered.map(e => e.id)).toEqual(['a', 'z']);
  });
});

describe('sessionStats — three different claims, three different counts', () => {
  const events = [
    ev({ id: '1', at: T0, status: 'pass' }),
    ev({ id: '2', at: T0 + MIN, status: 'pass' }),
    ev({ id: '3', at: T0 + 2 * MIN, status: 'reviewed' }),
    ev({ id: '4', at: T0 + 3 * MIN, type: 'treatment', status: 'approved' }),
    ev({ id: '5', at: T0 + 4 * MIN, status: 'override', by: 'fis.costa' }),
    ev({ id: '6', at: T0 + 5 * MIN, type: 'treatment', status: 'manual' }),
  ];

  it('separates what the software asserted from what a person did', () => {
    const stats = sessionStatistics(session(events));
    expect(stats.automaticChecks).toBe(2);
    expect(stats.humanChecks).toBe(2);
  });

  it('classifies each status by the kind of claim it is', () => {
    expect(STATUS_KIND.pass).toBe('automatic');
    expect(STATUS_KIND.approved).toBe('human');
    expect(STATUS_KIND.override).toBe('exception');
    expect(STATUS_KIND.manual).toBe('provenance');
  });

  it('counts each status separately, in a stable order', () => {
    const stats = sessionStatistics(session(events));
    expect(stats.byStatus.map(s => s.status)).toEqual([
      'pass',
      'reviewed',
      'approved',
      'override',
      'manual',
    ]);
    expect(stats.byStatus[0]).toEqual({ status: 'pass', label: STATUS_LABELS.pass, count: 2 });
  });

  // Accurate and completely misleading, and it is what a single total produces.
  it('says out loud when nothing was checked by a person', () => {
    const stats = sessionStatistics(session([ev({ id: '1', status: 'pass' }), ev({ id: '2', at: T0 + MIN, status: 'pass' })]));
    expect(stats.message).toMatch(/o que passou, passou no software/);
  });

  it('names who accepted each exception', () => {
    const stats = sessionStatistics(session(events));
    expect(stats.overrides).toEqual([{ id: '5', by: 'fis.costa', note: undefined }]);
    expect(stats.message).toMatch(/1 exceção\(ões\) aceita\(s\) por fis\.costa/);
  });

  // A rate over three events has a confidence interval wider than its own value.
  it('reports counts and never a percentage', () => {
    expect(sessionStatistics(session(events)).message).not.toMatch(/%/);
  });

  it('counts imaging and treatment events apart', () => {
    const stats = sessionStatistics(session(events));
    expect(stats.imagingEvents).toBe(4);
    expect(stats.treatmentEvents).toBe(2);
  });
});

describe('sessionStats — what deserves a second look', () => {
  it('flags a delivery with no imaging before it', () => {
    const s = session([ev({ id: 't', type: 'treatment', status: 'approved' })]);
    expect(sessionConcerns(s).reasons.join(' ')).toMatch(/sem imagem de verificação antes dela/);
  });

  it('does not flag one that had imaging at the same minute', () => {
    const s = session([
      ev({ id: 'kv', at: T0, type: 'imaging' }),
      ev({ id: 't', at: T0, type: 'treatment', status: 'approved' }),
    ]);
    expect(sessionConcerns(s).concerning).toBe(false);
  });

  it('surfaces every override with its owner and note', () => {
    const s = session([
      ev({ id: 'kv', at: T0 }),
      ev({ id: 'o', at: T0 + MIN, status: 'override', by: 'fis.costa', note: 'desvio de 4 mm aceito' }),
      ev({ id: 't', at: T0 + 2 * MIN, type: 'treatment', status: 'approved' }),
    ]);
    expect(sessionConcerns(s).reasons.join(' ')).toMatch(/Exceção aceita por fis\.costa — desvio de 4 mm aceito/);
  });

  it('flags an action item nobody looked at', () => {
    const s = session([
      ev({ id: 'kv', at: T0 }),
      ev({ id: 'a', at: T0 + MIN, status: 'action-item' }),
      ev({ id: 't', at: T0 + 2 * MIN, type: 'treatment', status: 'pass' }),
    ]);
    expect(sessionConcerns(s).reasons.join(' ')).toMatch(/sem nenhuma revisão humana na sessão/);
  });

  it('is quiet on a clean session', () => {
    const s = session([
      ev({ id: 'kv', at: T0, status: 'pass' }),
      ev({ id: 'r', at: T0 + MIN, status: 'reviewed' }),
      ev({ id: 't', at: T0 + 2 * MIN, type: 'treatment', status: 'approved' }),
    ]);
    expect(sessionConcerns(s).concerning).toBe(false);
  });
});

describe('sessionStats — the session line', () => {
  it('names the session, the fraction, the span and the tally', () => {
    const s = session([
      ev({ id: 'kv', at: T0, fraction: 7 }),
      ev({ id: 't', at: T0 + 10 * MIN, type: 'treatment', status: 'approved', fraction: 7 }),
    ]);
    expect(describeSession(s)).toMatch(/^Sessão 1 · fração 7 · 10 min — 1 imagem\(ns\), 1 entrega\(s\)\./);
  });
});
