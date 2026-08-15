/**
 * VIP — Volume Intensity Projection — pure core (RTV-16).
 *
 * A composite mode between MIP and volume rendering: it keeps the "brightest thing on the
 * ray" reading of MIP while restoring the depth cue MIP throws away.
 *
 * ## The definition, stated, because "between MIP and VR" is not one
 *
 * MIP returns `max(v_i)` along the ray. It is unbeatable at finding a bright structure
 * and useless at saying where it is: a calcified plaque in front of the aorta and one
 * behind it produce the same pixel. Volume rendering composites everything and keeps
 * depth, but a small bright structure inside dense tissue gets diluted to nothing.
 *
 * VIP here is the **transmittance-weighted maximum**:
 *
 * ```
 * VIP = max over i of ( T_i · v_i ),   T_i = Π_{j<i} (1 − α_j)
 * ```
 *
 * `T_i` is how much light still reaches sample *i* through everything in front of it. A
 * bright structure behind dense tissue is attenuated in proportion to what it hides
 * behind, so depth comes back; a bright structure in clear space is untouched, so the MIP
 * reading survives.
 *
 * That definition has a property worth having: **as opacity goes to zero everywhere, VIP
 * becomes exactly MIP.** The mode is a strict generalisation, not a different picture, and
 * there is a test asserting the limit. Anything that cannot state its relationship to MIP
 * is going to be argued about forever in acceptance.
 *
 * ## Opacity has to be corrected for the sample spacing
 *
 * This is the bug that makes volume renderings mysteriously darken. A transfer function's
 * α is an opacity *per unit length* — it is a property of the tissue, not of how finely
 * you sampled it. Apply it once per sample and halving the step size doubles the number of
 * multiplications, so the same anatomy renders darker at higher quality. The reader
 * changes the slab thickness, the image changes brightness, and they conclude the data
 * changed.
 *
 * {@link correctOpacity} applies `1 − (1 − α)^(Δs / Δs_ref)`, so the accumulated
 * attenuation depends on distance travelled and not on sampling rate. There is a test
 * that renders the same ray at two step sizes and demands the same answer.
 *
 * ## Early ray termination is correctness *and* the frame budget
 *
 * Once `T` falls below {@link TRANSMITTANCE_EPSILON}, nothing further along the ray can
 * contribute more than rounding error — the loop stops. That is what makes the ≥20 fps
 * criterion reachable on a chest CT, and it is also a statement about the result: samples
 * behind a saturated ray *cannot* change it. Tested both ways.
 *
 * Framework-free: no vtk, no WebGL. This is the reference implementation the shader must
 * agree with, and the thing that can actually be tested — a GLSL string cannot.
 * Zero-fork per RTV-114.
 */

/** Below this transmittance the ray is opaque for display purposes. */
export const TRANSMITTANCE_EPSILON = 1 / 255;

/** Opacity in a transfer function is defined per this many mm of tissue. */
export const REFERENCE_STEP_MM = 1;

export interface TransferPoint {
  /** Sample value, in HU for CT. */
  value: number;
  /** Opacity per {@link REFERENCE_STEP_MM} of tissue, 0..1. */
  opacity: number;
}

export interface VipPreset {
  id: string;
  label: string;
  /** Control points, ascending by value. */
  points: TransferPoint[];
  /** Window used to map the projected value to grey. */
  windowCenter: number;
  windowWidth: number;
  description: string;
}

/**
 * The three presets the ticket asks for.
 *
 * The HU ranges are the clinical content of this feature — the shader is the easy part.
 * Each ramp starts at fully transparent below the tissue of interest, so everything in
 * front of the target contributes attenuation only where it is actually that tissue.
 */
