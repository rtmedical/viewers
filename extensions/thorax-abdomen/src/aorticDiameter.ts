/**
 * Aortic diameter from a segmentation, measured the way the threshold assumes — pure core
 * (RTV-74).
 *
 * The segmentation is a sidecar. This is the measurement, and the measurement is where the
 * error that reaches the patient lives.
 *
 * ## An axial diameter over-estimates an angulated aorta, and the referral threshold does
 * not know that
 *
 * The aorta is rarely perpendicular to the axial plane. Where it runs at an angle, the
 * axial cross-section is an ellipse whose long axis is the true diameter divided by the
 * cosine of that angle. At thirty degrees that is fifteen percent: a genuine 4.8 cm
 * aneurysm measures 5.5 cm, which is the number at which a patient is referred for repair.
 *
 * The measurement is not noisy — it is **consistently and predictably too large**, and it
 * looks like a careful measurement because it is one. {@link perpendicularDiameter}
 * measures in the plane normal to the centreline, and {@link axialOverestimate} states what
 * the axial number would have added, so the difference can be shown rather than argued
 * about.
 *
 * ## Outer wall or lumen is not a detail
 *
 * An aneurysm sac lined with thrombus has a lumen far narrower than the aneurysm. Measuring
 * the lumen produces a reassuring number for a dangerous aorta. The convention is a
 * required field, and {@link compareToPrior} refuses to compute growth across two different
 * conventions — the change it would report is the convention, not the aorta.
 *
 * ## A growth rate over a short interval is mostly measurement noise
 *
 * Inter-observer variability on an aortic diameter is a couple of millimetres. Two
 * millimetres over three months annualises to eight millimetres a year, which is well above
 * the threshold for urgent referral, and the patient did not grow an aneurysm — the second
 * radiologist put the caliper somewhere slightly different. The interval matters more than
 * the difference, and {@link compareToPrior} says so instead of dividing.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export type Vec3 = [number, number, number];

export interface AortaGrid {
  dims: [number, number, number];
  /** Millimetres. */
  spacing: [number, number, number];
}

export type MeasurementConvention = 'outer-wall' | 'lumen';

export const CONVENTION_LABELS: Record<MeasurementConvention, string> = {
  'outer-wall': 'parede externa a parede externa',
  lumen: 'luz opacificada',
};

const index = (dims: [number, number, number], x: number, y: number, z: number): number =>
  x + dims[0] * (y + dims[1] * z);

function inside(mask: ArrayLike<number>, grid: AortaGrid, p: Vec3): boolean {
  const x = Math.round(p[0] / grid.spacing[0]);
  const y = Math.round(p[1] / grid.spacing[1]);
  const z = Math.round(p[2] / grid.spacing[2]);
  if (
    x < 0 || y < 0 || z < 0 ||
    x >= grid.dims[0] || y >= grid.dims[1] || z >= grid.dims[2]
  ) {
    return false;
  }
  return mask[index(grid.dims, x, y, z)] === 1;
}

export function unit(v: Vec3): Vec3 {
  const n = Math.hypot(v[0], v[1], v[2]);
  return n > 0 ? [v[0] / n, v[1] / n, v[2] / n] : [0, 0, 0];
}

/** Two unit vectors spanning the plane normal to `n`. */
export function planeBasis(n: Vec3): [Vec3, Vec3] {
  const w = unit(n);
  // Pick the world axis least aligned with w, so the cross product is well conditioned.
  const helper: Vec3 =
    Math.abs(w[0]) < Math.abs(w[1]) && Math.abs(w[0]) < Math.abs(w[2])
      ? [1, 0, 0]
      : Math.abs(w[1]) < Math.abs(w[2])
        ? [0, 1, 0]
        : [0, 0, 1];
  const u = unit([
    w[1] * helper[2] - w[2] * helper[1],
    w[2] * helper[0] - w[0] * helper[2],
    w[0] * helper[1] - w[1] * helper[0],
  ]);
  const v = unit([
    w[1] * u[2] - w[2] * u[1],
    w[2] * u[0] - w[0] * u[2],
    w[0] * u[1] - w[1] * u[0],
  ]);
  return [u, v];
}

export interface CrossSection {
  /** Longest chord through the centre, millimetres. */
  maxDiameterMm: number;
  /** Shortest chord through the centre. */
  minDiameterMm: number;
  /** max/min. Well above 1 means the plane is oblique to the vessel, or the vessel is not round. */
  eccentricity: number;
  convention: MeasurementConvention;
  ok: boolean;
  reason?: string;
}

/**
 * Diameter in the plane normal to the vessel axis.
 *
 * Rays are cast from the centreline point out to the edge of the mask in both directions,
 * so the chord is measured through the centre rather than as the widest extent of the
 * section — the widest extent of an oblique ellipse is the same wrong number the axial
 * measurement gives.
 */
