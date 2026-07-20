/**
 * Parse an existing **Grayscale Softcopy Presentation State** back into the
 * viewer-facing summary (RTV-200) — the read side of {@link ./gspsDataset}.
 *
 * Framework-free and `dcmjs`-free: it consumes a *naturalized* DICOM instance
 * (DICOM keyword -> value, as produced by
 * `dcmjs.data.DicomMetaDictionary.naturalizeDataset`) so it can be unit-tested
 * in isolation. The OHIF SopClassHandler ({@link ./getSopClassHandlerModule})
 * is the thin layer that feeds naturalized instances into this parser.
 */
import { GSPS_SOP_CLASS_UID } from './gspsDataset';

/** One VOI (window) entry recovered from the Softcopy VOI LUT module. */
export interface ParsedGspsVoi {
  windowCenter: number;
  windowWidth: number;
}

/** One referenced image, flattened out of ReferencedSeriesSequence. */
export interface ParsedGspsImageRef {
  SeriesInstanceUID: string;
  SOPInstanceUID: string;
  SOPClassUID?: string;
}

export interface ParsedGsps {
  /** SOP Instance UID of the GSPS object itself. */
  sopInstanceUID?: string;
  /** Presentation State Identification. */
  contentLabel?: string;
  contentDescription?: string;
  /** Window/level entries, in document order. */
  voi: ParsedGspsVoi[];
  /** Flat de-duplicated list of every image the state applies to. */
  referencedImages: ParsedGspsImageRef[];
  /** Graphic/text object counts keyed by GraphicType (texts under 'TEXT'). */
  graphicCounts: Record<string, number>;
}

/** dcmjs naturalizes sequences as arrays, but be defensive about scalars. */
function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

/**
 * WindowCenter/WindowWidth are DS and may naturalize as number, numeric
 * string or a multi-value array — take the first finite number.
 */
function firstNumber(value: unknown): number | undefined {
  const first = toArray(value as unknown[])[0];
  const n = Number(first);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Recover the viewer-facing summary from a naturalized GSPS instance:
 * identification, VOI entries, flat referenced images and graphic counts.
 * Malformed items (missing UIDs, non-numeric windows) are skipped.
 */
export function parseGspsInstance(instance: Record<string, any>): ParsedGsps {
  const result: ParsedGsps = {
    sopInstanceUID: instance?.SOPInstanceUID,
    contentLabel: instance?.ContentLabel ? String(instance.ContentLabel) : undefined,
    contentDescription: instance?.ContentDescription
      ? String(instance.ContentDescription)
      : undefined,
    voi: [],
    referencedImages: [],
    graphicCounts: {},
  };
  if (!instance) {
    return result;
  }

  // Presentation State Relationship -> flat image references.
  const seen = new Set<string>();
  for (const series of toArray(instance.ReferencedSeriesSequence)) {
    const SeriesInstanceUID = (series as any)?.SeriesInstanceUID;
    if (!SeriesInstanceUID) {
      continue;
    }
    for (const image of toArray((series as any)?.ReferencedImageSequence)) {
      const SOPInstanceUID = (image as any)?.ReferencedSOPInstanceUID;
      if (!SOPInstanceUID || seen.has(SOPInstanceUID)) {
        continue;
      }
      seen.add(SOPInstanceUID);
      result.referencedImages.push({
        SeriesInstanceUID,
        SOPInstanceUID,
        SOPClassUID: (image as any)?.ReferencedSOPClassUID,
      });
    }
  }

  // Softcopy VOI LUT -> window entries.
  for (const item of toArray(instance.SoftcopyVOILUTSequence)) {
    const windowCenter = firstNumber((item as any)?.WindowCenter);
    const windowWidth = firstNumber((item as any)?.WindowWidth);
    if (windowCenter !== undefined && windowWidth !== undefined) {
      result.voi.push({ windowCenter, windowWidth });
    }
  }

  // Graphic Annotation -> counts by GraphicType (+ 'TEXT' for text objects).
  for (const annotation of toArray(instance.GraphicAnnotationSequence)) {
    for (const graphic of toArray((annotation as any)?.GraphicObjectSequence)) {
      const type = String((graphic as any)?.GraphicType ?? 'UNKNOWN');
      result.graphicCounts[type] = (result.graphicCounts[type] ?? 0) + 1;
    }
    const texts = toArray((annotation as any)?.TextObjectSequence);
    if (texts.length) {
      result.graphicCounts.TEXT = (result.graphicCounts.TEXT ?? 0) + texts.length;
    }
  }

  return result;
}

/** True when a naturalized instance is a Grayscale Softcopy Presentation State. */
export function isGrayscaleSoftcopyPresentationState(instance: Record<string, any>): boolean {
  return instance?.SOPClassUID === GSPS_SOP_CLASS_UID;
}

export default parseGspsInstance;
