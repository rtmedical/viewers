/**
 * DCE (T1) perfusion — extended Tofts — pure core (RTV-57).
 *
 * Dynamic contrast-enhanced MR: T1-weighted volumes through a gadolinium bolus, fitted to
 * the extended Tofts model for `Ktrans`, `ve` and `vp`.
 *
 * ```
 * Ct(t) = vp·Cp(t) + Ktrans · ∫₀ᵗ Cp(τ)·e^(−kep(t−τ)) dτ,   kep = Ktrans / ve
 * ```
 *
 * ## The fit is linear, and that matters more than it sounds
 *
 * Integrating the model (Murase 2004) turns it into
 *
 * ```
 * Ct(t) = (Ktrans + kep·vp)·∫₀ᵗCp − kep·∫₀ᵗCt + vp·Cp(t)
 * ```
 *
 * which is **linear** in the three coefficients once the cumulative integrals are formed.
 * So this is one least-squares solve per voxel: no initial guess, no convergence
 * criterion, no optimiser that lands in a different local minimum on Tuesday. A nonlinear
 * fit over a whole brain is also where the runtime goes, and a map that takes four minutes
 * is a map nobody generates.
 *
 * Note the first coefficient: it is `Ktrans + kep·vp`, **not** `Ktrans`. Reading it
 * straight off as Ktrans over-estimates by `kep·vp` — about 12% for a typical
 * `Ktrans 0.25 / ve 0.4 / vp 0.05`, and more in a vascular tumour where vp is larger,
 * which is exactly where the number is being looked at. The fit still reports R² = 1
 * while being wrong, because the *linear* model is a perfect description of the data; only
 * the extraction is off. A synthetic round-trip through the forward model is what catches
 * this, and there is one in the test suite.
 *
 * ## Relative enhancement is not concentration, and Ktrans from it is not Ktrans
 *
 * This is the honesty problem specific to DCE. Getting `Ct` requires the **native T1** of
 * the tissue and the flip angle — the SPGR signal equation inverted, voxel by voxel, with
 * a T1 map from variable flip angle or from a look-locker acquisition. Most viewers skip
 * it and fit the model to `(S − S₀)/S₀`.
 *
 * The result of that is a number with the units of Ktrans, that correlates with Ktrans,
 * that is not Ktrans — it varies with the scanner, the coil, the flip angle and the
 * patient's baseline T1. It cannot be compared between visits, which is the entire point
 * of measuring Ktrans in an oncology follow-up.
 *
 * So {@link signalToConcentration} does the real conversion when it is given a T1 map, and
 * {@link relativeEnhancement} exists as the fallback — with `ConcentrationMethod` carried
 * all the way into the result, and a caveat that says the values are not comparable
 * between acquisitions.
 *
 * ## The AIF is the other half of every number here
 *
 * A population AIF (Parker) and a measured one disagree by tens of percent on the same
 * data. Which was used is recorded in the result, because a Ktrans without its AIF
 * provenance cannot be compared with anybody else's Ktrans, including the same patient's
 * from last month.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export type ConcentrationMethod = 'spgr' | 'relativeEnhancement';
export type AifSource = 'measured' | 'population' | 'unknown';

/** Gadolinium relaxivity at 1.5–3 T, in 1/(mmol/L·s). */
export const DEFAULT_RELAXIVITY = 4.5;

/** ve is a volume fraction; anything above this is a failed fit, not a finding. */
export const VE_MAX = 1;
/** Same for vp — plasma volume fraction in tissue does not exceed a few tens of percent. */
export const VP_MAX = 1;
/** Ktrans above this (per minute) is not tissue, it is a vessel or a fit blow-up. */
export const KTRANS_MAX_PER_MIN = 5;

export interface SpgrOptions {
  /** Flip angle, degrees. */
  flipAngleDeg: number;
  /** Repetition time, seconds. */
  trSec: number;
  /** Native (pre-contrast) T1 of the voxel, seconds. */
  t1Sec: number;
  /** Pre-contrast signal. Estimated from the leading points when omitted. */
  baseline?: number;
  relaxivity?: number;
}

