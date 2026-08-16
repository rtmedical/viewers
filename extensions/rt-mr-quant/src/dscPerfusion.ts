/**
 * DSC (T2*) perfusion — pure core (RTV-56).
 *
 * Dynamic susceptibility contrast: a bolus of gadolinium passes through the voxel, the
 * T2*-weighted signal dips, and the shape of that dip carries CBV, CBF, MTT and TTP.
 *
 * Three things about that are routinely got wrong, and all three change the numbers on the
 * map a neuroradiologist is looking at.
 *
 * ## Signal is not concentration
 *
 * The dip is exponential in concentration, not linear:
 *
 * ```
 * C(t) = −k · ln( S(t) / S₀ ) / TE
 * ```
 *
 * Integrating the raw signal drop and calling it CBV under-weights the peak and
 * over-weights the shoulders — the error is largest exactly where the bolus is
 * concentrated, so it does not cancel. {@link dscSignalToConcentration} does the conversion
 * and needs a real baseline, which is why {@link estimateBaseline} exists and why it
 * refuses to guess from too few pre-bolus points.
 *
 * ## Recirculation contaminates the area under the curve
 *
 * The tracer comes back around. Integrating the whole time-series counts the second pass
 * as if it were the first and inflates CBV, more in some tissues than others. The standard
 * fix is to fit a gamma-variate to the first pass and integrate the *fit*, which is what
 * {@link fitGammaVariate} is for.
 *
 * ## CBF is not the peak height, and MTT is not the FWHM
 *
 * The tissue curve is the arterial input convolved with the residue function. Recovering
 * CBF means **deconvolving** by a measured AIF — and this module does not do that: a
 * circulant-SVD deconvolution needs an AIF, a regularisation choice, and validation data
 * none of which exist here yet.
 *
 * So what is computed is stated for what it is. `rCBV` is a ratio of areas, MTT is the
 * **first moment** of the fitted curve, and CBF is `CBV/MTT` by the central volume
 * theorem, flagged `approximate` with `requiresDeconvolution` set. Every result carries
 * {@link PerfusionResult.caveats}. A CBF map that does not say it skipped the
 * deconvolution is the dangerous artefact here: it looks like the one from the scanner
 * console and disagrees with it by a factor that varies with the bolus.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

/** Minimum pre-bolus points needed to call a baseline a baseline. */
export const MIN_BASELINE_POINTS = 5;

/**
 * Proportionality constant in C = −k·ln(S/S₀)/TE.
 *
 * Unknown in practice, so everything here is *relative* perfusion (rCBV/rCBF), which is
 * what DSC is clinically used for anyway. Kept as 1 and named so nobody mistakes the
 * output for mL/100 g.
 */
export const RELATIVE_K = 1;

export interface ConcentrationOptions {
  /** Echo time in ms. Scales the result; irrelevant for ratios, so defaults to 1. */
  echoTimeMs?: number;
  /** Pre-computed baseline. Otherwise estimated from the leading points. */
  baseline?: number;
}

export interface BaselineEstimate {
  value: number;
  points: number;
  ok: boolean;
  reason?: string;
}

/**
 * Mean pre-bolus signal.
 *
 * The bolus arrival is found as the first point that drops below
 * `mean − 3σ` of the leading points; everything before it is baseline. Refuses with fewer
 * than {@link MIN_BASELINE_POINTS} points rather than averaging two samples — a baseline
 * off by 5% moves every concentration value and therefore every voxel of the map.
 */
export function estimateBaseline(signal: ArrayLike<number>): BaselineEstimate {
  const values: number[] = [];
  for (let i = 0; i < (signal?.length ?? 0); i++) {
    const v = Number(signal[i]);
    if (Number.isFinite(v)) {
      values.push(v);
    }
  }
  if (values.length < MIN_BASELINE_POINTS + 2) {
    return { value: 0, points: 0, ok: false, reason: 'Série curta demais para estimar a linha de base.' };
  }

  // Seed from the first few points, then extend while the signal stays inside the noise.
  const seed = values.slice(0, MIN_BASELINE_POINTS);
  const mean = seed.reduce((a, b) => a + b, 0) / seed.length;
  const variance = seed.reduce((a, b) => a + (b - mean) ** 2, 0) / seed.length;
  const threshold = mean - 3 * Math.sqrt(variance);

  let count = MIN_BASELINE_POINTS;
  while (count < values.length && values[count] > threshold) {
    count += 1;
  }

  const used = values.slice(0, count);
  const baseline = used.reduce((a, b) => a + b, 0) / used.length;
  if (!(baseline > 0)) {
    return { value: 0, points: count, ok: false, reason: 'Linha de base não positiva.' };
  }
  return { value: baseline, points: count, ok: true };
}

