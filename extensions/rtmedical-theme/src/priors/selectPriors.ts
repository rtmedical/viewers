/**
 * Prior-study selection (RTV-22) — framework-free, unit-tested.
 *
 * Given the current study and the patient's study list, returns the UIDs of the
 * N most-recent priors (StudyDate strictly before the current study, optionally
 * filtered to the same modality). The caller appends these to the viewer
 * navigation (StudyInstanceUIDs=current,prior1,...) so the rt-comparison-2up
 * hanging protocol lays them out current/prior side-by-side.
 *
 * The live DICOMweb query that produces the patient's study list (by PatientID,
 * incl. remote Q/R) is the integration layer (needs a data source) — this module
 * is the pure ranking/filtering logic. Zero-fork (RTV-114).
 */
export interface StudySummary {
  StudyInstanceUID: string;
  /** DICOM DA, "YYYYMMDD". */
  StudyDate?: string;
  /** Either "CT\\MR" or ['CT','MR']. */
  ModalitiesInStudy?: string | string[];
}

export interface SelectPriorsOptions {
  /** How many priors to return (default 1). */
  count?: number;
  /** Restrict to studies sharing a modality with this (defaults to the current study's). */
  sameModalityAs?: string | string[];
}

function parseStudyDate(date?: string): number | undefined {
  if (!date) {
    return undefined;
  }
  const digits = date.replace(/\D/g, '');
  if (digits.length < 8) {
    return undefined;
  }
  const value = Number(digits.slice(0, 8));
  return Number.isFinite(value) ? value : undefined;
}

function normalizeModalities(modalities?: string | string[]): string[] {
  if (!modalities) {
    return [];
  }
  const list = Array.isArray(modalities) ? modalities : modalities.split('\\');
  return list.map(m => m.trim().toUpperCase()).filter(Boolean);
}

export function selectPriors(
  current: StudySummary,
  studies: StudySummary[],
  options: SelectPriorsOptions = {}
): string[] {
  const count = Math.max(0, options.count ?? 1);
  if (count === 0) {
    return [];
  }
  const currentDate = parseStudyDate(current.StudyDate);
  const wanted = normalizeModalities(options.sameModalityAs ?? current.ModalitiesInStudy);

  return studies
    .filter(s => s.StudyInstanceUID && s.StudyInstanceUID !== current.StudyInstanceUID)
    .filter(s => {
      const d = parseStudyDate(s.StudyDate);
      // Keep only dated studies strictly earlier than the current study.
      return d !== undefined && (currentDate === undefined || d < currentDate);
    })
    .filter(s => {
      if (wanted.length === 0) {
        return true;
      }
      const mods = normalizeModalities(s.ModalitiesInStudy);
      return mods.some(m => wanted.includes(m));
    })
    .sort((a, b) => (parseStudyDate(b.StudyDate) ?? 0) - (parseStudyDate(a.StudyDate) ?? 0))
    .slice(0, count)
    .map(s => s.StudyInstanceUID);
}
