/**
 * @ohif/extension-rt-lesion-tracker
 *
 * RECIST 1.1 lesion tracking (RTV-10) and the labelling workflow (RTV-150).
 *
 * The response arithmetic is a pure, heavily-tested transcription of the RECIST 1.1
 * guideline; the workflow is a pure state machine over it. The commands only hold
 * state and delegate.
 *
 * Follows RTV-114 (extension-first, zero fork).
 */
export * from './recist';
export * from './anatomies';
export * from './labellingWorkflow';
export { createLesionTrackerActions } from './getCommandsModule';

import getCommandsModule from './getCommandsModule';

const id = '@ohif/extension-rt-lesion-tracker';

const rtLesionTrackerExtension = { id, getCommandsModule };

export { id };
export default rtLesionTrackerExtension;
