/**
 * @ohif/extension-cad
 *
 * CAD (Computer-Aided Detection) support for OHIF v3 (RTV-79): a client-side
 * CAD Structured Report parser (Mammography/Chest CAD SR) + a findings panel.
 * Follows RTV-114 (extension-first / zero fork). The CAD SR SOP classes are not
 * claimed by cornerstone-dicom-sr, so registering a handler here is not a
 * duplicate.
 *
 * Scope: parser + handler + findings panel delivered. Drawing finding markers as
 * an image overlay is a cornerstone-viewport follow-up.
 */
export * from './cadSr';
export { getSopClassHandlerModule } from './getSopClassHandlerModule';

import getSopClassHandlerModule from './getSopClassHandlerModule';
import getPanelModule from './getPanelModule';

const id = '@ohif/extension-cad';

const cadExtension = {
  id,
  getSopClassHandlerModule,
  getPanelModule,
};

export default cadExtension;
