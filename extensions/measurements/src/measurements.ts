/**
 * Pure **advanced measurement calculators** (RTV-27 epic): HU statistics
 * (RTV-28), SUVbw conversion (RTV-29), Cobb angle (RTV-30), Agatston calcium
 * score (RTV-46).
 *
 * Framework-free and `@ohif/*`-free: every function is pure and unit-tested.
 * Capturing the ROI pixels / line annotations / lesion masks from the
 * cornerstone viewport is an integration follow-up — these are the formulas the
 * viewport layer would feed.
 */

// ---------------------------------------------------------------- HU statistics
export interface HuStats {
  count: number;
  min?: number;
  max?: number;
  mean?: number;
  /** Population standard deviation. */
  sd?: number;
}

export function huStats(values: number[]): HuStats {
  const v = (values ?? []).filter(n => Number.isFinite(n));
  if (!v.length) return { count: 0 };
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const x of v) {
    if (x < min) min = x;
    if (x > max) max = x;
    sum += x;
  }
  const mean = sum / v.length;
  const variance = v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length;
  return { count: v.length, min, max, mean, sd: Math.sqrt(variance) };
}

// ----------------------------------------------------------------- Cobb angle
export type Point = [number, number];

function lineAngleDeg([a, b]: [Point, Point]): number {
  return (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
}

/**
 * Acute angle (degrees, 0–90) between two lines, each given as a [start, end]
 * point pair — the Cobb angle convention.
 */
export function cobbAngle(line1: [Point, Point], line2: [Point, Point]): number {
  let diff = Math.abs(lineAngleDeg(line1) - lineAngleDeg(line2)) % 180;
  if (diff > 90) diff = 180 - diff;
  return Math.round(diff * 100) / 100;
}

// ------------------------------------------------------------- Agatston score
/** Agatston density weight from a lesion's peak HU. */
export function agatstonWeight(maxHu: number): 0 | 1 | 2 | 3 | 4 {
  if (maxHu >= 400) return 4;
  if (maxHu >= 300) return 3;
  if (maxHu >= 200) return 2;
  if (maxHu >= 130) return 1;
  return 0;
}

export interface CalciumLesion {
  /** Lesion area in mm². */
  areaMm2: number;
  /** Peak HU within the lesion. */
  maxHu: number;
}

export interface AgatstonResult {
  total: number;
  perLesion: number[];
}

/** Agatston score = Σ (lesion area × density weight). */
export function agatstonScore(lesions: CalciumLesion[]): AgatstonResult {
  const perLesion = (lesions ?? []).map(l => {
    const area = Number.isFinite(l?.areaMm2) ? l.areaMm2 : 0;
    return area * agatstonWeight(l?.maxHu ?? 0);
  });
  return { total: Math.round(perLesion.reduce((a, b) => a + b, 0) * 100) / 100, perLesion };
}

// ---------------------------------------------------------------- SUVbw (PET)
/** Parse DICOM TM (HHMMSS[.ffffff]) to seconds of day. */
export function dicomTimeToSeconds(tm?: string): number | undefined {
  if (!tm) return undefined;
  const m = /^(\d{2})(\d{2})(\d{2}(?:\.\d+)?)/.exec(String(tm));
  if (!m) return undefined;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

export interface RadiopharmaceuticalInfo {
  injectedDoseBq?: number;
  halfLifeSec?: number;
  injectionTime?: string;
}

/** Pull radiopharmaceutical info from a naturalized PET instance. */
export function parseRadiopharmaceutical(instance: Record<string, any>): RadiopharmaceuticalInfo {
  const seq = instance?.RadiopharmaceuticalInformationSequence;
  const item = Array.isArray(seq) ? seq[0] : seq;
  if (!item) return {};
  return {
    injectedDoseBq: Number(item.RadionuclideTotalDose) || undefined,
    halfLifeSec: Number(item.RadionuclideHalfLife) || undefined,
    injectionTime: item.RadiopharmaceuticalStartTime,
  };
}

export interface SuvFactorParams {
  patientWeightKg: number;
  injectedDoseBq: number;
  halfLifeSec: number;
  injectionTime?: string;
  scanTime?: string;
  /** Override elapsed seconds (else derived from times). */
  elapsedSec?: number;
}

/**
 * SUVbw conversion factor: SUVbw = pixelActivityConc(Bq/mL) × factor, where
 * factor = patientWeight(g) / decay-corrected injected dose(Bq).
 * Returns undefined if inputs are insufficient.
 */
export function suvBwFactor(params: SuvFactorParams): number | undefined {
  const { patientWeightKg, injectedDoseBq, halfLifeSec } = params;
  if (!(patientWeightKg > 0) || !(injectedDoseBq > 0) || !(halfLifeSec > 0)) return undefined;
  let elapsed = params.elapsedSec;
  if (elapsed == null) {
    const inj = dicomTimeToSeconds(params.injectionTime);
    const scan = dicomTimeToSeconds(params.scanTime);
    if (inj != null && scan != null) {
      elapsed = scan - inj;
      if (elapsed < 0) elapsed += 24 * 3600; // crossed midnight
    } else {
      elapsed = 0;
    }
  }
  const decayedDose = injectedDoseBq * Math.pow(2, -elapsed / halfLifeSec);
  if (!(decayedDose > 0)) return undefined;
  return (patientWeightKg * 1000) / decayedDose;
}

export function convertToSuvBw(activityConcentrationBq: number, factor: number): number {
  return activityConcentrationBq * factor;
}

export interface SuvStats {
  count: number;
  maxSuv?: number;
  meanSuv?: number;
  minSuv?: number;
}

/** SUVbw stats over a set of activity-concentration values (Bq/mL). */
export function suvStats(activityValuesBq: number[], factor: number): SuvStats {
  const suv = (activityValuesBq ?? []).filter(n => Number.isFinite(n)).map(v => convertToSuvBw(v, factor));
  if (!suv.length) return { count: 0 };
  return {
    count: suv.length,
    maxSuv: Math.max(...suv),
    minSuv: Math.min(...suv),
    meanSuv: suv.reduce((a, b) => a + b, 0) / suv.length,
  };
}
