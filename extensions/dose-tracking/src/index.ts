/**
 * @ohif/extension-dose-tracking
 *
 * Radiation Dose SR (RDSR) support for OHIF v3 (RTV-201). Registers a
 * SopClassHandler for the Radiation Dose SR SOP classes (no native handler
 * claims them) and a Dose Report panel with per-acquisition CTDIvol/DLP/kVp,
 * accumulated totals, DRL comparison and CSV export. Follows RTV-114
 * (extension-first / zero fork; no `@ohif/core`).
 */
export * from './rdsrParser';
export { getSopClassHandlerModule } from './getSopClassHandlerModule';

import getSopClassHandlerModule from './getSopClassHandlerModule';
import getPanelModule from './getPanelModule';

const id = '@ohif/extension-dose-tracking';

const doseTrackingExtension = {
  id,
  getSopClassHandlerModule,
  getPanelModule,
};

export default doseTrackingExtension;
