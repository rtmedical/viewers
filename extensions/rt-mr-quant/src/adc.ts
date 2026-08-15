/**
 * DWI b-value detection and ADC fitting — pure core (RTV-81).
 *
 * ADC comes from the monoexponential model `S(b) = S0 · exp(-b · ADC)`, so taking logs
 * turns it into a straight line and the fit is ordinary least squares on `ln S` against
 * `b`.
 *
 * The arithmetic is three lines. Everything that makes an ADC map *right* is in the
 * guards around it:
 *
 * ## The noise floor is the thing that biases ADC
 *
 * At high b the diffusion signal decays toward the noise floor. Magnitude MR noise is
 * **Rician**, not Gaussian, so it does not average to zero — it floors the measured
 * signal at a positive value. The log of a floored signal flattens out, the fitted slope
 * gets shallower, and **ADC is underestimated exactly where restricted diffusion
 * matters**: in the bright-on-high-b lesion the reader is looking at.
 *
 * So {@link fitAdc} drops samples at or below a noise threshold, and reports how many it
 * dropped. It does *not* attempt a Rician bias correction — that needs a noise-sigma
 * estimate this module has no way to obtain, and a wrong correction is worse than a
 * documented omission.
 *
 * ## Two b-values is exact, three or more is a fit
 *
 * Both are supported and the result says which, because they are not equally
 * trustworthy: a two-point ADC inherits the full noise of both points with no residual
 * to check against.
 *
 * Framework-free and `@ohif/*`-free. Zero-fork per RTV-114.
 */

/**
 * Where a b-value can hide.
 *
 * The standard attribute is `DiffusionBValue` (0018,9087), but plenty of installed
 * scanners still write only their private tag, and a viewer that reads only the standard
 * one silently treats a multi-b series as a single acquisition.
 */
export const B_VALUE_KEYS = [
  'DiffusionBValue',
  // Siemens (0019,100C), GE (0043,1039), Philips (2001,1003).
  'SiemensDiffusionBValue',
  'GEDiffusionBValue',
  'PhilipsDiffusionBValue',
] as const;

export interface DwiInstanceLike {
  Modality?: string;
  SeriesDescription?: string;
  DiffusionBValue?: number | string | Array<number | string>;
  SiemensDiffusionBValue?: number | string;
  GEDiffusionBValue?: number | string | Array<number | string>;
  PhilipsDiffusionBValue?: number | string;
  [key: string]: unknown;
}

/** Largest b-value that is a real diffusion weighting rather than a coding artefact. */
export const B_VALUE_MAX = 10000;

/**
 * Reads the b-value, in s/mm².
 *
 * GE encodes it in a 4-element array whose first entry can carry a large offset
 * (e.g. `1000000750` meaning b = 750); values above {@link B_VALUE_MAX} are taken modulo
 * 100000, which is the conventional decoding. Returns `null` when nothing usable is
 * present — better no b-value than a wrong one, since a wrong b scales the whole ADC.
 */
export function parseBValue(instance: DwiInstanceLike): number | null {
  for (const key of B_VALUE_KEYS) {
    const raw = (instance ?? {})[key as keyof DwiInstanceLike];
    const first = Array.isArray(raw) ? raw[0] : raw;
    if (first == null || first === '') {
      continue;
    }
    let value = Number(first);
    if (!Number.isFinite(value) || value < 0) {
      continue;
    }
    if (value > B_VALUE_MAX) {
      value = value % 100000;
    }
    if (value >= 0 && value <= B_VALUE_MAX) {
      return value;
    }
  }
  return null;
}

/** Whether the instance looks like diffusion-weighted MR. */
export function isDwi(instance: DwiInstanceLike): boolean {
  const modality = String(instance?.Modality ?? '').trim().toUpperCase();
  if (modality && modality !== 'MR') {
    return false;
  }
  if (parseBValue(instance) != null) {
    return true;
  }
  const tokens = String(instance?.SeriesDescription ?? '')
    .toUpperCase()
    .split(/[\\\s_\-./,()[\]+]+/)
    .filter(Boolean);
  return tokens.includes('DWI') || tokens.includes('DIFFUSION') || tokens.includes('DIFUSAO');
}