export const VIP_PRESETS: VipPreset[] = [
  {
    id: 'bone',
    label: 'Osso',
    points: [
      { value: 150, opacity: 0 },
      { value: 300, opacity: 0.15 },
      { value: 700, opacity: 0.6 },
      { value: 1500, opacity: 0.95 },
    ],
    windowCenter: 700,
    windowWidth: 2000,
    description: 'Cortical e trabecular; tecidos moles quase transparentes.',
  },
  {
    id: 'vascular',
    label: 'Vascular',
    points: [
      { value: 80, opacity: 0 },
      { value: 150, opacity: 0.2 },
      { value: 350, opacity: 0.7 },
      { value: 600, opacity: 0.9 },
    ],
    windowCenter: 300,
    windowWidth: 700,
    description: 'Vaso com contraste; osso ainda opaco, por isso a profundidade importa.',
  },
  {
    id: 'tissue',
    label: 'Tecido mole',
    points: [
      { value: -100, opacity: 0 },
      { value: 20, opacity: 0.08 },
      { value: 80, opacity: 0.35 },
      { value: 300, opacity: 0.6 },
    ],
    windowCenter: 50,
    windowWidth: 400,
    description: 'Parênquima e músculo; gordura e ar praticamente transparentes.',
  },
];

export function findPreset(id: unknown): VipPreset | undefined {
  return VIP_PRESETS.find(p => p.id === id);
}

/**
 * Piecewise-linear opacity lookup.
 *
 * Clamped at both ends rather than extrapolated: extrapolating an opacity ramp past its
 * last control point is how you get α > 1 on a metal implant and a transfer function that
 * behaves differently on one scanner than another.
 */
export function opacityAt(points: TransferPoint[], value: number): number {
  const list = (points ?? []).filter(p => Number.isFinite(Number(p?.value)));
  if (!list.length) {
    return 0;
  }
  const v = Number(value);
  if (!Number.isFinite(v)) {
    return 0;
  }
  if (v <= list[0].value) {
    return clamp01(list[0].opacity);
  }
  const last = list[list.length - 1];
  if (v >= last.value) {
    return clamp01(last.opacity);
  }
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1];
    const b = list[i];
    if (v <= b.value) {
      const span = b.value - a.value;
      const t = span > 0 ? (v - a.value) / span : 0;
      return clamp01(a.opacity + t * (b.opacity - a.opacity));
    }
  }
  return clamp01(last.opacity);
}

function clamp01(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.min(1, Math.max(0, n));
}

/**
 * Rescales a per-{@link REFERENCE_STEP_MM} opacity to the actual step taken.
 *
 * `1 − (1 − α)^(Δs / Δs_ref)`: the survival probability of a photon compounds over
 * distance, so the correction is exponential and not linear. Getting this wrong is the
 * classic "the volume got darker when I improved the quality" bug.
 */
export function correctOpacity(opacity: number, stepMm: number): number {
  const a = clamp01(opacity);
  const step = Number(stepMm);
  if (!Number.isFinite(step) || step <= 0) {
    return a;
  }
  if (a <= 0) {
    return 0;
  }
  if (a >= 1) {
    return 1;
  }
  return 1 - Math.pow(1 - a, step / REFERENCE_STEP_MM);
}

export interface VipResult {
  /** The projected value, in the units of the input samples. */
  value: number;
  /** Index of the sample that won. -1 when the ray contributed nothing. */
  index: number;
  /** Transmittance at the winning sample: how much of it survived to the eye. */
  transmittance: number;
  /** Samples actually visited; below `samples.length` when the ray terminated early. */
  samplesVisited: number;
  /** True when accumulated opacity saturated before the end of the ray. */
  terminatedEarly: boolean;
}

export interface VipOptions {
  points: TransferPoint[];
  /** Distance between consecutive samples, in mm. */
  stepMm?: number;
}

/**
 * The transmittance-weighted maximum along one ray, front to back.
 *
 * Front to back is not a stylistic choice: it is the only order in which early
 * termination is possible, because `T` is only known once everything in front has been
 * accumulated.
 */
