/**
 * Pure **CAD-RADS model + SR TID 3000 builder** (RTV-38).
 *
 * Framework-free and `@ohif/*`-free: a coronary CAD-RADS assessment model and a
 * `buildCadRadsSr` that turns it into a *naturalized* Comprehensive SR — same
 * builder pattern as {@link ./measurementSr} / the Mammography CAD SR. Unit-tested.
 */

export interface CadRadsCategory {
  code: string;
  stenosis: string;
  management: string;
}

/** CAD-RADS categories (max coronary stenosis). */
export const CAD_RADS_CATEGORIES: CadRadsCategory[] = [
  { code: '0', stenosis: '0% (no plaque)', management: 'No further evaluation; reassure' },
  { code: '1', stenosis: '1–24% minimal', management: 'No further evaluation' },
  { code: '2', stenosis: '25–49% mild', management: 'No further evaluation; risk-factor modification' },
  { code: '3', stenosis: '50–69% moderate', management: 'Consider functional assessment' },
  { code: '4A', stenosis: '70–99% severe (1–2 vessels)', management: 'Consider ICA or functional assessment' },
  { code: '4B', stenosis: 'Left main >50% or 3-vessel ≥70%', management: 'ICA recommended' },
  { code: '5', stenosis: '100% total occlusion', management: 'Consider ICA / viability assessment' },
];

/** CAD-RADS modifiers. */
export const CAD_RADS_MODIFIERS: Record<string, string> = {
  N: 'Non-diagnostic study',
  HRP: 'High-risk plaque',
  I: 'Ischemia (CT-FFR / perfusion positive)',
  S: 'Stent',
  G: 'Graft',
  E: 'Exceptions / non-atherosclerotic',
  V: 'Vulnerable plaque',
};

export function getCadRadsCategory(code: string): CadRadsCategory | undefined {
  return CAD_RADS_CATEGORIES.find(c => c.code.toLowerCase() === String(code).toLowerCase());
}

export interface CadRadsAssessment {
  category: string; // 0-5 / 4A / 4B
  modifiers?: string[]; // subset of CAD_RADS_MODIFIERS keys
  stenosisDescription?: string;
}

/** Render a CAD-RADS report string (e.g. "CAD-RADS 4A / HRP"). */
export function formatCadRads(assessment: CadRadsAssessment): string {
  const mods = (assessment.modifiers ?? []).filter(m => CAD_RADS_MODIFIERS[m]);
  return `CAD-RADS ${assessment.category}${mods.length ? ' / ' + mods.join('/') : ''}`;
}

export interface BuildCadRadsSrOptions {
  generateUID: () => string;
  PatientName?: string;
  PatientID?: string;
  StudyInstanceUID?: string;
  AccessionNumber?: string;
  now?: { date?: string; time?: string };
}

const COMPREHENSIVE_SR_SOP_CLASS_UID = '1.2.840.10008.5.1.4.1.1.88.33';
const code = (value: string, scheme: string, meaning: string) => ({
  CodeValue: value,
  CodingSchemeDesignator: scheme,
  CodeMeaning: meaning,
});

/** Build a naturalized CAD-RADS Comprehensive SR (TID 3000). */
export function buildCadRadsSr(assessment: CadRadsAssessment, options: BuildCadRadsSrOptions): Record<string, unknown> {
  if (!assessment) throw new Error('buildCadRadsSr requires an assessment');
  const { generateUID } = options;
  if (typeof generateUID !== 'function') throw new Error('buildCadRadsSr requires options.generateUID');
  const date = options.now?.date ?? '';
  const time = options.now?.time ?? '';
  const cat = getCadRadsCategory(assessment.category);

  const content: Record<string, unknown>[] = [
    {
      RelationshipType: 'CONTAINS',
      ValueType: 'CODE',
      ConceptNameCodeSequence: [code('111056', 'DCM', 'Overall Assessment')],
      ConceptCodeSequence: [code(`CAD-RADS ${assessment.category}`, '99CADRADS', cat?.stenosis ?? assessment.category)],
    },
  ];

  for (const m of assessment.modifiers ?? []) {
    if (!CAD_RADS_MODIFIERS[m]) continue;
    content.push({
      RelationshipType: 'CONTAINS',
      ValueType: 'CODE',
      ConceptNameCodeSequence: [code('111059', 'DCM', 'CAD-RADS Modifier')],
      ConceptCodeSequence: [code(m, '99CADRADS', CAD_RADS_MODIFIERS[m])],
    });
  }

  if (assessment.stenosisDescription) {
    content.push({
      RelationshipType: 'CONTAINS',
      ValueType: 'TEXT',
      ConceptNameCodeSequence: [code('121071', 'DCM', 'Finding')],
      TextValue: assessment.stenosisDescription,
    });
  }

  if (cat?.management) {
    content.push({
      RelationshipType: 'CONTAINS',
      ValueType: 'TEXT',
      ConceptNameCodeSequence: [code('111058', 'DCM', 'Recommended Follow-up')],
      TextValue: cat.management,
    });
  }

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
    ConceptNameCodeSequence: [code('111036', 'DCM', 'CAD-RADS Report')],
    ContinuityOfContent: 'SEPARATE',
    ContentTemplateSequence: [{ MappingResource: 'DCMR', TemplateIdentifier: '3000' }],
    ContentSequence: content,
  };
}

export default buildCadRadsSr;
