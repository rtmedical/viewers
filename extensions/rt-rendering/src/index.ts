/**
 * @ohif/extension-rt-rendering
 *
 * Advanced rendering for OHIF v3.
 *
 * - **SSD — Surface Shaded Display** (RTV-17): the isosurface at a density threshold
 *   that RT uses for skeletal and skin-envelope views.
 * - **DSA — Digital Subtraction Angiography** (RTV-65): pre-contrast mask subtraction,
 *   with the window/level the signed result actually needs.
 * - **CPR — Curved Planar Reformation** (RTV-14, RTV-61): arc-length centerline
 *   resampling, rotation-minimising frames, and the three Kanitsar modes.
 *
 * What it does NOT contain: marching cubes and an STL writer. vtk.js ships
 * `vtkImageMarchingCubes` and `STLWriter`, both bundled. What was missing — and what
 * lives here — is the clinical part (which threshold, in what colour) and the
 * pre-flight that keeps a 105-million-voxel CT from locking the tab.
 *
 * Follows RTV-114 (extension-first, zero fork).
 */
export * from './ssdPresets';
export * from './ssdBudget';
export * from './dsa';
export * from './centerline';
export * from './cpr';
export { createSsdActions, SSD_ACTOR_UID } from './getCommandsModule';

import getCommandsModule from './getCommandsModule';

const id = '@ohif/extension-rt-rendering';

const rtRenderingExtension = { id, getCommandsModule };

export { id };
export default rtRenderingExtension;
