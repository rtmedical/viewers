/**
 * @ohif/extension-deid
 *
 * DICOM de-identification for OHIF v3 (RTV-113): a pure de-id engine per PS3.15
 * Annex E Basic Profile (+ LGPD), a dcmjs Part-10 exporter, a command and a
 * policy/options panel. Follows RTV-114 (extension-first / zero fork).
 *
 * Scope: de-id engine + single-instance export + panel delivered. Whole-study
 * batch de-identification and re-import are follow-ups.
 */
export * from './deidentify';
export * from './deidExport';
export { getCommandsModule } from './getCommandsModule';

import getCommandsModule from './getCommandsModule';
import getPanelModule from './getPanelModule';

const id = '@ohif/extension-deid';

const deidExtension = {
  id,
  getCommandsModule,
  getPanelModule,
};

export default deidExtension;
