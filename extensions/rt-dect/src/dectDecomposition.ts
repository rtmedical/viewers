/**
 * Dual-energy CT: two-material decomposition and virtual monochromatic images — pure core
 * (RTV-87, foundation for RTV-85/86/88/89).
 *
 * At diagnostic energies attenuation is the sum of two effects — photoelectric absorption
 * and Compton scatter — so any material's µ(E) can be written as a combination of two
 * basis materials. Two measurements at two kVp give two equations, and the basis densities
 * fall out of a 2×2 solve. Everything downstream (iodine maps, virtual non-contrast, VMI,
 * material classification) is a different way of reading the same two numbers.
 *
 * ## It is an ill-conditioned inverse problem, and that is the whole engineering story
 *
 * The 2×2 matrix is built from the basis materials' attenuation at the two spectra. When
 * the two spectra are close — 100/120 kVp, or a poorly separated dual-layer detector — the
 * two rows are nearly parallel, the matrix is nearly singular, and **noise in the input HU
 * is amplified by the condition number** on its way into the basis densities. A 5 HU
 * uncertainty becomes a 50 HU uncertainty in the iodine map, and the map looks like a map:
 * smooth, plausible, and wrong.
 *
 * So {@link decompose} computes the condition number, returns it, and **refuses** above
 * {@link MAX_CONDITION_NUMBER}. Spectral separation is not a quality setting; it is the
 * thing that makes the measurement possible.
 *
 * The conditioning is measured on the **column-normalised** matrix
 * ({@link basisConditionNumber}), not the raw one. The raw 2-norm condition number
 * conflates two completely different things: that iodine attenuates forty times more than
 * water (which is *signal* — it is why the decomposition works at all) and that two basis
 * materials point in nearly the same direction (which is the failure). Normalising the
 * columns leaves only the angle between them, which is the question actually being asked,
 * and makes the answer independent of the units the basis attenuations are quoted in.
 *
 * ## VMI at 40 keV is not free contrast
 *
 * A virtual monochromatic image at low keV boosts iodine enormously — and boosts noise
 * too, because it is a weighted difference of the two basis images and the weights grow
 * fast as keV falls. Noise is quadratic in the weights with a minimum somewhere in the
 * 65–75 keV region; below about 50 keV it climbs steeply.
 *
 * {@link virtualMonochromatic} reports the predicted noise amplification alongside the
 * image, and {@link optimalContrastToNoiseKev} finds the keV that actually maximises CNR
 * rather than the one that maximises contrast. A reader shown a 40 keV series without
 * being told the noise tripled will read it as if it were a 70 keV series.
 *
 * ## HU in, HU out
 *
 * Everything crossing the boundary is in Hounsfield units, because that is what the viewer
 * has. The linear algebra happens in µ relative to water, and the conversion is done here
 * rather than being left to the caller — a decomposition fed raw HU produces numbers that
 * are wrong in a way that looks like a calibration problem.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

/** Above this the decomposition amplifies noise beyond usefulness. */
export const MAX_CONDITION_NUMBER = 50;

/** Minimum kVp separation that yields a usable decomposition on a real scanner. */
export const MIN_KVP_SEPARATION = 30;

export interface MaterialAttenuation {
  name: string;
  /** µ/µ_water at the low-energy spectrum. */
  muLow: number;
  /** µ/µ_water at the high-energy spectrum. */
  muHigh: number;
}

/**
 * Reference values for an 80/140 kVp pair, µ relative to water.
 *
 * Approximate and scanner-dependent by nature — a real deployment calibrates these from a
 * phantom. They are exported so a caller can substitute measured ones without touching
 * the algebra, and so the tests have something concrete to work with.
 */
export const BASIS_80_140: Record<string, MaterialAttenuation> = {
  water: { name: 'water', muLow: 1, muHigh: 1 },
  iodine: { name: 'iodine', muLow: 38.9, muHigh: 17.2 },
  calcium: { name: 'calcium', muLow: 4.9, muHigh: 3.1 },
  fat: { name: 'fat', muLow: 0.93, muHigh: 0.95 },
  uricAcid: { name: 'uricAcid', muLow: 1.06, muHigh: 1.05 },
};

export const huToMu = (hu: number): number => 1 + Number(hu) / 1000;
export const muToHu = (mu: number): number => (Number(mu) - 1) * 1000;

export interface DecompositionInput {
  /** HU at the low-kVp acquisition. */
  huLow: number;
  /** HU at the high-kVp acquisition. */
  huHigh: number;
  basisA: MaterialAttenuation;
  basisB: MaterialAttenuation;
  /** kVp of each acquisition, for the separation check. */
  kvpLow?: number;
  kvpHigh?: number;
}

export type DecompositionFailure = 'illConditioned' | 'kvpTooClose' | 'invalidInput';

