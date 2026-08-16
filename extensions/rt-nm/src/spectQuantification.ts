/**
 * SPECT quantification: counts, %ID, target-to-background and relative renal function —
 * pure core (RTV-209).
 *
 * PET quantification lives in `@ohif/extension-rt-pet` and does not transfer. SPECT is a
 * different measurement with a different failure mode, and the difference is the first
 * thing this module enforces.
 *
 * ## There is no SUV here, and the absence has to be defended
 *
 * A PET scanner is cross-calibrated against a dose calibrator, so counts convert to
 * becquerels and SUV means something across scanners and across days. A conventional gamma
 * camera is not. Its counts depend on collimator, matrix, acquisition time, distance and
 * the operator's choices, and **the same patient re-imaged on the camera next door produces
 * a different number**.
 *
 * The danger is not that the number is wrong. It is that a count, or a ratio built from
 * counts, *looks* like a quantity — it has decimals — and gets compared to last year's
 * study, or copied into a report as though it were an uptake value. So
 * {@link absoluteUptake} refuses to produce one unless a camera sensitivity from a phantom
 * calibration is supplied, and says why rather than returning zero.
 *
 * ## Relative function sums to 100% by construction, which is the trap
 *
 * A renal split of 50/50 is what a healthy pair of kidneys gives. It is also what **two
 * equally failing kidneys** give. Relative function cannot see bilateral disease at all,
 * and it reports the case that needs urgent attention as the most normal-looking result on
 * the list. {@link relativeRenalFunction} always returns that warning alongside the split.
 *
 * Worse, the commonest technical error biases *towards* the reassuring answer: perirenal
 * background is soft tissue and blood pool, and leaving it in both ROIs pulls the split
 * toward 50/50. A 25/75 kidney reads as 30/70. **The error direction is towards normal**,
 * so nothing about the result invites a second look. {@link relativeRenalFunction} requires
 * the background to be declared, even as an explicit zero.
 *
 * ## Decay is physics, not biology
 *
 * Comparing a 2-hour image to a 4-hour image without decay correction measures the
 * half-life of technetium. And the injected dose is what entered the patient, not what was
 * drawn: residual activity in the syringe and line is routinely 2–5%, and ignoring it
 * inflates every %ID by that much in the same direction for every patient, which is exactly
 * the kind of bias that survives a sanity check.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

/** Physical half-lives, hours. */
export const HALF_LIFE_HOURS: Record<string, number> = {
  'Tc-99m': 6.0067,
  'I-123': 13.2234,
  'I-131': 192.605,
  'In-111': 67.313,
  'Ga-67': 78.281,
  'Lu-177': 159.53,
  'Tl-201': 73.01,
};

export type Radionuclide = keyof typeof HALF_LIFE_HOURS | string;

/** Outside this band a renal split is conventionally abnormal. */
export const RENAL_SPLIT_NORMAL_LOW = 0.45;
export const RENAL_SPLIT_NORMAL_HIGH = 0.55;

export interface Roi {
  label: string;
  /** Raw counts in the ROI. */
  counts: number;
  /** Voxels or pixels, for a mean. */
  voxels: number;
}

export interface Acquisition {
  /** Seconds of acquisition — counts are meaningless without it. */
  durationSec: number;
  /** Epoch ms. */
  acquiredAt: number;
  nuclide: Radionuclide;
  /** Whether CT-based attenuation correction was applied. */
  attenuationCorrected: boolean;
}

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};

const MS_PER_HOUR = 3_600_000;

/** Fraction of activity remaining after `elapsedHours`. */
export function decayFactor(nuclide: Radionuclide, elapsedHours: number): number {
  const halfLife = HALF_LIFE_HOURS[nuclide as string];
  const elapsed = num(elapsedHours);
  if (!(halfLife > 0) || !Number.isFinite(elapsed)) {
    return NaN;
  }
  return Math.pow(2, -elapsed / halfLife);
}

export interface CountRate {
  /** Counts per second. */
  cps: number;
  /** Mean counts per voxel per second. */
  meanCps: number;
  ok: boolean;
  reason?: string;
}

/**
 * Counts normalised by acquisition time.
 *
 * A raw count compared between a 10-minute and a 20-minute acquisition differs by a factor
 * of two for no clinical reason, and both numbers are labelled "counts".
 */
