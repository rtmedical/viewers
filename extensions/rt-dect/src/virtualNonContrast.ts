/**
 * Virtual non-contrast / virtual unenhanced — pure core (RTV-86).
 *
 * VNC removes the iodine contribution from a contrast-enhanced acquisition and renders
 * what is left. Clinically it is worth a whole acquisition of dose: a
 * portal-venous-only protocol that still produces a "pre-contrast" series saves the
 * patient the true unenhanced scan.
 *
 * The value of that is entirely contingent on the reader knowing where it is **not**
 * equivalent, and that is what this module is mostly about.
 *
 * ## VNC systematically loses calcium
 *
 * Calcium is not in the water/iodine basis, so the solve expresses it as water plus
 * *spurious iodine* — and VNC then subtracts that spurious iodine. The result is that
 * calcified structures come back **darker on VNC than they are in reality**, and small or
 * low-density calcifications can vanish entirely.
 *
 * Two concrete consequences, both refused here rather than left to the reader:
 *
 * - **Agatston scoring on VNC is invalid.** The score is defined on a true non-contrast
 *   acquisition with a 130 HU threshold; on VNC the same plaque falls below threshold or
 *   scores in a lower band, and the number is reported in the same units as a real one.
 *   {@link isValidForCalciumScoring} says no, always.
 * - **A small renal or ureteric stone can disappear.** {@link stoneVisibilityWarning}
 *   flags the size below which a stone is not reliably present on VNC.
 *
 * ## The residual is not zero, and it is not random
 *
 * Even in soft tissue, VNC does not reproduce the true unenhanced HU exactly — it is
 * biased a few HU, and the bias depends on the tissue. {@link vncHu} returns an
 * uncertainty alongside the value so an ROI comparison ("is this cyst 8 HU or 22 HU?") is
 * read with the right precision. An 8-HU-vs-22-HU distinction is exactly the kind that VNC
 * cannot settle and true non-contrast can.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

import { DecompositionResult, muToHu } from './dectDecomposition';

/** Agatston is defined against this threshold on a true non-contrast acquisition. */
export const AGATSTON_THRESHOLD_HU = 130;

/**
 * Typical VNC-vs-true-NC agreement in soft tissue, in HU (1σ).
 *
 * Literature reports roughly ±10 HU across tissues and scanners. It is a reference value,
 * exported so it can be replaced by a site's own phantom measurement, and it is what makes
 * the 8-vs-22 HU question unanswerable on VNC.
 */
export const VNC_SOFT_TISSUE_UNCERTAINTY_HU = 10;

/**
 * Below this size a stone is not reliably visible on VNC.
 *
 * Reported in the literature between 2 and 5 mm depending on density; 3 mm is the
 * conservative middle. A parameter, because the answer depends on the scanner and the
 * reconstruction.
 */
export const STONE_VISIBILITY_LIMIT_MM = 3;

export interface VncOptions {
  /** Per-voxel input noise, HU. Feeds the uncertainty. */
  inputNoiseHu?: number;
  /** Site-measured VNC bias, replacing the reference value. */
  softTissueUncertaintyHu?: number;
}

export interface VncResult {
  /** The virtual unenhanced value, in HU. */
  hu: number;
  /**
   * How far this can be from the true unenhanced HU, 1σ.
   *
   * Reported alongside the value, always — a VNC number quoted without it invites the
   * cyst-versus-solid comparison that VNC cannot make.
   */
  uncertaintyHu: number;
  /** How much iodine was removed, in HU at the low-energy spectrum. */
  removedIodineHu: number;
  ok: boolean;
  reason?: string;
}

/**
 * The virtual unenhanced HU for one voxel.
 *
 * The water basis density *is* the virtual unenhanced image: it is what the material would
 * have attenuated with the iodine taken out. Converting it back to HU is the whole
 * operation; everything else in this file is about what it does not mean.
 */
export function vncHu(
  decomposition: DecompositionResult,
  originalHu: number,
  options: VncOptions = {}
): VncResult {
  if (!decomposition?.ok) {
    return {
      hu: 0,
      uncertaintyHu: 0,
      removedIodineHu: 0,
      ok: false,
      reason: decomposition?.reason ?? 'Decomposição indisponível.',
    };
  }

  const hu = muToHu(Number(decomposition.densityA));
  const original = Number(originalHu);

  const bias = positiveOr(
    options.softTissueUncertaintyHu,
    VNC_SOFT_TISSUE_UNCERTAINTY_HU
  );
  const noise = Number(options.inputNoiseHu);
  const gain = Number(decomposition.noiseGainA);
  const propagated =
    Number.isFinite(noise) && noise > 0 && Number.isFinite(gain) ? noise * gain : 0;

  return {
    hu,
    // The systematic bias and the propagated noise are independent, so they add in
    // quadrature. Adding them linearly would over-state the uncertainty and make VNC look
    // useless; taking only the larger would under-state it.
    uncertaintyHu: Math.sqrt(bias * bias + propagated * propagated),
    removedIodineHu: Number.isFinite(original) ? original - hu : 0,
    ok: true,
  };
}

function positiveOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export interface ScoringVerdict {
  valid: boolean;
  reason: string;
}

