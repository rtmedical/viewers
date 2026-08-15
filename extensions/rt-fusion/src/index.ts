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
 *
 * RTV-134 adds the Fusion modal cores: fusionRegistration.ts (isocenter
 * alignment, rotation about a centre of rotation, rigid inverse) and
 * fusionSession.ts (pair validation and step flow, including skipping the
 * isocenter step when the two series already share a Frame of Reference, and
 * the Spatial Registration draft to STOW back). The modal component itself,
 * the composited preview and the STOW-RS call are integration follow-ups.
 *
 * RTV-205 adds followUpRegistration.ts for oncological follow-up: which
 * transform may be measured through (rigid yes, deformable never), the
 * Jacobian check that says where the transform did the volume work being
 * measured, and global-versus-local similarity reported separately rather than
 * averaged.
 */
export * from './fusionConfig';
export * from './fusionTools';
export * from './fusionRegistration';
export * from './fusionSession';
export * from './followUpRegistration';

import getPanelModule from './getPanelModule';

const id = '@ohif/extension-rt-fusion';

const rtFusionExtension = {
  id,
  getPanelModule,
};

export default rtFusionExtension;
