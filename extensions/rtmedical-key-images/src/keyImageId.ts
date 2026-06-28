import { KeyImageReference } from './types';

/**
 * Field separator for the canonical key-image id. DICOM UIDs are limited to
 * digits and dots (0-9, '.'), so neither '|' nor ':' can ever appear inside a
 * UID — which makes the encoding unambiguously reversible.
 */
const SEP = '|';
const FRAME_SEP = ':';

function requireUid(value: string | undefined, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`KeyImageReference.${field} is required and must be a non-empty string`);
  }
  return value;
}

/**
 * Build the canonical, stable identity string for a key-image reference.
 *
 * Identity is `Study|Series|SOPInstance` plus `:frame` when a frame number is
 * present. Display metadata (Modality, descriptions, ...) is intentionally
 * excluded so that re-selecting the same image with richer metadata maps to the
 * same id.
 */
export function getKeyImageId(ref: KeyImageReference): string {
  const study = requireUid(ref?.StudyInstanceUID, 'StudyInstanceUID');
  const series = requireUid(ref?.SeriesInstanceUID, 'SeriesInstanceUID');
  const sop = requireUid(ref?.SOPInstanceUID, 'SOPInstanceUID');

  let id = `${study}${SEP}${series}${SEP}${sop}`;

  if (ref.frameNumber != null) {
    if (!Number.isInteger(ref.frameNumber) || ref.frameNumber < 1) {
      throw new TypeError(`KeyImageReference.frameNumber must be a positive integer (got ${ref.frameNumber})`);
    }
    id += `${FRAME_SEP}${ref.frameNumber}`;
  }

  return id;
}

/**
 * Reverse of {@link getKeyImageId}. Returns the three UIDs and, when present,
 * the frame number. Display metadata cannot be recovered (it is not encoded).
 */
export function parseKeyImageId(id: string): KeyImageReference {
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError('key image id must be a non-empty string');
  }

  const parts = id.split(SEP);
  if (parts.length !== 3) {
    throw new TypeError(`malformed key image id: expected 3 '${SEP}'-separated parts, got ${parts.length}`);
  }

  const [study, series, sopAndFrame] = parts;
  const [sop, frameRaw] = sopAndFrame.split(FRAME_SEP);

  const ref: KeyImageReference = {
    StudyInstanceUID: study,
    SeriesInstanceUID: series,
    SOPInstanceUID: sop,
  };

  if (frameRaw != null) {
    const frameNumber = Number(frameRaw);
    if (!Number.isInteger(frameNumber) || frameNumber < 1) {
      throw new TypeError(`malformed frame number in key image id: ${frameRaw}`);
    }
    ref.frameNumber = frameNumber;
  }

  return ref;
}
