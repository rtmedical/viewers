/**
 * Study tabs state model — pure core (RTV-41).
 *
 * Multi-tab inside one window: several studies open at once, each keeping its own
 * viewport/measurement state, switchable in one click or one keystroke.
 *
 * Everything that decides *what happens* lives here, framework-free and
 * unit-tested (same split as `rtmedical-theme/src/mipSlab.ts`): the zustand store
 * is a thin wrapper, and the React bar only renders. That matters because the
 * interesting behaviour of a tab bar is all edge cases — closing the active tab,
 * reopening an already-open study, restoring a corrupt session — and none of it
 * needs a DOM to verify.
 *
 * Zero-fork per RTV-114.
 */

/** How many studies may be open at once. */
export const TAB_LIMIT = 8;

/** localStorage key and schema version for the persisted session. */
export const TABS_STORAGE_KEY = 'rt.studyTabs.v1';
export const TABS_SCHEMA_VERSION = 1;

export interface StudyTab {
  /** Stable id — the StudyInstanceUID is the natural one. */
  id: string;
  /** What the tab shows: patient name, or the study description. */
  label: string;
  /** Secondary line / tooltip (accession, date, modality…). */
  sublabel?: string;
  StudyInstanceUID: string;
  /** Route to restore when the tab is activated. */
  path?: string;
  /**
   * Opaque per-tab state slot (viewport layout, measurements, …).
   *
   * The model neither reads nor interprets this — it only carries it, so the
   * shape can evolve without touching any of the logic here. Capturing and
   * restoring real OHIF service state into this slot is integration work; see
   * the README's scope note.
   */
  snapshot?: unknown;
}

export interface TabsState {
  tabs: StudyTab[];
  /** id of the active tab, or null when nothing is open. */
  activeTabId: string | null;
}

export function emptyState(): TabsState {
  return { tabs: [], activeTabId: null };
}

/** Input for opening a tab: everything but the internal bookkeeping. */
export type OpenTabInput = Omit<StudyTab, 'id'> & { id?: string };

export interface OpenResult {
  state: TabsState;
  /** 'opened' | 'activated' (already open) | 'rejected' (limit reached). */
  outcome: 'opened' | 'activated' | 'rejected';
  reason?: string;
}

const indexOfTab = (state: TabsState, tabId: string) => state.tabs.findIndex(t => t.id === tabId);

/**
 * Opens a study in a tab.
 *
 * Reopening a study that is already open **activates the existing tab** instead of
 * duplicating it — two tabs on the same study would give the reader two divergent
 * measurement states for one patient, which is worse than useless.
 *
 * When the limit is reached the request is **rejected** rather than silently
 * evicting a tab: dropping a tab could throw away unsaved measurements.
 */
export function openTab(state: TabsState, input: OpenTabInput): OpenResult {
  const id = (input?.id ?? input?.StudyInstanceUID ?? '').trim();
  if (!id) {
    return { state, outcome: 'rejected', reason: 'A tab needs a StudyInstanceUID.' };
  }

  const existing = indexOfTab(state, id);
  if (existing !== -1) {
    return { state: { ...state, activeTabId: id }, outcome: 'activated' };
  }

  if (state.tabs.length >= TAB_LIMIT) {
    return {
      state,
      outcome: 'rejected',
      reason: `Tab limit reached (${TAB_LIMIT}). Close a study first.`,
    };
  }

  const tab: StudyTab = {
    id,
    label: input.label || input.StudyInstanceUID,
    sublabel: input.sublabel,
    StudyInstanceUID: input.StudyInstanceUID,
    path: input.path,
    snapshot: input.snapshot,
  };
  return { state: { tabs: [...state.tabs, tab], activeTabId: id }, outcome: 'opened' };
}

/**
 * Which tab should become active when `closedIndex` is removed.
 *
 * The tab to the **right**, falling back to the left — what every browser does,
 * and what keeps the reader's place when closing through a series of tabs.
 */
export function nextActiveAfterClose(tabs: StudyTab[], closedIndex: number): string | null {
  const remaining = tabs.filter((_unused, i) => i !== closedIndex);
  if (!remaining.length) {
    return null;
  }
  const candidate = remaining[Math.min(closedIndex, remaining.length - 1)];
  return candidate?.id ?? null;
}

/** Closes a tab. Closing a tab that is not open is a no-op, not an error. */
export function closeTab(state: TabsState, tabId: string): TabsState {
  const index = indexOfTab(state, tabId);
  if (index === -1) {
    return state;
  }
  const tabs = state.tabs.filter((_unused, i) => i !== index);
  const activeTabId =
    state.activeTabId === tabId ? nextActiveAfterClose(state.tabs, index) : state.activeTabId;
  return { tabs, activeTabId };
}

/** Closes every tab except one. */
export function closeOtherTabs(state: TabsState, tabId: string): TabsState {
  const keep = state.tabs.find(t => t.id === tabId);
  return keep ? { tabs: [keep], activeTabId: keep.id } : state;
}

export function closeAllTabs(): TabsState {
  return emptyState();
}

