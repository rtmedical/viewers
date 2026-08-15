/**
 * MR spectroscopy: peak integration, metabolite ratios and the quality gate — pure core
 * (RTV-58).
 *
 * A single-voxel proton spectrum is a handful of peaks at known chemical shifts. Reading
 * it is integrating windows and dividing. Deciding whether it *can* be read is the part
 * that changes the answer, and it comes first here.
 *
 * ## A badly shimmed spectrum is not a spectrum
 *
 * Linewidth is the whole ballgame. Past about 0.1 ppm of full width at half maximum the
 * peaks merge, the integration windows overlap their neighbours, and every ratio comes out
 * wrong in a direction that depends on which peak bled into which. The spectrum still
 * *looks* like a spectrum — it is smooth and has bumps in roughly the right places — which
 * is why {@link assessQuality} runs before anything else and
 * {@link analyseSpectrum} refuses rather than reporting ratios from it.
 *
 * ## Cr is the denominator, and Cr is not constant
 *
 * Absolute quantification needs water referencing and coil calibration, so clinical
 * spectroscopy reports ratios to creatine. That is fine until creatine itself moves —
 * and it falls in high-grade tumour and in necrosis, which are exactly the cases being
 * asked about.
 *
 * **A rising Cho/Cr can be a falling Cr.** The ratio cannot distinguish them, and neither
 * can any amount of care in reading it. {@link analyseSpectrum} therefore reports the raw
 * peak areas alongside the ratios and flags a creatine that has dropped relative to the
 * contralateral or expected value, so the reader is told the denominator moved.
 *
 * ## Lactate inverts at TE 144, and lipid does not
 *
 * The lactate doublet at 1.33 ppm points **down** at an echo time of 144 ms and **up** at
 * 35 ms. Lipid sits under it and always points up. So at short TE the two are
 * indistinguishable, and calling a lipid peak lactate is calling necrosis ischaemia.
 *
 * The echo time is a required argument, and {@link classifyLactateLipid} says what can be
 * concluded at the TE that was actually used instead of guessing.
 *
 * ## The chemical shift axis has to be referenced
 *
 * The windows are in ppm and they are narrow. If the axis is off by 0.1 ppm the choline
 * window is sampling creatine. NAA at 2.02 ppm is the conventional anchor;
 * {@link referenceAxis} shifts the axis so the largest peak in the NAA region lands there,
 * and reports the correction it applied — a large correction is itself a sign something is
 * wrong.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export type Metabolite = 'naa' | 'creatine' | 'choline' | 'myoInositol' | 'lactate' | 'lipid';

export interface PeakWindow {
  metabolite: Metabolite;
  label: string;
  /** Chemical shift window, ppm. */
  fromPpm: number;
  toPpm: number;
}

/** Conventional 1H windows at 1.5–3 T. */
export const PEAK_WINDOWS: PeakWindow[] = [
  { metabolite: 'lipid', label: 'Lipídios', fromPpm: 0.7, toPpm: 1.2 },
  { metabolite: 'lactate', label: 'Lactato', fromPpm: 1.25, toPpm: 1.45 },
  { metabolite: 'naa', label: 'NAA', fromPpm: 1.95, toPpm: 2.1 },
  { metabolite: 'creatine', label: 'Creatina', fromPpm: 2.95, toPpm: 3.1 },
  { metabolite: 'choline', label: 'Colina', fromPpm: 3.15, toPpm: 3.28 },
  { metabolite: 'myoInositol', label: 'mio-Inositol', fromPpm: 3.5, toPpm: 3.65 },
];

/** NAA is the conventional anchor of the chemical shift axis. */
export const NAA_PPM = 2.02;

/** Above this linewidth the peaks merge and the windows sample their neighbours. */
export const MAX_LINEWIDTH_PPM = 0.1;

/** Below this signal-to-noise the peak areas are not measurements. */
export const MIN_SNR = 5;

export interface Spectrum {
  /** Chemical shift of each sample, ppm. Descending or ascending, either is fine. */
  ppm: number[];
  /** Real part of the spectrum at each sample. */
  intensity: number[];
}

export interface QualityAssessment {
  /** Full width at half maximum of the NAA peak, ppm. */
  linewidthPpm: number;
  /** Peak height over noise standard deviation. */
  snr: number;
  usable: boolean;
  reasons: string[];
}

