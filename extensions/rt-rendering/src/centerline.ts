/**
 * Centerline resampling and rotation-minimising frames — pure core (RTV-14, RTV-61).
 *
 * A curved planar reformation needs two things from a centerline: samples at a
 * *uniform* arc length, and a stable frame at each sample to sample across.
 *
 * ## Why not Frenet frames
 *
 * The textbook answer is the Frenet-Serret frame (tangent, normal, binormal from the
 * curve's derivatives). It is the wrong tool here, and using it is the classic way a CPR
 * ends up looking broken:
 *
 * - The Frenet normal is defined by the **curvature vector**. Through a straight
 *   segment curvature goes to zero and the normal is undefined — it spins arbitrarily
 *   on noise, and the reformation twists like a corkscrew.
 * - At an inflection point the curvature vector **flips 180°**, so the reformatted image
 *   mirrors itself mid-vessel.
 *
 * Vessels are full of near-straight runs and inflections, so both happen constantly.
 * {@link rotationMinimisingFrames} uses the double-reflection method instead (Wang et
 * al., *ACM TOG* 2008): each frame is transported from the previous one with the least
 * possible rotation, so it is stable through straight segments and continuous through
 * inflections.
 *
 * Framework-free, no vtk, no cornerstone. Zero-fork per RTV-114.
 */

export type Vec3 = [number, number, number];

const finite = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function isVec3(value: unknown): value is Vec3 {
  return (
    Array.isArray(value) &&
    value.length >= 3 &&
    value.slice(0, 3).every(v => Number.isFinite(Number(v)))
  );
}

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export const length = (a: Vec3): number => Math.sqrt(dot(a, a));

/** Unit vector, or `null` when the input has no direction. */
export function normalise(a: Vec3): Vec3 | null {
  const len = length(a);
  return len > 1e-12 ? [a[0] / len, a[1] / len, a[2] / len] : null;
}

/** Drops anything that is not a usable 3D point. */
export function sanitisePoints(points: unknown): Vec3[] {
  return ((points as Vec3[]) ?? [])
    .filter(isVec3)
    .map(p => [finite(p[0]), finite(p[1]), finite(p[2])] as Vec3);
}

/** Cumulative arc length along a polyline, starting at 0. */
export function arcLengths(points: Vec3[]): number[] {
  const list = sanitisePoints(points);
  const lengths: number[] = [];
  let total = 0;
  for (let i = 0; i < list.length; i++) {
    if (i > 0) {
      total += length(sub(list[i], list[i - 1]));
    }
    lengths.push(total);
  }
  return lengths;
}

/** Total polyline length in mm. */
export function totalLength(points: Vec3[]): number {
  const lengths = arcLengths(points);
  return lengths.length ? lengths[lengths.length - 1] : 0;
}

/**
 * Catmull-Rom interpolation between `p1` and `p2`, with `p0`/`p3` as neighbours.
 *
 * Centripetal-style endpoint duplication is handled by the caller; the curve passes
 * through every control point, which is what a physicist clicking along a vessel
 * expects — an approximating spline that misses their clicks reads as the tool
 * ignoring them.
 */
