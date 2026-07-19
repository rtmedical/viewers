/**
 * @ohif/extension-cad
 *
 * CAD (Computer-Aided Detection) support for OHIF v3 (RTV-79): a client-side
 * CAD Structured Report parser (Mammography/Chest CAD SR), a findings panel,
 * and the finding-marker viewport overlay + navigation commands
 * (showCadFindings/hideCadFindings/toggleCadFindings/jumpToCadFinding).
 * Follows RTV-114 (extension-first / zero fork). The CAD SR SOP classes are not
 * claimed by cornerstone-dicom-sr, so registering a handler here is not a
 * duplicate.
 */
export * from './cadSr';
// Pure marker-geometry helpers (framework-free, jest-covered).
export * from './findingsGeometry';
export { getSopClassHandlerModule } from './getSopClassHandlerModule';

import getSopClassHandlerModule from './getSopClassHandlerModule';
import getPanelModule from './getPanelModule';
import getCommandsModule from './getCommandsModule';

const id = '@ohif/extension-cad';

const cadExtension = {
  id,
  getSopClassHandlerModule,
  getPanelModule,
  getCommandsModule,
};

export default cadExtension;
