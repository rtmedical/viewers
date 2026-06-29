/**
 * @ohif/extension-rt-services
 *
 * Shared RT Medical services/commands for OHIF v3 (RTV-160). Currently provides
 * local-file drag-drop classification/validation commands. Follows RTV-114
 * (extension-first / zero fork).
 *
 * Scope: OHIF v3 already ingests local files natively (routes/Local/filesToStudies
 * + DicomLocalDataSource + pdfFileLoader: DICOM/PDF, multi-file, SOP-class
 * detection, progress). This extension does NOT duplicate that — it adds the
 * reusable classification layer the native route does not expose (useful to
 * validate a drag-drop set before handing it to the native ingest, e.g. in RTVW).
 */
export * from './localFileClassifier';
export { getCommandsModule } from './getCommandsModule';

import getCommandsModule from './getCommandsModule';

const id = '@ohif/extension-rt-services';

const rtServicesExtension = {
  id,
  getCommandsModule,
};

export default rtServicesExtension;
