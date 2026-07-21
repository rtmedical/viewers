/**
 * Course Timeline right-panel (RTV-164) — the RT Summary "Course Timeline":
 * lanes stacked vertically over a shared calendar X axis (Varian Treatment
 * Delivery IFU, Fig. 10). Lanes: Prescriptions (RTV-165, real data),
 * Treatments (RTV-166, real data) and honest placeholders for Imaging /
 * Overrides / Trends, which are pending PACS/backend integration
 * (RTV-167/168/169).
 *
 * Data: the parsed `rtPlan` / `rtRecord` models the sibling extensions attach
 * to their display sets (duck-typed; no cross-extension import — RTV-114).
 * Calendar math is the pure {@link ../timelineWindow}; plan filtering the pure
 * `filterPlans` (RTV-174); user preferences (calendar options RTV-175 + plan
 * filters RTV-174 + zoom) persist per user/workstation via
 * {@link ../timelinePrefs} (localStorage `rt-summary-timeline-prefs`).
 * "Display complete history" (RTV-176) only appears when the course span
 * exceeds the 180-day rolling window and is deliberately not persisted.
 *
 * Performance (RTV-164 "1000+ events"): the axis is horizontally virtualized —
 * above {@link VIRTUALIZATION_THRESHOLD} columns only the columns inside the
 * scroll viewport (± {@link OVERSCAN_COLUMNS}) are mounted, windowed manually
 * from `scrollLeft` (no windowing library). At or below the threshold all
 * columns render directly: a few hundred absolutely-positioned divs are
 * cheaper than the bookkeeping.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  buildCourseTimeline,
  buildPrescriptionTimeline,
  filterPlans,
  PrescriptionTimelineRow,
  TreatmentTimelineRow,
  RtPlanLike,
  RtRecordLike,
} from '../courseTimeline';
import {
  buildTimelineWindow,
  toIsoDate,
  HISTORY_WINDOW_DAYS,
  TimelineZoom,
  TimelineDayColumn,
} from '../timelineWindow';
import { loadTimelinePrefs, saveTimelinePrefs, TimelinePrefs } from '../timelinePrefs';

interface ServicesManagerLike {
  services: Record<string, any>;
}
export interface CourseTimelinePanelProps {
  servicesManager: ServicesManagerLike;
}

// ---- Layout constants ----

/** Pixels per day column, per zoom level (week = zoomed in, month = out). */
const DAY_WIDTH: Record<TimelineZoom, number> = { week: 24, month: 8 };
/** Axis + lane rows virtualize only above this column count (see module doc). */
const VIRTUALIZATION_THRESHOLD = 400;
/** Extra columns mounted on each side of the scroll viewport. */
const OVERSCAN_COLUMNS = 40;
/** Fallback viewport width before first measure (also jsdom in tests). */
const FALLBACK_VIEWPORT_WIDTH = 800;
const AXIS_HEIGHT = 30;
const LANE_HEIGHT = 26;
const PRESCRIPTION_COLOR = '#5acce6';
const TREATMENT_COLOR = '#7bb662';

function collect(displaySetService: any): { plans: RtPlanLike[]; records: RtRecordLike[] } {
  const all = displaySetService?.getActiveDisplaySets?.() ?? displaySetService?.activeDisplaySets ?? [];
  const plans: RtPlanLike[] = [];
  const records: RtRecordLike[] = [];
  for (const ds of all as any[]) {
    if (ds?.rtPlan) plans.push(ds.rtPlan);
    if (ds?.rtRecord) records.push(ds.rtRecord);
  }
  return { plans, records };
}

const num = (v?: number, d = 1) => (v == null ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(d));
/** DICOM TM (HHMMSS[.frac]) → HH:MM. */
const fmtTime = (t?: string) => (t && t.length >= 4 ? `${t.slice(0, 2)}:${t.slice(2, 4)}` : undefined);

