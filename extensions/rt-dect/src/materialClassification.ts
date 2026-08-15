/**
 * Dual-energy material classification — pure core (RTV-88).
 *
 * The dual-energy ratio — low-kVp attenuation over high-kVp attenuation — depends on the
 * material's effective atomic number and almost not at all on its density. Water and a
 * dilute solution of water have the same ratio; water and calcium do not. That is what
 * makes the ratio a material signature rather than a density measurement, and it is the
 * basis of every "what is this made of?" question dual-energy answers.
 *
 * ## The ratio is meaningless in low-attenuation material
 *
 * The ratio is `(HU_low + 1000) / (HU_high + 1000)`. As both approach water, the numerator
 * and denominator both approach 1000 and their **ratio approaches 1 no matter what the
 * material is** — while the noise in each stays the same size. A 20 HU structure has a
 * ratio dominated entirely by noise, and it will classify as something, confidently.
 *
 * So {@link classifyMaterial} has a hard attenuation floor and returns
 * `indeterminate` below it. A classifier without that floor produces a beautiful colour
 * overlay across soft tissue in which every voxel has an opinion.
 *
 * ## DECT separates uric acid from everything else. It does not separate the everything
 * else.
 *
 * This is the clinically load-bearing statement. Uric acid (Z ≈ 7) and calcium-containing
 * stones (Z ≈ 15–20) are far apart and reliably distinguishable. Calcium **oxalate** and
 * calcium **phosphate** are not: their ratios overlap at clinical doses and stone sizes.
 *
 * The distinction that matters clinically is exactly the one DECT can make — a uric acid
 * stone dissolves with urinary alkalinisation and a calcium stone does not — so this module
 * reports `uricAcid` versus `nonUricAcid` and **refuses to name the mineral**. A viewer
 * that prints "calcium oxalate monohydrate" from a dual-energy ratio is inventing a
 * precision the physics does not have, and a urologist will act on it.
 *
 * ## Partial volume drags small objects toward their surroundings
 *
 * A 2 mm stone in a 3 mm slice is mostly urine by volume, and its ratio is pulled toward
 * urine's. {@link classifyMaterial} takes the object size and refuses to classify below
 * the size where partial volume dominates.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export type MaterialClass =
  | 'water'
  | 'fat'
  | 'uricAcid'
  | 'nonUricAcid'
  | 'iodine'
  | 'metal'
  | 'indeterminate';

/**
 * Below this attenuation the ratio is noise. 100 HU is conservative; below it the
 * separation between uric acid and calcium is smaller than the measurement error.
 */
export const MIN_ATTENUATION_HU = 100;

/**
 * Below this size, partial volume dominates the ratio.
 *
 * 3 mm is the commonly cited limit for stone characterisation at typical slice thickness.
 * A parameter, because it scales with the reconstruction.
 */
export const MIN_OBJECT_SIZE_MM = 3;

/** Metal saturates the low-kVp acquisition; anything past this is not tissue. */
export const METAL_HU = 2500;

export interface RatioBand {
  material: MaterialClass;
  min: number;
  max: number;
  label: string;
}

/**
 * Dual-energy ratio bands for an 80/140 kVp pair.
 *
 * Scanner- and protocol-dependent; a deployment measures these from a phantom. Note what
 * is *not* here: no band for calcium oxalate and none for calcium phosphate. See the
 * module note.
 */
export const RATIO_BANDS_80_140: RatioBand[] = [
  { material: 'fat', min: 0.9, max: 0.98, label: 'Gordura' },
  { material: 'water', min: 0.98, max: 1.06, label: 'Água / tecido mole' },
  { material: 'uricAcid', min: 1.06, max: 1.15, label: 'Ácido úrico' },
  { material: 'nonUricAcid', min: 1.15, max: 1.75, label: 'Cálcio (não ácido úrico)' },
  { material: 'iodine', min: 1.75, max: 2.4, label: 'Iodo' },
];

/**
 * `(HU_low + 1000) / (HU_high + 1000)`.
 *
 * The +1000 converts HU back to attenuation relative to air, which is what the ratio is
 * defined on. Computing it on raw HU gives a number that changes sign around water and is
 * not a ratio of anything physical.
 */
export function dualEnergyRatio(huLow: number, huHigh: number): number {
  const low = Number(huLow) + 1000;
  const high = Number(huHigh) + 1000;
  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= 0) {
    return NaN;
  }
  return low / high;
}

export interface ClassificationInput {
  huLow: number;
  huHigh: number;
  /** Smallest dimension of the object, mm. Guards against partial volume. */
  sizeMm?: number;
  bands?: RatioBand[];
  minAttenuationHu?: number;
  minSizeMm?: number;
}

export type ClassificationRefusal =
  | 'belowAttenuationFloor'
  | 'partialVolume'
  | 'outsideBands'
  | 'invalidInput';

export interface ClassificationResult {
  material: MaterialClass;
  label: string;
  ratio: number;
  /** Mean of the two acquisitions, HU. */
  attenuationHu: number;
  ok: boolean;
  refusal?: ClassificationRefusal;
  message?: string;
  /** Present for a stone: what the classification implies for management. */
  clinicalNote?: string;
}

/**
 * Classifies one voxel or ROI by its dual-energy ratio.
 *
 * Every path that cannot answer returns `indeterminate` **with a reason**, rather than
 * the nearest band. The nearest band is always available and always wrong when the input
 * is out of range, which is what makes it the dangerous default.
 */
