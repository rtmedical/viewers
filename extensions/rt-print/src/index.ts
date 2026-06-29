/**
 * @ohif/extension-rt-print
 *
 * RT Print panel for OHIF v3 (RTV-140): configurable print layout (A3/A4/A5 ×
 * portrait/landscape × 1×1/2×2/3×3 grid, padding/gap), preview and print
 * (Save-as-PDF for PDF export). Follows RTV-114 (extension-first / zero fork).
 *
 * Scope: the configurable layout, preview and print trigger are delivered.
 * Capturing live viewport screenshots (and embedded DVH/RTPlan) into the grid
 * zones is a cornerstone-viewport integration follow-up.
 */
export * from './printLayout';
export { getCommandsModule } from './getCommandsModule';

import getCommandsModule from './getCommandsModule';
import getPanelModule from './getPanelModule';

const id = '@ohif/extension-rt-print';

const rtPrintExtension = {
  id,
  getCommandsModule,
  getPanelModule,
};

export default rtPrintExtension;
