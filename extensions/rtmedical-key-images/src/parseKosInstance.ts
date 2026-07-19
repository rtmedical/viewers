/**
 * Parse an existing **Key Object Selection (KOS) Document** back into key-image
 * references (RTV-148) — the read side of {@link ./kosDataset}.
 *
 * Framework-free and `dcmjs`-free: it consumes a *naturalized* DICOM instance
 * (DICOM keyword -> value, as produced by
 * `dcmjs.data.DicomMetaDictionary.naturalizeDataset`) so it can be unit-tested
 * in isolation. The OHIF SopClassHandler ({@link ./getSopClassHandlerModule})
 * is the thin layer that feeds naturalized instances into this parser.
 */
import { KEY_OBJECT_SELECTION_SOP_CLASS_UID } from './kos';
import { KeyImageReference, KosDocumentTitle } from './types';

export interface ParsedKos {
  /** SOP Instance UID of the KOS document itself. */
  sopInstanceUID?: string;
  /** Document title (CID 7010), if present. */
  title?: KosDocumentTitle;
  /** Optional free-text key object description. */
  description?: string;
  /** De-duplicated key-image references recovered from the document. */
  references: KeyImageReference[];
}

/** dcmjs naturalizes sequences as arrays, but be defensive about scalars. */
function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

/** ReferencedFrameNumber is IS (string/number, possibly multi-valued). */
function toFrameNumbers(value: unknown): number[] {
  return toArray(value as unknown[])
    .map(v => Number(v))
    .filter(n => Number.isFinite(n) && n > 0);
}

function readTitle(instance: Record<string, any>): KosDocumentTitle | undefined {
  const code = toArray(instance?.ConceptNameCodeSequence)[0] as
    | Record<string, any>
    | undefined;
  if (!code) {
    return undefined;
  }
  return {
    CodeValue: code.CodeValue,
    CodingSchemeDesignator: code.CodingSchemeDesignator,
    CodeMeaning: code.CodeMeaning,
  };
}

/**
 * Map every referenced SOP Instance UID to its Study/Series via the Current
 * Requested Procedure Evidence Sequence, so flat content-item references can be
 * resolved back to their full Study/Series/SOP identity.
 */
function buildEvidenceIndex(
  instance: Record<string, any>
): Map<string, { StudyInstanceUID: string; SeriesInstanceUID: string }> {
  const index = new Map<string, { StudyInstanceUID: string; SeriesInstanceUID: string }>();
  for (const study of toArray(instance?.CurrentRequestedProcedureEvidenceSequence)) {
    const StudyInstanceUID = (study as any)?.StudyInstanceUID;
    for (const series of toArray((study as any)?.ReferencedSeriesSequence)) {
      const SeriesInstanceUID = (series as any)?.SeriesInstanceUID;
      for (const sop of toArray((series as any)?.ReferencedSOPSequence)) {
        const uid = (sop as any)?.ReferencedSOPInstanceUID;
        if (uid && StudyInstanceUID && SeriesInstanceUID) {
          index.set(uid, { StudyInstanceUID, SeriesInstanceUID });
        }
      }
    }
  }
  return index;
}

/**
 * Recover key-image references from a naturalized KOS instance.
 *
 * IMAGE content items that reference a multiframe SOP instance with several
 * frames expand into one reference per frame. References whose Study/Series
 * cannot be resolved from the evidence sequence are skipped.
 */
export function parseKosInstance(instance: Record<string, any>): ParsedKos {
  const result: ParsedKos = {
    sopInstanceUID: instance?.SOPInstanceUID,
    title: readTitle(instance),
    references: [],
  };
  if (!instance) {
    return result;
  }

  const evidence = buildEvidenceIndex(instance);
  const seen = new Set<string>();

  for (const item of toArray(instance.ContentSequence)) {
    const node = item as Record<string, any>;
    if (node?.ValueType === 'TEXT' && node?.TextValue && !result.description) {
      result.description = String(node.TextValue);
      continue;
    }
    if (node?.ValueType !== 'IMAGE') {
      continue;
    }
    const sop = toArray(node.ReferencedSOPSequence)[0] as Record<string, any> | undefined;
    const sopInstanceUID = sop?.ReferencedSOPInstanceUID;
    if (!sopInstanceUID) {
      continue;
    }
    const location = evidence.get(sopInstanceUID);
    if (!location) {
      continue;
    }
    const frames = toFrameNumbers(sop?.ReferencedFrameNumber);
    const base: KeyImageReference = {
      StudyInstanceUID: location.StudyInstanceUID,
      SeriesInstanceUID: location.SeriesInstanceUID,
      SOPInstanceUID: sopInstanceUID,
      SOPClassUID: sop?.ReferencedSOPClassUID,
    };
    const refs: KeyImageReference[] = frames.length
      ? frames.map(frameNumber => ({ ...base, frameNumber }))
      : [base];
    for (const ref of refs) {
      const key = `${ref.SOPInstanceUID}:${ref.frameNumber ?? ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.references.push(ref);
      }
    }
  }

  return result;
}

/** True when a naturalized instance is a KOS document. */
export function isKeyObjectSelection(instance: Record<string, any>): boolean {
  return instance?.SOPClassUID === KEY_OBJECT_SELECTION_SOP_CLASS_UID;
}

export default parseKosInstance;