export interface DecompositionResult {
  ok: boolean;
  /** Density fraction of basis A. */
  densityA: number;
  /** Density fraction of basis B. */
  densityB: number;
  /**
   * Condition number of the basis matrix.
   *
   * The factor by which input noise is amplified into the output. Reported always, not
   * only on failure — a decomposition at κ = 40 is usable and needs to be read knowing
   * that a 5 HU uncertainty is a 200 HU uncertainty in the answer.
   */
  conditionNumber: number;
  failure?: DecompositionFailure;
  reason?: string;
}

/**
 * Solves the 2×2 for basis densities.
 *
 * ```
 * µ_low  = a·µA_low  + b·µB_low
 * µ_high = a·µA_high + b·µB_high
 * ```
 */
export function decompose(input: DecompositionInput): DecompositionResult {
  const a = input?.basisA;
  const b = input?.basisB;
  const huLow = Number(input?.huLow);
  const huHigh = Number(input?.huHigh);

  const fail = (
    failure: DecompositionFailure,
    reason: string,
    conditionNumber = Infinity
  ): DecompositionResult => ({
    ok: false, densityA: 0, densityB: 0, conditionNumber, failure, reason,
  });

  if (
    !a || !b ||
    ![a.muLow, a.muHigh, b.muLow, b.muHigh].every(v => Number.isFinite(Number(v))) ||
    !Number.isFinite(huLow) ||
    !Number.isFinite(huHigh)
  ) {
    return fail('invalidInput', 'Entradas insuficientes para a decomposição.');
  }

  const kvpLow = Number(input?.kvpLow);
  const kvpHigh = Number(input?.kvpHigh);
  if (
    Number.isFinite(kvpLow) &&
    Number.isFinite(kvpHigh) &&
    Math.abs(kvpHigh - kvpLow) < MIN_KVP_SEPARATION
  ) {
    return fail(
      'kvpTooClose',
      `Separação espectral de ${Math.abs(kvpHigh - kvpLow)} kVp é insuficiente (mínimo ${MIN_KVP_SEPARATION}).`
    );
  }

  const m = [
    [Number(a.muLow), Number(b.muLow)],
    [Number(a.muHigh), Number(b.muHigh)],
  ];
  const det = m[0][0] * m[1][1] - m[0][1] * m[1][0];
  const conditionNumber = basisConditionNumber(m);

  if (!Number.isFinite(conditionNumber) || Math.abs(det) < 1e-12) {
    return fail('illConditioned', 'Materiais de base são colineares — decomposição impossível.');
  }
  if (conditionNumber > MAX_CONDITION_NUMBER) {
    return fail(
      'illConditioned',
      `Matriz mal condicionada (κ = ${conditionNumber.toFixed(1)}); o ruído seria amplificado ${conditionNumber.toFixed(0)}×.`,
      conditionNumber
    );
  }

  const muLow = huToMu(huLow);
  const muHigh = huToMu(huHigh);

  return {
    ok: true,
    densityA: (muLow * m[1][1] - muHigh * m[0][1]) / det,
    densityB: (m[0][0] * muHigh - m[1][0] * muLow) / det,
    conditionNumber,
  };
}

/**
 * Condition number of the basis matrix with its columns normalised to unit length.
 *
 * This is the number that answers "can these two materials be told apart?". See the
 * module note on why the raw condition number is the wrong question.
 */
export function basisConditionNumber(m: number[][]): number {
  const cols = [
    [Number(m?.[0]?.[0]), Number(m?.[1]?.[0])],
    [Number(m?.[0]?.[1]), Number(m?.[1]?.[1])],
  ];
  const normalised = cols.map(col => {
    const norm = Math.hypot(col[0], col[1]);
    return norm > 1e-15 ? [col[0] / norm, col[1] / norm] : [0, 0];
  });
  return conditionNumber2x2([
    [normalised[0][0], normalised[1][0]],
    [normalised[0][1], normalised[1][1]],
  ]);
}

/** 2-norm condition number of a 2×2, from its singular values. */
export function conditionNumber2x2(m: number[][]): number {
  const [[a, b], [c, d]] = m as [[number, number], [number, number]];
  // Singular values of a 2x2 in closed form.
  const s1 = a * a + b * b + c * c + d * d;
  const s2 = Math.sqrt(Math.max(0, (a * a + b * b - c * c - d * d) ** 2 + 4 * (a * c + b * d) ** 2));
  const sigmaMax = Math.sqrt(Math.max(0, (s1 + s2) / 2));
  const sigmaMin = Math.sqrt(Math.max(0, (s1 - s2) / 2));
  return sigmaMin > 1e-15 ? sigmaMax / sigmaMin : Infinity;
}

/**
 * Mass attenuation of water, cm²/g, as a smooth function of keV over 40–140.
 *
 * A compact fit rather than a table lookup: the shape is what matters for the VMI
 * weights, and a fit keeps the function differentiable so the CNR optimum can be found by
 * scanning rather than by interpolating between table rows.
 */
