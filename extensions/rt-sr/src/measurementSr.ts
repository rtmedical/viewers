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
  /**
   * SOP Class of the referenced image. When provided together with
   * `referencedSopInstanceUID`, the IMAGE reference carries BOTH UIDs (a
   * complete ReferencedSOPSequence item). When absent, the reference is
   * emitted with the instance UID only — no fallback: guessing a SOP class
   * (e.g. CT) would be wrong more often than an incomplete-but-honest ref.
   */
  referencedSopClassUID?: string;
  /**
   * Series of the referenced image. Needed (together with both SOP UIDs) for
   * the instance to appear in CurrentRequestedProcedureEvidenceSequence; refs
   * without a known series are still emitted inline but are left out of the
   * evidence sequence (known limit).
   */
  referencedSeriesInstanceUID?: string;
}

export interface BuildMeasurementSrOptions {
  generateUID: () => string;
  PatientName?: string;
  PatientID?: string;
  PatientBirthDate?: string;
  PatientSex?: string;
  StudyInstanceUID?: string;
  StudyDate?: string;
  StudyTime?: string;
  AccessionNumber?: string;
  ReferringPhysicianName?: string;
  StudyID?: string;
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
    const referencedSop: Record<string, unknown> = {
      ReferencedSOPInstanceUID: m.referencedSopInstanceUID,
    };
    if (m.referencedSopClassUID) {
      referencedSop.ReferencedSOPClassUID = m.referencedSopClassUID;
    }
    contentSeq.push({
      RelationshipType: 'INFERRED FROM',
      ValueType: 'IMAGE',
      ReferencedSOPSequence: [referencedSop],
    });
  }
  if (contentSeq.length) item.ContentSequence = contentSeq;
  return item;
}

/**
 * Group fully-specified references (SOP class + SOP instance + series UIDs,
 * deduped per series) for CurrentRequestedProcedureEvidenceSequence. Refs
 * missing any of the three UIDs are skipped — the evidence sequence must be
 * complete, so partially-known refs stay inline-only (documented limit).
 */
function evidenceSeriesFor(measurements: SrMeasurement[]): Record<string, unknown>[] {
  const bySeries = new Map<string, Map<string, Record<string, unknown>>>();
  for (const m of measurements) {
    if (!m.referencedSopInstanceUID || !m.referencedSopClassUID || !m.referencedSeriesInstanceUID) {
      continue;
    }
    let refs = bySeries.get(m.referencedSeriesInstanceUID);
    if (!refs) {
      refs = new Map();
      bySeries.set(m.referencedSeriesInstanceUID, refs);
    }
    refs.set(m.referencedSopInstanceUID, {
      ReferencedSOPClassUID: m.referencedSopClassUID,
      ReferencedSOPInstanceUID: m.referencedSopInstanceUID,
    });
  }
  return Array.from(bySeries, ([seriesUID, refs]) => ({
    SeriesInstanceUID: seriesUID,
    ReferencedSOPSequence: Array.from(refs.values()),
  }));
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

  // UID generation order (SOP → Study → Series) is part of the builder's
  // observable contract with the injected factory.
  const sopInstanceUID = generateUID();
  const studyInstanceUID = options.StudyInstanceUID ?? generateUID();
  const dataset: NaturalizedSr = {
    SOPClassUID: COMPREHENSIVE_SR_SOP_CLASS_UID,
    SOPInstanceUID: sopInstanceUID,
    SpecificCharacterSet: 'ISO_IR 192',
    InstanceCreationDate: date,
    InstanceCreationTime: time,
    Modality: 'SR',
    // Patient (Type 2 emitted empty when unknown, mirroring the KOS builder)
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

  // Evidence sequence only when at least one reference is complete (SOP class
  // + instance + series). References lacking a series UID cannot be listed
  // (ReferencedSeriesSequence requires one), so with none complete the
  // sequence is omitted entirely rather than emitted half-filled.
  const evidenceSeries = evidenceSeriesFor(list);
  if (evidenceSeries.length) {
    dataset.CurrentRequestedProcedureEvidenceSequence = [
      {
        StudyInstanceUID: studyInstanceUID,
        ReferencedSeriesSequence: evidenceSeries,
      },
    ];
  }

  return dataset;
}

export default buildMeasurementSr;
