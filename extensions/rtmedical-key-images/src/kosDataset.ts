/**
 * Build a naturalized DICOM **Key Object Selection (KOS) Document** dataset from
 * a {@link KosDescriptor} (RTV-148).
 *
 * This module is deliberately framework-free and free of any `dcmjs` import: it
 * produces a plain, *naturalized* dataset object (DICOM keyword -> value, the
 * shape `dcmjs.data.DicomMetaDictionary.denaturalizeDataset` consumes) so the
 * whole IOD-shaping step is pure and unit-testable. The thin `dcmjs` byte
 * writing wraps this in {@link ./kosSerialize}.
 *
 * Conforms to the Key Object Selection Document IOD (PS3.3 A.35.4) using the
 * KO Document template TID 2010 and a CID 7010 document title.
 */
import { KosDescriptor } from './kos';

/** SOP Class fallback when a referenced image has no known SOP Class UID. */
export const SECONDARY_CAPTURE_SOP_CLASS_UID = '1.2.840.10008.5.1.4.1.1.7';

/** DCM code for the optional free-text "Key Object Description" content item. */
const KEY_OBJECT_DESCRIPTION_CODE = {
  CodeValue: '113012',
  CodingSchemeDesignator: 'DCM',
  CodeMeaning: 'Key Object Description',
};

/** Patient/Study identity to stamp on the generated KOS document. */
export interface KosPatientStudyContext {
  PatientName?: string;
  PatientID?: string;
  PatientBirthDate?: string;
  PatientSex?: string;
  /** Study the KOS is filed under. Defaults to the first referenced study. */
  StudyInstanceUID?: string;
  StudyDate?: string;
  StudyTime?: string;
  AccessionNumber?: string;
  ReferringPhysicianName?: string;
  StudyID?: string;
}

export interface BuildKosDatasetOptions extends KosPatientStudyContext {
  /**
   * UID factory (required, injected so this stays pure/testable). The
   * serializer passes `dcmjs.data.DicomMetaDictionary.uid`.
   */
  generateUID: () => string;
  /** Free-text description emitted as a TEXT content item (CID code 113012). */
  description?: string;
  /** Defaults to `'1'`. */
  seriesNumber?: string | number;
  /** Defaults to `'1'`. */
  instanceNumber?: string | number;
  /** `{ date, time }` stamped on Content/Series date-time. Defaults to empty. */
  now?: { date?: string; time?: string };
}

/** A naturalized DICOM dataset (keyword -> value), as dcmjs consumes. */
export type NaturalizedKosDataset = Record<string, unknown>;

/**
 * Build a naturalized KOS dataset from a descriptor.
 *
 * @throws if the descriptor carries no evidence (an empty KOS is invalid).
 */
export function buildKosNaturalizedDataset(
  descriptor: KosDescriptor,
  options: BuildKosDatasetOptions
): NaturalizedKosDataset {
  if (!descriptor?.evidence?.length) {
    throw new Error('buildKosNaturalizedDataset requires a descriptor with evidence');
  }
  const { generateUID } = options;
  if (typeof generateUID !== 'function') {
    throw new Error('buildKosNaturalizedDataset requires an options.generateUID factory');
  }

  const date = options.now?.date ?? '';
  const time = options.now?.time ?? '';
  const studyInstanceUID =
    options.StudyInstanceUID ?? descriptor.evidence[0].StudyInstanceUID;

  // Current Requested Procedure Evidence Sequence: Study -> Series -> SOP refs.
  const evidenceSequence = descriptor.evidence.map(study => ({
    StudyInstanceUID: study.StudyInstanceUID,
    ReferencedSeriesSequence: study.series.map(series => ({
      SeriesInstanceUID: series.SeriesInstanceUID,
      ReferencedSOPSequence: series.sopInstances.map(inst => ({
        ReferencedSOPClassUID: inst.SOPClassUID ?? SECONDARY_CAPTURE_SOP_CLASS_UID,
        ReferencedSOPInstanceUID: inst.SOPInstanceUID,
      })),
    })),
  }));

  // CONTENT SEQUENCE: optional description, then one IMAGE item per instance.
  const contentSequence: Record<string, unknown>[] = [];
  if (options.description) {
    contentSequence.push({
      RelationshipType: 'CONTAINS',
      ValueType: 'TEXT',
      ConceptNameCodeSequence: [KEY_OBJECT_DESCRIPTION_CODE],
      TextValue: options.description,
    });
  }
  for (const study of descriptor.evidence) {
    for (const series of study.series) {
      for (const inst of series.sopInstances) {
        const referencedSop: Record<string, unknown> = {
          ReferencedSOPClassUID: inst.SOPClassUID ?? SECONDARY_CAPTURE_SOP_CLASS_UID,
          ReferencedSOPInstanceUID: inst.SOPInstanceUID,
        };
        if (inst.frames?.length) {
          // ReferencedFrameNumber is IS, multi-valued.
          referencedSop.ReferencedFrameNumber = inst.frames.map(String);
        }
        contentSequence.push({
          RelationshipType: 'CONTAINS',
          ValueType: 'IMAGE',
          ReferencedSOPSequence: [referencedSop],
        });
      }
    }
  }

  return {
    // SOP Common
    SOPClassUID: descriptor.sopClassUID,
    SOPInstanceUID: generateUID(),
    SpecificCharacterSet: 'ISO_IR 192',
    InstanceCreationDate: date,
    InstanceCreationTime: time,
    // Patient
    PatientName: options.PatientName ?? '',
    PatientID: options.PatientID ?? '',
    PatientBirthDate: options.PatientBirthDate ?? '',
    PatientSex: options.PatientSex ?? '',
    // General Study
    StudyInstanceUID: studyInstanceUID,
    StudyDate: options.StudyDate ?? '',
    StudyTime: options.StudyTime ?? '',
    AccessionNumber: options.AccessionNumber ?? '',
    ReferringPhysicianName: options.ReferringPhysicianName ?? '',
    StudyID: options.StudyID ?? '',
    // KO Document Series
    Modality: 'KO',
    SeriesInstanceUID: generateUID(),
    SeriesNumber: String(options.seriesNumber ?? '1'),
    SeriesDate: date,
    SeriesTime: time,
    SeriesDescription: descriptor.seriesDescription ?? descriptor.title.CodeMeaning,
    // General Equipment
    Manufacturer: 'RT Medical',
    ManufacturerModelName: '@ohif/extension-rtmedical-key-images',
    // KO Document
    InstanceNumber: String(options.instanceNumber ?? '1'),
    ContentDate: date,
    ContentTime: time,
    // Key Object Document Content (SR-style CONTAINER, TID 2010)
    ValueType: 'CONTAINER',
    ConceptNameCodeSequence: [
      {
        CodeValue: descriptor.title.CodeValue,
        CodingSchemeDesignator: descriptor.title.CodingSchemeDesignator,
        CodeMeaning: descriptor.title.CodeMeaning,
      },
    ],
    ContinuityOfContent: 'SEPARATE',
    ContentTemplateSequence: [{ MappingResource: 'DCMR', TemplateIdentifier: '2010' }],
    CurrentRequestedProcedureEvidenceSequence: evidenceSequence,
    ContentSequence: contentSequence,
  };
}

export default buildKosNaturalizedDataset;