/** Bucket rows by ISO event day (rows without a parsable date are dropped). */
function byDay<T extends { date?: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const iso = toIsoDate(row.date);
    if (!iso) continue;
    const bucket = map.get(iso);
    if (bucket) bucket.push(row);
    else map.set(iso, [row]);
  }
  return map;
}

// ---- Small header widgets (plain elements — no new UI lib) ----

function Dropdown({
  label,
  dataCy,
  children,
}: {
  label: string;
  dataCy: string;
  children: React.ReactNode;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        data-cy={dataCy}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen(o => !o)}
        className="rounded border border-white/20 px-2 py-0.5 text-xs hover:bg-white/10"
      >
        {label} ▾
      </button>
      {open && (
        <>
          {/* click-away backdrop */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-20 mt-1 w-60 rounded border border-white/20 bg-black p-2 shadow-lg">
            {children}
          </div>
        </>
      )}
    </div>
  );
}

function CheckboxRow({
  label,
  checked,
  onChange,
  dataCy,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  dataCy: string;
}): React.ReactElement {
  return (
    <label className="flex cursor-pointer items-center gap-2 py-1 text-xs">
      <input
        type="checkbox"
        data-cy={dataCy}
        checked={checked}
        onChange={e => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

interface SelectedDay {
  date: string;
  lines: string[];
}

export function CourseTimelinePanel({ servicesManager }: CourseTimelinePanelProps): React.ReactElement {
  const { t, i18n } = useTranslation('RTMedical');
  const displaySetService = servicesManager?.services?.displaySetService;
  const [data, setData] = useState(() => collect(displaySetService));

  useEffect(() => {
    if (!displaySetService?.subscribe) return undefined;
    const resync = () => setData(collect(displaySetService));
    resync();
    const events = displaySetService.EVENTS ?? {};
    const subs = [events.DISPLAY_SETS_ADDED, events.DISPLAY_SETS_CHANGED, events.DISPLAY_SETS_REMOVED]
      .filter(Boolean)
      .map((e: string) => displaySetService.subscribe(e, resync));
    return () => subs.forEach((s: any) => s?.unsubscribe?.());
  }, [displaySetService]);

  // ---- Preferences (RTV-174/175) — loaded once, saved on every change ----
  const [prefs, setPrefs] = useState<TimelinePrefs>(() => loadTimelinePrefs());
  const updatePrefs = useCallback((patch: Partial<TimelinePrefs>) => {
    setPrefs(prev => {
      const next = { ...prev, ...patch };
      saveTimelinePrefs(next);
      return next;
    });
  }, []);

  // Per-course, non-persisted view state.
  const [completeHistory, setCompleteHistory] = useState(false); // RTV-176
  const [anchorDate, setAnchorDate] = useState<string | undefined>(undefined); // RTV-175
  const [collapsedLanes, setCollapsedLanes] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<SelectedDay | null>(null);

  // ---- Course model ----
  const timeline = useMemo(() => buildCourseTimeline(data.plans, data.records), [data]);
  const prescriptionRows = useMemo(
    () => buildPrescriptionTimeline(filterPlans(data.plans, prefs)),
    [data.plans, prefs]
  );
  const prescriptionsByDay = useMemo(() => byDay(prescriptionRows), [prescriptionRows]);
  const treatmentsByDay = useMemo(() => byDay(timeline.treatment), [timeline.treatment]);

  const eventDates = useMemo(
    () => [...prescriptionsByDay.keys(), ...treatmentsByDay.keys()],
    [prescriptionsByDay, treatmentsByDay]
  );
  const range = useMemo(() => {
    let first: string | undefined;
    let last: string | undefined;
    for (const iso of eventDates) {
      if (!first || iso < first) first = iso;
      if (!last || iso > last) last = iso;
    }
    return { firstDate: first, lastDate: last };
  }, [eventDates]);

  const win = useMemo(
    () =>
      buildTimelineWindow(range, eventDates, {
        workWeekOnly: prefs.workWeekOnly,
        hideEmptyWeeks: prefs.hideEmptyWeeks,
        completeHistory,
        zoom: prefs.zoom,
        anchorDate,
      }),
    [range, eventDates, prefs.workWeekOnly, prefs.hideEmptyWeeks, prefs.zoom, completeHistory, anchorDate]
  );

  const undatedCount = useMemo(
    () =>
      prescriptionRows.filter(r => !toIsoDate(r.date)).length +
      timeline.treatment.filter(r => !toIsoDate(r.date)).length,
    [prescriptionRows, timeline.treatment]
  );

  // ---- Horizontal virtualization (manual scrollLeft windowing, RTV-176) ----
  const dayWidth = DAY_WIDTH[prefs.zoom];
  const totalDays = win.visibleDays.length;
  const totalWidth = totalDays * dayWidth;
  const scrollRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const [viewport, setViewport] = useState({ left: 0, width: 0 });

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (el) setViewport({ left: el.scrollLeft, width: el.clientWidth });
  }, []);

  const onScroll = useCallback(() => {
    if (rafRef.current != null || typeof requestAnimationFrame !== 'function') {
      if (rafRef.current == null) measure();
      return;
    }
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = undefined;
      measure();
    });
  }, [measure]);

  // Re-attach when the scroll container APPEARS (the panel may mount on the
  // empty state before display sets arrive — review M1) and cancel any
  // pending rAF on teardown (review N1).
  const hasColumns = win.visibleDays.length > 0;
  useEffect(() => {
    measure();
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (rafRef.current != null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = undefined;
      }
    };
  }, [measure, hasColumns]);

  // Scroll to the picked date (RTV-175) — anchorIndex is the nearest column.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || win.anchorIndex == null) return;
    const width = el.clientWidth || FALLBACK_VIEWPORT_WIDTH;
    el.scrollLeft = Math.max(0, win.anchorIndex * dayWidth - width / 2 + dayWidth / 2);
    measure();
    // anchorDate is a dep so re-picking a date that snaps to the SAME column
    // still recenters the view (review M4).
  }, [win.anchorIndex, anchorDate, dayWidth, measure]);

  const virtualize = totalDays > VIRTUALIZATION_THRESHOLD;
  const viewWidth = viewport.width || FALLBACK_VIEWPORT_WIDTH;
  const startIdx = virtualize
    ? Math.max(0, Math.floor(viewport.left / dayWidth) - OVERSCAN_COLUMNS)
    : 0;
  const endIdx = virtualize
    ? Math.min(totalDays, Math.ceil((viewport.left + viewWidth) / dayWidth) + OVERSCAN_COLUMNS)
    : totalDays;
  const columns = useMemo(() => {
    const cols: { day: TimelineDayColumn; index: number }[] = [];
    for (let i = startIdx; i < endIdx; i++) {
      cols.push({ day: win.visibleDays[i], index: i });
    }
    return cols;
  }, [win.visibleDays, startIdx, endIdx]);

  // ---- Labels & tooltips ----
  const monthLabel = useCallback(
    (iso: string) => {
      try {
        return new Date(`${iso}T00:00:00Z`).toLocaleDateString(i18n?.language || undefined, {
          month: 'short',
          year: '2-digit',
          timeZone: 'UTC',
        });
      } catch {
        return iso.slice(0, 7);
      }
    },
    [i18n?.language]
  );

  const planTooltip = useCallback(
    (p: PrescriptionTimelineRow) =>
      [
        p.phase,
        p.fractions != null
          ? `${p.fractions} fx × ${num(p.dosePerFractionGy)} Gy/fx = ${num(p.totalDoseGy)} Gy`
          : undefined,
        [p.energy, p.technique].filter(Boolean).join(' · ') || undefined,
        [p.approvalStatus, p.planIntent].filter(Boolean).join(' · ') || undefined,
      ]
        .filter(Boolean)
        .join('\n'),
    []
  );

  const treatmentTooltip = useCallback(
    (r: TreatmentTimelineRow) =>
      [
        [toIsoDate(r.date) ?? '—', fmtTime(r.time)].filter(Boolean).join(' '),
        r.fraction != null ? `Fx ${r.fraction}` : undefined,
        r.machine,
        `${r.beams} ${t('tl_hdr_beams')}`,
        r.deliveredMeterset != null ? `${num(r.deliveredMeterset)} MU` : undefined,
      ]
        .filter(Boolean)
        .join('\n'),
    [t]
  );

  const renderEventCells = useCallback(
    <T,>(
      dayMap: Map<string, T[]>,
      color: string,
      dataCy: string,
      tooltipOf: (row: T) => string
    ) =>
      columns.map(({ day, index }) => {
        const events = dayMap.get(day.date);
        if (!events?.length) return null;
        const lines = events.map(tooltipOf);
        return (
          <button
            key={day.date}
            type="button"
            data-cy={dataCy}
            title={lines.join('\n\n')}
            onClick={() => setSelected({ date: day.date, lines })}
            className="absolute rounded-sm hover:opacity-80"
            style={{
              left: index * dayWidth + 1,
              top: 4,
              width: Math.max(dayWidth - 2, 4),
              height: LANE_HEIGHT - 8,
              backgroundColor: color,
            }}
          >
            {events.length > 1 && prefs.zoom === 'week' ? (
              <span className="text-black" style={{ fontSize: 9 }}>
                {events.length}
              </span>
            ) : null}
          </button>
        );
      }),
    [columns, dayWidth, prefs.zoom]
  );

  // ---- Lane list (Fig. 10 order) ----
  const lanes = useMemo(
    () =>
      [
        {
          id: 'prescriptions',
          labelKey: 'tl_lane_prescriptions',
          count: prescriptionRows.length,
          render: () =>
            renderEventCells(prescriptionsByDay, PRESCRIPTION_COLOR, 'rt-tl-presc-event', planTooltip),
          emptyNote:
            prescriptionRows.length === 0 && data.plans.length > 0
              ? t('tl_all_plans_filtered')
              : undefined,
        },
        {
          id: 'treatments',
          labelKey: 'tl_lane_treatments',
          count: timeline.treatment.length,
          render: () =>
            renderEventCells(treatmentsByDay, TREATMENT_COLOR, 'rt-tl-tx-event', treatmentTooltip),
        },
        // Honest placeholders — data pending PACS/backend integration.
        { id: 'imaging', labelKey: 'tl_lane_imaging', ticket: 'RTV-167' },
        { id: 'overrides', labelKey: 'tl_lane_overrides', ticket: 'RTV-168' },
        { id: 'trends', labelKey: 'tl_lane_trends', ticket: 'RTV-169' },
      ] as {
        id: string;
        labelKey: string;
        count?: number;
        ticket?: string;
        render?: () => React.ReactNode;
        emptyNote?: string;
      }[],
    [
      prescriptionRows.length,
      timeline.treatment.length,
      prescriptionsByDay,
      treatmentsByDay,
      renderEventCells,
      planTooltip,
      treatmentTooltip,
      data.plans.length,
      t,
    ]
  );

  if (!timeline.prescription.length && !timeline.treatment.length) {
    return (
      <div className="text-muted-foreground px-2 py-4 text-sm" data-cy="rt-timeline-panel">
        {t('tl_empty')}
      </div>
    );
  }

  const { summary } = timeline;
  const notes = [
    win.truncated ? t('tl_truncated_note', { days: win.windowDays }) : null,
    win.weeksHidden > 0 ? t('tl_weeks_hidden', { count: win.weeksHidden }) : null,
    undatedCount > 0 ? t('tl_undated', { count: undatedCount }) : null,
  ].filter(Boolean) as string[];
  const fmtIso = (d?: string) => toIsoDate(d) ?? '—';
  const gridBackground = `repeating-linear-gradient(90deg, transparent 0px, transparent ${dayWidth - 1}px, rgba(255,255,255,0.06) ${dayWidth - 1}px, rgba(255,255,255,0.06) ${dayWidth}px)`;

  return (
    <div className="flex h-full flex-col px-2 py-2 text-sm text-white" data-cy="rt-timeline-panel">
      <span className="mb-1 text-base font-medium">{t('tl_title')}</span>
      <div className="text-muted-foreground mb-2 text-xs">
        {t('tl_summary_plans', { count: summary.plans })} · {t('tl_summary_sessions', { count: summary.sessions })}
        {summary.totalDeliveredMeterset != null ? ` · ${t('tl_summary_delivered', { mu: num(summary.totalDeliveredMeterset) })}` : ''}
        {summary.firstTreatmentDate ? ` · ${fmtIso(summary.firstTreatmentDate)} → ${fmtIso(summary.lastTreatmentDate)}` : ''}
      </div>

      {/* ---- Controls: calendar options (RTV-175), plan filter (RTV-174), zoom, complete history (RTV-176) ---- */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Dropdown label={t('tl_calendar_options')} dataCy="rt-tl-calendar-options">
          <CheckboxRow
            dataCy="rt-tl-workweek"
            label={t('tl_show_work_week')}
            checked={prefs.workWeekOnly}
            onChange={v => updatePrefs({ workWeekOnly: v })}
          />
          <CheckboxRow
            dataCy="rt-tl-hide-empty"
            label={t('tl_hide_empty_weeks')}
            checked={prefs.hideEmptyWeeks}
            onChange={v => updatePrefs({ hideEmptyWeeks: v })}
          />
          <label className="flex items-center gap-2 py-1 text-xs">
            <span>{t('tl_go_to_date')}</span>
            <input
              type="date"
              data-cy="rt-tl-datepicker"
              className="rounded border border-white/20 bg-transparent px-1 text-white"
              value={anchorDate ?? ''}
              onChange={e => setAnchorDate(e.target.value || undefined)}
            />
          </label>
        </Dropdown>

        <Dropdown label={t('tl_plan_filter')} dataCy="rt-tl-plan-filter">
          <CheckboxRow
            dataCy="rt-tl-filter-verification"
            label={t('tl_show_verification')}
            checked={prefs.showVerification}
            onChange={v => updatePrefs({ showVerification: v })}
          />
          <CheckboxRow
            dataCy="rt-tl-filter-approved"
            label={t('tl_show_approved')}
            checked={prefs.showApproved}
            onChange={v => updatePrefs({ showApproved: v })}
          />
          <CheckboxRow
            dataCy="rt-tl-filter-unapproved"
            label={t('tl_show_unapproved')}
            checked={prefs.showUnapproved}
            onChange={v => updatePrefs({ showUnapproved: v })}
          />
        </Dropdown>

        <div className="flex items-center gap-1">
          <button
            type="button"
            data-cy="rt-tl-zoom-out"
            title={t('tl_zoom_out')}
            disabled={prefs.zoom === 'month'}
            onClick={() => updatePrefs({ zoom: 'month' })}
            className="rounded border border-white/20 px-2 py-0.5 text-xs hover:bg-white/10 disabled:opacity-40"
          >
            −
          </button>
          <button
            type="button"
            data-cy="rt-tl-zoom-in"
            title={t('tl_zoom_in')}
            disabled={prefs.zoom === 'week'}
            onClick={() => updatePrefs({ zoom: 'week' })}
            className="rounded border border-white/20 px-2 py-0.5 text-xs hover:bg-white/10 disabled:opacity-40"
          >
            +
          </button>
        </div>

        {/* RTV-176 — only offered when the course span exceeds the window. */}
        {win.spanDays > HISTORY_WINDOW_DAYS && (
          <CheckboxRow
            dataCy="rt-tl-complete-history"
            label={t('tl_complete_history')}
            checked={completeHistory}
            onChange={setCompleteHistory}
          />
        )}
      </div>

      {notes.length > 0 && (
        <div className="text-muted-foreground mb-1 text-xs">{notes.join(' · ')}</div>
      )}

      {/* ---- Shared-axis lanes ---- */}
      {win.visibleDays.length === 0 ? (
        <div className="text-muted-foreground text-xs">
          {timeline.prescriptions.length > 0 || (data?.plans?.length ?? 0) > 0
            ? prescriptionRows.length === 0 && (data?.plans?.length ?? 0) > 0
              ? t('tl_all_plans_filtered')
              : t('tl_no_dates')
            : t('tl_no_dates')}
        </div>
      ) : (
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="ohif-scrollbar min-h-0 flex-1 overflow-auto"
          data-cy="rt-tl-scroll"
        >
          <div style={{ width: totalWidth, minWidth: '100%' }}>
            {/* Calendar axis */}
            <div className="relative border-b border-white/20" style={{ height: AXIS_HEIGHT, width: totalWidth }}>
              {columns.map(({ day, index }) => (
                <div
                  key={day.date}
                  className={`absolute top-0 h-full ${day.isWeekStart ? 'border-l border-white/25' : ''}`}
                  style={{ left: index * dayWidth, width: dayWidth }}
                >
                  {day.isMonthStart && (
                    <span className="absolute top-0 left-0.5 whitespace-nowrap font-medium" style={{ fontSize: 10 }}>
                      {monthLabel(day.date)}
                    </span>
                  )}
                  {(prefs.zoom === 'week' || day.isWeekStart) && (
                    <span
                      className={`absolute bottom-0 left-0 w-full text-center ${day.isWeekend ? 'text-white/30' : 'text-white/60'}`}
                      style={{ fontSize: 9 }}
                    >
                      {day.dayOfMonth}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {lanes.map(lane => {
              const collapsed = !!collapsedLanes[lane.id];
              return (
                <div key={lane.id} className="border-b border-white/10">
                  <div className="sticky left-0 z-10 w-max py-0.5 pr-2">
                    <button
                      type="button"
                      data-cy={`rt-tl-lane-${lane.id}`}
                      aria-expanded={!collapsed}
                      title={collapsed ? t('tl_expand_lane') : t('tl_collapse_lane')}
                      onClick={() =>
                        setCollapsedLanes(prev => ({ ...prev, [lane.id]: !prev[lane.id] }))
                      }
                      className="flex items-center gap-1 text-xs"
                    >
                      <span className="text-muted-foreground">{collapsed ? '▸' : '▾'}</span>
                      <span className="font-medium">{t(lane.labelKey)}</span>
                      {lane.count != null && <span className="text-muted-foreground">({lane.count})</span>}
                    </button>
                  </div>
                  {!collapsed &&
                    (lane.render ? (
                      <>
                        <div
                          className="relative"
                          style={{ height: LANE_HEIGHT, width: totalWidth, backgroundImage: gridBackground }}
                        >
                          {lane.render()}
                        </div>
                        {lane.emptyNote && (
                          <div className="text-muted-foreground sticky left-0 w-max px-4 pb-1 text-xs">
                            {lane.emptyNote}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-muted-foreground sticky left-0 w-max px-4 pb-1 text-xs italic">
                        {t('tl_lane_placeholder', { ticket: lane.ticket })}
                      </div>
                    ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Clicked-event detail (tooltip content, persistent) */}
      {selected && (
        <div className="mt-2 border-t border-white/20 pt-1 text-xs" data-cy="rt-tl-event-detail">
          <div className="flex items-center justify-between">
            <span className="font-medium">{selected.date}</span>
            <button
              type="button"
              className="text-muted-foreground hover:text-white"
              onClick={() => setSelected(null)}
              aria-label={t('tl_close_detail')}
            >
              ✕
            </button>
          </div>
          {selected.lines.map((line, i) => (
            <div key={i} className="text-muted-foreground whitespace-pre-wrap border-t border-white/5 py-0.5">
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default CourseTimelinePanel;
