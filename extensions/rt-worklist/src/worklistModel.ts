/**
 * Pure worklist model for the RIS-style study list (RTV-161) — no React, no
 * OHIF imports, fully unit-testable (RTV-114 zero-fork discipline).
 *
 * Study shape = exactly what the DicomWebDataSource study-level QIDO mapper
 * returns (extensions/default/src/DicomWebDataSource/qido.js `processResults`):
 *   studyInstanceUid, date (DICOM DA, YYYYMMDD), time (DICOM TM), accession,
 *   mrn (PatientID), patientName (formatPN'ed string), instances (number,
 *   NumberOfStudyRelatedInstances), description, modalities
 *   (backslash-separated string from ModalitiesInStudy — `getString` joins
 *   multi-valued attributes with '\\'), referringPhysicianName.
 *
 * Series shape = qido.js `processSeriesResults`:
 *   studyInstanceUid, seriesInstanceUid, modality, seriesNumber, seriesDate
 *   (already display-formatted by utils.formatDate), numSeriesInstances,
 *   description.
 *
 * Note: QIDO-RS is study-centric — there is no patient-level query in
 * DICOMweb — so the PATIENT level of the RIS hierarchy is produced here by
 * grouping the study results client-side by PatientID (mrn).
 */

export interface WorklistStudy {
  studyInstanceUid: string;
  /** DICOM DA (YYYYMMDD). */
  date?: string;
  /** DICOM TM (HHmmss.frac). */
  time?: string;
  accession?: string;
  /** PatientID. */
  mrn?: string;
  patientName?: string;
  /** NumberOfStudyRelatedInstances. */
  instances?: number;
  description?: string;
  /** Backslash-separated ModalitiesInStudy, e.g. 'CT\\SR'. */
  modalities?: string;
  referringPhysicianName?: string;
}

export interface WorklistSeries {
  studyInstanceUid: string;
  seriesInstanceUid: string;
  modality?: string;
  seriesNumber?: string;
  seriesDate?: string;
  numSeriesInstances?: number;
  description?: string;
}

export interface PatientGroup {
  /** PatientID (mrn); falls back to the normalized name when the ID is empty. */
  patientId: string;
  patientName: string;
  /** Studies of this patient, most recent first. */
  studies: WorklistStudy[];
}

export interface StudyFilters {
  /** Case- and accent-insensitive substring match on patientName. */
  patientName?: string;
  /** Case-insensitive substring match on mrn (PatientID). */
  patientId?: string;
  /** Inclusive lower bound; accepts YYYY-MM-DD (HTML date input) or YYYYMMDD. */
  dateFrom?: string;
  /** Inclusive upper bound; accepts YYYY-MM-DD or YYYYMMDD. */
  dateTo?: string;
  /** Single modality token (e.g. 'CT'); matches any of the study's modalities. */
  modality?: string;
}

export interface StudyRow {
  studyInstanceUid: string;
  /** ISO date (YYYY-MM-DD) or '' when the study has no/invalid StudyDate. */
  date: string;
  description: string;
  /** Display string, tokens joined with ', ' (e.g. 'CT, SR'). */
  modalities: string;
  instances: number;
  accession: string;
  patientName: string;
  mrn: string;
}