export interface BValueGroup<T = DwiInstanceLike> {
  bValue: number;
  instances: T[];
}

/**
 * Groups DWI series by b-value, ascending.
 *
 * Series without a readable b-value are excluded rather than lumped into b = 0: treating
 * an unknown as zero would make it the reference signal for every other point and skew
 * the whole fit.
 */
export function groupByBValue<T extends DwiInstanceLike>(instances: T[]): BValueGroup<T>[] {
  const groups = new Map<number, T[]>();
  for (const instance of instances ?? []) {
    if (!instance || !isDwi(instance)) {
      continue;
    }
    const b = parseBValue(instance);
    if (b == null) {
      continue;
    }
    groups.set(b, [...(groups.get(b) ?? []), instance]);
  }
  return [...groups.entries()]
    .map(([bValue, list]) => ({ bValue, instances: list }))
    .sort((a, b) => a.bValue - b.bValue);
}

/** A set of b-values is fittable when at least two are distinct. */
export function isFittable(bValues: number[]): boolean {
  return new Set((bValues ?? []).filter(b => Number.isFinite(b) && b >= 0)).size >= 2;
}

export interface AdcSample {
  bValue: number;
  /** Measured signal at that b. */
  signal: number;
}

export interface AdcFit {
  /** Apparent diffusion coefficient, mm²/s. NaN when it could not be fitted. */
  adc: number;
  /** Extrapolated signal at b = 0. */
  s0: number;
  /** Coefficient of determination of the log-linear fit; NaN for a two-point solve. */
  r2: number;
  /** Samples that survived the noise floor. */
  used: number;
  /** Samples dropped for being at or below the noise floor. */
  droppedToNoise: number;
  /** 'exact' for a two-point solve, 'fit' for least squares, 'failed' otherwise. */
  method: 'exact' | 'fit' | 'failed';
  reason?: string;
}

/** ADC values outside this range are not physical in tissue and are rejected. */
export const ADC_MIN_MM2_S = 0;
export const ADC_MAX_MM2_S = 0.01;

const failed = (reason: string): AdcFit => ({
  adc: NaN,
  s0: NaN,
  r2: NaN,
  used: 0,
  droppedToNoise: 0,
  method: 'failed',
  reason,
});

/**
 * Fits ADC from signal at two or more b-values.
 *
 * @param noiseFloor Signal at or below which a sample is discarded. See the module note
 *   on why this matters more than the arithmetic; pass an estimate of the background
 *   level (a few times the standard deviation of air is the usual rule of thumb). The
 *   default of 0 keeps every positive sample, which is the right behaviour for
 *   synthetic or already-denoised data.
 */