/** Activates a tab. Unknown ids are ignored so a stale hotkey cannot blank the view. */
export function activateTab(state: TabsState, tabId: string): TabsState {
  return indexOfTab(state, tabId) === -1 ? state : { ...state, activeTabId: tabId };
}

/** Activates by 1-based position, as the Ctrl+1…9 hotkeys address tabs. */
export function activateTabAt(state: TabsState, position: number): TabsState {
  const index = Math.floor(position) - 1;
  const tab = state.tabs[index];
  return tab ? { ...state, activeTabId: tab.id } : state;
}

/**
 * Cycles the active tab by `delta`, wrapping.
 * Wrapping matters: Ctrl+Tab through the last tab should land on the first, not stop.
 */
export function cycleTab(state: TabsState, delta: number): TabsState {
  if (!state.tabs.length) {
    return state;
  }
  const current = Math.max(0, indexOfTab(state, state.activeTabId ?? ''));
  const step = Math.floor(delta) || 1;
  const count = state.tabs.length;
  const next = (((current + step) % count) + count) % count;
  return { ...state, activeTabId: state.tabs[next].id };
}

/**
 * Moves a tab to a new position (drag-to-reorder).
 * Both indices are clamped, so a drag that ends off the bar cannot throw.
 */
export function moveTab(state: TabsState, fromIndex: number, toIndex: number): TabsState {
  const count = state.tabs.length;
  const from = Math.floor(fromIndex);
  if (!count || from < 0 || from >= count) {
    return state;
  }
  const to = Math.min(count - 1, Math.max(0, Math.floor(toIndex)));
  if (from === to) {
    return state;
  }
  const tabs = [...state.tabs];
  const [moved] = tabs.splice(from, 1);
  tabs.splice(to, 0, moved);
  return { ...state, tabs };
}

/** Replaces a tab's opaque snapshot, leaving order and activation alone. */
export function setTabSnapshot(state: TabsState, tabId: string, snapshot: unknown): TabsState {
  if (indexOfTab(state, tabId) === -1) {
    return state;
  }
  return { ...state, tabs: state.tabs.map(t => (t.id === tabId ? { ...t, snapshot } : t)) };
}

/** Renames a tab. Blank names are refused — an unlabelled tab is unusable. */
export function renameTab(state: TabsState, tabId: string, label: string): TabsState {
  const trimmed = String(label ?? '').trim();
  if (!trimmed || indexOfTab(state, tabId) === -1) {
    return state;
  }
  return { ...state, tabs: state.tabs.map(t => (t.id === tabId ? { ...t, label: trimmed } : t)) };
}

export function activeTab(state: TabsState): StudyTab | null {
  return state.tabs.find(t => t.id === state.activeTabId) ?? null;
}

// --- Persistence -----------------------------------------------------------

interface PersistedShape {
  version: number;
  tabs: StudyTab[];
  activeTabId: string | null;
}

/** Serialises the session for localStorage. */
export function serializeTabs(state: TabsState): string {
  const payload: PersistedShape = {
    version: TABS_SCHEMA_VERSION,
    tabs: state.tabs,
    activeTabId: state.activeTabId,
  };
  return JSON.stringify(payload);
}

/**
 * Restores a session, or an empty one.
 *
 * Deliberately paranoid: this string comes from localStorage, which survives
 * upgrades, is shared with every other app on the origin, and can be edited by
 * hand. Anything unexpected — bad JSON, a future schema version, a tabs array
 * full of junk — yields an empty session rather than a half-built one, because a
 * viewer that will not start is far worse than one that forgot yesterday's tabs.
 *
 * Malformed *entries* are dropped individually, so one bad tab does not cost the
 * whole session, and the active id is only kept if it still points at a real tab.
 */
export function deserializeTabs(raw: unknown): TabsState {
  if (typeof raw !== 'string' || !raw) {
    return emptyState();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyState();
  }

  if (!parsed || typeof parsed !== 'object') {
    return emptyState();
  }
  const shape = parsed as Partial<PersistedShape>;
  if (shape.version !== TABS_SCHEMA_VERSION || !Array.isArray(shape.tabs)) {
    return emptyState();
  }

  const seen = new Set<string>();
  const tabs: StudyTab[] = [];
  for (const candidate of shape.tabs) {
    const tab = candidate as Partial<StudyTab> | null;
    const id = typeof tab?.id === 'string' ? tab.id.trim() : '';
    const uid = typeof tab?.StudyInstanceUID === 'string' ? tab.StudyInstanceUID.trim() : '';
    if (!id || !uid || seen.has(id) || tabs.length >= TAB_LIMIT) {
      continue;
    }
    seen.add(id);
    tabs.push({
      id,
      StudyInstanceUID: uid,
      label: typeof tab?.label === 'string' && tab.label.trim() ? tab.label : uid,
      sublabel: typeof tab?.sublabel === 'string' ? tab.sublabel : undefined,
      path: typeof tab?.path === 'string' ? tab.path : undefined,
      snapshot: tab?.snapshot,
    });
  }

  const activeTabId =
    typeof shape.activeTabId === 'string' && tabs.some(t => t.id === shape.activeTabId)
      ? shape.activeTabId
      : (tabs[0]?.id ?? null);

  return { tabs, activeTabId };
}
