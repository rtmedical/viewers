/**
 * DICOM PS3.14 Grayscale Standard Display Function (GSDF) — pure math (RTV-211).
 *
 * Implements the Barten-model interpolation of PS3.14 Section 7.1: luminance as
 * a function of the Just-Noticeable-Difference (JND) index j, valid for
 * j ∈ [1, 1023], covering the luminance range ~0.05 to ~4000 cd/m².
 *
 *   log10 L(j) = (a + c·ln j + e·ln²j + g·ln³j + m·ln⁴j)
 *              / (1 + b·ln j + d·ln²j + f·ln³j + h·ln⁴j + k·ln⁵j)
 *
 * with the official PS3.14 constants below. The inverse (JND index for a given
 * luminance) is computed by bisection over the (strictly monotonic) forward
 * function.
 *
 * SCOPE / HONESTY NOTE: real luminance verification requires a photometer —
 * a browser cannot measure emitted cd/m². This module only computes the GSDF
 * *targets* used by the visual-conformance workflow (tg18Patterns +
 * CalibrationPage); GPU-LUT/ICC calibration is out of scope.
 */

/** Official PS3.14 Barten-fit coefficients (Section 7.1). */
export const GSDF_COEFFICIENTS = {
  a: -1.3011877,
  b: -2.5840191e-2,
  c: 8.0242636e-2,
  d: -1.0320229e-1,
  e: 1.3646699e-1,
  f: 2.874562e-2,
  g: -2.5468404e-2,
  h: -3.1978977e-3,
  k: 1.2992634e-4,
  m: 1.3635334e-3,
} as const;

const { a: A, b: B, c: C, d: D, e: E, f: F, g: G, h: H, k: K, m: M } = GSDF_COEFFICIENTS;

/** Inclusive JND-index domain of the PS3.14 GSDF. */
export const JND_MIN = 1;
export const JND_MAX = 1023;

/**
 * GSDF luminance (cd/m²) for a JND index j ∈ [1, 1023].
 * L(1) ≈ 0.0500 cd/m², L(1023) ≈ 3993 cd/m² (PS3.14 quotes 0.05–4000).
 *
 * @throws RangeError when j is outside [1, 1023] or not finite.
 */
export function gsdfLuminance(jndIndex: number): number {
  if (!Number.isFinite(jndIndex) || jndIndex < JND_MIN || jndIndex > JND_MAX) {
    throw new RangeError(`GSDF JND index must be in [${JND_MIN}, ${JND_MAX}], got ${jndIndex}`);
  }
  const x = Math.log(jndIndex);
  const x2 = x * x;
  const x3 = x2 * x;
  const x4 = x3 * x;
  const x5 = x4 * x;
  const numerator = A + C * x + E * x2 + G * x3 + M * x4;
  const denominator = 1 + B * x + D * x2 + F * x3 + H * x4 + K * x5;
  return Math.pow(10, numerator / denominator);
}

/**
 * Inverse GSDF: the (continuous) JND index whose GSDF luminance equals `L`,
 * found by bisection over [1, 1023] (the forward function is strictly
 * monotonic). Values outside the GSDF luminance range clamp to the domain
 * bounds, so callers can feed a display's measured/rated Lmin/Lmax directly.
 */
export function jndIndexForLuminance(luminance: number, tolerance = 1e-6): number {
  if (!Number.isFinite(luminance) || luminance <= 0) {
    throw new RangeError(`Luminance must be a positive number, got ${luminance}`);
  }
  if (luminance <= gsdfLuminance(JND_MIN)) {
    return JND_MIN;
  }
  if (luminance >= gsdfLuminance(JND_MAX)) {
    return JND_MAX;
  }
  let lo = JND_MIN;
  let hi = JND_MAX;
  while (hi - lo > tolerance) {
    const mid = (lo + hi) / 2;
    if (gsdfLuminance(mid) < luminance) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

export interface GsdfCurvePoint {
  /** JND index. */
  j: number;
  /** GSDF luminance at j, cd/m². */
  L: number;
}

/**
 * Samples the GSDF curve with `nPoints` equally spaced JND indices in
 * [jMin, jMax] (endpoints included) — the data set the CalibrationPage plots.
 */
export function gsdfCurve(nPoints: number, jMin = JND_MIN, jMax = JND_MAX): GsdfCurvePoint[] {
  if (!Number.isInteger(nPoints) || nPoints < 2) {
    throw new RangeError(`nPoints must be an integer >= 2, got ${nPoints}`);
  }
  if (jMin < JND_MIN || jMax > JND_MAX || jMin >= jMax) {
    throw new RangeError(`Invalid JND range [${jMin}, ${jMax}]`);
  }
  const points: GsdfCurvePoint[] = [];
  for (let i = 0; i < nPoints; i++) {
    const j = jMin + ((jMax - jMin) * i) / (nPoints - 1);
    points.push({ j, L: gsdfLuminance(j) });
  }
  return points;
}

export interface ContrastStep {
  /** 0-based step index. */
  step: number;
  /** JND index at this step. */
  j: number;
  /** GSDF target luminance at this step, cd/m². */
  luminance: number;
  /**
   * Target relative contrast of ONE JND at this operating point:
   * (L(j+1) − L(j)) / L(j). This is the dL/L a compliant display should
   * resolve here (the QC-report target).
   */
  contrastPerJnd: number;
}

/**
 * Per-step GSDF contrast targets for a display operating between `lMin` and
 * `lMax` cd/m²: the [jnd(lMin), jnd(lMax)] interval is divided into `steps`
 * equally spaced JND indices (TG18-LN style) and, for each, the target
 * luminance and the single-JND relative contrast dL/L are reported.
 */
export function contrastPerJnd(lMin: number, lMax: number, steps: number): ContrastStep[] {
  if (!Number.isInteger(steps) || steps < 2) {
    throw new RangeError(`steps must be an integer >= 2, got ${steps}`);
  }
  if (!(lMin > 0) || !(lMax > lMin)) {
    throw new RangeError(`Require 0 < lMin < lMax, got lMin=${lMin} lMax=${lMax}`);
  }
  const jLo = jndIndexForLuminance(lMin);
  const jHi = jndIndexForLuminance(lMax);
  const table: ContrastStep[] = [];
  for (let i = 0; i < steps; i++) {
    const j = jLo + ((jHi - jLo) * i) / (steps - 1);
    const L = gsdfLuminance(j);
    const jNext = Math.min(j + 1, JND_MAX);
    // At the very top of the domain measure the JND below instead.
    const dL =
      jNext > j
        ? gsdfLuminance(jNext) - L
        : L - gsdfLuminance(j - 1);
    table.push({ step: i, j, luminance: L, contrastPerJnd: dL / L });
  }
  return table;
}
