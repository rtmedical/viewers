import {
  compareBySla,
  computeSla,
  DEFAULT_TURNAROUND_MINUTES,
  formatDuration,
  normalizePriority,
  normalizeReportStatus,
  priorityBadge,
  priorityRowTint,
  reportStatusBadge,
  SLA_GREEN_ABOVE,
  toEpochMs,
} from './worklistSla';

const NOW = Date.parse('2026-08-15T12:00:00Z');
const minutes = (n: number) => n * 60_000;

describe('parsing helpers', () => {
  it('accepts ISO, epoch numbers and epoch strings', () => {
    expect(toEpochMs('2026-08-15T12:00:00Z')).toBe(NOW);
    expect(toEpochMs(NOW)).toBe(NOW);
    expect(toEpochMs(String(NOW))).toBe(NOW);
  });

  it('is null for anything unparseable', () => {
    expect(toEpochMs('não é data')).toBeNull();
    expect(toEpochMs('')).toBeNull();
    expect(toEpochMs(undefined)).toBeNull();
    expect(toEpochMs(NaN)).toBeNull();
  });

  it('normalises priority from Portuguese and English', () => {
    expect(normalizePriority('EMERGENTE')).toBe('emergency');
    expect(normalizePriority('emergency')).toBe('emergency');
    expect(normalizePriority('Urgente')).toBe('urgent');
    expect(normalizePriority('rotina')).toBe('normal');
    expect(normalizePriority(undefined)).toBe('normal');
  });

  it('normalises report status', () => {
    expect(normalizeReportStatus('em laudo')).toBe('inProgress');
    expect(normalizeReportStatus('DRAFT')).toBe('inProgress');
    expect(normalizeReportStatus('assinado')).toBe('signed');
    expect(normalizeReportStatus('Addendum')).toBe('addendum');
    expect(normalizeReportStatus('whatever')).toBe('none');
  });

  it('formats durations compactly', () => {
    expect(formatDuration(40)).toBe('40m');
    expect(formatDuration(135)).toBe('2h 15m');
    expect(formatDuration(120)).toBe('2h');
    expect(formatDuration(60 * 30)).toBe('1d 6h');
    expect(formatDuration(-40)).toBe('40m');
  });
});

describe('computeSla', () => {
  const at = (createdMinAgo: number, deadlineInMin: number, priority = 'normal') =>
    computeSla({
      createdAt: NOW - minutes(createdMinAgo),
      deadlineAt: NOW + minutes(deadlineInMin),
      priority,
      now: NOW,
    });

  it('is green with most of the window left', () => {
    // 24h window, 20h left -> 83%.
    expect(at(4 * 60, 20 * 60).level).toBe('green');
  });

  it('is amber inside the middle band', () => {
    // 24h window, 6h left -> 25%.
    const sla = at(18 * 60, 6 * 60);
    expect(sla.level).toBe('amber');
    expect(sla.remainingFraction).toBeCloseTo(0.25, 6);
  });

  it('is red under 10% of the window', () => {
    // 24h window, 1h left -> 4%.
    expect(at(23 * 60, 60).level).toBe('red');
  });

  it('is red and flagged when overdue', () => {
    const sla = at(25 * 60, -60);
    expect(sla.level).toBe('red');
    expect(sla.overdue).toBe(true);
    expect(sla.remainingMinutes).toBe(-60);
    expect(sla.label).toMatch(/^atrasado /);
  });

  it('ranks by fraction of the allowed window, not raw minutes', () => {
    // 10 minutes left on a 30-minute emergency is 33% -> amber.
    // 10 minutes left on a 24-hour routine is 0.7% -> red.
    const emergency = computeSla({
      createdAt: NOW - minutes(20),
      deadlineAt: NOW + minutes(10),
      priority: 'emergency',
      now: NOW,
    });
    const routine = computeSla({
      createdAt: NOW - minutes(24 * 60 - 10),
      deadlineAt: NOW + minutes(10),
      priority: 'normal',
      now: NOW,
    });
    expect(emergency.level).toBe('amber');
    expect(routine.level).toBe('red');
  });

  it('treats the green boundary as strictly above half', () => {
    const half = computeSla({
      createdAt: NOW - minutes(60),
      deadlineAt: NOW + minutes(60),
      now: NOW,
    });
    expect(half.remainingFraction).toBeCloseTo(SLA_GREEN_ABOVE, 6);
    expect(half.level).toBe('amber');
  });

  it('infers a deadline from the priority when none was supplied, and says so', () => {
    const sla = computeSla({ createdAt: NOW - minutes(10), priority: 'urgent', now: NOW });
    expect(sla.deadlineInferred).toBe(true);
    expect(sla.remainingMinutes).toBe(DEFAULT_TURNAROUND_MINUTES.urgent - 10);
  });

  it('does not claim an inferred deadline when one was given', () => {
    expect(at(10, 60).deadlineInferred).toBe(false);
  });

  it('is unknown, not red, when there is nothing to compute from', () => {
    // "Unknown" must never masquerade as a breach.
    const sla = computeSla({ now: NOW });
    expect(sla.level).toBe('unknown');
    expect(sla.overdue).toBe(false);
    expect(sla.label).toBe('—');
  });

  it('still works without a creation time by falling back to the nominal window', () => {
    const sla = computeSla({ deadlineAt: NOW + minutes(30), priority: 'urgent', now: NOW });
    expect(sla.level).not.toBe('unknown');
    expect(sla.remainingFraction).toBeCloseTo(30 / DEFAULT_TURNAROUND_MINUTES.urgent, 6);
  });
});

