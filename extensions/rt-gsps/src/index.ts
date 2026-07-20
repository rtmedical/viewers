/**
 * @ohif/extension-rt-gsps
 *
 * DICOM Grayscale Softcopy Presentation State (GSPS) support for OHIF v3
 * (RTV-200, Phase 1). OHIF ships no GSPS SopClassHandler, so this is a
 * net-new extension following the RTV-114 extension-first / zero-fork policy:
 * a pure GSPS IOD builder (PS3.3 A.33) + dcmjs byte glue + a pure read-side
 * parser (all unit-tested at their pure core), plus the OHIF wiring: the
 * `saveGsps`/`applyGsps` commands and the SopClassHandler that turns stored
 * GSPS objects into display sets. Modes opt in via `sopClassHandlers` and
 * toolbar buttons.
 */
export * from './gspsDataset';
export * from './gspsSerialize';
export * from './parseGspsInstance';

export { getCommandsModule } from './getCommandsModule';
export { getSopClassHandlerModule, SOP_CLASS_HANDLER_ID } from './getSopClassHandlerModule';

import { getCommandsModule } from './getCommandsModule';
import getSopClassHandlerModule from './getSopClassHandlerModule';

const id = '@ohif/extension-rt-gsps';

const rtGspsExtension = {
  id,
  getCommandsModule,
  getSopClassHandlerModule,
};

export default rtGspsExtension;
