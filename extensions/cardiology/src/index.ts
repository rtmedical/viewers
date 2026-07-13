/**
 * @ohif/extension-cardiology
 *
 * Cardiology tooling for OHIF v3 — AHA 17-segment bullseye polar map (RTV-48):
 * clickable segments with slice navigation, customizable perfusion color
 * scales and SVG/PNG export. Pure framework-free core (ahaBullseye.ts) + a
 * right panel. Follows RTV-114 (extension-first / zero fork).
 */
export * from './ahaBullseye';

import getPanelModule from './getPanelModule';

const id = '@ohif/extension-cardiology';

const cardiologyExtension = {
  id,
  getPanelModule,
};

export default cardiologyExtension;
