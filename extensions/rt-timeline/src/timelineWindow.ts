/**
 * Pure calendar-window math for the Course Timeline (RTV-164/175/176).
 *
 * Given the course date range and the set of event dates, computes the list of
 * visible day columns for the shared calendar X axis (Varian Treatment
 * Delivery IFU, Fig. 10 — RT Summary / Course Timeline):
 *   - `workWeekOnly` hides Saturdays/Sundays EXCEPT days that carry an event
 *     (a Saturday session is always shown) — RTV-175 "Show work week".
 *   - `hideEmptyWeeks` drops whole Mon–Sun weeks without any event and counts
 *     them in `weeksHidden` — RTV-175 "Hide empty weeks" (default ON).
 *   - unless `completeHistory`, the window is clamped to the last
 *     {@link HISTORY_WINDOW_DAYS} days (counted back from `lastDate`) and
 *     `truncated` reports whether the full range exceeded it — RTV-176
 *     "Display complete history".
 *   - `anchorDate` (RTV-175 date picker) resolves to `anchorIndex`, the visible
 *     column nearest that date, so the panel can scroll to it.
 *
 * Framework-free and fully deterministic: dates are ISO/DICOM-DA strings and
 * `anchorDate` is injected — no `Date.now()` anywhere. `zoom` is carried in the
 * options for a single panel↔prefs options object, but it does NOT change the
 * column list — it only drives the panel's px-per-day and axis label density.
 */

export type TimelineZoom = 'week' | 'month';

export interface TimelineWindowOptions {
  /** Hide weekends (except days with events). Default false. */
  workWeekOnly?: boolean;
  /** Hide Mon–Sun weeks without any event. Default true. */
  hideEmptyWeeks?: boolean;
  /** Show the full course span instead of the last 180 days. Default false. */
  completeHistory?: boolean;
  /** Rendering density hint only (see module doc). Default 'week'. */
  zoom?: TimelineZoom;
  /** ISO (or DICOM DA) date the panel should scroll to → `anchorIndex`. */
  anchorDate?: string;
}

export interface TimelineDayColumn {
  /** ISO YYYY-MM-DD. */
  date: string;
  dayOfMonth: number;
  /** 0 = Sunday … 6 = Saturday (JS `Date#getUTCDay` convention). */
  weekday: number;
  isWeekend: boolean;
  hasEvent: boolean;
  /** ISO date of the Monday starting this day's week. */
  weekStart: string;
  /** First *visible* column of its week (axis tick / separator anchor). */
  isWeekStart: boolean;
  /** First *visible* column of its month (axis month-label anchor). */
  isMonthStart: boolean;
}

export interface TimelineWindowResult {
  visibleDays: TimelineDayColumn[];
  /** Number of whole weeks dropped by `hideEmptyWeeks`. */
  weeksHidden: number;
  /** True when the rendered window is smaller than the full course range. */
  truncated: boolean;
  /** Effective size of the (possibly clamped) window in days — drives the
   * truncation note (the fixed 180-day constant would lie when the
   * MAX_WINDOW_DAYS corruption cap is the one that clamped). */
  windowDays: number;
  /** Full course span in days (inclusive), before any truncation. */
  spanDays: number;
  /** ISO bounds of the (possibly truncated) window; undefined when empty. */
  windowStart?: string;
  windowEnd?: string;
  /** Index in `visibleDays` nearest `options.anchorDate`, when given. */
  anchorIndex?: number;
}

/** RTV-176 — default rolling window (days) when `completeHistory` is off. */
export const HISTORY_WINDOW_DAYS = 180;

/**
 * Hard cap (~10 years) so a corrupt DICOM date (e.g. year 1900) cannot produce
 * an unbounded column list even with `completeHistory` on. Clamping counts as
 * truncation.
 */
export const MAX_WINDOW_DAYS = 3700;

const MS_PER_DAY = 86400000;

/**
 * Normalize a DICOM DA (`YYYYMMDD`) or ISO (`YYYY-MM-DD`, optionally with a
 * time suffix) date string to plain ISO `YYYY-MM-DD`; undefined otherwise.
 */
export function toIsoDate(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (compact) {
    return `${compact[1]}-${compact[2]}-${compact[3]}`;
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }
  return undefined;
}

/** Days since 1970-01-01 (UTC) for an ISO date; undefined when invalid. */
function isoToEpochDay(iso: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) {
    return undefined;
  }
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(ms) ? Math.round(ms / MS_PER_DAY) : undefined;
}

