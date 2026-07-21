/**
 * @ohif/extension-mammography
 *
 * Mammography / BI-RADS support for OHIF v3 (RTV-78): a structured ACR BI-RADS®
 * (5th ed.) reporting form + finding labels for annotation tools. Follows
 * RTV-114 (extension-first / zero fork).
 *
 * Scope: the BI-RADS model, report builder, form panel, measurement labels,
 * DICOM SR (TID 2000) export (RTV-37) and STOW-RS send-to-PACS (RTV-39,
 * `storeBiradsSrToPacs`) are delivered. Drawing finding markers on the image
 * (overlay) is a viewport follow-up.
 */
export * from './birads';
export * from './mammographyCadSr';
export * from './srExport';
export { getCustomizationModule } from './getCustomizationModule';
export { getCommandsModule } from './getCommandsModule';

import getCustomizationModule from './getCustomizationModule';
import getCommandsModule from './getCommandsModule';
import getPanelModule from './getPanelModule';

const id = '@ohif/extension-mammography';

const mammographyExtension = {
  id,
  getCustomizationModule,
  getCommandsModule,
  getPanelModule,
};

export default mammographyExtension;
