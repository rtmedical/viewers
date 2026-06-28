import { KeyImageReference, KosDocumentTitle } from './types';
import { getKeyImageId } from './keyImageId';

/**
 * SOP Class UID for a Key Object Selection Document.
 * DICOM PS3.6 / PS3.4 — "Key Object Selection Document Storage".
 */
export const KEY_OBJECT_SELECTION_SOP_CLASS_UID = '1.2.840.10008.5.1.4.1.1.88.59';

/**
 * Subset of DICOM PS3.16 CID 7010 "Key Object Selection Document Title".
 * All entries use the "DCM" coding scheme. `OF_INTEREST` is the conventional
 * default for ad-hoc user-flagged key images.
 */
export const KOS_DOCUMENT_TITLES: Record<string, KosDocumentTitle> = {
  OF_INTEREST: { CodeValue: '113000', CodingSchemeDesignator: 'DCM', CodeMeaning: 'Of Interest' },
  FOR_REFERRING_PROVIDER: { CodeValue: '113002', CodingSchemeDesignator: 'DCM', CodeMeaning: 'For Referring Provider' },
  FOR_SURGERY: { CodeValue: '113003', CodingSchemeDesignator: 'DCM', CodeMeaning: 'For Surgery' },
  FOR_TEACHING: { CodeValue: '113004', CodingSchemeDesignator: 'DCM', CodeMeaning: 'For Teaching' },
  FOR_CONFERENCE: { CodeValue: '113005', CodingSchemeDesignator: 'DCM', CodeMeaning: 'For Conference' },
};

/** The default document title applied when none is specified. */
export const DEFAULT_KOS_TITLE: KosDocumentTitle = KOS_DOCUMENT_TITLES.OF_INTEREST;

export interface KosSopInstance {
  SOPInstanceUID: string;
  /** SOP Class UID of the referenced image (for `ReferencedSOPClassUID`). */
  SOPClassUID?: string;
  /** Sorted, de-duplicated 1-based frame numbers (omitted for single-frame). */
  frames?: number[];
}

export interface KosSeries {
  SeriesInstanceUID: string;
  SeriesDescription?: string;
  Modality?: string;
  sopInstances: KosSopInstance[];
}

export interface KosStudyEvidence {
  StudyInstanceUID: string;
  series: KosSeries[];
}

/**
 * A plain, serialization-ready description of a KOS document. This is the
 * boundary between selection logic (here, fully testable) and DICOM byte
 * writing (done later via dcmjs at integration time). It mirrors the
 * Study -> Series -> SOP Instance grouping of the KOS "Current Requested
 * Procedure Evidence Sequence".
 */
export interface KosDescriptor {
  sopClassUID: string;
  title: KosDocumentTitle;
  /** Optional free-text document description. */
  seriesDescription?: string;
  /** De-duplicated, input-ordered flat list of references. */
  references: KeyImageReference[];
  /** Hierarchical evidence grouping (Study -> Series -> Instance/frames). */
  evidence: KosStudyEvidence[];
}

export interface BuildKosOptions {
  title?: KosDocumentTitle;
  seriesDescription?: string;
}

/**
 * Build a {@link KosDescriptor} from a set of key-image references.
 *
 * - Throws on an empty selection (a KOS with no content is invalid).
 * - De-duplicates by canonical id, preserving first-seen order.
 * - Groups into Study -> Series -> SOP Instance, aggregating frame numbers
 *   (sorted, unique) for multiframe instances.
 * - Supports references spanning multiple studies/series.
 */
export function buildKosDescriptor(
  refs: KeyImageReference[],
  options: BuildKosOptions = {}
): KosDescriptor {
  if (!Array.isArray(refs) || refs.length === 0) {
    throw new Error('buildKosDescriptor requires at least one key image reference');
  }

  const title = options.title ?? DEFAULT_KOS_TITLE;

  // De-dupe by canonical id, preserving first-seen order.
  const seen = new Set<string>();
  const references: KeyImageReference[] = [];
  for (const ref of refs) {
    const id = getKeyImageId(ref); // validates UIDs/frame
    if (!seen.has(id)) {
      seen.add(id);
      references.push(ref);
    }
  }

  // Group Study -> Series -> SOP Instance, keeping first-seen order at each level.
  const studyOrder: string[] = [];
  const studies = new Map<string, Map<string, KosSeries>>();
  const frameSets = new Map<string, Set<number>>(); // key: studySeriesSop

  for (const ref of references) {
    if (!studies.has(ref.StudyInstanceUID)) {
      studies.set(ref.StudyInstanceUID, new Map());
      studyOrder.push(ref.StudyInstanceUID);
    }
    const seriesMap = studies.get(ref.StudyInstanceUID)!;

    if (!seriesMap.has(ref.SeriesInstanceUID)) {
      seriesMap.set(ref.SeriesInstanceUID, {
        SeriesInstanceUID: ref.SeriesInstanceUID,
        SeriesDescription: ref.SeriesDescription,
        Modality: ref.Modality,
        sopInstances: [],
      });
    }
    const series = seriesMap.get(ref.SeriesInstanceUID)!;

    let instance = series.sopInstances.find(i => i.SOPInstanceUID === ref.SOPInstanceUID);
    if (!instance) {
      instance = { SOPInstanceUID: ref.SOPInstanceUID, SOPClassUID: ref.SOPClassUID };
      series.sopInstances.push(instance);
    }

    if (ref.frameNumber != null) {
      const fkey = `${ref.SeriesInstanceUID}/${ref.SOPInstanceUID}`;
      if (!frameSets.has(fkey)) {
        frameSets.set(fkey, new Set());
      }
      frameSets.get(fkey)!.add(ref.frameNumber);
    }
  }

  // Materialize aggregated frame numbers (sorted, unique) onto instances.
  const evidence: KosStudyEvidence[] = studyOrder.map(studyUid => ({
    StudyInstanceUID: studyUid,
    series: Array.from(studies.get(studyUid)!.values()).map(series => ({
      ...series,
      sopInstances: series.sopInstances.map(inst => {
        const fkey = `${series.SeriesInstanceUID}/${inst.SOPInstanceUID}`;
        const set = frameSets.get(fkey);
        return set && set.size > 0
          ? { ...inst, frames: Array.from(set).sort((a, b) => a - b) }
          : inst;
      }),
    })),
  }));

  return {
    sopClassUID: KEY_OBJECT_SELECTION_SOP_CLASS_UID,
    title,
    seriesDescription: options.seriesDescription,
    references,
    evidence,
  };
}
