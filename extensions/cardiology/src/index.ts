/**
 * @ohif/extension-cardiology
 *
 * Cardiology tooling for OHIF v3 — AHA 17-segment bullseye polar map (RTV-48):
 * clickable segments with slice navigation, customizable perfusion color
 * scales and SVG/PNG export. Pure framework-free core (ahaBullseye.ts) + a
 * right panel.
 *
 * RTV-47 adds cardiacFunction.ts: ventricular volumes by summation of disks,
 * ejection fraction and myocardial mass — with the slice gap required rather
 * than defaulted, the papillary-muscle convention required rather than
 * assumed, and a cross-study comparison that refuses when the two were traced
 * under different conventions.
 *
 * RTV-50 adds cadRads.ts: percent diameter stenosis (converting from area
 * rather than assuming), the CAD-RADS 2.0 bands and modifiers, and a refusal
 * to state a stenosis through a severely calcified segment.
 *
 * Follows RTV-114 (extension-first / zero fork).
 */
export * from './ahaBullseye';
export * from './cardiacFunction';
export * from './cadRads';
export * from './coronaryTree';

import getPanelModule from './getPanelModule';

const id = '@ohif/extension-cardiology';

const cardiologyExtension = {
  id,
  getPanelModule,
};

export default cardiologyExtension;