/** Mean of the first `count` finite samples. */
export function meanBaseline(signal: ArrayLike<number>, count = 5): number {
  const values: number[] = [];
  for (let i = 0; i < (signal?.length ?? 0) && values.length < Math.max(1, count); i++) {
    const v = Number(signal[i]);
    if (Number.isFinite(v)) {
      values.push(v);
    }
  }
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/**
 * Signal to concentration through the SPGR signal equation.
 *
 * The ratio S/S₀ determines R1(t) given the native T1 and the sequence parameters; the
 * concentration is `(R1(t) − R1₀)/r₁`. Requires a T1 map — see the module note on why the
 * shortcut is not equivalent.
 */
export function signalToConcentration(
  signal: ArrayLike<number>,
  options: SpgrOptions
): number[] {
  const alpha = (Number(options?.flipAngleDeg) * Math.PI) / 180;
  const tr = Number(options?.trSec);
  const t1 = Number(options?.t1Sec);
  const r1 = Number(options?.relaxivity);
  const relaxivity = Number.isFinite(r1) && r1 > 0 ? r1 : DEFAULT_RELAXIVITY;
  const baseline = Number.isFinite(Number(options?.baseline))
    ? Number(options.baseline)
    : meanBaseline(signal);

  const n = signal?.length ?? 0;
  const out: number[] = new Array(n).fill(0);
  if (!(alpha > 0) || !(tr > 0) || !(t1 > 0) || !(baseline > 0)) {
    return out;
  }

  const e10 = Math.exp(-tr / t1);
  const cosA = Math.cos(alpha);
  // Steady-state SPGR: S = M0·sinα·(1−E1)/(1−E1·cosα). The M0·sinα factor cancels in the
  // ratio, which is why no coil calibration is needed here.
  const s0Factor = (1 - e10) / (1 - e10 * cosA);

  for (let i = 0; i < n; i++) {
    const s = Number(signal[i]);
    if (!Number.isFinite(s) || s <= 0) {
      continue;
    }
    const target = (s / baseline) * s0Factor;
    // Invert for E1: target = (1−E1)/(1−E1·cosα)  →  E1 = (1−target)/(1−target·cosα)
    const denominator = 1 - target * cosA;
    if (Math.abs(denominator) < 1e-12) {
      continue;
    }
    const e1 = (1 - target) / denominator;
    if (!(e1 > 0) || e1 >= 1) {
      continue;
    }
    const r1t = -Math.log(e1) / tr;
    const concentration = (r1t - 1 / t1) / relaxivity;
    out[i] = concentration > 0 ? concentration : 0;
  }
  return out;
}

/**
 * `(S − S₀)/S₀`.
 *
 * The fallback when there is no T1 map. Kept as a named function rather than inlined so
 * every call site is greppable — the values it produces are not concentration and must
 * not be labelled as such.
 */
export function relativeEnhancement(signal: ArrayLike<number>, baseline?: number): number[] {
  const s0 = Number.isFinite(Number(baseline)) ? Number(baseline) : meanBaseline(signal);
  const out: number[] = [];
  for (let i = 0; i < (signal?.length ?? 0); i++) {
    const s = Number(signal[i]);
    if (!Number.isFinite(s) || !(s0 > 0)) {
      out.push(0);
      continue;
    }
    const value = (s - s0) / s0;
    out.push(value > 0 ? value : 0);
  }
  return out;
}

/** Trapezoidal cumulative integral, same length as the input. */
export function cumulativeTrapezoid(values: ArrayLike<number>, timesMin: ArrayLike<number>): number[] {
  const n = Math.min(values?.length ?? 0, timesMin?.length ?? 0);
  const out: number[] = new Array(n).fill(0);
  let total = 0;
  for (let i = 1; i < n; i++) {
    const dt = Number(timesMin[i]) - Number(timesMin[i - 1]);
    const a = Number(values[i - 1]);
    const b = Number(values[i]);
    if (Number.isFinite(dt) && dt > 0 && Number.isFinite(a) && Number.isFinite(b)) {
      total += ((a + b) / 2) * dt;
    }
    out[i] = total;
  }
  return out;
}

export type ToftsFailure =
  | 'tooFewPoints'
  | 'noEnhancement'
  | 'singular'
  | 'nonPhysical'
  | 'temporalResolution';

export type DceCaveat =
  | 'relativeEnhancement'
  | 'populationAif'
  | 'unknownAif'
  | 'coarseTemporalResolution';

export interface ToftsResult {
  ok: boolean;
  /** Volume transfer constant, per minute. */
  ktrans: number;
  /** Extravascular extracellular volume fraction. */
  ve: number;
  /** Plasma volume fraction. */
  vp: number;
  /** Rate constant, per minute — `Ktrans/ve`. */
  kep: number;
  /** Coefficient of determination of the linear fit. */
  r2: number;
  method: ConcentrationMethod;
  aifSource: AifSource;
  caveats: DceCaveat[];
  failure?: ToftsFailure;
  reason?: string;
}

export interface ToftsInput {
  /** Tissue curve: concentration, or relative enhancement when there is no T1 map. */
  tissue: ArrayLike<number>;
  /** Arterial plasma curve, in the same units as `tissue`. */
  plasma: ArrayLike<number>;
  /** Time axis in MINUTES — Ktrans is conventionally per minute. */
  timesMin: ArrayLike<number>;
  method: ConcentrationMethod;
  aifSource: AifSource;
}

/**
 * Sampling interval above which the wash-in is under-sampled and Ktrans is biased low.
 *
 * A 30-second TR cannot see the first-pass upslope of an aggressive tumour, so the fit
 * attributes the missed rise to a smaller Ktrans. Flagged rather than refused, because a
 * biased number the reader knows about is still useful for ve and vp.
 */
export const MAX_SAMPLING_MIN = 0.25;

/**
 * One linear least-squares solve for Ktrans, ve and vp.
 *
 * Rejects a fit that lands outside physiology instead of returning it. A `ve` of 3 is not
 * "an unusual tumour", it is an unconstrained solve fitting noise, and a map with those in
 * it has bright spots in exactly the places the reader is drawn to.
 */
export function fitExtendedTofts(input: ToftsInput): ToftsResult {
  const method: ConcentrationMethod =
    input?.method === 'spgr' ? 'spgr' : 'relativeEnhancement';
  const aifSource: AifSource = ['measured', 'population'].includes(input?.aifSource as string)
    ? (input.aifSource as AifSource)
    : 'unknown';

  const caveats: DceCaveat[] = [];
  if (method !== 'spgr') {
    caveats.push('relativeEnhancement');
  }
  if (aifSource === 'population') {
    caveats.push('populationAif');
  }
  if (aifSource === 'unknown') {
    caveats.push('unknownAif');
  }

  const fail = (failure: ToftsFailure, reason: string): ToftsResult => ({
    ok: false, ktrans: 0, ve: 0, vp: 0, kep: 0, r2: 0, method, aifSource, caveats, failure, reason,
  });

  const n = Math.min(
    input?.tissue?.length ?? 0,
    input?.plasma?.length ?? 0,
    input?.timesMin?.length ?? 0
  );
  if (n < 6) {
    return fail('tooFewPoints', 'Série curta demais para o modelo de Tofts.');
  }

  let maxTissue = 0;
  let maxPlasma = 0;
  let maxGap = 0;
  for (let i = 0; i < n; i++) {
    maxTissue = Math.max(maxTissue, Number(input.tissue[i]) || 0);
    maxPlasma = Math.max(maxPlasma, Number(input.plasma[i]) || 0);
    if (i > 0) {
      maxGap = Math.max(maxGap, Number(input.timesMin[i]) - Number(input.timesMin[i - 1]));
    }
  }
  if (!(maxTissue > 0) || !(maxPlasma > 0)) {
    return fail('noEnhancement', 'Sem realce no tecido ou na AIF.');
  }
  if (maxGap > MAX_SAMPLING_MIN) {
    caveats.push('coarseTemporalResolution');
  }

  const intPlasma = cumulativeTrapezoid(input.plasma, input.timesMin);
  const intTissue = cumulativeTrapezoid(input.tissue, input.timesMin);

  // Ct = (Ktrans + kep·vp)·∫Cp − kep·∫Ct + vp·Cp
  const rows: Array<[number, number, number]> = [];
  const ys: number[] = [];
  for (let i = 0; i < n; i++) {
    rows.push([intPlasma[i], -intTissue[i], Number(input.plasma[i]) || 0]);
    ys.push(Number(input.tissue[i]) || 0);
  }

  const solved = solve3NoIntercept(rows, ys);
  if (!solved) {
    return fail('singular', 'Sistema mal condicionado — curvas colineares.');
  }
  // The first coefficient is Ktrans + kep·vp — see the module note. Unpicking it is the
  // difference between a correct map and one that is 12% high everywhere and worse where
  // vp is large.
  const [combined, kep, vp] = solved;
  const ktrans = combined - kep * vp;
  const ve = kep > 0 ? ktrans / kep : 0;

  if (
    !(ktrans > 0) ||
    !(kep > 0) ||
    ktrans > KTRANS_MAX_PER_MIN ||
    !(ve > 0) ||
    ve > VE_MAX ||
    vp < 0 ||
    vp > VP_MAX
  ) {
    return fail(
      'nonPhysical',
      `Ajuste fora da fisiologia (Ktrans=${ktrans.toFixed(3)}, ve=${ve.toFixed(3)}, vp=${vp.toFixed(3)}).`
    );
  }

  // R² against the measured tissue curve, so a plausible-looking but bad fit is visible.
  let ssRes = 0;
  let ssTot = 0;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
  for (let i = 0; i < n; i++) {
    const predicted = combined * rows[i][0] + kep * rows[i][1] + vp * rows[i][2];
    ssRes += (ys[i] - predicted) ** 2;
    ssTot += (ys[i] - meanY) ** 2;
  }

  return {
    ok: true,
    ktrans,
    ve,
    vp,
    kep,
    r2: ssTot > 0 ? 1 - ssRes / ssTot : 0,
    method,
    aifSource,
    caveats,
  };
}

/** Least squares for `y = a·x₁ + b·x₂ + c·x₃`, no intercept. */
function solve3NoIntercept(
  rows: Array<[number, number, number]>,
  ys: number[]
): [number, number, number] | null {
  const a = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  for (let i = 0; i < rows.length; i++) {
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        a[r][c] += rows[i][r] * rows[i][c];
      }
      a[r][3] += rows[i][r] * ys[i];
    }
  }
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) {
        pivot = row;
      }
    }
    if (Math.abs(a[pivot][col]) < 1e-15) {
      return null;
    }
    const tmp = a[col];
    a[col] = a[pivot];
    a[pivot] = tmp;
    for (let row = 0; row < 3; row++) {
      if (row !== col) {
        const factor = a[row][col] / a[col][col];
        for (let k = col; k < 4; k++) {
          a[row][k] -= factor * a[col][k];
        }
      }
    }
  }
  return [a[0][3] / a[0][0], a[1][3] / a[1][1], a[2][3] / a[2][2]];
}

