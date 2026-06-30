/**
 * Pure **Mammography CAD SR (TID 2000) builder** (RTV-37).
 *
 * Framework-free and `@ohif/*`-free: turns a {@link BiradsAssessment} (from
 * {@link ./birads}) into a *naturalized* DICOM Structured Report dataset, the
 * shape `dcmjs.data.DicomMetaDictionary.denaturalizeDataset` consumes — same
 * boundary as the KOS builder in `@ohif/extension-rtmedical-key-images`. The
 * dcmjs byte writing is the thin {@link ./srExport}; STOW-RS export to PACS is a
 * separate backend ticket (RTV-39).
 */
import { BiradsAssessment, getBiradsCategory, BREAST_DENSITY } from './birads';

/** Mammography CAD SR Document Storage. */
export const MAMMO_CAD_SR_SOP_CLASS_UID = '1.2.840.10008.5.1.4.1.1.88.50';

const DCM = 'DCM';
const codeItem = (CodeValue: string, CodeMeaning: string, CodingSchemeDesignator = DCM) => ({
  CodeValue,
  CodingSchemeDesignator,
  CodeMeaning,
});

export interface BuildSrOptions {
  /** UID factory (injected → pure/testable; serializer passes dcmjs's). */
  generateUID: () => string;
  PatientName?: string;
  PatientID?: string;
  StudyInstanceUID?: string;
  AccessionNumber?: string;
  now?: { date?: string; time?: string };
}

export type NaturalizedSr = Record<string, unknown>;

/** Build a naturalized Mammography CAD SR dataset from a BI-RADS assessment. */
export function buildMammographyCadSr(assessment: BiradsAssessment, options: BuildSrOptions): NaturalizedSr {
  if (!assessment) {
    throw new Error('buildMammographyCadSr requires an assessment');
  }
  const { generateUID } = options;
  if (typeof generateUID !== 'function') {
    throw new Error('buildMammographyCadSr requires options.generateUID');
  }
  const date = options.now?.date ?? '';
  const time = options.now?.time ?? '';

  const content: Record<string, unknown>[] = [];

  // Breast composition (density a–d) as a CODE item.
  if (assessment.density) {
    const d = BREAST_DENSITY.find(x => x.code === assessment.density);
    content.push({
      RelationshipType: 'CONTAINS',
      ValueType: 'CODE',
      ConceptNameCodeSequence: [codeItem('111041', 'Breast Composition')],
      ConceptCodeSequence: [codeItem(assessment.density, d?.description ?? assessment.density, 'BI-RADS')],
    });
  }

  // Laterality (TEXT).
  if (assessment.laterality) {
    content.push({
      RelationshipType: 'CONTAINS',
      ValueType: 'TEXT',
      ConceptNameCodeSequence: [codeItem('G-C171', 'Laterality', 'SRT')],
      TextValue: assessment.laterality,
    });
  }

  // One CONTAINER per finding, with its descriptors as TEXT.
  for (const f of assessment.findings ?? []) {
    const fContent: Record<string, unknown>[] = [];
    if (f.descriptors?.length) {
      fContent.push({
        RelationshipType: 'CONTAINS',
        ValueType: 'TEXT',
        ConceptNameCodeSequence: [codeItem('121071', 'Finding')],
        TextValue: f.descriptors.join(', '),
      });
    }
    if (f.location) {
      fContent.push({
        RelationshipType: 'CONTAINS',
        ValueType: 'TEXT',
        ConceptNameCodeSequence: [codeItem('G-A1F8', 'Location', 'SRT')],
        TextValue: f.location,
      });
    }
    content.push({
      RelationshipType: 'CONTAINS',
      ValueType: 'CONTAINER',
      ConceptNameCodeSequence: [codeItem('111059', f.type || 'Finding')],
      ContinuityOfContent: 'SEPARATE',
      ContentSequence: fContent,
    });
  }

  // Overall assessment (BI-RADS category) as a CODE item.
  const cat = getBiradsCategory(assessment.category);
  content.push({
    RelationshipType: 'CONTAINS',
    ValueType: 'CODE',
    ConceptNameCodeSequence: [codeItem('111056', 'Overall Assessment')],
    ConceptCodeSequence: [codeItem(assessment.category, cat?.label ?? `BI-RADS ${assessment.category}`, 'BI-RADS')],
  });

  // Management recommendation (TEXT).
  if (cat?.management) {
    content.push({
      RelationshipType: 'CONTAINS',
      ValueType: 'TEXT',
      ConceptNameCodeSequence: [codeItem('111058', 'Recommended Follow-up')],
      TextValue: cat.management,
    });
  }

  return {
    SOPClassUID: MAMMO_CAD_SR_SOP_CLASS_UID,
    SOPInstanceUID: generateUID(),
    SpecificCharacterSet: 'ISO_IR 192',
    InstanceCreationDate: date,
    InstanceCreationTime: time,
    Modality: 'SR',
    // Patient / Study
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
    ManufacturerModelName: '@ohif/extension-mammography',
    CompletionFlag: 'COMPLETE',
    VerificationFlag: 'UNVERIFIED',
    // SR Document Content (root CONTAINER, TID 2000)
    ValueType: 'CONTAINER',
    ConceptNameCodeSequence: [codeItem('111036', 'Mammography CAD Report')],
    ContinuityOfContent: 'SEPARATE',
    ContentTemplateSequence: [{ MappingResource: 'DCMR', TemplateIdentifier: '2000' }],
    ContentSequence: content,
  };
}

export default buildMammographyCadSr;