export function waterMassAttenuation(kev: number): number {
  const e = Math.max(20, Math.min(200, Number(kev) || 70));
  // Photoelectric falls as ~E^-3, Compton is nearly flat over this range.
  return 0.16 + 3800 / (e * e * e);
}

/** Same shape with the iodine K-edge at 33.2 keV dominating the low end. */
export function iodineMassAttenuation(kev: number): number {
  const e = Math.max(20, Math.min(200, Number(kev) || 70));
  const kEdge = e >= 33.2 ? 1 : 0.18;
  return 0.13 + (kEdge * 1.35e6) / (e * e * e);
}

export interface VmiInput {
  /** Water-equivalent basis density, from {@link decompose}. */
  waterDensity: number;
  /** Iodine basis density, from {@link decompose}. */
  iodineDensity: number;
  kev: number;
  /** Standard deviation of the input HU, for the noise prediction. */
  inputNoiseHu?: number;
  conditionNumber?: number;
}

export interface VmiResult {
  hu: number;
  kev: number;
  /**
   * Factor by which input noise appears in this VMI, relative to a 70 keV image.
   *
   * Reported with the image, always. A reader shown a 40 keV series without being told the
   * noise tripled reads it as if it were a 70 keV series.
   */
  noiseAmplification: number;
  /** Predicted noise standard deviation in HU, when the input noise is known. */
  predictedNoiseHu: number | null;
}

const REFERENCE_KEV = 70;

/**
 * Synthesises the HU a monochromatic beam at `kev` would have produced.
 *
 * The basis densities are energy-independent by construction; the energy dependence lives
 * entirely in the mass attenuation coefficients, which is the point of decomposing in the
 * first place.
 */
export function virtualMonochromatic(input: VmiInput): VmiResult {
  const kev = Math.max(40, Math.min(140, Number(input?.kev) || REFERENCE_KEV));
  const water = Number(input?.waterDensity) || 0;
  const iodine = Number(input?.iodineDensity) || 0;

  const muWater = waterMassAttenuation(kev);
  const muIodine = iodineMassAttenuation(kev);
  const mu = water * muWater + iodine * muIodine;
  const hu = ((mu - muWater) / muWater) * 1000;

  const amplification = vmiNoiseAmplification(kev);
  const inputNoise = Number(input?.inputNoiseHu);
  const kappa = Number(input?.conditionNumber);
  const noiseFactor = Number.isFinite(kappa) && kappa > 0 ? kappa : 1;

  return {
    hu,
    kev,
    noiseAmplification: amplification,
    predictedNoiseHu: Number.isFinite(inputNoise)
      ? inputNoise * amplification * noiseFactor
      : null,
  };
}

/**
 * Noise amplification of a VMI relative to 70 keV.
 *
 * The VMI is a weighted difference of the two basis images; the weights grow as the
 * mass-attenuation ratio moves away from where the two spectra actually sampled it, so the
 * curve is a bowl with a minimum near 70 keV and a steep low-keV wall.
 */
export function vmiNoiseAmplification(kev: number): number {
  const e = Math.max(40, Math.min(140, Number(kev) || REFERENCE_KEV));
  const ratio = iodineMassAttenuation(e) / iodineMassAttenuation(REFERENCE_KEV);
  const highSide = Math.abs(e - REFERENCE_KEV) / 200;
  return Math.max(1, Math.sqrt(ratio * ratio * 0.72 + 0.28) + highSide);
}

/**
 * The keV that maximises iodine CNR, not iodine contrast.
 *
 * Contrast is monotonically better as keV falls, so optimising contrast alone always
 * answers "40 keV" — which is why so many protocols default there. CNR has an interior
 * optimum, and it is the number that predicts whether the lesion is actually more visible.
 */
export function optimalContrastToNoiseKev(minKev = 40, maxKev = 140): number {
  let best = REFERENCE_KEV;
  let bestCnr = -Infinity;
  for (let e = Math.max(40, minKev); e <= Math.min(140, maxKev); e += 1) {
    const contrast = iodineMassAttenuation(e) / waterMassAttenuation(e);
    const cnr = contrast / vmiNoiseAmplification(e);
    if (cnr > bestCnr) {
      bestCnr = cnr;
      best = e;
    }
  }
  return best;
}

/** One line for the VMI slider readout. */
export function describeVmi(result: VmiResult): string {
  if (!result) {
    return '';
  }
  const noise =
    result.predictedNoiseHu !== null
      ? `, ruído previsto ±${result.predictedNoiseHu.toFixed(0)} HU`
      : '';
  return `${result.kev} keV · ${result.hu.toFixed(0)} HU · ruído ${result.noiseAmplification.toFixed(2)}× vs 70 keV${noise}`;
}
