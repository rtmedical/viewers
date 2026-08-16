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
 * - **Multi-station stitching** (RTV-60): frame-of-reference-checked composition of
 *   overlapping angio stations, with a linear blend across the overlap.
 * - **Virtual bone removal** (RTV-63): seeded region growing rather than a
 *   global threshold, and — because a vessel that touches bone is absorbed by
 *   the grower — at-risk voxels identified by attenuation rather than by
 *   geometry.
 * - **Circle of Willis** (RTV-53): variant classification, and the collateral
 *   consequence that is the only reason to report one.
 * - **Frangi vesselness** (RTV-62): multiscale Hessian vessel enhancement,
 *   with the polarity required rather than assumed, gamma normalisation so the
 *   scales are comparable, a data-derived structureness constant, and the
 *   winning sigma returned as a caliber estimate.
 * - **VIP — Volume Intensity Projection** (RTV-16): the transmittance-weighted
 *   maximum along the ray, which is MIP with the depth cue put back. Reduces
 *   exactly to MIP as opacity goes to zero. Reference implementation for the
 *   shader, plus the three clinical presets and the frame-budget pre-flight.
 *
 * What it does NOT contain: marching cubes and an STL writer. vtk.js ships
 * `vtkImageMarchingCubes` and `STLWriter`, both bundled. What was missing — and what
 * lives here — is the clinical part (which threshold, in what colour) and the
 * pre-flight that keeps a 105-million-voxel CT from locking the tab.
 *
 * Follows RTV-114 (extension-first, zero fork).
 */
export * from './vip';
export * from './frangi';
export * from './boneRemoval';
export * from './circleOfWillis';
export * from './ssdPresets';
export * from './ssdBudget';
export * from './dsa';
export * from './centerline';
export * from './cpr';
export * from './stitching';
export { createSsdActions, SSD_ACTOR_UID } from './getCommandsModule';

import getCommandsModule from './getCommandsModule';

const id = '@ohif/extension-rt-rendering';

const rtRenderingExtension = { id, getCommandsModule };

export { id };
export default rtRenderingExtension;