export function countRate(roi: Roi, acquisition: Acquisition): CountRate {
  const counts = num(roi?.counts);
  const duration = num(acquisition?.durationSec);
  const voxels = num(roi?.voxels);

  if (!Number.isFinite(counts) || counts < 0) {
    return { cps: NaN, meanCps: NaN, ok: false, reason: 'Contagens inválidas na ROI.' };
  }
  if (!(duration > 0)) {
    return {
      cps: NaN,
      meanCps: NaN,
      ok: false,
      reason:
        'Aquisição sem duração — contagem bruta não é comparável entre aquisições de tempos diferentes.',
    };
  }

  const cps = counts / duration;
  return {
    cps,
    meanCps: voxels > 0 ? cps / voxels : NaN,
    ok: true,
  };
}

export interface InjectedDose {
  /** Activity drawn into the syringe, MBq. */
  syringeBeforeMBq: number;
  /** Activity left in the syringe and line after injection, MBq. */
  syringeAfterMBq: number;
  /** Epoch ms of injection. */
  injectedAt: number;
  /** When the residual was measured. Defaults to the injection time. */
  residualMeasuredAt?: number;
}

export interface NetDose {
  netMBq: number;
  /** Residual as a fraction of what was drawn. */
  residualFraction: number;
  ok: boolean;
  reason?: string;
  warnings: string[];
}

/**
 * What actually entered the patient.
 *
 * Residual activity in the syringe and line is routinely 2–5%. Ignoring it inflates %ID by
 * the same amount in the same direction for every patient — a bias, not noise, which is
 * why it survives averaging and why it is a required input rather than an optional one.
 */
export function netInjectedDose(dose: InjectedDose, nuclide: Radionuclide): NetDose {
  const before = num(dose?.syringeBeforeMBq);
  const after = num(dose?.syringeAfterMBq);
  const warnings: string[] = [];

  if (!(before > 0)) {
    return {
      netMBq: NaN,
      residualFraction: NaN,
      ok: false,
      reason: 'Atividade aspirada não informada.',
      warnings,
    };
  }
  if (!Number.isFinite(after) || after < 0) {
    return {
      netMBq: NaN,
      residualFraction: NaN,
      ok: false,
      reason:
        'Atividade residual não informada. Sem ela o %ID sai inflado em 2–5% para todo paciente, sempre na mesma direção.',
      warnings,
    };
  }

  // The residual is usually measured minutes after injection; over that interval a Tc-99m
  // residual has already decayed, and subtracting it uncorrected under-subtracts.
  let residual = after;
  const measuredAt = num(dose?.residualMeasuredAt ?? dose?.injectedAt);
  const injectedAt = num(dose?.injectedAt);
  if (Number.isFinite(measuredAt) && Number.isFinite(injectedAt) && measuredAt > injectedAt) {
    const factor = decayFactor(nuclide, (measuredAt - injectedAt) / MS_PER_HOUR);
    if (Number.isFinite(factor) && factor > 0) {
      residual = after / factor;
    }
  }

  if (residual >= before) {
    return {
      netMBq: NaN,
      residualFraction: NaN,
      ok: false,
      reason: 'Residual maior ou igual à atividade aspirada — medida inconsistente.',
      warnings,
    };
  }

  const netMBq = before - residual;
  const residualFraction = residual / before;
  if (residualFraction > 0.1) {
    warnings.push(
      `Residual de ${(residualFraction * 100).toFixed(1)}% da atividade aspirada — acima do esperado; confira a técnica de injeção.`
    );
  }

  return { netMBq, residualFraction, ok: true, warnings };
}

export interface UptakeInput {
  roi: Roi;
  acquisition: Acquisition;
  dose: InjectedDose;
  /** Camera sensitivity from a phantom calibration, counts per second per MBq. */
  sensitivityCpsPerMBq?: number;
}

export interface UptakeResult {
  /** Activity in the ROI, MBq, decay-corrected to injection. Null when uncalibrated. */
  activityMBq: number | null;
  /** Percent of the injected dose. Null when uncalibrated. */
  percentInjectedDose: number | null;
  cps: number;
  calibrated: boolean;
  warnings: string[];
  message: string;
}

/**
 * Absolute uptake, or a refusal to state one.
 *
 * Without a phantom-derived sensitivity there is no route from counts to becquerels, and a
 * number that looks quantitative is worse than no number: it gets compared to last year's
 * study on another camera, where the same physiology produces a different value. The counts
 * per second still come back, because they are honest within one acquisition.
 */
