/**
 * Core types for the RT Medical Key Images / DICOM Key Object Selection (KOS)
 * extension (RTV-148).
 *
 * These types are deliberately framework-free (no @ohif/* imports) so the
 * selection model and KOS descriptor logic can be unit-tested in isolation and
 * reused by the panel, commands and SopClassHandler wiring layers.
 */

/**
 * A reference to a single image (or frame) flagged as a "key image".
 *
 * The three UIDs form the identity of the reference. `frameNumber` (1-based,
 * DICOM convention) further narrows the identity for multiframe instances.
 * The remaining fields are display metadata captured at selection time and are
 * NOT part of the identity (see {@link getKeyImageId}).
 */
export interface KeyImageReference {
  StudyInstanceUID: string;
  SeriesInstanceUID: string;
  SOPInstanceUID: string;
  /** 1-based frame number for multiframe instances; omit for single-frame. */
  frameNumber?: number;

  // ---- Display metadata (not part of identity) ----
  Modality?: string;
  SeriesNumber?: number;
  InstanceNumber?: number;
  SeriesDescription?: string;
}

/**
 * A coded concept used as the KOS document title.
 * Source: DICOM PS3.16 CID 7010 "Key Object Selection Document Title".
 */
export interface KosDocumentTitle {
  CodeValue: string;
  CodingSchemeDesignator: string;
  CodeMeaning: string;
}

export type KeyImageEventType = 'added' | 'removed' | 'cleared';

/** Event emitted by {@link KeyImageManager} on every state mutation. */
export interface KeyImageEvent {
  type: KeyImageEventType;
  /** Canonical id of the affected reference (absent for `cleared`). */
  id?: string;
  /** The affected reference (absent for `removed`/`cleared`). */
  ref?: KeyImageReference;
  /** Selection size after the mutation. */
  count: number;
}
