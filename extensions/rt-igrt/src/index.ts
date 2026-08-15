/**
 * @ohif/extension-rt-igrt
 *
 * Image-guided radiotherapy.
 *
 * - **Couch corrections** (RTV-208): CBCT detection, and the decomposition of a
 *   CBCT-to-planning-CT registration into the couch move a therapist applies —
 *   with the patient position required, because the axis signs depend on it and
 *   a shift applied backwards leaves the patient at twice the error.
 * - **Setup statistics and margins** (RTV-208): systematic and random error kept
 *   apart, because only one of them is correctable, and the van Herk recipe
 *   with its two contributions reported separately.
 *
 * Follows RTV-114 (extension-first, zero fork).
 */
export * from './couchShifts';
export * from './setupStatistics';

const id = '@ohif/extension-rt-igrt';

const rtIgrtExtension = { id };

export { id };
export default rtIgrtExtension;
