import { KeyImageReference } from './types';
import { getKeyImageId } from './keyImageId';

/**
 * Loose metadata shape as produced by OHIF viewport / displaySet / instance
 * objects. Numbers may arrive as strings (DICOM IS VR), and UIDs may be absent
 * on malformed input — {@link toKeyImageReference} normalizes and validates.
 */
export interface KeyImageSource {
  StudyInstanceUID?: string;
  SeriesInstanceUID?: string;
  SOPInstanceUID?: string;
  frameNumber?: number;
  Modality?: string;
  SeriesNumber?: number | string;
  InstanceNumber?: number | string;
  SeriesDescription?: string;
}

/** Coerce a DICOM-ish integer-or-string to an integer, or undefined. */
function toOptionalInt(value: number | string | undefined): number | undefined {
  if (value == null || value === '') {
    return undefined;
  }
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

/**
 * Normalize a loose OHIF metadata object into a validated, clean
 * {@link KeyImageReference}. Empty/absent optional fields are dropped (not set
 * to empty strings). Throws (via {@link getKeyImageId}) when a required UID is
 * missing or the frame number is invalid — this is the single choke-point that
 * the commands layer relies on to reject un-selectable targets.
 */
export function toKeyImageReference(source: KeyImageSource): KeyImageReference {
  const ref: KeyImageReference = {
    StudyInstanceUID: source.StudyInstanceUID ?? '',
    SeriesInstanceUID: source.SeriesInstanceUID ?? '',
    SOPInstanceUID: source.SOPInstanceUID ?? '',
  };

  if (source.frameNumber != null) {
    ref.frameNumber = source.frameNumber;
  }
  if (source.Modality) {
    ref.Modality = source.Modality;
  }
  const seriesNumber = toOptionalInt(source.SeriesNumber);
  if (seriesNumber !== undefined) {
    ref.SeriesNumber = seriesNumber;
  }
  const instanceNumber = toOptionalInt(source.InstanceNumber);
  if (instanceNumber !== undefined) {
    ref.InstanceNumber = instanceNumber;
  }
  if (source.SeriesDescription) {
    ref.SeriesDescription = source.SeriesDescription;
  }

  getKeyImageId(ref); // validates UIDs + frame; throws on missing/invalid
  return ref;
}

/**
 * Human-readable one-line label for a key image (panel rows, tooltips).
 * Includes only the parts that are present; never returns an empty string —
 * falls back to a short SOP Instance UID suffix.
 */
export function describeKeyImage(ref: KeyImageReference): string {
  const parts: string[] = [];

  if (ref.Modality) {
    parts.push(ref.Modality);
  }
  if (ref.SeriesNumber != null) {
    parts.push(`Series ${ref.SeriesNumber}`);
  } else if (ref.SeriesDescription) {
    parts.push(ref.SeriesDescription);
  }
  if (ref.InstanceNumber != null) {
    parts.push(`Image ${ref.InstanceNumber}`);
  }
  if (ref.frameNumber != null) {
    parts.push(`Frame ${ref.frameNumber}`);
  }

  if (parts.length === 0) {
    parts.push(`Instance …${ref.SOPInstanceUID.slice(-8)}`);
  }

  return parts.join(' · ');
}
