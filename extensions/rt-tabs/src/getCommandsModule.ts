/**
 * Study-tab commands (RTV-41).
 *
 * Thin wrappers over the zustand store so the toolbar, a hotkey binding registered
 * through OHIF's own hotkey service, or another extension can drive the tab bar
 * without importing the store. Every decision lives in the pure model.
 */
import { useStudyTabsStore } from './useStudyTabsStore';
import type { OpenTabInput } from './tabsModel';

interface ServicesManagerLike {
  services: Record<string, any>;
}

function getCommandsModule({ servicesManager }: { servicesManager?: ServicesManagerLike } = {}) {
  const notify = (message: string) => {
    servicesManager?.services?.uiNotificationService?.show?.({
      title: 'Study tabs',
      message,
      type: 'warning',
    });
  };

  const store = () => useStudyTabsStore.getState();

  const actions = {
    /** Opens (or re-activates) a study tab. */
    rtTabsOpenStudy: (input: OpenTabInput) => {
      const outcome = store().openStudy(input);
      if (outcome === 'rejected') {
        const reason = store().lastError;
        if (reason) {
          notify(reason);
        }
      }
      return outcome;
    },

    /** Closes a tab, or the active one when no id is given. */
    rtTabsClose: ({ tabId }: { tabId?: string } = {}) => {
      const state = store();
      const target = tabId ?? state.activeTabId;
      if (!target) {
        return false;
      }
      state.close(target);
      return true;
    },

    rtTabsCloseOthers: ({ tabId }: { tabId?: string } = {}) => {
      const state = store();
      const target = tabId ?? state.activeTabId;
      if (!target) {
        return false;
      }
      state.closeOthers(target);
      return true;
    },

    rtTabsCloseAll: () => {
      store().closeEverything();
      return true;
    },

    /** Activates by 1-based position, matching the Alt+1…9 bindings. */
    rtTabsSelect: ({ position }: { position?: number } = {}) => {
      if (!Number.isFinite(position as number)) {
        return false;
      }
      store().activateAt(position as number);
      return true;
    },

    rtTabsNext: () => {
      store().cycle(1);
      return true;
    },

    rtTabsPrevious: () => {
      store().cycle(-1);
      return true;
    },

    /** Stores an opaque per-tab snapshot (viewport/measurement state). */
    rtTabsSaveSnapshot: ({ tabId, snapshot }: { tabId?: string; snapshot?: unknown } = {}) => {
      const state = store();
      const target = tabId ?? state.activeTabId;
      if (!target) {
        return false;
      }
      state.saveSnapshot(target, snapshot);
      return true;
    },
  };

  const definitions = Object.keys(actions).reduce(
    (acc, name) => {
      acc[name] = { commandFn: actions[name as keyof typeof actions], storeContexts: [], options: {} };
      return acc;
    },
    {} as Record<string, { commandFn: unknown; storeContexts: string[]; options: Record<string, never> }>
  );

  return { actions, definitions, defaultContext: 'VIEWER' };
}

export default getCommandsModule;