/**
 * Converts a DSC signal time-course to concentration.
 *
 * Values at or above the baseline give a concentration of 0 rather than a negative one:
 * noise above the baseline is noise, and letting it go negative puts holes in the area
 * under the curve.
 */
export function dscSignalToConcentration(
  signal: ArrayLike<number>,
  options: ConcentrationOptions = {}
): number[] {
  const te = Number(options.echoTimeMs);
  const echo = Number.isFinite(te) && te > 0 ? te : 1;
  const baseline = Number.isFinite(Number(options.baseline))
    ? Number(options.baseline)
    : estimateBaseline(signal).value;

  const out: number[] = [];
  for (let i = 0; i < (signal?.length ?? 0); i++) {
    const s = Number(signal[i]);
    if (!Number.isFinite(s) || !(baseline > 0) || s <= 0) {
      out.push(0);
      continue;
    }
    const c = (-RELATIVE_K * Math.log(s / baseline)) / echo;
    out.push(c > 0 ? c : 0);
  }
  return out;
}

export interface GammaVariateFit {
  ok: boolean;
  /** Scale. */
  k: number;
  /** Rise exponent. */
  alpha: number;
  /** Decay constant. */
  beta: number;
  /** Bolus arrival time, in the same units as the time axis. */
  t0: number;
  /** Points used by the fit. */
  points: number;
  reason?: string;
}

/**
 * Fits `C(t) = k·(t−t₀)^α·exp(−(t−t₀)/β)` to the first pass.
 *
 * Log-linearised: `ln C = ln k + α·ln(t−t₀) − (t−t₀)/β` is linear in `ln k`, `α` and
 * `1/β`, so it is a three-parameter least squares once `t₀` is known — no iterative
 * optimiser, no convergence to explain, and deterministic. `t₀` comes from the first
 * non-zero concentration.
 *
 * Only the points up to the peak plus the decay before the curve turns back up are used:
 * including the recirculation hump is exactly the thing this fit exists to exclude.
 *
 * `t₀` is quantised to the sampling grid, and at a coarse TR that is the dominant error in
 * everything downstream — a 1.5 s error in arrival shifts the whole fitted curve and moves
 * the area by a few percent. Worth knowing before comparing two acquisitions with
 * different TRs; not worth a sub-sample estimator without data to validate one against.
 */
export function fitGammaVariate(
  concentration: ArrayLike<number>,
  timesSec: ArrayLike<number>
): GammaVariateFit {
  const n = Math.min(concentration?.length ?? 0, timesSec?.length ?? 0);
  const fail = (reason: string): GammaVariateFit => ({
    ok: false, k: 0, alpha: 0, beta: 0, t0: 0, points: 0, reason,
  });
  if (n < 6) {
    return fail('Série curta demais para ajustar a primeira passagem.');
  }

  let firstIndex = -1;
  let peakIndex = 0;
  let peak = -Infinity;
  for (let i = 0; i < n; i++) {
    const c = Number(concentration[i]);
    if (firstIndex < 0 && c > 0) {
      firstIndex = i;
    }
    if (c > peak) {
      peak = c;
      peakIndex = i;
    }
  }
  if (firstIndex < 0 || !(peak > 0)) {
    return fail('Sem realce detectável.');
  }

  const t0 = Number(timesSec[Math.max(0, firstIndex - 1)]);

  // Walk down from the peak until the curve stops falling — that upturn is recirculation.
  let lastIndex = peakIndex;
  while (
    lastIndex + 1 < n &&
    Number(concentration[lastIndex + 1]) <= Number(concentration[lastIndex]) &&
    Number(concentration[lastIndex + 1]) > 0
  ) {
    lastIndex += 1;
  }

  const xs: Array<[number, number]> = [];
  const ys: number[] = [];
  for (let i = firstIndex; i <= lastIndex; i++) {
    const dt = Number(timesSec[i]) - t0;
    const c = Number(concentration[i]);
    if (dt > 0 && c > 0) {
      xs.push([Math.log(dt), dt]);
      ys.push(Math.log(c));
    }
  }
  if (xs.length < 4) {
    return fail('Pontos insuficientes na primeira passagem.');
  }

  const solved = solve3(xs, ys);
  if (!solved) {
    return fail('Ajuste da gama-variada não convergiu.');
  }
  const [lnK, alpha, negInvBeta] = solved;
  const beta = negInvBeta < 0 ? -1 / negInvBeta : 0;
  if (!(beta > 0) || !(alpha > 0) || !Number.isFinite(lnK)) {
    return fail('Parâmetros da gama-variada não físicos.');
  }

  return { ok: true, k: Math.exp(lnK), alpha, beta, t0, points: xs.length };
}