/**
 * Parker population AIF, in mmol/L.
 *
 * Two Gaussians plus a decaying exponential, from Parker et al., MRM 2006. Provided so a
 * study without a measurable artery is analysable at all — and every result that uses it
 * carries the `populationAif` caveat, because it disagrees with a measured AIF by tens of
 * percent on the same data.
 */
export function parkerAif(timesMin: ArrayLike<number>, bolusArrivalMin = 0): number[] {
  const A = [0.809, 0.330];
  const T = [0.17046, 0.365];
  const sigma = [0.0563, 0.132];
  const alpha = 1.05;
  const beta = 0.1685;
  const s = 38.078;
  const tau = 0.483;

  const out: number[] = [];
  for (let i = 0; i < (timesMin?.length ?? 0); i++) {
    const t = Number(timesMin[i]) - Number(bolusArrivalMin || 0);
    if (!Number.isFinite(t) || t <= 0) {
      out.push(0);
      continue;
    }
    let value = 0;
    for (let k = 0; k < 2; k++) {
      value +=
        (A[k] / (sigma[k] * Math.sqrt(2 * Math.PI))) *
        Math.exp(-((t - T[k]) ** 2) / (2 * sigma[k] ** 2));
    }
    value += (alpha * Math.exp(-beta * t)) / (1 + Math.exp(-s * (t - tau)));
    out.push(value);
  }
  return out;
}