function epochDayToIso(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. 1970-01-01 (epoch day 0) was a Thursday. */
function weekdayOf(epochDay: number): number {
  return (((epochDay % 7) + 7) % 7 + 4) % 7;
}

interface DayInfo {
  day: number;
  weekday: number;
  /** Epoch day of the Monday starting this day's week. */
  weekStart: number;
  isWeekend: boolean;
  hasEvent: boolean;
}

/** Compute the visible day columns for the course timeline axis. */
export function buildTimelineWindow(
  range: { firstDate?: string; lastDate?: string },
  eventDates: Iterable<string> = [],
  options: TimelineWindowOptions = {}
): TimelineWindowResult {
  const { workWeekOnly = false, hideEmptyWeeks = true, completeHistory = false } = options;
  const empty: TimelineWindowResult = {
    visibleDays: [],
    weeksHidden: 0,
    truncated: false,
    windowDays: 0,
    spanDays: 0,
  };

  const firstIso = toIsoDate(range?.firstDate);
  const lastIso = toIsoDate(range?.lastDate);
  const first = firstIso ? isoToEpochDay(firstIso) : undefined;
  const last = lastIso ? isoToEpochDay(lastIso) : undefined;
  if (first == null || last == null || last < first) {
    return empty;
  }

  const events = new Set<number>();
  for (const d of eventDates) {
    const iso = toIsoDate(d);
    const e = iso ? isoToEpochDay(iso) : undefined;
    if (e != null) {
      events.add(e);
    }
  }

  const spanDays = last - first + 1;
  let windowFirst = first;
  let truncated = false;
  if (!completeHistory && spanDays > HISTORY_WINDOW_DAYS) {
    windowFirst = last - (HISTORY_WINDOW_DAYS - 1);
    truncated = true;
  }
  if (last - windowFirst + 1 > MAX_WINDOW_DAYS) {
    windowFirst = last - (MAX_WINDOW_DAYS - 1);
    truncated = true;
  }
  const windowDays = last - windowFirst + 1;

  // ---- Group the window's days into Mon–Sun weeks ----
  const weeks: DayInfo[][] = [];
  let currentWeek: DayInfo[] = [];
  for (let day = windowFirst; day <= last; day++) {
    const weekday = weekdayOf(day);
    const info: DayInfo = {
      day,
      weekday,
      weekStart: day - ((weekday + 6) % 7),
      isWeekend: weekday === 0 || weekday === 6,
      hasEvent: events.has(day),
    };
    if (currentWeek.length && currentWeek[0].weekStart !== info.weekStart) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
    currentWeek.push(info);
  }
  if (currentWeek.length) {
    weeks.push(currentWeek);
  }

  // ---- Week filter first (a week whose only event is a Saturday survives),
  //      then the per-day weekend filter (event weekends always visible) ----
  let weeksHidden = 0;
  const visibleInfos: DayInfo[] = [];
  for (const week of weeks) {
    if (hideEmptyWeeks && !week.some(d => d.hasEvent)) {
      weeksHidden++;
      continue;
    }
    for (const d of week) {
      if (workWeekOnly && d.isWeekend && !d.hasEvent) {
        continue;
      }
      visibleInfos.push(d);
    }
  }

  const visibleDays: TimelineDayColumn[] = visibleInfos.map((d, i) => {
    const iso = epochDayToIso(d.day);
    const prev = visibleInfos[i - 1];
    return {
      date: iso,
      dayOfMonth: Number(iso.slice(8, 10)),
      weekday: d.weekday,
      isWeekend: d.isWeekend,
      hasEvent: d.hasEvent,
      weekStart: epochDayToIso(d.weekStart),
      isWeekStart: !prev || prev.weekStart !== d.weekStart,
      isMonthStart: !prev || epochDayToIso(prev.day).slice(0, 7) !== iso.slice(0, 7),
    };
  });

  // ---- Anchor (RTV-175 date picker): nearest visible column ----
  let anchorIndex: number | undefined;
  const anchorIso = toIsoDate(options.anchorDate);
  const anchor = anchorIso ? isoToEpochDay(anchorIso) : undefined;
  if (anchor != null && visibleInfos.length) {
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < visibleInfos.length; i++) {
      const distance = Math.abs(visibleInfos[i].day - anchor);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    anchorIndex = best;
  }

  return {
    visibleDays,
    weeksHidden,
    truncated,
    windowDays,
    spanDays,
    windowStart: epochDayToIso(windowFirst),
    windowEnd: epochDayToIso(last),
    anchorIndex,
  };
}

export default buildTimelineWindow;