/** Lowercase + strip diacritics (NFD), for accent/case-insensitive matching. */
export function normalizeText(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/** DICOM DA (YYYYMMDD) → ISO (YYYY-MM-DD); passes ISO through; '' otherwise. */
export function dicomDateToIso(da: unknown): string {
  const value = String(da ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }
  return '';
}

/** Comparable YYYYMMDD digits from a DA or ISO date; '' when unparseable. */
function comparableDate(value: unknown): string {
  const digits = String(value ?? '').replace(/-/g, '').trim();
  return /^\d{8}$/.test(digits) ? digits : '';
}

/** Split a ModalitiesInStudy string on '\', '/', ',' or whitespace → tokens. */
export function splitModalities(modalities: unknown): string[] {
  return String(modalities ?? '')
    .split(/[\\/,\s]+/)
    .map(token => token.trim().toUpperCase())
    .filter(Boolean);
}

/**
 * Client-side study filtering (the page fetches once, then filters locally):
 * name is accent/case-insensitive, id is case-insensitive, dates are an
 * inclusive [from, to] range on StudyDate (studies without a parseable date
 * are excluded while a date filter is active — RIS-like behaviour), and
 * modality matches any token of ModalitiesInStudy.
 */
export function filterStudies(
  studies: WorklistStudy[],
  filters: StudyFilters = {}
): WorklistStudy[] {
  const name = normalizeText(filters.patientName);
  const id = normalizeText(filters.patientId);
  const from = comparableDate(filters.dateFrom);
  const to = comparableDate(filters.dateTo);
  const modality = String(filters.modality ?? '').trim().toUpperCase();

  return (studies || []).filter(study => {
    if (name && !normalizeText(study.patientName).includes(name)) {
      return false;
    }
    if (id && !normalizeText(study.mrn).includes(id)) {
      return false;
    }
    if (from || to) {
      const date = comparableDate(study.date);
      if (!date || (from && date < from) || (to && date > to)) {
        return false;
      }
    }
    if (modality && !splitModalities(study.modalities).includes(modality)) {
      return false;
    }
    return true;
  });
}

/** Sort studies most-recent first; undated studies sink to the end. */
function byDateDesc(a: WorklistStudy, b: WorklistStudy): number {
  const dateA = comparableDate(a.date);
  const dateB = comparableDate(b.date);
  if (dateA !== dateB) {
    if (!dateA) {
      return 1;
    }
    if (!dateB) {
      return -1;
    }
    return dateB < dateA ? -1 : 1;
  }
  const timeA = String(a.time ?? '');
  const timeB = String(b.time ?? '');
  if (timeA !== timeB) {
    return timeB < timeA ? -1 : 1;
  }
  return 0;
}

/**
 * PATIENT level of the hierarchy: group the (study-centric) QIDO results by
 * PatientID. Studies with an empty PatientID fall back to grouping by
 * normalized name so homonyms without an MRN still cluster deterministically.
 * Groups are sorted by patient name (accent-insensitive), studies inside each
 * group by date descending.
 */
export function groupStudiesByPatient(studies: WorklistStudy[]): PatientGroup[] {
  const groups = new Map<string, PatientGroup>();

  for (const study of studies || []) {
    const mrn = String(study.mrn ?? '').trim();
    const key = mrn || `name:${normalizeText(study.patientName) || 'unknown'}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        patientId: mrn,
        patientName: String(study.patientName ?? '').trim(),
        studies: [],
      };
      groups.set(key, group);
    }
    if (!group.patientName && study.patientName) {
      group.patientName = String(study.patientName).trim();
    }
    group.studies.push(study);
  }

  const result = Array.from(groups.values());
  result.forEach(group => group.studies.sort(byDateDesc));
  result.sort((a, b) => {
    const nameA = normalizeText(a.patientName);
    const nameB = normalizeText(b.patientName);
    if (nameA !== nameB) {
      // Unnamed patients sink to the end.
      if (!nameA) {
        return 1;
      }
      if (!nameB) {
        return -1;
      }
      return nameA < nameB ? -1 : 1;
    }
    return a.patientId < b.patientId ? -1 : a.patientId > b.patientId ? 1 : 0;
  });
  return result;
}

/**
 * Display projection of a study row: DICOM DA → ISO date, modalities joined
 * with ', ', numeric instance count. The series count is NOT part of this row
 * — the study-level QIDO mapper only exposes NumberOfStudyRelatedInstances
 * (qido.js `processResults`), so the series count is only known after the
 * on-demand series expansion.
 */
export function formatStudyRow(study: WorklistStudy): StudyRow {
  return {
    studyInstanceUid: String(study.studyInstanceUid ?? ''),
    date: dicomDateToIso(study.date),
    description: String(study.description ?? ''),
    modalities: splitModalities(study.modalities).join(', '),
    instances: Number(study.instances) || 0,
    accession: String(study.accession ?? ''),
    patientName: String(study.patientName ?? ''),
    mrn: String(study.mrn ?? ''),
  };
}