const finitePairs = (spectrum: Spectrum): Array<[number, number]> => {
  const ppm = spectrum?.ppm ?? [];
  const intensity = spectrum?.intensity ?? [];
  const out: Array<[number, number]> = [];
  for (let i = 0; i < Math.min(ppm.length, intensity.length); i++) {
    const x = Number(ppm[i]);
    const y = Number(intensity[i]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      out.push([x, y]);
    }
  }
  return out.sort((a, b) => a[0] - b[0]);
};

/** Samples inside a ppm window, sorted ascending by ppm. */
function windowSamples(spectrum: Spectrum, fromPpm: number, toPpm: number): Array<[number, number]> {
  const lo = Math.min(fromPpm, toPpm);
  const hi = Math.max(fromPpm, toPpm);
  return finitePairs(spectrum).filter(([x]) => x >= lo && x <= hi);
}

/**
 * Noise standard deviation, from a region with no metabolite signal.
 *
 * Taken from beyond 8 ppm by default, which is empty in a brain spectrum. Estimating noise
 * from the whole spectrum would fold the peaks into it and make every SNR look fine.
 */
export function noiseLevel(spectrum: Spectrum, fromPpm = 8, toPpm = 12): number {
  const samples = windowSamples(spectrum, fromPpm, toPpm).map(([, y]) => y);
  if (samples.length < 3) {
    return 0;
  }
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const variance = samples.reduce((sum, y) => sum + (y - mean) ** 2, 0) / (samples.length - 1);
  return Math.sqrt(variance);
}

/**
 * Full width at half maximum of the tallest peak in a window, in ppm.
 *
 * Measured on NAA by convention: it is the tallest peak in a normal brain spectrum and the
 * narrowest, so it is the most sensitive to a poor shim.
 */
export function linewidth(spectrum: Spectrum, fromPpm = 1.8, toPpm = 2.25): number {
  const samples = windowSamples(spectrum, fromPpm, toPpm);
  if (samples.length < 3) {
    return NaN;
  }
  let peakIndex = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i][1] > samples[peakIndex][1]) {
      peakIndex = i;
    }
  }
  const peak = samples[peakIndex][1];
  if (!(peak > 0)) {
    return NaN;
  }
  const half = peak / 2;

  let left = samples[0][0];
  for (let i = peakIndex; i >= 0; i--) {
    if (samples[i][1] < half) {
      left = samples[i][0];
      break;
    }
  }
  let right = samples[samples.length - 1][0];
  for (let i = peakIndex; i < samples.length; i++) {
    if (samples[i][1] < half) {
      right = samples[i][0];
      break;
    }
  }
  return Math.abs(right - left);
}

/**
 * Whether the spectrum can be read at all.
 *
 * Runs before anything else. A badly shimmed spectrum still looks like a spectrum — smooth,
 * with bumps in roughly the right places — and its ratios are wrong in a direction that
 * depends on which peak bled into which.
 */
export function assessQuality(
  spectrum: Spectrum,
  maxLinewidthPpm = MAX_LINEWIDTH_PPM,
  minSnr = MIN_SNR
): QualityAssessment {
  const reasons: string[] = [];
  const linewidthPpm = linewidth(spectrum);
  const noise = noiseLevel(spectrum);
  const naa = windowSamples(spectrum, 1.95, 2.1).map(([, y]) => y);
  const peak = naa.length ? Math.max(...naa) : 0;
  const snr = noise > 0 ? peak / noise : 0;

  if (!Number.isFinite(linewidthPpm)) {
    reasons.push('Não foi possível medir a largura de linha — sem pico de NAA identificável.');
  } else if (linewidthPpm > maxLinewidthPpm) {
    reasons.push(
      `Largura de linha de ${linewidthPpm.toFixed(3)} ppm acima de ${maxLinewidthPpm} — shim insuficiente; as janelas de integração invadem os picos vizinhos.`
    );
  }
  if (!(snr >= minSnr)) {
    reasons.push(
      `Relação sinal-ruído de ${snr.toFixed(1)} abaixo de ${minSnr} — as áreas dos picos não são medidas.`
    );
  }

  return { linewidthPpm, snr, usable: !reasons.length, reasons };
}