/** Least squares for `y = a + b·x₁ + c·x₂` via the 3×3 normal equations. */
function solve3(xs: Array<[number, number]>, ys: number[]): [number, number, number] | null {
  let s0 = 0, s1 = 0, s2 = 0, s11 = 0, s12 = 0, s22 = 0, sy = 0, sy1 = 0, sy2 = 0;
  for (let i = 0; i < xs.length; i++) {
    const [x1, x2] = xs[i];
    const y = ys[i];
    s0 += 1; s1 += x1; s2 += x2;
    s11 += x1 * x1; s12 += x1 * x2; s22 += x2 * x2;
    sy += y; sy1 += y * x1; sy2 += y * x2;
  }
  const m = [
    [s0, s1, s2, sy],
    [s1, s11, s12, sy1],
    [s2, s12, s22, sy2],
  ];
  // Gaussian elimination with partial pivoting.
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) {
        pivot = row;
      }
    }
    if (Math.abs(m[pivot][col]) < 1e-12) {
      return null;
    }
    const tmp = m[col];
    m[col] = m[pivot];
    m[pivot] = tmp;
    for (let row = 0; row < 3; row++) {
      if (row !== col) {
        const factor = m[row][col] / m[col][col];
        for (let k = col; k < 4; k++) {
          m[row][k] -= factor * m[col][k];
        }
      }
    }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}

/** Evaluates the fitted gamma-variate at `t`. */
export function gammaVariateAt(fit: GammaVariateFit, t: number): number {
  if (!fit?.ok) {
    return 0;
  }
  const dt = Number(t) - fit.t0;
  if (!(dt > 0)) {
    return 0;
  }
  return fit.k * Math.pow(dt, fit.alpha) * Math.exp(-dt / fit.beta);
}

/**
 * Analytic area and first moment of the fitted first pass.
 *
 * ∫ k·t^α·e^(−t/β) dt = k·β^(α+1)·Γ(α+1), and the first moment is `(α+1)·β`. Using the
 * closed form rather than summing the samples removes the dependence on the sampling
 * interval, which is what makes two scanners with different TRs comparable.
 */
export function gammaVariateArea(fit: GammaVariateFit): number {
  if (!fit?.ok) {
    return 0;
  }
  return fit.k * Math.pow(fit.beta, fit.alpha + 1) * gammaFunction(fit.alpha + 1);
}

/** Mean transit time of the fitted curve: `(α+1)·β`. */
export function gammaVariateFirstMoment(fit: GammaVariateFit): number {
  return fit?.ok ? (fit.alpha + 1) * fit.beta : 0;
}

/** Lanczos approximation; accurate to ~1e-13 for the α range a bolus produces. */
function gammaFunction(z: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.PI / (Math.sin(Math.PI * z) * gammaFunction(1 - z));
  }
  const x = z - 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) {
    a += c[i] / (x + i);
  }
  return Math.sqrt(2 * Math.PI) * Math.pow(t, x + 0.5) * Math.exp(-t) * a;
}

