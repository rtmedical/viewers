/**
 * @ohif/extension-rt-bev — Beam's Eye View (MLC/jaws over RTIMAGE) for OHIF v3.
 *
 * Phase A (pure core): framework-free RTPLAN→BEV parser + mm→px geometry,
 * re-exported below for direct import and unit testing.
 * Phase B (viewport layer): `getCommandsModule` (showBev/hideBev/toggleBev/
 * setBevControlPoint — SVG aperture overlay on the stack viewport showing the
 * RTIMAGE) + `getPanelModule` (BEV panel: beam info + control-point slider).
 */

export const id = '@ohif/extension-rt-bev';

// Pure re-exports (framework-free, jest-covered).
export * from './rtBevParser';
export * from './bevGeometry';

import getCommandsModule from './getCommandsModule';
import getPanelModule from './getPanelModule';

const rtBevExtension = {
  id,
  getCommandsModule,
  getPanelModule,
};

export default rtBevExtension;
