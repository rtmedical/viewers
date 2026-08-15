/**
 * Iodine mapping and quantification — pure core (RTV-85).
 *
 * Reads the iodine basis density from `dectDecomposition` as a concentration in mg/mL, and
 * answers the question an iodine map is actually asked: **is this lesion enhancing?**
 *
 * ## Everything outside the basis gets projected onto it
 *
 * This is the caveat that matters, and it is a property of two-material decomposition, not
 * a bug to be fixed. The basis is water and iodine. A voxel of calcium is neither — but the
 * solve has only two directions to express it in, so calcium lands as *some water plus some
 * iodine*. Dense calcium can report several mg/mL of iodine that is not there.
 *
 * The consequence is concrete: a calcified renal cyst reads as enhancing, and enhancement
 * is the difference between "follow up" and "resect". {@link iodineConcentration} flags a
 * voxel whose combined attenuation is in the calcium range, and {@link assessEnhancement}
 * refuses to call it enhancing on the iodine map alone.
 *
 * ## Below the noise floor there is no iodine, there is noise
 *
 * The decomposition happily returns 0.3 mg/mL for a voxel of pure water, because the input
 * HU had noise in it. Rendering that as a faint blush on a colour map creates enhancement
 * where there is none, in exactly the low-contrast lesions people use iodine maps to
 * settle.
 *
 * So there is a floor, it is derived from the input noise and the decomposition's exact
 * noise gain rather than being a magic number, and values under it are reported as
 * **`none`** — not as a small quantity. The floor is returned so the reader can see what
 * the study was actually capable of resolving.
 *
 * ## The threshold that decides is clinical, not technical
 *
 * {@link IODINE_ENHANCEMENT_MG_ML} is 2 mg/mL, the commonly cited threshold for a renal
 * lesion. It is a parameter, not a constant, because it differs by organ and by
 * institution — and because a threshold buried in a function is a threshold nobody
 * revisits.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

import { DecompositionResult } from './dectDecomposition';

/**
 * mg/mL of iodine per unit of the iodine basis density.
 *
 * Scanner- and calibration-dependent; the reference basis in `dectDecomposition` is
 * normalised so a density of 1 is pure iodine at 4.93 g/mL. A deployment calibrates this
 * from a phantom, so it is a parameter.
 */
export const DEFAULT_IODINE_CALIBRATION_MG_ML = 4930;

/** Commonly cited threshold for a renal lesion. Organ- and site-dependent. */
export const IODINE_ENHANCEMENT_MG_ML = 2;

/** Attenuation range where calcium is plausible and the water/iodine basis lies. */
export const CALCIUM_SUSPICION_HU = 130;

export type IodineLevel = 'none' | 'trace' | 'enhancing';

export interface IodineOptions {
  calibrationMgPerMl?: number;
  /** Standard deviation of the input HU. Sets the noise floor. */
  inputNoiseHu?: number;
  /** Mean of the two acquisitions, used for the calcium check. */
  meanHu?: number;
  enhancementThresholdMgMl?: number;
}

export interface IodineResult {
  /** mg/mL. Zero when below the noise floor — see the module note. */
  concentrationMgMl: number;
  /** The smallest concentration this acquisition could distinguish from zero. */
  noiseFloorMgMl: number;
  level: IodineLevel;
  /** True when the attenuation is high enough that calcium could be masquerading. */
  calciumSuspected: boolean;
  ok: boolean;
  reason?: string;
}

/**
 * Iodine concentration from a decomposition.
 *
 * The noise floor is `3σ` of the propagated input noise: three standard deviations is the
 * conventional line between "a value" and "a value indistinguishable from zero", and using
 * the propagated noise rather than a fixed number means a noisy acquisition gets a higher
 * floor instead of a more confident-looking map.
 *
 * The propagation uses `noiseGainB` from the decomposition, which is the exact row norm of
 * the inverse — not the condition number. The two differ by the scale disparity between
 * water and iodine, which is signal. It is worth knowing how large the honest floor is:
 * at 10 HU of per-voxel noise on an 80/140 pair it is around 10 mg/mL, which is why single
 * voxels are never quoted and why {@link roiStatistics} exists.
 */
export function iodineConcentration(
  decomposition: DecompositionResult,
  options: IodineOptions = {}
): IodineResult {
  const calibration = positiveOr(
    options.calibrationMgPerMl,
    DEFAULT_IODINE_CALIBRATION_MG_ML
  );
  const threshold = positiveOr(options.enhancementThresholdMgMl, IODINE_ENHANCEMENT_MG_ML);

  const empty: IodineResult = {
    concentrationMgMl: 0,
    noiseFloorMgMl: 0,
    level: 'none',
    calciumSuspected: false,
    ok: false,
  };

  if (!decomposition?.ok) {
    return { ...empty, reason: decomposition?.reason ?? 'Decomposição indisponível.' };
  }

  // Input noise propagates through the solve at exactly `noiseGainB` — the row norm of
  // the inverse — not at the condition number. Using kappa here would over-state the floor
  // by the scale disparity between the two basis materials, which is signal and not noise.
  const inputNoise = Number(options.inputNoiseHu);
  const gain = Number(decomposition.noiseGainB);
  const noiseFloorMgMl =
    Number.isFinite(inputNoise) && inputNoise > 0 && Number.isFinite(gain)
      ? 3 * (inputNoise / 1000) * gain * calibration
      : 0;

  const raw = Number(decomposition.densityB) * calibration;
  const meanHu = Number(options.meanHu);
  const calciumSuspected = Number.isFinite(meanHu) && meanHu >= CALCIUM_SUSPICION_HU;

  if (!(raw > noiseFloorMgMl)) {
    return {
      concentrationMgMl: 0,
      noiseFloorMgMl,
      level: 'none',
      calciumSuspected,
      ok: true,
    };
  }

  return {
    concentrationMgMl: raw,
    noiseFloorMgMl,
    level: raw >= threshold ? 'enhancing' : 'trace',
    calciumSuspected,
    ok: true,
  };
}

function positiveOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export type EnhancementVerdict =
  | 'enhancing'
  | 'notEnhancing'
  | 'indeterminate'
  | 'calciumConfound'
  | 'unavailable';

export interface EnhancementAssessment {
  verdict: EnhancementVerdict;
  concentrationMgMl: number;
  message: string;
  /** True when the answer needs something the iodine map cannot supply. */
  needsTrueNonContrast: boolean;
}

/**
 * The clinical read of an iodine ROI.
 *
 * Returns `calciumConfound` rather than a number when the attenuation says calcium could be
 * doing the work — because on the iodine map a calcified cyst and an enhancing lesion look
 * the same, and that difference is "follow up" versus "resect".
 *
 * `indeterminate` is a real answer: a concentration between the noise floor and the
 * threshold means the study cannot settle it, and saying so sends the patient to a true
 * non-contrast comparison instead of to surgery.
 */
export function assessEnhancement(
  result: IodineResult,
  thresholdMgMl = IODINE_ENHANCEMENT_MG_ML
): EnhancementAssessment {
  if (!result?.ok) {
    return {
      verdict: 'unavailable',
      concentrationMgMl: 0,
      message: result?.reason ?? 'Mapa de iodo indisponível.',
      needsTrueNonContrast: true,
    };
  }

  const value = result.concentrationMgMl;

  if (result.calciumSuspected) {
    return {
      verdict: 'calciumConfound',
      concentrationMgMl: value,
      message:
        'Atenuação na faixa de cálcio — cálcio é projetado sobre a base de iodo e pode simular realce. Compare com aquisição sem contraste.',
      needsTrueNonContrast: true,
    };
  }

  if (value <= 0) {
    return {
      verdict: 'notEnhancing',
      concentrationMgMl: 0,
      message:
        result.noiseFloorMgMl > 0
          ? `Sem iodo detectável (piso de ruído ${result.noiseFloorMgMl.toFixed(1)} mg/mL).`
          : 'Sem iodo detectável.',
      needsTrueNonContrast: false,
    };
  }

  if (value >= thresholdMgMl) {
    return {
      verdict: 'enhancing',
      concentrationMgMl: value,
      message: `Realce: ${value.toFixed(1)} mg/mL de iodo (limiar ${thresholdMgMl}).`,
      needsTrueNonContrast: false,
    };
  }

  return {
    verdict: 'indeterminate',
    concentrationMgMl: value,
    message: `${value.toFixed(1)} mg/mL — entre o piso de ruído e o limiar de ${thresholdMgMl}; este exame não decide.`,
    needsTrueNonContrast: true,
  };
}

export interface RoiStatistics {
  meanMgMl: number;
  maxMgMl: number;
  /** Fraction of voxels above the enhancement threshold. */
  enhancingFraction: number;
  voxels: number;
  /** Voxels excluded because calcium was suspected. */
  excludedForCalcium: number;
}

/**
 * ROI statistics over a set of already-computed voxel results.
 *
 * Calcium-suspect voxels are **excluded from the mean and counted separately** rather than
 * averaged in. Averaging them in is how a rim of calcification drags a non-enhancing cyst
 * over the threshold — the mean is the number the radiologist quotes, and it must not be
 * contaminated by voxels the module already knows it cannot interpret.
 */
export function roiStatistics(
  results: IodineResult[],
  thresholdMgMl = IODINE_ENHANCEMENT_MG_ML
): RoiStatistics {
  const usable = (results ?? []).filter(r => r?.ok && !r.calciumSuspected);
  const excluded = (results ?? []).filter(r => r?.ok && r.calciumSuspected).length;

  if (!usable.length) {
    return { meanMgMl: 0, maxMgMl: 0, enhancingFraction: 0, voxels: 0, excludedForCalcium: excluded };
  }

  let sum = 0;
  let max = 0;
  let above = 0;
  for (const r of usable) {
    sum += r.concentrationMgMl;
    max = Math.max(max, r.concentrationMgMl);
    if (r.concentrationMgMl >= thresholdMgMl) {
      above += 1;
    }
  }

  return {
    meanMgMl: sum / usable.length,
    maxMgMl: max,
    enhancingFraction: above / usable.length,
    voxels: usable.length,
    excludedForCalcium: excluded,
  };
}

/** One line for the ROI readout. */
export function describeRoi(stats: RoiStatistics): string {
  if (!stats || !stats.voxels) {
    return stats?.excludedForCalcium
      ? `Nenhum voxel interpretável (${stats.excludedForCalcium} excluídos por cálcio).`
      : 'ROI vazia.';
  }
  const excluded = stats.excludedForCalcium
    ? ` · ${stats.excludedForCalcium} voxels excluídos por cálcio`
    : '';
  return `Iodo médio ${stats.meanMgMl.toFixed(1)} mg/mL (máx ${stats.maxMgMl.toFixed(1)}) · ${(
    stats.enhancingFraction * 100
  ).toFixed(0)}% dos voxels acima do limiar${excluded}`;
}