export type PerfusionCaveat =
  | 'noDeconvolution'
  | 'relativeUnits'
  | 'noLeakageCorrection'
  | 'fitFailed'
  | 'noAif';

export interface PerfusionResult {
  ok: boolean;
  /** Relative cerebral blood volume: area under the first pass (÷ AIF area when given). */
  rCbv: number;
  /** Mean transit time, seconds. First moment of the fit — see the module note. */
  mtt: number;
  /** Relative cerebral blood flow, `rCBV/MTT` by the central volume theorem. */
  rCbf: number;
  /** Time to peak of the fitted curve, seconds from t0. */
  ttp: number;
  /** Peak concentration of the fit. */
  peak: number;
  /** True when a real deconvolution would be needed for these to be quantitative. */
  requiresDeconvolution: boolean;
  caveats: PerfusionCaveat[];
  reason?: string;
}

export interface PerfusionInput {
  signal: ArrayLike<number>;
  timesSec: ArrayLike<number>;
  echoTimeMs?: number;
  /** Arterial input function, already in concentration units. Enables the ratio. */
  aifArea?: number;
}

/**
 * Everything this module is willing to claim about one voxel's time-course.
 *
 * `requiresDeconvolution` is always true and `caveats` always names it. That is not
 * defensive noise: a CBF map that does not say it skipped the deconvolution looks like the
 * one from the scanner console and disagrees with it by a bolus-dependent factor.
 */
export function analysePerfusion(input: PerfusionInput): PerfusionResult {
  const empty: PerfusionResult = {
    ok: false,
    rCbv: 0,
    mtt: 0,
    rCbf: 0,
    ttp: 0,
    peak: 0,
    requiresDeconvolution: true,
    caveats: ['noDeconvolution', 'relativeUnits', 'noLeakageCorrection'],
  };

  const baseline = estimateBaseline(input?.signal);
  if (!baseline.ok) {
    return { ...empty, caveats: [...empty.caveats, 'fitFailed'], reason: baseline.reason };
  }

  const concentration = dscSignalToConcentration(input.signal, {
    echoTimeMs: input.echoTimeMs,
    baseline: baseline.value,
  });
  const fit = fitGammaVariate(concentration, input.timesSec);
  if (!fit.ok) {
    return { ...empty, caveats: [...empty.caveats, 'fitFailed'], reason: fit.reason };
  }

  const area = gammaVariateArea(fit);
  const aifArea = Number(input.aifArea);
  const hasAif = Number.isFinite(aifArea) && aifArea > 0;
  const rCbv = hasAif ? area / aifArea : area;
  const mtt = gammaVariateFirstMoment(fit);
  const ttp = fit.alpha * fit.beta;

  const caveats: PerfusionCaveat[] = [
    'noDeconvolution',
    'relativeUnits',
    'noLeakageCorrection',
  ];
  if (!hasAif) {
    // Without an AIF the "volume" is in arbitrary units that cannot be compared between
    // patients, or between two acquisitions of the same patient.
    caveats.push('noAif');
  }

  return {
    ok: true,
    rCbv,
    mtt,
    rCbf: mtt > 0 ? rCbv / mtt : 0,
    ttp,
    peak: gammaVariateAt(fit, fit.t0 + ttp),
    requiresDeconvolution: true,
    caveats,
  };
}

export const CAVEAT_LABELS: Record<PerfusionCaveat, string> = {
  noDeconvolution:
    'CBF e MTT sem deconvolução pela AIF — valores relativos, sujeitos a dispersão do bolus.',
  relativeUnits: 'Unidades relativas (rCBV/rCBF), não mL/100 g.',
  noLeakageCorrection: 'Sem correção de vazamento — superestima CBV onde há quebra de barreira.',
  fitFailed: 'Não foi possível ajustar a primeira passagem.',
  noAif: 'Sem AIF: os valores não são comparáveis entre exames.',
};

/** The disclaimer that has to travel with the map. */
export function describeDscCaveats(result: PerfusionResult): string {
  return (result?.caveats ?? []).map(c => CAVEAT_LABELS[c]).filter(Boolean).join(' ');
}
