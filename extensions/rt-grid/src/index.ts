/**
 * @ohif/extension-rt-grid
 *
 * Reference grid over the image (RTV-142) — the migration of the legacy
 * connectviewer `DrawGridTool` + `MoveGridTool` + `grid_tool` store.
 *
 * Spacing is in millimetres, so the grid means the same thing at any zoom and on
 * any series. Pure model + pure SVG builder + thin command glue; nothing here
 * imports `@ohif/core` or `@cornerstonejs/core`.
 *
 * Follows RTV-114 (extension-first, zero fork).
 */
export * from './grid';
export * from './gridOverlay';
export { createGridActions } from './getCommandsModule';

import getCommandsModule from './getCommandsModule';

const id = '@ohif/extension-rt-grid';

const rtGridExtension = {
  id,
  getCommandsModule,
};

export { id };
export default rtGridExtension;