export function perpendicularDiameter(
  mask: ArrayLike<number>,
  grid: AortaGrid,
  centreMm: Vec3,
  tangent: Vec3,
  convention: MeasurementConvention,
  options: { rays?: number; stepMm?: number; maxRadiusMm?: number } = {}
): CrossSection {
  if (!inside(mask, grid, centreMm)) {
    return {
      maxDiameterMm: NaN,
      minDiameterMm: NaN,
      eccentricity: NaN,
      convention,
      ok: false,
      reason: 'Ponto central fora da máscara — a medida sairia do nada.',
    };
  }

  const [u, v] = planeBasis(tangent);
  const rays = Math.max(8, Math.floor(Number(options.rays) || 72));
  const step = Math.max(0.05, Number(options.stepMm) || 0.25);
  const maxRadius = Math.max(1, Number(options.maxRadiusMm) || 100);

  const march = (dx: number, dy: number): number => {
    let distance = 0;
    for (;;) {
      distance += step;
      if (distance > maxRadius) {
        return distance;
      }
      const p: Vec3 = [
        centreMm[0] + (u[0] * dx + v[0] * dy) * distance,
        centreMm[1] + (u[1] * dx + v[1] * dy) * distance,
        centreMm[2] + (u[2] * dx + v[2] * dy) * distance,
      ];
      if (!inside(mask, grid, p)) {
        return distance - step / 2;
      }
    }
  };

  let maxDiameterMm = 0;
  let minDiameterMm = Number.POSITIVE_INFINITY;
  for (let i = 0; i < rays; i++) {
    const angle = (Math.PI * i) / rays;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const chord = march(dx, dy) + march(-dx, -dy);
    maxDiameterMm = Math.max(maxDiameterMm, chord);
    minDiameterMm = Math.min(minDiameterMm, chord);
  }

  return {
    maxDiameterMm,
    minDiameterMm,
    eccentricity: minDiameterMm > 0 ? maxDiameterMm / minDiameterMm : NaN,
    convention,
    ok: true,
  };
}

export interface AxialOverestimate {
  angleDeg: number;
  /** Multiplier the axial measurement applies to the true diameter. */
  factor: number;
  extraMm: number;
  message: string;
}

/**
 * What measuring in the axial plane would have added.
 *
 * Not noise: a consistent, predictable inflation that looks like a careful measurement,
 * because it is one — of the wrong quantity.
 */
export function axialOverestimate(tangent: Vec3, trueDiameterMm: number): AxialOverestimate {
  const t = unit(tangent);
  const cos = Math.abs(t[2]);
  const angleDeg = Math.acos(Math.min(1, Math.max(0, cos))) * (180 / Math.PI);
  const factor = cos > 1e-6 ? 1 / cos : Number.POSITIVE_INFINITY;
  const diameter = Number(trueDiameterMm);
  const extraMm = Number.isFinite(diameter) && Number.isFinite(factor) ? diameter * (factor - 1) : NaN;

  return {
    angleDeg,
    factor,
    extraMm,
    message: Number.isFinite(extraMm) && extraMm >= 0.5
      ? `A aorta corre a ${angleDeg.toFixed(0)}° do plano axial: uma medida axial somaria ${extraMm.toFixed(1)} mm ` +
        `(${((factor - 1) * 100).toFixed(0)}%). Não é ruído — é um aumento consistente e previsível, e parece uma medida cuidadosa porque é uma, da grandeza errada.`
      : '',
  };
}

export type AortaSex = 'male' | 'female';

/** Repair thresholds for an infrarenal abdominal aortic aneurysm, millimetres. */
export const AAA_THRESHOLD_MM: Record<AortaSex, number> = { male: 55, female: 50 };
/** Growth above this in a year is itself an indication, millimetres per year. */
export const RAPID_GROWTH_MM_PER_YEAR = 10;
/** Below this interval an annualised rate is mostly measurement variability. */
export const MIN_GROWTH_INTERVAL_DAYS = 180;
/** Typical inter-observer variability on an aortic diameter, millimetres. */
export const CALIPER_VARIABILITY_MM = 2;

export interface PriorMeasurement {
  diameterMm: number;
  at: number;
  convention: MeasurementConvention;
}

export interface GrowthResult {
  deltaMm: number | null;
  intervalDays: number | null;
  /** Null when the interval is too short for the rate to mean anything. */
  mmPerYear: number | null;
  rapid: boolean;
  comparable: boolean;
  message: string;
}

/**
 * Growth against a prior study.
 *
 * Refuses across two conventions, and refuses to annualise a short interval: two
 * millimetres of caliper variability over three months annualises to eight millimetres a
 * year, and nothing grew.
 */
