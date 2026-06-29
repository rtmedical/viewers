/**
 * @ohif/extension-mammography
 *
 * Mammography / BI-RADS support for OHIF v3 (RTV-78): a structured ACR BI-RADS®
 * (5th ed.) reporting form + finding labels for annotation tools. Follows
 * RTV-114 (extension-first / zero fork).
 *
 * Scope: the BI-RADS model, report builder, form panel and measurement labels
 * are delivered. Drawing finding markers on the image (overlay) and DICOM SR
 * (TID 2000) export are viewport/SR follow-ups.
 */
export * from './birads';
export { getCustomizationModule } from './getCustomizationModule';

import getCustomizationModule from './getCustomizationModule';
import getPanelModule from './getPanelModule';

const id = '@ohif/extension-mammography';

const mammographyExtension = {
  id,
  getCustomizationModule,
  getPanelModule,
};

export default mammographyExtension;
