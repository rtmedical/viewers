/**
 * @ohif/extension-rt-fusion
 *
 * Image-fusion UI for OHIF v3 (RTV-197): a fusion config model (layers, opacity,
 * blend mode, colormap, inversion) + a config panel with a live CSS-blended
 * preview. Follows RTV-114 (extension-first / zero fork).
 *
 * Scope: config/state + preview delivered. Compositing the moving layer onto the
 * fixed layer in the cornerstone viewport (with the rt-isodose colormap LUT) is
 * an integration follow-up.
 */
export * from './fusionConfig';

import getPanelModule from './getPanelModule';

const id = '@ohif/extension-rt-fusion';

const rtFusionExtension = {
  id,
  getPanelModule,
};

export default rtFusionExtension;
