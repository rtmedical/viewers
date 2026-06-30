/**
 * @ohif/extension-measurements
 *
 * Advanced measurement calculators for OHIF v3 (RTV-27 epic): HU statistics
 * (RTV-28), SUVbw (RTV-29), Cobb angle (RTV-30), Agatston calcium score
 * (RTV-46). Follows RTV-114 (extension-first / zero fork).
 *
 * Scope: the pure calculators + commands + a status panel are delivered.
 * Capturing the ROI pixels / line annotations / lesion masks from the cornerstone
 * viewport to feed them is an integration follow-up.
 */
export * from './measurements';
export { getCommandsModule } from './getCommandsModule';

import getCommandsModule from './getCommandsModule';
import getPanelModule from './getPanelModule';

const id = '@ohif/extension-measurements';

const measurementsExtension = {
  id,
  getCommandsModule,
  getPanelModule,
};

export default measurementsExtension;
