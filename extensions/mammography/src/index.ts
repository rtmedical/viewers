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
 *
 * RTV-76 adds **breast tomosynthesis (DBT)**: detection of the multi-frame MG
 * stacks and the four-up hanging protocol (CC over MLO, right breast on the
 * viewer's left) with slice and window/level synchronised across the tiles.
 */
export * from './birads';
export * from './dbt';
export { dbtProtocol, dbtProtocols, DBT_PROTOCOL_ID, dbtViewportLabels } from './dbtProtocol';
export * from './mammographyCadSr';
export * from './srExport';
export { getCustomizationModule } from './getCustomizationModule';
export { getCommandsModule } from './getCommandsModule';

import getCustomizationModule from './getCustomizationModule';
import getCommandsModule from './getCommandsModule';
import getPanelModule from './getPanelModule';
import getHangingProtocolModule from './getHangingProtocolModule';

const id = '@ohif/extension-mammography';

const mammographyExtension = {
  id,
  getCustomizationModule,
  getCommandsModule,
  getPanelModule,
  getHangingProtocolModule,
};

export default mammographyExtension;
