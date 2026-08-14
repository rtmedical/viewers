/**
 * @ohif/extension-rt-mr-quant
 *
 * MR-quantitative display for OHIF v3:
 *
 * - **RTV-83 — Dixon fat/water.** Detects the fat / water / in-phase /
 *   out-of-phase reconstructions of a Dixon acquisition from ImageType and
 *   SeriesDescription, and hangs them 2x2 with slice and window/level
 *   synchronised.
 * - **RTV-82 — parametric maps.** Perceptually-uniform colour LUTs (viridis,
 *   magma, inferno, plasma, grayscale), an adjustable display range with the
 *   window/level equivalence, a transparency threshold for overlaying anatomy,
 *   and unit-aware readouts for ADC / CBV / CBF / MTT / TTP.
 *
 * The cores are pure, framework-free and unit-tested; the panel and commands are
 * a thin layer on top. Follows RTV-114 (extension-first, zero fork): the colour
 * ramps are handed to Cornerstone3D as colormap *presets* rather than by editing
 * `extensions/cornerstone/src/utils/colormaps.js`, which is a fork-forbidden
 * package.
 *
 * Scope: compositing a parametric volume as a semi-transparent second layer over
 * anatomy is a cornerstone integration follow-up — see the note in
 * `getCommandsModule`. The pure colour/alpha mapping it needs
 * (`mapValueToRgba`) is already here and unit-tested.
 */
export * from './dixon';
export * from './parametricLut';
export * from './parametricRange';
export { dixonProtocol, dixonProtocols, DIXON_PROTOCOL_ID } from './hangingProtocols/dixonProtocol';
export { ParametricMapPanel } from './getPanelModule/ParametricMapPanel';

import getCommandsModule from './getCommandsModule';
import getHangingProtocolModule from './getHangingProtocolModule';
import getPanelModule from './getPanelModule';

const id = '@ohif/extension-rt-mr-quant';

const rtMrQuantExtension = {
  id,
  getCommandsModule,
  getHangingProtocolModule,
  getPanelModule,
};

export { id };
export default rtMrQuantExtension;