export function compareToPrior(
  currentMm: number,
  currentAt: number,
  currentConvention: MeasurementConvention,
  prior: PriorMeasurement
): GrowthResult {
  const current = Number(currentMm);
  const previous = Number(prior?.diameterMm);

  if (!Number.isFinite(current) || !Number.isFinite(previous)) {
    return {
      deltaMm: null,
      intervalDays: null,
      mmPerYear: null,
      rapid: false,
      comparable: false,
      message: 'Medida atual ou anterior ausente.',
    };
  }
  if (prior.convention !== currentConvention) {
    return {
      deltaMm: null,
      intervalDays: null,
      mmPerYear: null,
      rapid: false,
      comparable: false,
      message:
        `Atual medida ${CONVENTION_LABELS[currentConvention]} e anterior ${CONVENTION_LABELS[prior.convention]} — ` +
        'a mudança relatada seria a convenção, não a aorta.',
    };
  }

  const intervalDays = (Number(currentAt) - Number(prior.at)) / 86_400_000;
  const deltaMm = current - previous;

  if (!(intervalDays > 0)) {
    return {
      deltaMm,
      intervalDays: null,
      mmPerYear: null,
      rapid: false,
      comparable: false,
      message: 'Intervalo não positivo entre os exames.',
    };
  }

  if (intervalDays < MIN_GROWTH_INTERVAL_DAYS) {
    const wouldBe = (deltaMm / intervalDays) * 365.25;
    return {
      deltaMm,
      intervalDays,
      mmPerYear: null,
      rapid: false,
      comparable: true,
      message:
        `${deltaMm.toFixed(1)} mm em ${intervalDays.toFixed(0)} dias. Sem taxa anualizada: a variabilidade entre observadores é de ` +
        `cerca de ${CALIPER_VARIABILITY_MM} mm, e sobre esse intervalo ela sozinha daria ${Math.abs((CALIPER_VARIABILITY_MM / intervalDays) * 365.25).toFixed(0)} mm/ano ` +
        `(este delta daria ${wouldBe.toFixed(0)} mm/ano). O intervalo pesa mais que a diferença.`,
    };
  }

  const mmPerYear = (deltaMm / intervalDays) * 365.25;
  return {
    deltaMm,
    intervalDays,
    mmPerYear,
    rapid: mmPerYear >= RAPID_GROWTH_MM_PER_YEAR,
    comparable: true,
    message: `${deltaMm.toFixed(1)} mm em ${(intervalDays / 365.25).toFixed(1)} ano(s) — ${mmPerYear.toFixed(1)} mm/ano.`,
  };
}

export interface SurveillanceAdvice {
  atThreshold: boolean;
  rapidGrowth: boolean;
  thresholdMm: number;
  message: string;
}

/**
 * Whether the aneurysm has reached a size or a growth rate that changes management.
 *
 * The threshold differs by sex, and using the male threshold for a woman leaves a 5.2 cm
 * aneurysm below the line when it is above hers.
 */
export function surveillanceAdvice(
  diameterMm: number,
  sex: AortaSex,
  growth?: GrowthResult
): SurveillanceAdvice {
  const thresholdMm = AAA_THRESHOLD_MM[sex] ?? AAA_THRESHOLD_MM.male;
  const diameter = Number(diameterMm);
  const atThreshold = Number.isFinite(diameter) && diameter >= thresholdMm;
  const rapidGrowth = Boolean(growth?.rapid);

  const parts: string[] = [];
  if (atThreshold) {
    parts.push(`${diameter.toFixed(0)} mm atinge o limiar de ${thresholdMm} mm para este paciente.`);
  }
  if (rapidGrowth) {
    parts.push(`Crescimento de ${growth!.mmPerYear!.toFixed(1)} mm/ano, acima de ${RAPID_GROWTH_MM_PER_YEAR} mm/ano.`);
  }
  if (!parts.length) {
    parts.push(`${diameter.toFixed(0)} mm, abaixo do limiar de ${thresholdMm} mm.`);
  }

  return { atThreshold, rapidGrowth, thresholdMm, message: parts.join(' ') };
}

/** One line for the aorta panel. */
export function describeAorta(
  section: CrossSection,
  overestimate?: AxialOverestimate,
  advice?: SurveillanceAdvice
): string {
  if (!section.ok) {
    return section.reason ?? '';
  }
  const parts = [
    `${section.maxDiameterMm.toFixed(1)} mm perpendicular ao eixo (${CONVENTION_LABELS[section.convention]}).`,
  ];
  if (overestimate?.message) {
    parts.push(overestimate.message);
  }
  if (advice?.message) {
    parts.push(advice.message);
  }
  return parts.join(' ');
}
