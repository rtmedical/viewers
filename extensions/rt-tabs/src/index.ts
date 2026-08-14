/**
 * @ohif/extension-rt-tabs
 *
 * Multi-tab inside one window (RTV-41): several studies open at once, each keeping
 * its own state, switchable in one click or one keystroke.
 *
 * The state model is pure and unit-tested (`tabsModel`), the zustand store is a
 * thin wrapper, and the React bar decides nothing — the same split as
 * `rtmedical-theme/src/mipSlab.ts`.
 *
 * Follows RTV-114 (extension-first, zero fork).
 */
export * from './tabsModel';
export * from './tabsHotkeys';
export { useStudyTabsStore, selectActiveTab } from './useStudyTabsStore';
export { StudyTabsBar } from './StudyTabsBar';

import getCommandsModule from './getCommandsModule';

const id = '@ohif/extension-rt-tabs';

const rtTabsExtension = {
  id,
  getCommandsModule,
};

export { id };
export default rtTabsExtension;
