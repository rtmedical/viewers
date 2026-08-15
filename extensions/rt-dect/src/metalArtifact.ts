/**
 * Metal artefact reduction by dual-energy — pure core (RTV-91).
 *
 * A high-keV virtual monochromatic image reduces streaking around a prosthesis, and it is
 * one of the more visibly impressive things dual-energy does. What matters for using it
 * safely is knowing which half of the artefact it fixes.
 *
 * ## Beam hardening is spectral. Photon starvation is missing data.
 *
 * Both produce dark streaks between dense objects and both are called "metal artefact",
 * but they have nothing in common underneath:
 *
 * - **Beam hardening** is a spectral effect — the low-energy photons are absorbed
 *   preferentially, the effective spectrum shifts, and the reconstruction's linearity
 *   assumption breaks. Synthesising a *monochromatic* image is exactly the right fix,
 *   because a monochromatic beam cannot harden.
 * - **Photon starvation** is a count problem: through the long axis of a hip prosthesis,
 *   almost nothing reaches the detector. **No spectral trick recovers information that was
 *   never measured.** A high-keV VMI makes those streaks look smoother while adding
 *   nothing, which is arguably worse than leaving them visible.
 *
 * {@link classifyArtefact} separates them by their signature — beam hardening is
 * energy-dependent and photon starvation is not — and {@link expectedImprovement} refuses
 * to promise an improvement it cannot deliver.
 *
 * ## The MAR keV is not the diagnostic keV
 *
 * Artefact suppression keeps improving up to 130–140 keV. Iodine contrast is nearly gone
 * by then. So a MAR reconstruction is a **separate series alongside** the diagnostic one,
 * not a replacement — and {@link recommendMarKev} returns both the artefact-optimal energy
 * and the contrast cost of using it, so nobody quietly reads a post-contrast study at
 * 140 keV.
 *
 * ## It is not a substitute for projection-based MAR
 *
 * iMAR/O-MAR operate on the sinogram and address the missing data that VMI cannot. The two
 * are complementary and routinely used together. This module says so rather than implying
 * dual-energy is sufficient.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

import { vmiNoiseAmplification } from './dectDecomposition';

/** Artefact suppression keeps improving up to about here. */
export const MAR_KEV_MAX = 140;
/** Below this, high-keV synthesis is not doing meaningful artefact suppression. */
export const MAR_KEV_MIN = 95;

/** Standard deviation ratio above which a region is called artefact-degraded. */
export const ARTEFACT_SD_RATIO = 2;

export type ArtefactKind = 'beamHardening' | 'photonStarvation' | 'mixed' | 'none';

export interface ArtefactSample {
  /** HU standard deviation in a ROI beside the metal, at the LOW-kVp acquisition. */
  sdLow: number;
  /** Same ROI, high-kVp acquisition. */
  sdHigh: number;
  /** HU standard deviation in an unaffected reference ROI. */
  sdReference: number;
}

export interface ArtefactClassification {
  kind: ArtefactKind;
  /** How much noisier the affected region is than the reference. */
  severity: number;
  /**
   * How much of the excess is energy-dependent, 0..1.
   *
   * Beam hardening is much worse at low kVp; photon starvation is roughly the same at
   * both. This fraction is what tells them apart.
   */
  spectralFraction: number;
  message: string;
}

/**
 * Separates beam hardening from photon starvation by their energy dependence.
 *
 * The excess standard deviation over the reference is split: the part that shrinks at high
 * kVp is spectral and a VMI can address it, the part that does not is missing data and a
 * VMI cannot.
 */
export function classifyArtefact(sample: ArtefactSample): ArtefactClassification {
  const sdLow = Number(sample?.sdLow);
  const sdHigh = Number(sample?.sdHigh);
  const sdReference = Number(sample?.sdReference);

  if (
    ![sdLow, sdHigh, sdReference].every(v => Number.isFinite(v) && v >= 0) ||
    sdReference <= 0
  ) {
    return {
      kind: 'none',
      severity: 0,
      spectralFraction: 0,
      message: 'Amostras insuficientes para classificar o artefato.',
    };
  }

  const severity = Math.max(sdLow, sdHigh) / sdReference;
  if (severity < ARTEFACT_SD_RATIO) {
    return {
      kind: 'none',
      severity,
      spectralFraction: 0,
      message: 'Sem artefato significativo em relação à referência.',
    };
  }

  const excessLow = Math.max(0, sdLow - sdReference);
  const excessHigh = Math.max(0, sdHigh - sdReference);
  // The part that survives at high kVp is not spectral.
  const spectralFraction =
    excessLow > 0 ? Math.min(1, Math.max(0, (excessLow - excessHigh) / excessLow)) : 0;

  if (spectralFraction >= 0.6) {
    return {
      kind: 'beamHardening',
      severity,
      spectralFraction,
      message:
        'Predominantemente endurecimento de feixe — efeito espectral; VMI de alta energia deve reduzir.',
    };
  }
  if (spectralFraction <= 0.25) {
    return {
      kind: 'photonStarvation',
      severity,
      spectralFraction,
      message:
        'Predominantemente falta de fótons — dado que não foi medido. VMI NÃO recupera; considere MAR de projeção (iMAR/O-MAR).',
    };
  }
  return {
    kind: 'mixed',
    severity,
    spectralFraction,
    message:
      'Misto: parte espectral, parte falta de fótons. VMI reduz só a parcela espectral; combine com MAR de projeção.',
  };
}

