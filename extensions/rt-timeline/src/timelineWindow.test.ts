import {
  buildTimelineWindow,
  toIsoDate,
  HISTORY_WINDOW_DAYS,
  MAX_WINDOW_DAYS,
} from './timelineWindow';

// Calendar facts used below: 2026-01-01 is a Thursday, so 2026-01-03 is a
// Saturday, 2026-01-04 a Sunday and 2026-01-05 a Monday.

describe('toIsoDate', () => {
  it('normalizes DICOM DA and ISO (with/without time) to YYYY-MM-DD', () => {
    expect(toIsoDate('20260105')).toBe('2026-01-05');
    expect(toIsoDate('2026-01-05')).toBe('2026-01-05');
    expect(toIsoDate('2026-01-05T10:30:00')).toBe('2026-01-05');
  });

  it('returns undefined for garbage or empty input', () => {
    expect(toIsoDate(undefined)).toBeUndefined();
    expect(toIsoDate('')).toBeUndefined();
    expect(toIsoDate('Jan 5')).toBeUndefined();
    expect(toIsoDate('2026')).toBeUndefined();
  });
});

describe('buildTimelineWindow', () => {
  const range = { firstDate: '2026-01-05', lastDate: '2026-01-16' }; // Mon..Fri, 2 weeks
  const events = ['2026-01-05', '20260110', '2026-01-14']; // 01-10 is a Saturday

  it('emits one inclusive column per day with calendar metadata', () => {
    const w = buildTimelineWindow(range, events);
    expect(w.visibleDays).toHaveLength(12);
    expect(w.spanDays).toBe(12);
    expect(w.truncated).toBe(false);
    expect(w.weeksHidden).toBe(0);
    expect(w.windowStart).toBe('2026-01-05');
    expect(w.windowEnd).toBe('2026-01-16');

    const first = w.visibleDays[0];
    expect(first).toMatchObject({
      date: '2026-01-05',
      dayOfMonth: 5,
      weekday: 1, // Monday
      isWeekend: false,
      hasEvent: true,
      weekStart: '2026-01-05',
      isWeekStart: true,
      isMonthStart: true,
    });
    const saturday = w.visibleDays.find(d => d.date === '2026-01-10');
    expect(saturday).toMatchObject({ weekday: 6, isWeekend: true, hasEvent: true });
    // Second week begins on Monday the 12th.
    const secondMonday = w.visibleDays.find(d => d.date === '2026-01-12');
    expect(secondMonday).toMatchObject({ isWeekStart: true, weekStart: '2026-01-12' });
  });

  it('workWeekOnly hides weekends EXCEPT days with events (Saturday sessions stay)', () => {
    const w = buildTimelineWindow(range, events, { workWeekOnly: true });
    const dates = w.visibleDays.map(d => d.date);
    expect(dates).toContain('2026-01-10'); // Saturday WITH event → always visible
    expect(dates).not.toContain('2026-01-11'); // Sunday without event → hidden
    expect(w.visibleDays).toHaveLength(11);
    // The Monday after a hidden Sunday still starts its week.
    expect(w.visibleDays.find(d => d.date === '2026-01-12')?.isWeekStart).toBe(true);
  });

  it('hideEmptyWeeks drops whole event-less weeks and counts them', () => {
    const longRange = { firstDate: '2026-01-05', lastDate: '2026-01-30' };
    const sparse = ['2026-01-05', '2026-01-26'];
    const w = buildTimelineWindow(longRange, sparse, { hideEmptyWeeks: true });
    expect(w.weeksHidden).toBe(2); // weeks of Jan 12 and Jan 19
    // Week 1 (05..11, clipped at range start) + week 4 (26..30, clipped at end).
    expect(w.visibleDays.map(d => d.date)).toEqual([
      '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09',
      '2026-01-10', '2026-01-11',
      '2026-01-26', '2026-01-27', '2026-01-28', '2026-01-29', '2026-01-30',
    ]);
    // The first day after the gap anchors both a week and (unchanged) no month.
    expect(w.visibleDays[7]).toMatchObject({ date: '2026-01-26', isWeekStart: true });

    const all = buildTimelineWindow(longRange, sparse, { hideEmptyWeeks: false });
    expect(all.visibleDays).toHaveLength(26);
    expect(all.weeksHidden).toBe(0);
  });

  it('a week whose only event is a Saturday survives hideEmptyWeeks + workWeekOnly', () => {
    const w = buildTimelineWindow(
      { firstDate: '2026-01-05', lastDate: '2026-01-18' },
      ['2026-01-10'], // Saturday of week 1; week 2 empty
      { hideEmptyWeeks: true, workWeekOnly: true }
    );
    expect(w.weeksHidden).toBe(1);
    expect(w.visibleDays.map(d => d.date)).toEqual([
      '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09', '2026-01-10',
    ]);
  });

  it('truncates to the last 180 days unless completeHistory (RTV-176)', () => {
    const longRange = { firstDate: '2025-06-01', lastDate: '2026-01-15' }; // 229 days
    const sparse = ['2025-06-02', '2026-01-15'];

    const w = buildTimelineWindow(longRange, sparse, { hideEmptyWeeks: false });
    expect(w.spanDays).toBe(229);
    expect(w.truncated).toBe(true);
    expect(w.windowStart).toBe('2025-07-20'); // 2026-01-15 − 179 days
    expect(w.visibleDays).toHaveLength(HISTORY_WINDOW_DAYS);
    expect(w.visibleDays.some(d => d.date === '2025-06-02')).toBe(false);

    const full = buildTimelineWindow(longRange, sparse, {
      hideEmptyWeeks: false,
      completeHistory: true,
    });
    expect(full.truncated).toBe(false);
    expect(full.visibleDays).toHaveLength(229);
    expect(full.visibleDays.some(d => d.date === '2025-06-02')).toBe(true);
  });

  it('caps even completeHistory windows at MAX_WINDOW_DAYS (corrupt dates)', () => {
    const w = buildTimelineWindow(
      { firstDate: '1900-01-01', lastDate: '2026-01-15' },
      ['2026-01-15'],
      { hideEmptyWeeks: false, completeHistory: true }
    );
    expect(w.truncated).toBe(true);
    expect(w.visibleDays).toHaveLength(MAX_WINDOW_DAYS);
  });

  it('resolves anchorDate to the nearest visible column (clamped across gaps)', () => {
    const w = buildTimelineWindow(range, events, { anchorDate: '2026-01-14' });
    expect(w.visibleDays[w.anchorIndex!].date).toBe('2026-01-14');

    const before = buildTimelineWindow(range, events, { anchorDate: '2025-12-01' });
    expect(before.anchorIndex).toBe(0);

    const after = buildTimelineWindow(range, events, { anchorDate: '2026-03-01' });
    expect(after.anchorIndex).toBe(11);

    // Anchor inside a hidden empty week snaps to the nearest visible day.
    const gappy = buildTimelineWindow(
      { firstDate: '2026-01-05', lastDate: '2026-01-30' },
      ['2026-01-05', '2026-01-26'],
      { anchorDate: '2026-01-13' }
    );
    expect(gappy.visibleDays[gappy.anchorIndex!].date).toBe('2026-01-11');

    expect(buildTimelineWindow(range, events).anchorIndex).toBeUndefined();
  });

  it('zoom is a rendering hint only — the column list is identical', () => {
    const week = buildTimelineWindow(range, events, { zoom: 'week' });
    const month = buildTimelineWindow(range, events, { zoom: 'month' });
    expect(month.visibleDays).toEqual(week.visibleDays);
  });

  it('is defensive about missing/invalid ranges', () => {
    const empty = { visibleDays: [], weeksHidden: 0, truncated: false, windowDays: 0, spanDays: 0 };
    expect(buildTimelineWindow({}, [])).toEqual(empty);
    expect(buildTimelineWindow({ firstDate: 'oops', lastDate: '2026-01-05' }, [])).toEqual(empty);
    expect(
      buildTimelineWindow({ firstDate: '2026-01-10', lastDate: '2026-01-05' }, [])
    ).toEqual(empty);
  });

  it('accepts DICOM DA range bounds', () => {
    const w = buildTimelineWindow({ firstDate: '20260105', lastDate: '20260107' }, ['20260106']);
    expect(w.visibleDays.map(d => d.date)).toEqual(['2026-01-05', '2026-01-06', '2026-01-07']);
    expect(w.visibleDays[1].hasEvent).toBe(true);
  });
});
