/**
 * @ohif/extension-rt-lesion-tracker
 *
 * RECIST 1.1 lesion tracking (RTV-10), the labelling workflow (RTV-150) and
 * volume doubling time (RTV-69).
 *
 * The response arithmetic is a pure, heavily-tested transcription of the RECIST 1.1
 * guideline; the workflow is a pure state machine over it. The commands only hold
 * state and delegate.
 *
 * vdt.ts is the same shape: the doubling-time arithmetic is three lines, and
 * everything around it is refusing to produce a number the measurements cannot
 * support — a confidence envelope from the caliper uncertainty, no doubling
 * time at all for a shrinking nodule, and a prior-matching step that refuses
 * ambiguous pairs rather than guessing.
 *
 * Follows RTV-114 (extension-first, zero fork).
 */
export * from './recist';
export * from './vdt';
export * from './anatomies';
export * from './labellingWorkflow';
export { createLesionTrackerActions } from './getCommandsModule';

import getCommandsModule from './getCommandsModule';

const id = '@ohif/extension-rt-lesion-tracker';

const rtLesionTrackerExtension = { id, getCommandsModule };

export { id };
export default rtLesionTrackerExtension;