export function catmullRom(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const t2 = t * t;
  const t3 = t2 * t;
  const out: number[] = [];
  for (let i = 0; i < 3; i++) {
    out.push(
      0.5 *
        (2 * p1[i] +
          (-p0[i] + p2[i]) * t +
          (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 +
          (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3)
    );
  }
  return out as Vec3;
}

/**
 * Densely samples a Catmull-Rom spline through the control points.
 *
 * Used as the intermediate for arc-length resampling: the spline is sampled far more
 * finely than the target spacing, then walked at uniform distance. Sampling the spline
 * in its own parameter would give points that bunch on tight curves and spread on
 * straight runs — and a CPR built on those is stretched and squashed along its length.
 */
export function sampleSpline(points: Vec3[], samplesPerSegment = 16): Vec3[] {
  const list = sanitisePoints(points);
  if (list.length < 2) {
    return list;
  }
  const steps = Math.max(2, Math.floor(samplesPerSegment));
  const out: Vec3[] = [];

  for (let i = 0; i < list.length - 1; i++) {
    // Endpoints are duplicated so the curve starts and ends at the reader's clicks.
    const p0 = list[i - 1] ?? list[i];
    const p1 = list[i];
    const p2 = list[i + 1];
    const p3 = list[i + 2] ?? list[i + 1];
    for (let s = 0; s < steps; s++) {
      out.push(catmullRom(p0, p1, p2, p3, s / steps));
    }
  }
  out.push(list[list.length - 1]);
  return out;
}

export const CENTERLINE_SPACING_MM_MIN = 0.05;
export const CENTERLINE_SPACING_MM_MAX = 10;
export const CENTERLINE_SPACING_MM_DEFAULT = 0.5;

export function clampSpacing(mm: unknown): number {
  const n = Number(mm);
  if (!Number.isFinite(n) || n <= 0) {
    return CENTERLINE_SPACING_MM_DEFAULT;
  }
  return Math.min(CENTERLINE_SPACING_MM_MAX, Math.max(CENTERLINE_SPACING_MM_MIN, n));
}

/**
 * Resamples a centerline at uniform arc length.
 *
 * Uniform spacing is what makes the reformatted image metrically honest: one pixel row
 * is one fixed distance along the vessel, so a stenosis measured on the CPR is a real
 * length. Non-uniform rows silently rescale the anatomy row by row.
 */
export function resampleCenterline(
  points: Vec3[],
  spacingMm: number = CENTERLINE_SPACING_MM_DEFAULT,
  samplesPerSegment = 16
): Vec3[] {
  const dense = sampleSpline(points, samplesPerSegment);
  if (dense.length < 2) {
    return dense;
  }
  const spacing = clampSpacing(spacingMm);
  const cumulative = arcLengths(dense);
  const total = cumulative[cumulative.length - 1];
  if (!(total > 0)) {
    return [dense[0]];
  }

  const out: Vec3[] = [dense[0]];
  const count = Math.floor(total / spacing);
  let cursor = 1;

  for (let k = 1; k <= count; k++) {
    const target = k * spacing;
    while (cursor < cumulative.length - 1 && cumulative[cursor] < target) {
      cursor += 1;
    }
    const prev = cumulative[cursor - 1];
    const next = cumulative[cursor];
    const span = next - prev;
    const t = span > 1e-12 ? (target - prev) / span : 0;
    out.push(add(dense[cursor - 1], scale(sub(dense[cursor], dense[cursor - 1]), t)));
  }

  // Always finish on the last control point, so the vessel is not clipped short of the
  // reader's final click by up to one spacing.
  const last = dense[dense.length - 1];
  if (length(sub(last, out[out.length - 1])) > spacing * 0.25) {
    out.push(last);
  }
  return out;
}

export interface Frame {
  position: Vec3;
  tangent: Vec3;
  normal: Vec3;
  binormal: Vec3;
}

/**
 * Rotation-minimising frames along a centerline (double reflection).
 *
 * Each frame is carried from the previous one by two reflections, which is the discrete
 * form of parallel transport: the frame rotates only as much as the tangent forces it
 * to, and not at all around the tangent. That is what keeps a CPR from corkscrewing
 * through straight segments and from mirroring at inflections — see the module note.
 *
 * `initialNormal` seeds the first frame. When omitted, an arbitrary vector perpendicular
 * to the first tangent is chosen; the *choice* is arbitrary but the *consistency* along
 * the curve is not, which is all the reformation needs.
 */
export function rotationMinimisingFrames(points: Vec3[], initialNormal?: Vec3): Frame[] {
  const list = sanitisePoints(points);
  if (list.length < 2) {
    return [];
  }

  const tangentAt = (i: number): Vec3 => {
    const a = list[Math.max(0, i - 1)];
    const b = list[Math.min(list.length - 1, i + 1)];
    return normalise(sub(b, a)) ?? [0, 0, 1];
  };

  const frames: Frame[] = [];
  const t0 = tangentAt(0);
  let normal =
    (initialNormal && normalise(rejectFrom(initialNormal, t0))) ?? perpendicularTo(t0);

  frames.push({ position: list[0], tangent: t0, normal, binormal: cross(t0, normal) });

  for (let i = 1; i < list.length; i++) {
    const prev = frames[i - 1];
    const position = list[i];
    const tangent = tangentAt(i);

    // First reflection: through the plane bisecting the two positions.
    const v1 = sub(position, prev.position);
    const c1 = dot(v1, v1);
    let nL = prev.normal;
    let tL = prev.tangent;
    if (c1 > 1e-12) {
      nL = sub(prev.normal, scale(v1, (2 / c1) * dot(v1, prev.normal)));
      tL = sub(prev.tangent, scale(v1, (2 / c1) * dot(v1, prev.tangent)));
    }

    // Second reflection: aligns the reflected tangent with the real one.
    const v2 = sub(tangent, tL);
    const c2 = dot(v2, v2);
    const nNext = c2 > 1e-12 ? sub(nL, scale(v2, (2 / c2) * dot(v2, nL))) : nL;

    normal = normalise(rejectFrom(nNext, tangent)) ?? perpendicularTo(tangent);
    frames.push({ position, tangent, normal, binormal: cross(tangent, normal) });
  }

  return frames;
}

/** Component of `v` perpendicular to `axis`. */
function rejectFrom(v: Vec3, axis: Vec3): Vec3 {
  return sub(v, scale(axis, dot(v, axis)));
}

/** Any unit vector perpendicular to `t`, chosen to avoid a degenerate cross product. */
function perpendicularTo(t: Vec3): Vec3 {
  // Cross with whichever axis is least aligned with the tangent.
  const helper: Vec3 =
    Math.abs(t[0]) < Math.abs(t[1]) && Math.abs(t[0]) < Math.abs(t[2])
      ? [1, 0, 0]
      : Math.abs(t[1]) < Math.abs(t[2])
        ? [0, 1, 0]
        : [0, 0, 1];
  return normalise(cross(t, helper)) ?? [1, 0, 0];
}