export function projectVip(samples: ArrayLike<number>, options: VipOptions): VipResult {
  const points = options?.points ?? [];
  const stepMm = Number.isFinite(Number(options?.stepMm)) ? Number(options.stepMm) : REFERENCE_STEP_MM;
  const n = samples?.length ?? 0;

  let transmittance = 1;
  let best = -Infinity;
  let bestIndex = -1;
  let bestTransmittance = 1;
  let visited = 0;
  let saturated = false;

  for (let i = 0; i < n && !saturated; i++) {
    const value = Number(samples[i]);
    visited = i + 1;
    if (Number.isFinite(value)) {
      const contribution = transmittance * value;
      if (contribution > best) {
        best = contribution;
        bestIndex = i;
        bestTransmittance = transmittance;
      }
      transmittance *= 1 - correctOpacity(opacityAt(points, value), stepMm);
      if (transmittance <= TRANSMITTANCE_EPSILON) {
        saturated = true;
      }
    }
  }

  return {
    value: bestIndex >= 0 ? best : 0,
    index: bestIndex,
    transmittance: bestIndex >= 0 ? bestTransmittance : 1,
    samplesVisited: visited,
    terminatedEarly: saturated && visited < n,
  };
}

/** Plain MIP, for comparison and for the α→0 limit test. */
export function projectMip(samples: ArrayLike<number>): number {
  let best = -Infinity;
  for (let i = 0; i < (samples?.length ?? 0); i++) {
    const value = Number(samples[i]);
    if (Number.isFinite(value) && value > best) {
      best = value;
    }
  }
  return best === -Infinity ? 0 : best;
}

/**
 * How far apart VIP and MIP land on this ray, as a fraction of the MIP value.
 *
 * The acceptance criterion "clear visual differentiation from MIP" is otherwise a matter
 * of opinion; this turns it into a number a test can assert. Zero means the ray has
 * nothing in front of its brightest sample, which is a legitimate outcome and not a
 * failure — on a ray through clear air the two modes *should* agree.
 */
export function mipDivergence(samples: ArrayLike<number>, options: VipOptions): number {
  const mip = projectMip(samples);
  if (!(Math.abs(mip) > 0)) {
    return 0;
  }
  return Math.abs(mip - projectVip(samples, options).value) / Math.abs(mip);
}

export const VIP_TARGET_FPS = 20;
/** Rough per-frame sample budget that holds 20 fps on the integrated GPUs in the fleet. */
export const VIP_SAMPLE_BUDGET = 120_000_000;

export interface VipPlan {
  stepMm: number;
  samplesPerRay: number;
  totalSamples: number;
  withinBudget: boolean;
  /** Set when the step had to be coarsened to fit. */
  coarsened: boolean;
}

/**
 * Picks a step size that fits the frame budget.
 *
 * Reported rather than applied silently: a projection quietly rendered at 3 mm steps when
 * the reader asked for 0.5 looks like a different dataset, and the one thing worse than a
 * slow render is a fast wrong one nobody was told about.
 *
 * Early termination means the real cost is usually well under `totalSamples` — this is a
 * worst-case bound, which is the right kind of estimate for deciding whether to warn.
 */
export function planVip(
  slabThicknessMm: number,
  requestedStepMm: number,
  pixelCount: number,
  budget = VIP_SAMPLE_BUDGET
): VipPlan {
  const slab = Math.max(0, Number(slabThicknessMm) || 0);
  const pixels = Math.max(1, Math.floor(Number(pixelCount) || 1));
  const requested = Math.max(0.01, Number(requestedStepMm) || 1);
  const cap = Math.max(1, Number(budget) || VIP_SAMPLE_BUDGET);

  const at = (step: number) => {
    const perRay = Math.max(1, Math.ceil(slab / step));
    return { perRay, total: perRay * pixels };
  };

  let step = requested;
  let plan = at(step);
  let coarsened = false;
  // Bounded: doubling the step at most 12 times covers any slab we can load.
  for (let i = 0; i < 12 && plan.total > cap; i++) {
    step *= 2;
    plan = at(step);
    coarsened = true;
  }

  return {
    stepMm: step,
    samplesPerRay: plan.perRay,
    totalSamples: plan.total,
    withinBudget: plan.total <= cap,
    coarsened,
  };
}

export function describePlan(plan: VipPlan): string {
  if (!plan) {
    return '';
  }
  const base = `${plan.samplesPerRay} amostras/raio a ${plan.stepMm.toFixed(2)} mm`;
  if (!plan.withinBudget) {
    return `${base} — acima do orçamento mesmo no passo máximo; reduza a espessura do slab.`;
  }
  return plan.coarsened
    ? `${base} — passo aumentado para manter ${VIP_TARGET_FPS} fps.`
    : base;
}
