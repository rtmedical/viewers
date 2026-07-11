/**
 * @ohif/extension-rt-isodose
 *
 * Isodoses + dose color maps for OHIF v3 (RTV-137). Pure dose-heat colormaps
 * (hot/jet/grayscale/rainbow) and isodose levels (as % of prescription) + a
 * config panel. Follows RTV-114 (extension-first / zero fork).
 *
 * Scope: the color/level data layer and panel are delivered. Rendering the
 * isodose lines / dose-wash on the cornerstone viewport from the RTDOSE grid is
 * an integration follow-up.
 */
export * from './isodose';
export * from './doseBands';

import getPanelModule from './getPanelModule';

const id = '@ohif/extension-rt-isodose';

const rtIsodoseExtension = {
  id,
  getPanelModule,
};

export default rtIsodoseExtension;
