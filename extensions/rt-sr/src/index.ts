/**
 * @ohif/extension-rt-sr
 *
 * DICOM Structured Report builders for OHIF v3. Currently TID 1500 (Measurement
 * Report) — RTV-36 — as a pure naturalized-dataset builder + dcmjs Part-10
 * exporter + command. Follows RTV-114 (extension-first / zero fork). A home for
 * further SR templates (e.g. TID 3000 CAD-RADS, RTV-38).
 *
 * Scope: SR construction + Part-10 export delivered. STOW-RS push to PACS is a
 * separate backend ticket (RTV-39).
 */
export * from './measurementSr';
export * from './srExport';
export { getCommandsModule } from './getCommandsModule';

import getCommandsModule from './getCommandsModule';

const id = '@ohif/extension-rt-sr';

const rtSrExtension = {
  id,
  getCommandsModule,
};

export default rtSrExtension;
