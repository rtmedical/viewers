/**
 * Study tabs zustand store (RTV-41).
 *
 * A thin wrapper: every transition is a pure function from {@link ./tabsModel}, so
 * this file holds no logic worth testing on its own — only the store wiring and the
 * localStorage side effect.
 *
 * Persistence is written by hand rather than with zustand's `persist` middleware
 * because the pure model already owns serialisation, and it must stay paranoid
 * about what comes back out of localStorage (see `deserializeTabs`). Wrapping it in
 * middleware would hide that validation behind a rehydration hook.
 */
import { create } from 'zustand';

import {
  activateTab,
  activateTabAt,
  closeAllTabs,
  closeOtherTabs,
  closeTab,
  cycleTab,
  deserializeTabs,
  emptyState,
  moveTab,
  OpenTabInput,
  openTab,
  renameTab,
  serializeTabs,
  setTabSnapshot,
  StudyTab,
  TABS_STORAGE_KEY,
  TabsState,
} from './tabsModel';

/** localStorage, or null where it is unavailable (SSR, privacy mode, quota off). */
function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    // Accessing localStorage throws outright in some privacy configurations.
    return null;
  }
}

function loadPersisted(): TabsState {
  try {
    return deserializeTabs(storage()?.getItem(TABS_STORAGE_KEY));
  } catch {
    return emptyState();
  }
}

function persist(state: TabsState): void {
  try {
    storage()?.setItem(TABS_STORAGE_KEY, serializeTabs(state));
  } catch {
    // A full quota must never break tab switching.
  }
}

export interface StudyTabsStore extends TabsState {
  /** Last rejection reason (tab limit, missing uid), for the caller to surface. */
  lastError: string | null;
  openStudy: (input: OpenTabInput) => 'opened' | 'activated' | 'rejected';
  close: (tabId: string) => void;
  closeOthers: (tabId: string) => void;
  closeEverything: () => void;
  activate: (tabId: string) => void;
  activateAt: (position: number) => void;
  cycle: (delta: number) => void;
  move: (fromIndex: number, toIndex: number) => void;
  rename: (tabId: string, label: string) => void;
  saveSnapshot: (tabId: string, snapshot: unknown) => void;
  /** Re-reads localStorage — for a second window adopting the session. */
  reload: () => void;
}

export const useStudyTabsStore = create<StudyTabsStore>()(set => {
  /** Applies a pure transition, persists, and stores it. */
  const apply = (transition: (state: TabsState) => TabsState) =>
    set(state => {
      const next = transition({ tabs: state.tabs, activeTabId: state.activeTabId });
      persist(next);
      return { ...next, lastError: null };
    });

  return {
    ...loadPersisted(),
    lastError: null,

    openStudy: input => {
      let outcome: 'opened' | 'activated' | 'rejected' = 'rejected';
      set(state => {
        const result = openTab({ tabs: state.tabs, activeTabId: state.activeTabId }, input);
        outcome = result.outcome;
        if (result.outcome !== 'rejected') {
          persist(result.state);
        }
        return { ...result.state, lastError: result.reason ?? null };
      });
      return outcome;
    },

    close: tabId => apply(state => closeTab(state, tabId)),
    closeOthers: tabId => apply(state => closeOtherTabs(state, tabId)),
    closeEverything: () => apply(() => closeAllTabs()),
    activate: tabId => apply(state => activateTab(state, tabId)),
    activateAt: position => apply(state => activateTabAt(state, position)),
    cycle: delta => apply(state => cycleTab(state, delta)),
    move: (fromIndex, toIndex) => apply(state => moveTab(state, fromIndex, toIndex)),
    rename: (tabId, label) => apply(state => renameTab(state, tabId, label)),
    saveSnapshot: (tabId, snapshot) => apply(state => setTabSnapshot(state, tabId, snapshot)),
    reload: () => set({ ...loadPersisted(), lastError: null }),
  };
});

/** Selector: the active tab, or null. */
export const selectActiveTab = (store: StudyTabsStore): StudyTab | null =>
  store.tabs.find(t => t.id === store.activeTabId) ?? null;

export default useStudyTabsStore;