export interface AxisReference {
  /** ppm added to every sample to put NAA at 2.02. */
  correctionPpm: number;
  spectrum: Spectrum;
  /** True when the correction was large enough to be suspicious. */
  suspicious: boolean;
  message?: string;
}

/**
 * Shifts the chemical shift axis so the tallest peak near NAA lands at 2.02 ppm.
 *
 * The windows are narrow: an axis off by 0.1 ppm has the choline window sampling creatine.
 * A large correction is itself a sign something is wrong, so it is reported rather than
 * applied silently.
 */
export function referenceAxis(spectrum: Spectrum, searchHalfWidthPpm = 0.3): AxisReference {
  const samples = windowSamples(spectrum, NAA_PPM - searchHalfWidthPpm, NAA_PPM + searchHalfWidthPpm);
  if (!samples.length) {
    return {
      correctionPpm: 0,
      spectrum,
      suspicious: true,
      message: 'Sem sinal na região do NAA — eixo não referenciado.',
    };
  }
  let peak = samples[0];
  for (const sample of samples) {
    if (sample[1] > peak[1]) {
      peak = sample;
    }
  }
  const correctionPpm = NAA_PPM - peak[0];
  const suspicious = Math.abs(correctionPpm) > 0.15;

  return {
    correctionPpm,
    spectrum: {
      ppm: (spectrum?.ppm ?? []).map(v => Number(v) + correctionPpm),
      intensity: spectrum?.intensity ?? [],
    },
    suspicious,
    message: suspicious
      ? `Correção de eixo de ${correctionPpm.toFixed(2)} ppm — grande demais para ser só referenciamento; verifique a aquisição.`
      : undefined,
  };
}

/** Trapezoidal area under a window, with a linear baseline through its endpoints. */
export function peakArea(spectrum: Spectrum, fromPpm: number, toPpm: number): number {
  const samples = windowSamples(spectrum, fromPpm, toPpm);
  if (samples.length < 2) {
    return 0;
  }
  const [x0, y0] = samples[0];
  const [x1, y1] = samples[samples.length - 1];
  const span = x1 - x0;

  let area = 0;
  for (let i = 1; i < samples.length; i++) {
    const [xa, ya] = samples[i - 1];
    const [xb, yb] = samples[i];
    // Subtract the baseline: without it a rolling background is counted as signal, and it
    // is counted differently in each window because they are different widths.
    const ba = span > 0 ? y0 + ((xa - x0) / span) * (y1 - y0) : 0;
    const bb = span > 0 ? y0 + ((xb - x0) / span) * (y1 - y0) : 0;
    area += ((ya - ba + (yb - bb)) / 2) * (xb - xa);
  }
  return area;
}

export type LactateVerdict = 'lactate' | 'lipid' | 'indistinguishable';

export interface LactateAssessment {
  verdict: LactateVerdict;
  message: string;
}

/**
 * What can be concluded about the 1.33 ppm peak at the echo time actually used.
 *
 * At TE 144 lactate inverts and lipid does not, so the sign settles it. At short TE both
 * point up and they are **not separable** — saying so is the whole value of the function,
 * because calling a lipid peak lactate is calling necrosis ischaemia.
 */
export function classifyLactateLipid(
  areaAt133: number,
  echoTimeMs: number
): LactateAssessment {
  const area = Number(areaAt133);
  const te = Number(echoTimeMs);

  if (!Number.isFinite(area) || !Number.isFinite(te)) {
    return { verdict: 'indistinguishable', message: 'Área ou TE ausentes.' };
  }
  if (Math.abs(area) < 1e-9) {
    return { verdict: 'indistinguishable', message: 'Sem pico em 1,33 ppm.' };
  }

  // Inversion happens around TE 135-150.
  if (te >= 130 && te <= 160) {
    return area < 0
      ? { verdict: 'lactate', message: 'Dupleto invertido em TE ~144 ms — lactato.' }
      : { verdict: 'lipid', message: 'Pico positivo em TE ~144 ms — lipídio, não lactato.' };
  }
  return {
    verdict: 'indistinguishable',
    message:
      `Em TE ${te.toFixed(0)} ms lactato e lipídio apontam ambos para cima e se sobrepõem — ` +
      'não é possível separá-los. Repita em TE 144 ms se a distinção importar.',
  };
}

