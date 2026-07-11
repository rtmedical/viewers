/**
 * Density line-profile core (RTV-32) — framework-free & unit-tested.
 *
 * Samples a scalar value (e.g. HU) along the straight line between two
 * world-space points. The cornerstone viewport is abstracted behind a
 * `sampleAt(world) => value | null` callback so this module has zero
 * dependency on cornerstone and is fully testable; the LineProfileTool /
 * command supplies the real sampler from the active viewport's image data.
 */
export type Vec3 = [number, number, number];

export interface ProfilePoint {
  /** Distance along the line from p0, in millimetres. */
  distanceMm: number;
  /** Sampled scalar value (HU for CT). */
  value: number;
}

export interface SampleLineProfileOptions {
  /** Sampling step in mm (default 1). */
  stepMm?: number;
  /** Hard cap on the number of samples regardless of length (default 1024). */
  maxSamples?: number;
}

function distance3(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Sample `sampleAt` at evenly spaced points from p0 to p1 (inclusive of both
 * ends). Points where the sampler returns null/NaN (outside the volume) are
 * skipped. Returns [] for a degenerate (zero-length) line.
 */
export function sampleLineProfile(
  sampleAt: (world: Vec3) => number | null | undefined,
  p0: Vec3,
  p1: Vec3,
  options: SampleLineProfileOptions = {}
): ProfilePoint[] {
  const total = distance3(p0, p1);
  if (!(total > 0)) {
    return [];
  }
  const step = options.stepMm && options.stepMm > 0 ? options.stepMm : 1;
  const maxSamples = options.maxSamples && options.maxSamples > 1 ? options.maxSamples : 1024;
  // Number of segments; at least 1, capped so long lines don't explode.
  const segments = Math.min(Math.max(Math.round(total / step), 1), maxSamples - 1);

  const out: ProfilePoint[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const world: Vec3 = [
      p0[0] + (p1[0] - p0[0]) * t,
      p0[1] + (p1[1] - p0[1]) * t,
      p0[2] + (p1[2] - p0[2]) * t,
    ];
    const v = sampleAt(world);
    if (v != null && Number.isFinite(v)) {
      out.push({ distanceMm: total * t, value: v });
    }
  }
  return out;
}

export interface ProfileStats {
  count: number;
  min: number;
  max: number;
  mean: number;
  lengthMm: number;
}

export function profileStats(points: ProfilePoint[]): ProfileStats | null {
  if (!points.length) {
    return null;
  }
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const p of points) {
    if (p.value < min) {
      min = p.value;
    }
    if (p.value > max) {
      max = p.value;
    }
    sum += p.value;
  }
  return {
    count: points.length,
    min,
    max,
    mean: sum / points.length,
    lengthMm: points[points.length - 1].distanceMm,
  };
}

/** CSV with a `distance_mm,value` header — for the panel's Export CSV. */
export function profileToCsv(points: ProfilePoint[]): string {
  const rows = points.map(p => `${p.distanceMm.toFixed(3)},${p.value}`);
  return ['distance_mm,value', ...rows].join('\n');
}