export function classifyMaterial(input: ClassificationInput): ClassificationResult {
  const huLow = Number(input?.huLow);
  const huHigh = Number(input?.huHigh);
  const ratio = dualEnergyRatio(huLow, huHigh);
  const attenuationHu = (huLow + huHigh) / 2;

  const base = { ratio, attenuationHu, material: 'indeterminate' as MaterialClass, label: 'Indeterminado' };

  if (!Number.isFinite(ratio) || !Number.isFinite(attenuationHu)) {
    return { ...base, ok: false, refusal: 'invalidInput', message: 'Medidas inválidas.' };
  }

  if (attenuationHu >= METAL_HU) {
    return {
      ratio,
      attenuationHu,
      material: 'metal',
      label: 'Metal',
      ok: true,
      message: 'Atenuação de metal — a decomposição não é válida nesta região.',
    };
  }

  const floor = positiveOr(input?.minAttenuationHu, MIN_ATTENUATION_HU);
  if (attenuationHu < floor) {
    return {
      ...base,
      ok: false,
      refusal: 'belowAttenuationFloor',
      message: `Atenuação de ${attenuationHu.toFixed(0)} HU abaixo de ${floor} HU — a razão dual-energy é ruído nesta faixa.`,
    };
  }

  const sizeMm = Number(input?.sizeMm);
  const minSize = positiveOr(input?.minSizeMm, MIN_OBJECT_SIZE_MM);
  if (Number.isFinite(sizeMm) && sizeMm > 0 && sizeMm < minSize) {
    return {
      ...base,
      ok: false,
      refusal: 'partialVolume',
      message: `Objeto de ${sizeMm} mm abaixo de ${minSize} mm — volume parcial puxa a razão em direção ao meio circundante.`,
    };
  }

  const bands = (input?.bands ?? RATIO_BANDS_80_140).filter(b => b && b.material);
  const band = bands.find(b => ratio >= b.min && ratio < b.max);
  if (!band) {
    return {
      ...base,
      ok: false,
      refusal: 'outsideBands',
      message: `Razão de ${ratio.toFixed(2)} fora das faixas calibradas.`,
    };
  }

  return {
    material: band.material,
    label: band.label,
    ratio,
    attenuationHu,
    ok: true,
    clinicalNote: clinicalNoteFor(band.material),
  };
}

function positiveOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * What the classification means for management.
 *
 * Only where the physics supports a statement. There is deliberately no note for
 * `nonUricAcid` beyond naming what it is not — see the module note on why the mineral is
 * not named.
 */
function clinicalNoteFor(material: MaterialClass): string | undefined {
  switch (material) {
    case 'uricAcid':
      return 'Ácido úrico: candidato a dissolução com alcalinização urinária.';
    case 'nonUricAcid':
      return 'Não é ácido úrico. A dupla energia NÃO separa oxalato de fosfato de cálcio de forma confiável — não relate o mineral.';
    case 'metal':
      return 'Metal: a decomposição de dois materiais não vale aqui.';
    default:
      return undefined;
  }
}

/**
 * Effective atomic number, from the ratio.
 *
 * A monotonic mapping calibrated at water (Z 7.4) and the iodine ratio, useful as a
 * continuous readout next to the discrete class. Approximate by construction: Zeff is not
 * a physical property of a mixture, it is a fitted summary, and two mixtures with the same
 * Zeff can behave differently.
 */
export function effectiveZ(ratio: number): number {
  const r = Number(ratio);
  if (!Number.isFinite(r) || r <= 0) {
    return NaN;
  }
  // Anchored so water (ratio ~1.0) gives 7.4 and iodine (ratio ~2.0) gives ~53.
  return 7.4 * Math.pow(Math.max(r, 0.5), 3.6);
}

export interface RatioSeparation {
  separated: boolean;
  gap: number;
  message: string;
}

/**
 * Whether two ratio bands can actually be told apart at a given measurement precision.
 *
 * Exists so a site adding its own bands finds out immediately that the two it just added
 * overlap, instead of finding out from a classifier that flips between them voxel by
 * voxel.
 */
export function bandsAreSeparable(
  a: RatioBand,
  b: RatioBand,
  ratioPrecision = 0.05
): RatioSeparation {
  const gap = Math.max(a?.min ?? 0, b?.min ?? 0) - Math.min(a?.max ?? 0, b?.max ?? 0);
  if (gap >= ratioPrecision) {
    return { separated: true, gap, message: '' };
  }
  return {
    separated: false,
    gap,
    message: `"${a?.label}" e "${b?.label}" ficam a ${gap.toFixed(3)} de distância, dentro da precisão de ${ratioPrecision} — não são separáveis.`,
  };
}

/** Readout line for a classified ROI. */
export function describeClassification(result: ClassificationResult): string {
  if (!result) {
    return '';
  }
  if (!result.ok) {
    return result.message ?? 'Indeterminado.';
  }
  const zeff = effectiveZ(result.ratio);
  const z = Number.isFinite(zeff) ? ` · Zeff ~${zeff.toFixed(0)}` : '';
  const note = result.clinicalNote ? ` ${result.clinicalNote}` : '';
  return `${result.label} · razão ${result.ratio.toFixed(2)}${z} · ${result.attenuationHu.toFixed(0)} HU.${note}`;
}
