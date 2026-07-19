/**
 * Pure **DICOM SR TID 1500 (Measurement Report) builder** (RTV-36).
 *
 * Framework-free and `@ohif/*`-free: turns a list of measurements into a
 * *naturalized* Comprehensive SR dataset (root CONTAINER → Imaging Measurements
 * → Measurement Group → NUM items), the shape dcmjs denaturalizes. Same boundary
 * as the KOS / Mammography-CAD-SR builders. Unit-tested; byte writing is the thin
 * {@link ./srExport}.
 */

/** Comprehensive SR Document Storage. */
export const COMPREHENSIVE_SR_SOP_CLASS_UID = '1.2.840.10008.5.1.4.1.1.88.33';

export interface CodedConcept {
  value: string;
  scheme: string;
  meaning: string;
}

export interface SrMeasurement {
  /** Display name (used as ConceptName meaning if no coded concept). */
  name: string;
  /** Optional coded concept name (else a private code is synthesised). */
  nameCode?: CodedConcept;
  value: number;
  /** UCUM unit string, e.g. 'mm', 'mm2', '[hnsf'U]' (HU), '%'. */
  unit: string;
  /** Optional human meaning for the unit. */
  unitMeaning?: string;
  trackingIdentifier?: string;
  referencedSopInstanceUID?: string;
}

export interface BuildMeasurementSrOptions {
  generateUID: () => string;
  PatientName?: string;
  PatientID?: string;
  StudyInstanceUID?: string;
  AccessionNumber?: string;
  title?: string;
  now?: { date?: string; time?: string };
}

export type NaturalizedSr = Record<string, unknown>;

const code = (value: string, scheme: string, meaning: string) => ({
  CodeValue: value,
  CodingSchemeDesignator: scheme,
  CodeMeaning: meaning,
});

function numItem(m: SrMeasurement): Record<string, unknown> {
  const concept = m.nameCode
    ? code(m.nameCode.value, m.nameCode.scheme, m.nameCode.meaning)
    : code('RT-MEAS', '99RTMED', m.name);
  const item: Record<string, unknown> = {
    RelationshipType: 'CONTAINS',
    ValueType: 'NUM',
    ConceptNameCodeSequence: [concept],
    MeasuredValueSequence: [
      {
        NumericValue: String(m.value),
        MeasurementUnitsCodeSequence: [code(m.unit, 'UCUM', m.unitMeaning ?? m.unit)],
      },
    ],
  };
  const contentSeq: Record<string, unknown>[] = [];
  if (m.trackingIdentifier) {
    contentSeq.push({
      RelationshipType: 'HAS OBS CONTEXT',
      ValueType: 'TEXT',
      ConceptNameCodeSequence: [code('112039', 'DCM', 'Tracking Identifier')],
      TextValue: m.trackingIdentifier,
    });
  }
  if (m.referencedSopInstanceUID) {
    contentSeq.push({
      RelationshipType: 'INFERRED FROM',
      ValueType: 'IMAGE',
      ReferencedSOPSequence: [{ ReferencedSOPInstanceUID: m.referencedSopInstanceUID }],
    });
  }
  if (contentSeq.length) item.ContentSequence = contentSeq;
  return item;
}

/** Build a naturalized TID 1500 Measurement Report SR from measurements. */
export function buildMeasurementSr(measurements: SrMeasurement[], options: BuildMeasurementSrOptions): NaturalizedSr {
  const { generateUID } = options;
  if (typeof generateUID !== 'function') {
    throw new Error('buildMeasurementSr requires options.generateUID');
  }
  const list = measurements ?? [];
  const date = options.now?.date ?? '';
  const time = options.now?.time ?? '';

  const measurementGroup = {
    RelationshipType: 'CONTAINS',
    ValueType: 'CONTAINER',
    ConceptNameCodeSequence: [code('125007', 'DCM', 'Measurement Group')],
    ContinuityOfContent: 'SEPARATE',
    ContentSequence: list.map(numItem),
  };

  const imagingMeasurements = {
    RelationshipType: 'CONTAINS',
    ValueType: 'CONTAINER',
    ConceptNameCodeSequence: [code('126010', 'DCM', 'Imaging Measurements')],
    ContinuityOfContent: 'SEPARATE',
    ContentSequence: [measurementGroup],
  };

  return {
    SOPClassUID: COMPREHENSIVE_SR_SOP_CLASS_UID,
    SOPInstanceUID: generateUID(),
    SpecificCharacterSet: 'ISO_IR 192',
    InstanceCreationDate: date,
    InstanceCreationTime: time,
    Modality: 'SR',
    PatientName: options.PatientName ?? '',
    PatientID: options.PatientID ?? '',
    StudyInstanceUID: options.StudyInstanceUID ?? generateUID(),
    AccessionNumber: options.AccessionNumber ?? '',
    SeriesInstanceUID: generateUID(),
    SeriesNumber: '1',
    InstanceNumber: '1',
    ContentDate: date,
    ContentTime: time,
    Manufacturer: 'RT Medical',
    ManufacturerModelName: '@ohif/extension-rt-sr',
    CompletionFlag: 'COMPLETE',
    VerificationFlag: 'UNVERIFIED',
    ValueType: 'CONTAINER',
    ConceptNameCodeSequence: [code('126000', 'DCM', options.title ?? 'Imaging Measurement Report')],
    ContinuityOfContent: 'SEPARATE',
    ContentTemplateSequence: [{ MappingResource: 'DCMR', TemplateIdentifier: '1500' }],
    ContentSequence: [imagingMeasurements],
  };
}

export default buildMeasurementSr;