export function fitAdc(samples: AdcSample[], noiseFloor = 0): AdcFit {
  const floor = Number.isFinite(Number(noiseFloor)) ? Math.max(0, Number(noiseFloor)) : 0;

  const all = (samples ?? []).filter(
    s => s && Number.isFinite(s.bValue) && s.bValue >= 0 && Number.isFinite(s.signal)
  );
  if (all.length < 2) {
    return failed('At least two b-values are needed.');
  }

  // A non-positive signal has no logarithm, and a sample at the noise floor drags the
  // slope shallow -- see the module note.
  const usable = all.filter(s => s.signal > 0 && s.signal > floor);
  const droppedToNoise = all.length - usable.length;

  if (usable.length < 2) {
    return {
      ...failed('Too few samples above the noise floor.'),
      droppedToNoise,
    };
  }
  if (!isFittable(usable.map(s => s.bValue))) {
    return { ...failed('All usable samples share one b-value.'), droppedToNoise };
  }

  const n = usable.length;
  const xs = usable.map(s => s.bValue);
  const ys = usable.map(s => Math.log(s.signal));

  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - meanX) * (ys[i] - meanY);
    sxx += (xs[i] - meanX) ** 2;
  }
  if (!(sxx > 0)) {
    return { ...failed('The b-values do not span a range.'), droppedToNoise };
  }

  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;
  // S(b) = S0 exp(-b ADC): the slope of ln S against b is -ADC.
  const adc = -slope;

  if (!Number.isFinite(adc) || adc < ADC_MIN_MM2_S || adc > ADC_MAX_MM2_S) {
    return {
      ...failed(`Fitted ADC ${adc.toExponential(2)} mm²/s is outside the physical range.`),
      used: n,
      droppedToNoise,
    };
  }

  let r2 = NaN;
  if (n > 2) {
    let ssRes = 0;
    let ssTot = 0;
    for (let i = 0; i < n; i++) {
      const predicted = intercept + slope * xs[i];
      ssRes += (ys[i] - predicted) ** 2;
      ssTot += (ys[i] - meanY) ** 2;
    }
    r2 = ssTot > 0 ? 1 - ssRes / ssTot : 1;
  }

  return {
    adc,
    s0: Math.exp(intercept),
    r2,
    used: n,
    droppedToNoise,
    // Two points define the line exactly; there is no residual to check it against.
    method: n === 2 ? 'exact' : 'fit',
  };
}

/** ADC in the ×10⁻⁶ mm²/s unit the parametric-map panel displays (RTV-82). */
export function adcToDisplayUnits(adcMm2PerS: number): number {
  return Number.isFinite(adcMm2PerS) ? adcMm2PerS * 1e6 : NaN;
}

/**
 * Fits an ADC map voxel by voxel.
 *
 * `frames` must be one signal array per b-value, all the same length. Returns a
 * Float32Array in **×10⁻⁶ mm²/s**, matching the display unit, with 0 where the fit
 * failed — a failed voxel reads as "no diffusion measured" rather than as a NaN that
 * every downstream statistic then has to special-case.
 *
 * @throws RangeError when the inputs cannot describe a map.
 */
export function computeAdcMap(
  bValues: number[],
  frames: ArrayLike<number>[],
  noiseFloor = 0
): Float32Array {
  const bs = (bValues ?? []).map(Number);
  const list = frames ?? [];
  if (bs.length !== list.length) {
    throw new RangeError(
      `computeAdcMap: ${bs.length} b-values against ${list.length} frames.`
    );
  }
  if (!isFittable(bs)) {
    throw new RangeError('computeAdcMap: at least two distinct b-values are needed.');
  }
  const voxels = list[0]?.length ?? 0;
  if (!voxels) {
    throw new RangeError('computeAdcMap: the frames are empty.');
  }
  if (list.some(f => (f?.length ?? 0) !== voxels)) {
    throw new RangeError('computeAdcMap: the frames differ in size.');
  }

  const out = new Float32Array(voxels);
  const samples: AdcSample[] = bs.map(bValue => ({ bValue, signal: 0 }));

  for (let v = 0; v < voxels; v++) {
    for (let i = 0; i < bs.length; i++) {
      samples[i].signal = list[i][v];
    }
    const fit = fitAdc(samples, noiseFloor);
    out[v] = Number.isFinite(fit.adc) ? adcToDisplayUnits(fit.adc) : 0;
  }
  return out;
}

/** One-line summary for the panel. */
export function describeAdcFit(fit: AdcFit): string {
  if (!fit || fit.method === 'failed') {
    return fit?.reason ?? 'ADC could not be fitted.';
  }
  const value = Math.round(adcToDisplayUnits(fit.adc));
  const parts = [`ADC ${value} ×10⁻⁶ mm²/s`, `${fit.used} b-values`];
  if (fit.method === 'exact') {
    parts.push('two-point (no residual to check)');
  } else if (Number.isFinite(fit.r2)) {
    parts.push(`R² ${fit.r2.toFixed(3)}`);
  }
  if (fit.droppedToNoise) {
    parts.push(`${fit.droppedToNoise} dropped at the noise floor`);
  }
  return parts.join(' · ');
}
