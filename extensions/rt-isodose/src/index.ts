/**
 * @ohif/extension-rt-isodose
 *
 * Isodoses + dose color maps for OHIF v3 (RTV-137). Pure dose-heat colormaps
 * (hot/jet/grayscale/rainbow) and isodose levels (as % of prescription) + a
 * config panel. Follows RTV-114 (extension-first / zero fork).
 *
 * Scope: color/level data layer + config panel (RTV-137), RTDOSE dose color
 * wash on the MPR viewports (`showDoseWash`), and vector ISODOSE LINES
 * (`showIsodoseLines`/`toggleIsodoseLines` — marching squares over the dose
 * grid sampled on each camera plane, drawn as an SVG overlay).
 */
export * from './isodose';
export * from './doseBands';
export * from './marchingSquares';
export * from './isodoseLineLevels';
export { derivePrescription } from './rxDose';
export { doseToBandLabelmapAccelerated, isDoseKernelReady } from './doseBandsWasm';

import getPanelModule from './getPanelModule';
import getCommandsModule from './getCommandsModule';

const id = '@ohif/extension-rt-isodose';

const rtIsodoseExtension = {
  id,
  getPanelModule,
  getCommandsModule,
};

export default rtIsodoseExtension;