export interface SpectrumAnalysis {
  ok: boolean;
  quality: QualityAssessment;
  axis: AxisReference;
  /** Baseline-corrected area per metabolite. */
  areas: Partial<Record<Metabolite, number>>;
  /** Ratios to creatine. */
  ratios: { naaCr?: number; choCr?: number; miCr?: number };
  lactate: LactateAssessment;
  warnings: string[];
  reason?: string;
}

export interface AnalysisOptions {
  /** Required — the lactate/lipid answer depends on it. */
  echoTimeMs: number;
  /** Creatine area from normal contralateral tissue, if measured. */
  referenceCreatineArea?: number;
  maxLinewidthPpm?: number;
  minSnr?: number;
}

/**
 * The full read, or a refusal.
 *
 * Quality first, then the axis, then the areas. A ratio from an unreadable spectrum is a
 * number the reader has no way to distrust.
 */
export function analyseSpectrum(
  spectrum: Spectrum,
  options: AnalysisOptions
): SpectrumAnalysis {
  const warnings: string[] = [];
  const axis = referenceAxis(spectrum);
  if (axis.message) {
    warnings.push(axis.message);
  }
  const referenced = axis.spectrum;
  const quality = assessQuality(referenced, options?.maxLinewidthPpm, options?.minSnr);

  const empty: SpectrumAnalysis = {
    ok: false,
    quality,
    axis,
    areas: {},
    ratios: {},
    lactate: { verdict: 'indistinguishable', message: '' },
    warnings,
  };

  if (!quality.usable) {
    return { ...empty, reason: quality.reasons.join(' ') };
  }
  if (!Number.isFinite(Number(options?.echoTimeMs))) {
    return {
      ...empty,
      reason:
        'Tempo de eco não informado — sem ele não é possível dizer se o pico em 1,33 ppm é lactato ou lipídio.',
    };
  }

  const areas: Partial<Record<Metabolite, number>> = {};
  for (const window of PEAK_WINDOWS) {
    areas[window.metabolite] = peakArea(referenced, window.fromPpm, window.toPpm);
  }

  const creatine = areas.creatine ?? 0;
  const ratios: SpectrumAnalysis['ratios'] = {};
  if (creatine > 0) {
    ratios.naaCr = (areas.naa ?? 0) / creatine;
    ratios.choCr = (areas.choline ?? 0) / creatine;
    ratios.miCr = (areas.myoInositol ?? 0) / creatine;
  } else {
    warnings.push('Creatina não mensurável — as razões a Cr não podem ser calculadas.');
  }

  // A rising Cho/Cr can be a falling Cr, and the ratio cannot tell them apart.
  const reference = Number(options?.referenceCreatineArea);
  if (Number.isFinite(reference) && reference > 0 && creatine > 0 && creatine < 0.7 * reference) {
    warnings.push(
      `Creatina ${Math.round((1 - creatine / reference) * 100)}% abaixo da referência — ` +
        'uma razão Cho/Cr elevada aqui pode ser queda do denominador e não aumento de colina.'
    );
  }

  return {
    ok: true,
    quality,
    axis,
    areas,
    ratios,
    lactate: classifyLactateLipid(areas.lactate ?? 0, options.echoTimeMs),
    warnings,
  };
}

/** Readout for the spectroscopy panel. */
export function describeSpectrum(analysis: SpectrumAnalysis): string {
  if (!analysis) {
    return '';
  }
  if (!analysis.ok) {
    return analysis.reason ?? '';
  }
  const r = analysis.ratios;
  const parts = [
    r.naaCr !== undefined ? `NAA/Cr ${r.naaCr.toFixed(2)}` : '',
    r.choCr !== undefined ? `Cho/Cr ${r.choCr.toFixed(2)}` : '',
    r.miCr !== undefined ? `mI/Cr ${r.miCr.toFixed(2)}` : '',
    analysis.lactate.message,
  ].filter(Boolean);
  const warnings = analysis.warnings.length ? ` ${analysis.warnings.join(' ')}` : '';
  return `${parts.join(' · ')}${warnings}`;
}