export const DCE_CAVEAT_LABELS: Record<DceCaveat, string> = {
  relativeEnhancement:
    'Ajustado sobre realce relativo, sem mapa T1 — os valores NÃO são Ktrans e não comparam entre exames.',
  populationAif: 'AIF populacional (Parker) — difere de AIF medida em dezenas de porcento.',
  unknownAif: 'Origem da AIF não declarada — resultados não comparáveis.',
  coarseTemporalResolution:
    'Resolução temporal grossa — a subida do primeiro passo pode estar subamostrada e o Ktrans subestimado.',
};

/** The disclaimer that has to travel with the map. */
export function describeCaveats(result: ToftsResult): string {
  return (result?.caveats ?? []).map(c => DCE_CAVEAT_LABELS[c]).filter(Boolean).join(' ');
}

/** Short summary line for a ROI readout. */
export function describeTofts(result: ToftsResult): string {
  if (!result) {
    return '';
  }
  if (!result.ok) {
    return result.reason ?? 'Ajuste falhou.';
  }
  const unit = result.method === 'spgr' ? 'min⁻¹' : 'min⁻¹ (relativo)';
  return `Ktrans ${result.ktrans.toFixed(3)} ${unit} · ve ${result.ve.toFixed(2)} · vp ${result.vp.toFixed(3)} · R² ${result.r2.toFixed(3)}`;
}