describe('badges', () => {
  it('draws nothing for normal priority', () => {
    // A badge on every row is noise, and noise is what hides the emergency badge.
    expect(priorityBadge('normal')).toMatchObject({ label: '', tone: 'none' });
  });

  it('draws emergency bold red and urgent yellow', () => {
    expect(priorityBadge('emergente')).toMatchObject({ tone: 'red', bold: true });
    expect(priorityBadge('urgente')).toMatchObject({ tone: 'yellow' });
  });

  it('gives every report status a distinct tone', () => {
    const tones = ['none', 'inProgress', 'preliminary', 'signed', 'addendum'].map(
      s => reportStatusBadge(s).tone
    );
    expect(new Set(tones).size).toBe(tones.length);
  });

  it('pulses only while a report is in progress', () => {
    expect(reportStatusBadge('inProgress').pulse).toBe(true);
    expect(reportStatusBadge('signed').pulse).toBeUndefined();
  });

  it('tints only the rows that need it, and faintly', () => {
    expect(priorityRowTint('normal')).toBeUndefined();
    expect(priorityRowTint('emergency')).toContain('0.10');
    expect(priorityRowTint('urgent')).toContain('0.08');
  });
});

describe('compareBySla', () => {
  const row = (createdMinAgo: number, deadlineInMin: number, priority = 'normal') => ({
    sla: computeSla({
      createdAt: NOW - minutes(createdMinAgo),
      deadlineAt: NOW + minutes(deadlineInMin),
      priority,
      now: NOW,
    }),
    priority,
  });

  it('puts breaches first', () => {
    const overdue = row(30 * 60, -60);
    const fine = row(60, 20 * 60);
    expect(compareBySla(overdue, fine)).toBeLessThan(0);
  });

  it('then orders by how close to breaching', () => {
    const close = row(23 * 60, 60);
    const relaxed = row(60, 20 * 60);
    expect(compareBySla(close, relaxed)).toBeLessThan(0);
  });

  it('sinks unknowns to the bottom instead of floating them to the top', () => {
    // "Unknown" is not "urgent"; treating it as urgent would bury the real breaches.
    const unknown = { sla: computeSla({ now: NOW }), priority: 'normal' };
    const fine = row(60, 20 * 60);
    expect(compareBySla(unknown, fine)).toBeGreaterThan(0);
  });

  it('breaks ties on priority', () => {
    const a = { sla: computeSla({ now: NOW }), priority: 'emergency' };
    const b = { sla: computeSla({ now: NOW }), priority: 'normal' };
    expect(compareBySla(a, b)).toBeLessThan(0);
  });
});
