/**
 * Course Timeline user preferences (RTV-174/175/176) — persisted per
 * user/workstation in `localStorage` under {@link TIMELINE_PREFS_KEY}.
 *
 * Deliberately `localStorage` (the ToolGroupService persistence pattern)
 * rather than `customizationService`: these are *personal* viewing preferences
 * (work week, empty weeks, plan filters, zoom) that must survive reloads per
 * browser profile/workstation, not deployment-level customizations a mode
 * ships. All storage access is try/catch-guarded so private-browsing or
 * storage-disabled environments degrade to the defaults silently.
 *
 * Note: "Display complete history" (RTV-176) is intentionally NOT persisted —
 * it is a per-course escape hatch, not a standing preference.
 */
import { TimelineZoom } from './timelineWindow';

export const TIMELINE_PREFS_KEY = 'rt-summary-timeline-prefs';

export interface TimelinePrefs {
  /** RTV-175 "Show work week" — hide event-less weekends. */
  workWeekOnly: boolean;
  /** RTV-175 "Hide empty weeks" (default ON). */
  hideEmptyWeeks: boolean;
  /** RTV-174 "Show Verification Plans" (PlanIntent = VERIFICATION). */
  showVerification: boolean;
  /** RTV-174 "Show Approved Plans" (ApprovalStatus = APPROVED). */
  showApproved: boolean;
  /** RTV-174 "Show Unapproved Plans" (any non-APPROVED ApprovalStatus). */
  showUnapproved: boolean;
  /** Axis density (px/day + label granularity). */
  zoom: TimelineZoom;
}

export const DEFAULT_TIMELINE_PREFS: TimelinePrefs = {
  workWeekOnly: false,
  hideEmptyWeeks: true,
  showVerification: true,
  showApproved: true,
  showUnapproved: true,
  zoom: 'week',
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const BOOLEAN_KEYS = [
  'workWeekOnly',
  'hideEmptyWeeks',
  'showVerification',
  'showApproved',
  'showUnapproved',
] as const;

function defaultStorage(): StorageLike | undefined {
  return typeof window !== 'undefined' ? window.localStorage : undefined;
}

/**
 * Load persisted prefs, merged over the defaults. Unknown/ill-typed fields are
 * ignored; corrupt JSON or unavailable storage yields the defaults.
 */
export function loadTimelinePrefs(storage: StorageLike | undefined = defaultStorage()): TimelinePrefs {
  const prefs: TimelinePrefs = { ...DEFAULT_TIMELINE_PREFS };
  try {
    const raw = storage?.getItem(TIMELINE_PREFS_KEY);
    if (!raw) {
      return prefs;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return prefs;
    }
    for (const key of BOOLEAN_KEYS) {
      if (typeof parsed[key] === 'boolean') {
        prefs[key] = parsed[key];
      }
    }
    if (parsed.zoom === 'week' || parsed.zoom === 'month') {
      prefs.zoom = parsed.zoom;
    }
  } catch {
    // ignore corrupt localStorage / storage disabled — defaults win
  }
  return prefs;
}

/** Persist prefs; failures (quota, private mode) are silently ignored. */
export function saveTimelinePrefs(
  prefs: TimelinePrefs,
  storage: StorageLike | undefined = defaultStorage()
): void {
  try {
    storage?.setItem(TIMELINE_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore — persistence is best-effort
  }
}