export interface MarRecommendation {
  /** keV that best suppresses the artefact. */
  kev: number;
  /** Fraction of the artefact this is expected to remove, 0..1. */
  expectedReduction: number;
  /** Iodine contrast remaining at that energy, relative to 70 keV. */
  iodineContrastRetained: number;
  /** Noise relative to a 70 keV image. */
  noiseFactor: number;
  /** True when a separate diagnostic series is needed alongside. */
  needsSeparateDiagnosticSeries: boolean;
  message: string;
}

/**
 * Contrast of iodine at `kev`, relative to 70 keV.
 *
 * Falls steeply with energy — which is the whole cost of MAR reconstruction and the reason
 * it cannot be the only series.
 */
export function iodineContrastAt(kev: number): number {
  const e = Math.max(40, Math.min(200, Number(kev) || 70));
  // Photoelectric contribution falls as ~E^-3; normalised at 70 keV.
  return Math.pow(70 / e, 3);
}

/**
 * The keV to reconstruct the MAR series at, and what it costs.
 *
 * Returns the contrast cost alongside the energy, always, so nobody quietly reads a
 * post-contrast study at 140 keV.
 */
export function recommendMarKev(
  classification: ArtefactClassification,
  contrastEnhanced = false
): MarRecommendation {
  const noArtefact: MarRecommendation = {
    kev: 70,
    expectedReduction: 0,
    iodineContrastRetained: 1,
    noiseFactor: 1,
    needsSeparateDiagnosticSeries: false,
    message: 'Sem artefato relevante — não há motivo para reconstruir em alta energia.',
  };

  if (!classification || classification.kind === 'none') {
    return noArtefact;
  }

  // Suppression saturates; going past 140 keV buys almost nothing and costs contrast.
  const kev = classification.kind === 'photonStarvation' ? MAR_KEV_MIN : MAR_KEV_MAX;
  const expectedReduction = expectedImprovement(classification, kev);
  const iodineContrastRetained = iodineContrastAt(kev);

  return {
    kev,
    expectedReduction,
    iodineContrastRetained,
    noiseFactor: vmiNoiseAmplification(kev),
    needsSeparateDiagnosticSeries: contrastEnhanced && iodineContrastRetained < 0.5,
    message: buildMessage(classification, kev, expectedReduction, iodineContrastRetained, contrastEnhanced),
  };
}

/**
 * How much of the artefact a VMI at `kev` can actually remove.
 *
 * Bounded by the spectral fraction: a VMI cannot touch what is not spectral, so an artefact
 * that is 80% photon starvation cannot be more than 20% improved however high the energy
 * goes. Promising more is how a reader concludes the prosthesis is fine.
 */
export function expectedImprovement(
  classification: ArtefactClassification,
  kev: number
): number {
  if (!classification || classification.kind === 'none') {
    return 0;
  }
  const e = Math.max(40, Math.min(MAR_KEV_MAX, Number(kev) || 70));
  // Suppression rises with energy and saturates near the top of the range.
  const energyFactor = Math.min(1, Math.max(0, (e - 70) / (MAR_KEV_MAX - 70)));
  return classification.spectralFraction * energyFactor;
}

function buildMessage(
  classification: ArtefactClassification,
  kev: number,
  reduction: number,
  contrastRetained: number,
  contrastEnhanced: boolean
): string {
  const parts = [
    `Reconstruir MAR em ${kev} keV; redução esperada de ~${Math.round(reduction * 100)}% do artefato.`,
  ];
  if (classification.kind !== 'beamHardening') {
    parts.push(classification.message);
  }
  parts.push(
    `Contraste de iodo remanescente ${Math.round(contrastRetained * 100)}% em relação a 70 keV.`
  );
  if (contrastEnhanced && contrastRetained < 0.5) {
    parts.push(
      'Estudo com contraste: mantenha uma série diagnóstica separada — a série MAR não serve para avaliar realce.'
    );
  }
  return parts.join(' ');
}

/**
 * Whether dual-energy MAR alone is enough for this artefact.
 *
 * Says no whenever there is a meaningful non-spectral component, and names the alternative.
 * iMAR/O-MAR operate on the sinogram and address exactly the part a VMI cannot.
 */
export function needsProjectionMar(classification: ArtefactClassification): {
  needed: boolean;
  reason: string;
} {
  if (!classification || classification.kind === 'none') {
    return { needed: false, reason: '' };
  }
  if (classification.spectralFraction >= 0.75) {
    return { needed: false, reason: '' };
  }
  return {
    needed: true,
    reason:
      `${Math.round((1 - classification.spectralFraction) * 100)}% do artefato não é espectral — ` +
      'a VMI não alcança essa parte. MAR de projeção (iMAR/O-MAR) atua no sinograma e é complementar, não alternativa.',
  };
}

/** Readout line for the MAR panel. */
export function describeMar(
  classification: ArtefactClassification,
  recommendation: MarRecommendation
): string {
  if (!classification || !recommendation) {
    return '';
  }
  if (classification.kind === 'none') {
    return classification.message;
  }
  const severity = `Artefato ${classification.severity.toFixed(1)}× a referência`;
  const projection = needsProjectionMar(classification);
  return [severity, recommendation.message, projection.reason].filter(Boolean).join(' ');
}