export function absoluteUptake(input: UptakeInput): UptakeResult {
  const rate = countRate(input?.roi, input?.acquisition);
  const warnings: string[] = [];

  if (!rate.ok) {
    return {
      activityMBq: null,
      percentInjectedDose: null,
      cps: NaN,
      calibrated: false,
      warnings,
      message: rate.reason ?? '',
    };
  }

  if (input?.acquisition && !input.acquisition.attenuationCorrected) {
    warnings.push(
      'Sem correção de atenuação: contagens de uma lesão profunda e de uma superficial não são comparáveis entre si.'
    );
  }

  const sensitivity = num(input?.sensitivityCpsPerMBq);
  if (!(sensitivity > 0)) {
    return {
      activityMBq: null,
      percentInjectedDose: null,
      cps: rate.cps,
      calibrated: false,
      warnings,
      message:
        `${rate.cps.toFixed(1)} cps. Sem calibração de sensibilidade da câmara não há caminho de contagens para becquerels — ` +
        'e um número que parece quantitativo acaba comparado a um exame de outra câmara, onde a mesma fisiologia dá outro valor. SPECT convencional não tem SUV.',
    };
  }

  const dose = netInjectedDose(input.dose, input.acquisition.nuclide);
  if (!dose.ok) {
    return {
      activityMBq: rate.cps / sensitivity,
      percentInjectedDose: null,
      cps: rate.cps,
      calibrated: true,
      warnings,
      message: dose.reason ?? '',
    };
  }
  warnings.push(...dose.warnings);

  const elapsedHours =
    (num(input.acquisition.acquiredAt) - num(input.dose.injectedAt)) / MS_PER_HOUR;
  const factor = decayFactor(input.acquisition.nuclide, elapsedHours);
  if (!Number.isFinite(factor) || !(factor > 0)) {
    return {
      activityMBq: rate.cps / sensitivity,
      percentInjectedDose: null,
      cps: rate.cps,
      calibrated: true,
      warnings,
      message: `Meia-vida desconhecida para ${String(input.acquisition.nuclide)} — sem correção de decaimento não dá para calcular %ID.`,
    };
  }
  if (elapsedHours < 0) {
    return {
      activityMBq: rate.cps / sensitivity,
      percentInjectedDose: null,
      cps: rate.cps,
      calibrated: true,
      warnings,
      message: 'Aquisição anterior à injeção — horários inconsistentes.',
    };
  }

  const activityMBq = rate.cps / sensitivity;
  // The denominator is the dose still present at scan time, so the ratio is a fraction of
  // what the patient had, not of what they were given hours ago.
  const doseAtScanMBq = dose.netMBq * factor;
  const percentInjectedDose = (activityMBq / doseAtScanMBq) * 100;

  return {
    activityMBq,
    percentInjectedDose,
    cps: rate.cps,
    calibrated: true,
    warnings,
    message: `${percentInjectedDose.toFixed(2)}% da dose injetada (${activityMBq.toFixed(2)} MBq na ROI).`,
  };
}

export interface RatioResult {
  ratio: number | null;
  ok: boolean;
  message: string;
}

/**
 * Target-to-background ratio.
 *
 * The ratio is only as meaningful as the background ROI, and it is unbounded as the
 * background approaches zero: a background ROI placed over lung or over the edge of the
 * field produces a spectacular ratio from an unremarkable lesion. A small background ROI is
 * refused rather than divided by.
 */
export function targetToBackground(
  target: Roi,
  background: Roi,
  minBackgroundVoxels = 50
): RatioResult {
  const targetCounts = num(target?.counts);
  const backgroundCounts = num(background?.counts);
  const backgroundVoxels = num(background?.voxels);
  const targetVoxels = num(target?.voxels);

  if (!(targetVoxels > 0) || !(backgroundVoxels > 0)) {
    return { ratio: null, ok: false, message: 'ROI vazia.' };
  }
  if (backgroundVoxels < Math.max(1, num(minBackgroundVoxels) || 50)) {
    return {
      ratio: null,
      ok: false,
      message:
        `ROI de fundo com ${backgroundVoxels} voxels — pequena demais. A razão é ilimitada quando o fundo tende a zero, ` +
        'e um fundo mal posicionado produz uma razão espetacular a partir de uma lesão banal.',
    };
  }

  const backgroundMean = backgroundCounts / backgroundVoxels;
  if (!(backgroundMean > 0)) {
    return {
      ratio: null,
      ok: false,
      message: 'Fundo com contagem média zero — razão indefinida.',
    };
  }

  const ratio = targetCounts / targetVoxels / backgroundMean;
  return { ratio, ok: true, message: `T/B = ${ratio.toFixed(2)}` };
}

export interface RenalRoi {
  /** Counts in the kidney ROI, background included. */
  counts: number;
  voxels: number;
  /**
   * Mean counts per voxel in the perirenal background ROI. Required — pass 0 explicitly to
   * declare that no background was subtracted.
   */
  backgroundMeanCounts: number;
}

