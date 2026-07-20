/**
 * @ohif/extension-rt-capture
 *
 * Secondary Capture support for OHIF v3 (RTV-203): screenshot of the active
 * viewport or the whole layout (image + burned-in annotations), packed as a
 * DICOM Secondary Capture Image (PS3.3 A.8, RGB) with dcmjs and sent to the
 * PACS via the data source's STOW-RS (`store.dicom`). Zero-fork (RTV-114):
 * pure dataset builder + dcmjs glue + commands; modes opt in via toolbar
 * buttons/hotkeys.
 *
 * Also home to the cine → video export (RTV-95): sweep the active viewport's
 * frames and record them (MediaRecorder) into an MP4/WebM download.
 */
export * from './scDataset';
export * from './scSerialize';
export { composeViewportCanvas, composeLayoutCanvas, canvasPixels } from './captureCompose';
export {
  VIDEO_MIME_CANDIDATES,
  pickVideoMimeType,
  exportFilename,
  recordCanvasFrames,
  downloadBlob,
} from './cineExport';
export { getCommandsModule } from './getCommandsModule';

import { getCommandsModule } from './getCommandsModule';

const id = '@ohif/extension-rt-capture';

const rtCaptureExtension = {
  id,
  getCommandsModule,
};

export default rtCaptureExtension;