/**
 * Whether a VNC series may be used for coronary calcium scoring.
 *
 * Always no. The Agatston score is defined on a true non-contrast acquisition against a
 * 130 HU threshold, and VNC systematically darkens calcium — so the same plaque scores in
 * a lower band or falls below threshold entirely. The score would come out in the same
 * units as a real one, which is what makes it dangerous rather than merely wrong.
 *
 * Exported as a function returning a reason rather than as a comment, because the thing
 * that stops this happening is a call site that cannot proceed, not documentation.
 */
export function isValidForCalciumScoring(): ScoringVerdict {
  return {
    valid: false,
    reason:
      `Escore de cálcio (Agatston) exige aquisição sem contraste verdadeira: a VNC subtrai ` +
      `cálcio junto com o iodo e o mesmo placa cai abaixo do limiar de ${AGATSTON_THRESHOLD_HU} HU ` +
      `ou pontua numa faixa menor, com o resultado saindo na mesma unidade de um escore real.`,
  };
}

export interface StoneWarning {
  reliable: boolean;
  message: string;
}

/**
 * Whether a stone of this size can be trusted to appear on VNC.
 *
 * A negative VNC in a patient with renal colic is the failure mode: the stone is there, the
 * VNC does not show it, and the reader concludes there is no stone.
 */
export function stoneVisibilityWarning(
  sizeMm: number,
  limitMm = STONE_VISIBILITY_LIMIT_MM
): StoneWarning {
  const size = Number(sizeMm);
  const limit = positiveOr(limitMm, STONE_VISIBILITY_LIMIT_MM);
  if (!Number.isFinite(size) || size <= 0) {
    return {
      reliable: false,
      message: `Cálculos abaixo de ${limit} mm podem não aparecer na VNC — a subtração remove cálcio junto com o iodo.`,
    };
  }
  if (size < limit) {
    return {
      reliable: false,
      message: `Cálculo de ${size} mm está abaixo do limite de confiabilidade da VNC (${limit} mm); ausência na VNC não exclui.`,
    };
  }
  return { reliable: true, message: '' };
}

export type VncComparison = 'clearlyBelow' | 'clearlyAbove' | 'inconclusive' | 'unavailable';

export interface VncThresholdRead {
  verdict: VncComparison;
  hu: number;
  uncertaintyHu: number;
  message: string;
}

/**
 * Compares a VNC value with a diagnostic threshold, honestly.
 *
 * The classic use is "is this renal lesion a simple cyst (< 20 HU) on the unenhanced
 * image?". With a ±10 HU uncertainty, a VNC of 18 HU cannot answer it — and the answer
 * "inconclusive" is what sends the patient for the true non-contrast that can.
 *
 * The comparison uses 2σ, not the point value. A point comparison against a threshold is
 * how a measurement with known uncertainty gets reported as a fact.
 */
export function compareToThreshold(
  result: VncResult,
  thresholdHu: number,
  label = 'limiar'
): VncThresholdRead {
  if (!result?.ok) {
    return {
      verdict: 'unavailable',
      hu: 0,
      uncertaintyHu: 0,
      message: result?.reason ?? 'VNC indisponível.',
    };
  }
  const threshold = Number(thresholdHu);
  const margin = 2 * result.uncertaintyHu;

  if (result.hu + margin < threshold) {
    return {
      verdict: 'clearlyBelow',
      hu: result.hu,
      uncertaintyHu: result.uncertaintyHu,
      message: `${result.hu.toFixed(0)} ± ${result.uncertaintyHu.toFixed(0)} HU — abaixo do ${label} de ${threshold} HU.`,
    };
  }
  if (result.hu - margin > threshold) {
    return {
      verdict: 'clearlyAbove',
      hu: result.hu,
      uncertaintyHu: result.uncertaintyHu,
      message: `${result.hu.toFixed(0)} ± ${result.uncertaintyHu.toFixed(0)} HU — acima do ${label} de ${threshold} HU.`,
    };
  }
  return {
    verdict: 'inconclusive',
    hu: result.hu,
    uncertaintyHu: result.uncertaintyHu,
    message: `${result.hu.toFixed(0)} ± ${result.uncertaintyHu.toFixed(0)} HU — a incerteza da VNC cruza o ${label} de ${threshold} HU; use aquisição sem contraste verdadeira.`,
  };
}

/** One line for the VNC series description, so the caveat travels with the pixels. */
export function vncSeriesDescription(sourceDescription?: string): string {
  const source = String(sourceDescription ?? '').trim();
  const base = 'VNC (sem contraste virtual) — NÃO equivale a aquisição sem contraste';
  return source ? `${base} · derivada de ${source}` : base;
}

/** Readout for a VNC ROI. */
export function describeVnc(result: VncResult): string {
  if (!result?.ok) {
    return result?.reason ?? '';
  }
  const removed =
    Math.abs(result.removedIodineHu) > 0.5
      ? ` (iodo removido: ${result.removedIodineHu.toFixed(0)} HU)`
      : '';
  return `VNC ${result.hu.toFixed(0)} ± ${result.uncertaintyHu.toFixed(0)} HU${removed}`;
}
