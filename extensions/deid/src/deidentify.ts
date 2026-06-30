/**
 * Pure **DICOM de-identification** per PS3.15 Annex E (Basic Application Level
 * Confidentiality Profile) + LGPD (RTV-113).
 *
 * Framework-free and `@ohif/*`-free: operates on a *naturalized* dataset (DICOM
 * keyword → value) and returns a new de-identified dataset (input is not
 * mutated). Per-tag actions follow the Basic Profile vocabulary:
 *   D = replace with a dummy value · Z = zero length · X = remove
 *   K = keep · U = UID remap (consistent). Unit-tested in isolation; the
 * Part-10 byte writing (dcmjs) is a thin wrapper in {@link ./deidExport}.
 */

export type TagAction = 'D' | 'Z' | 'X' | 'K' | 'U';

/** Identity / PHI tags → action (curated Basic-Profile-aligned subset). */
export const PHI_ACTIONS: Record<string, TagAction> = {
  // Patient identity
  PatientName: 'D',
  PatientID: 'Z',
  IssuerOfPatientID: 'X',
  OtherPatientIDs: 'X',
  OtherPatientIDsSequence: 'X',
  OtherPatientNames: 'X',
  PatientBirthName: 'X',
  PatientMotherBirthName: 'X',
  PatientBirthTime: 'X',
  PatientSex: 'K',
  PatientAge: 'K',
  PatientSize: 'K',
  PatientWeight: 'K',
  PatientAddress: 'X',
  PatientTelephoneNumbers: 'X',
  PatientTelecomInformation: 'X',
  CountryOfResidence: 'X',
  RegionOfResidence: 'X',
  MilitaryRank: 'X',
  BranchOfService: 'X',
  EthnicGroup: 'X',
  Occupation: 'X',
  PatientReligiousPreference: 'X',
  PatientComments: 'X',
  AdditionalPatientHistory: 'X',
  MedicalRecordLocator: 'X',
  // Physicians / operators / institution
  ReferringPhysicianName: 'Z',
  ReferringPhysicianAddress: 'X',
  ReferringPhysicianTelephoneNumbers: 'X',
  PerformingPhysicianName: 'Z',
  NameOfPhysiciansReadingStudy: 'X',
  OperatorsName: 'Z',
  PhysiciansOfRecord: 'X',
  RequestingPhysician: 'X',
  InstitutionName: 'X',
  InstitutionAddress: 'X',
  InstitutionalDepartmentName: 'X',
  StationName: 'X',
  // Identifiers
  AccessionNumber: 'Z',
  StudyID: 'Z',
  DeviceSerialNumber: 'X',
  ProtocolName: 'K',
  PerformedProcedureStepID: 'X',
  RequestAttributesSequence: 'X',
  // UIDs
  StudyInstanceUID: 'U',
  SeriesInstanceUID: 'U',
  SOPInstanceUID: 'U',
  FrameOfReferenceUID: 'U',
  SynchronizationFrameOfReferenceUID: 'U',
  MediaStorageSOPInstanceUID: 'U',
  ReferencedSOPInstanceUID: 'U',
  ReferencedFrameOfReferenceUID: 'U',
};

/** Date/time tags handled together (kept when `retainDates`, else zeroed). */
export const DATE_TIME_KEYWORDS = new Set([
  'StudyDate', 'SeriesDate', 'AcquisitionDate', 'ContentDate', 'OverlayDate', 'CurveDate',
  'AcquisitionDateTime', 'StudyTime', 'SeriesTime', 'AcquisitionTime', 'ContentTime',
  'PatientBirthDate', 'ScheduledProcedureStepStartDate', 'PerformedProcedureStepStartDate',
]);

const DEFAULT_DUMMIES: Record<string, string> = {
  PatientName: 'ANONYMIZED',
  ReferringPhysicianName: 'ANONYMIZED',
  PerformingPhysicianName: 'ANONYMIZED',
  OperatorsName: 'ANONYMIZED',
};

export interface DeidOptions {
  /** Keep date/time values (default: false → zeroed). */
  retainDates?: boolean;
  /** Keep UIDs as-is (default: true → preserves referential integrity). */
  retainUids?: boolean;
  /** Consistent UID remapper, used only when `retainUids` is false. */
  remapUid?: (uid: string) => string;
  /** Per-keyword dummy overrides for `D` actions. */
  dummyValues?: Record<string, string>;
  /** De-identification method string written to the dataset. */
  method?: string;
}

const SQ_VALUE = (v: unknown): v is Record<string, unknown>[] =>
  Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' && v[0] !== null;

function remap(uid: unknown, options: DeidOptions): unknown {
  if (options.retainUids !== false || !options.remapUid) return uid;
  if (Array.isArray(uid)) return uid.map(u => options.remapUid!(String(u)));
  return options.remapUid(String(uid));
}

/**
 * De-identify a naturalized dataset. Returns a new object; the input is not
 * mutated. Sequences are recursed. Adds `PatientIdentityRemoved` +
 * `DeidentificationMethod`.
 */
export function deidentify(dataset: Record<string, any>, options: DeidOptions = {}): Record<string, any> {
  const out: Record<string, any> = {};
  if (!dataset) return out;

  for (const [keyword, value] of Object.entries(dataset)) {
    // Recurse into sequences regardless of (and before) any direct action.
    if (PHI_ACTIONS[keyword] === 'X') {
      continue; // remove
    }
    if (SQ_VALUE(value)) {
      out[keyword] = (value as Record<string, unknown>[]).map(item => deidentify(item as Record<string, any>, options));
      continue;
    }

    const action = PHI_ACTIONS[keyword];
    if (action) {
      if (action === 'K') out[keyword] = value;
      else if (action === 'Z') out[keyword] = '';
      else if (action === 'D') out[keyword] = options.dummyValues?.[keyword] ?? DEFAULT_DUMMIES[keyword] ?? 'ANONYMIZED';
      else if (action === 'U') out[keyword] = remap(value, options);
      // 'X' already handled above
      continue;
    }

    if (DATE_TIME_KEYWORDS.has(keyword)) {
      out[keyword] = options.retainDates ? value : '';
      continue;
    }

    out[keyword] = value; // non-PHI: keep
  }

  out.PatientIdentityRemoved = 'YES';
  out.DeidentificationMethod = options.method ?? 'RT Medical — PS3.15 Annex E Basic Profile + LGPD';
  return out;
}

/** List the PHI keywords that would be acted on (for UI/preview). */
export function deidActions(): { keyword: string; action: TagAction }[] {
  return Object.entries(PHI_ACTIONS).map(([keyword, action]) => ({ keyword, action }));
}

export default deidentify;
