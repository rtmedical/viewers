/**
 * @ohif/extension-rt-capture
 *
 * Secondary Capture support for OHIF v3 (RTV-203): screenshot of the active
 * viewport or the whole layout (image + burned-in annotations), packed as a
 * DICOM Secondary Capture Image (PS3.3 A.8, RGB) with dcmjs and sent to the
 * PACS via the data source's STOW-RS (`store.dicom`). Zero-fork (RTV-114):
 * pure dataset builder + dcmjs glue + commands; modes opt in via toolbar
 * buttons/hotkeys.
 */
export * from './scDataset';
export * from './scSerialize';
export { composeViewportCanvas, composeLayoutCanvas, canvasPixels } from './captureCompose';
export { getCommandsModule } from './getCommandsModule';

import { getCommandsModule } from './getCommandsModule';

const id = '@ohif/extension-rt-capture';

const rtCaptureExtension = {
  id,
  getCommandsModule,
};

export default rtCaptureExtension;