export interface RenalSplit {
  leftFraction: number;
  rightFraction: number;
  ok: boolean;
  /** Outside 45–55%. */
  asymmetric: boolean;
  /** Always present: the limitation is structural, not conditional. */
  bilateralWarning: string;
  warnings: string[];
  message: string;
}

/**
 * Differential renal function, left versus right.
 *
 * Returns the bilateral-disease caveat unconditionally, because the number cannot express
 * it: two equally failing kidneys give the same 50/50 as two healthy ones, and the case
 * that needs urgent attention is the one that looks most normal on the list.
 */
export function relativeRenalFunction(left: RenalRoi, right: RenalRoi): RenalSplit {
  const bilateralWarning =
    'Função relativa soma 100% por construção: dois rins igualmente comprometidos dão 50/50, igual a dois rins normais. ' +
    'Doença bilateral é invisível aqui — só uma medida absoluta (clearance/TFG) a detecta.';
  const warnings: string[] = [];

  const net = (roi: RenalRoi, side: string): number => {
    const counts = num(roi?.counts);
    const voxels = num(roi?.voxels);
    const background = num(roi?.backgroundMeanCounts);
    if (!Number.isFinite(counts) || !(voxels > 0) || !Number.isFinite(background)) {
      return NaN;
    }
    if (background === 0) {
      warnings.push(
        `Rim ${side} sem subtração de fundo declarada. Fundo perirrenal é tecido mole e pool sanguíneo, ` +
          'e deixá-lo nas duas ROIs puxa a divisão para 50/50 — o erro aponta para o resultado normal, então nada no exame pede uma segunda olhada.'
      );
    }
    return Math.max(0, counts - background * voxels);
  };

  const leftNet = net(left, 'esquerdo');
  const rightNet = net(right, 'direito');

  if (!Number.isFinite(leftNet) || !Number.isFinite(rightNet)) {
    return {
      leftFraction: NaN,
      rightFraction: NaN,
      ok: false,
      asymmetric: false,
      bilateralWarning,
      warnings,
      message: 'ROIs renais incompletas.',
    };
  }

  const total = leftNet + rightNet;
  if (!(total > 0)) {
    return {
      leftFraction: NaN,
      rightFraction: NaN,
      ok: false,
      asymmetric: false,
      bilateralWarning,
      warnings,
      message: 'Contagem renal líquida zero — verifique as ROIs e o fundo.',
    };
  }

  const leftFraction = leftNet / total;
  const rightFraction = rightNet / total;
  const asymmetric =
    leftFraction < RENAL_SPLIT_NORMAL_LOW || leftFraction > RENAL_SPLIT_NORMAL_HIGH;

  return {
    leftFraction,
    rightFraction,
    ok: true,
    asymmetric,
    bilateralWarning,
    warnings,
    message:
      `Função relativa: E ${(leftFraction * 100).toFixed(1)}% / D ${(rightFraction * 100).toFixed(1)}%` +
      (asymmetric ? ' — assimétrica.' : ' — dentro de 45–55%.'),
  };
}

/**
 * Whether two SPECT acquisitions can be compared quantitatively.
 *
 * Same nuclide, both attenuation-corrected, and both calibrated. Anything else and the
 * difference between the two numbers is technique.
 */
export function comparable(
  a: Acquisition & { sensitivityCpsPerMBq?: number },
  b: Acquisition & { sensitivityCpsPerMBq?: number }
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!a || !b) {
    return { ok: false, reasons: ['Aquisição ausente.'] };
  }
  if (a.nuclide !== b.nuclide) {
    reasons.push(`Radiofármacos diferentes (${String(a.nuclide)} e ${String(b.nuclide)}).`);
  }
  if (a.attenuationCorrected !== b.attenuationCorrected) {
    reasons.push('Apenas uma das aquisições tem correção de atenuação.');
  }
  const sa = num(a.sensitivityCpsPerMBq);
  const sb = num(b.sensitivityCpsPerMBq);
  if (!(sa > 0) || !(sb > 0)) {
    reasons.push(
      'Ao menos uma aquisição sem calibração — a diferença entre as duas seria técnica, não fisiológica.'
    );
  }
  return { ok: !reasons.length, reasons };
}

/** One line for the quantification panel. */
export function describeUptake(result: UptakeResult): string {
  if (!result) {
    return '';
  }
  const warnings = result.warnings.length ? ` ${result.warnings.join(' ')}` : '';
  return `${result.message}${warnings}`;
}
