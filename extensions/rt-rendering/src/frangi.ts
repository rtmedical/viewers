/**
 * Frangi vesselness — pure core (RTV-62).
 *
 * A tubular structure has a characteristic Hessian signature: one small eigenvalue along
 * the vessel and two large ones of the same sign across it. Frangi's filter turns those
 * three numbers into a single "how much does this look like a vessel" response.
 *
 * The formula is short and widely published. Four things around it decide whether an
 * implementation finds vessels or finds nothing, and all four are easy to get wrong
 * silently — the filter always produces *a* number.
 *
 * ## The sign convention is the whole difference between vessels and their complement
 *
 * For a **bright** vessel on a dark background, the two cross-vessel eigenvalues are
 * **negative** (the intensity curves downward away from the centreline). Drop the sign
 * check and the filter responds to dark tubes instead — airways instead of arteries, and
 * on a contrast CT that means a confident, smooth, completely wrong result.
 *
 * {@link vesselness} takes the polarity explicitly. There is no default.
 *
 * ## Without γ-normalisation, the largest scale always wins
 *
 * Derivatives of a Gaussian shrink as `σ` grows, so an un-normalised Hessian at σ = 5 is
 * numerically tiny next to one at σ = 1 — or rather the reverse for second derivatives,
 * which grow. Either way the scales are not comparable, and the maximum over scales is
 * decided by the arithmetic instead of by the anatomy. Scaling by `σ²`
 * ({@link scaleNormalise}) makes them commensurable, which is what allows the
 * *argmax over scale* to be a caliber estimate.
 *
 * ## `c` is data-dependent and a fixed value makes the filter useless
 *
 * The structureness term suppresses background using `c`, which must be about half the
 * maximum Hessian norm **in this volume**. A constant tuned on one dataset silently kills
 * the response on a dataset with a different intensity range — and the failure looks like
 * "no vessels here" rather than like a bug. {@link suggestC} derives it.
 *
 * ## One scale finds one caliber
 *
 * A single-scale filter is not a vessel filter; it is a filter for vessels of one size.
 * {@link multiscaleVesselness} maxes over scales and returns the winning σ, so the caller
 * gets the caliber for free instead of running the filter three times and losing it.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export type VesselPolarity = 'bright' | 'dark';

export interface FrangiParams {
  /** Plate-vs-line sensitivity. */
  alpha?: number;
  /** Blob-vs-line sensitivity. */
  beta?: number;
  /** Structureness (background suppression). About half the max Hessian norm. */
  c: number;
  polarity: VesselPolarity;
}

export const DEFAULT_ALPHA = 0.5;
export const DEFAULT_BETA = 0.5;

/**
 * Eigenvalues of a symmetric 3×3, ascending by absolute value.
 *
 * Analytic (Smith's trigonometric solution) rather than iterative: this runs once per
 * voxel per scale, and an iterative solver would put a convergence loop in the innermost
 * position of the whole filter.
 */
export function symmetricEigenvalues(
  xx: number, yy: number, zz: number, xy: number, xz: number, yz: number
): [number, number, number] {
  const p1 = xy * xy + xz * xz + yz * yz;
  if (p1 === 0) {
    return sortByAbs([xx, yy, zz]);
  }
  const q = (xx + yy + zz) / 3;
  const p2 = (xx - q) ** 2 + (yy - q) ** 2 + (zz - q) ** 2 + 2 * p1;
  const p = Math.sqrt(p2 / 6);
  if (!(p > 0)) {
    return sortByAbs([q, q, q]);
  }

  // B = (A - qI)/p has determinant in [-1, 1]; its half is cos(3θ).
  const b11 = (xx - q) / p;
  const b22 = (yy - q) / p;
  const b33 = (zz - q) / p;
  const b12 = xy / p;
  const b13 = xz / p;
  const b23 = yz / p;
  const det =
    b11 * (b22 * b33 - b23 * b23) -
    b12 * (b12 * b33 - b23 * b13) +
    b13 * (b12 * b23 - b22 * b13);

  const r = Math.min(1, Math.max(-1, det / 2));
  const phi = Math.acos(r) / 3;

  const e1 = q + 2 * p * Math.cos(phi);
  const e3 = q + 2 * p * Math.cos(phi + (2 * Math.PI) / 3);
  const e2 = 3 * q - e1 - e3;
  return sortByAbs([e1, e2, e3]);
}

function sortByAbs(values: number[]): [number, number, number] {
  const sorted = [...values].sort((a, b) => Math.abs(a) - Math.abs(b));
  return [sorted[0], sorted[1], sorted[2]];
}

/**
 * Frangi vesselness from the three eigenvalues, ascending by magnitude.
 *
 * Returns 0 for the wrong polarity rather than a small number: a vessel filter that gives
 * airways a weak positive response produces a threshold problem instead of a clean
 * rejection.
 */
export function vesselness(
  eigenvalues: [number, number, number],
  params: FrangiParams
): number {
  const [l1, l2, l3] = eigenvalues ?? [0, 0, 0];
  const alpha = positiveOr(params?.alpha, DEFAULT_ALPHA);
  const beta = positiveOr(params?.beta, DEFAULT_BETA);
  const c = Number(params?.c);
  const polarity = params?.polarity;

  if (![l1, l2, l3].every(Number.isFinite) || !Number.isFinite(c) || c <= 0) {
    return 0;
  }
  if (polarity !== 'bright' && polarity !== 'dark') {
    return 0;
  }

  // The sign check. Bright tube: the two cross-vessel eigenvalues are negative.
  if (polarity === 'bright' && (l2 >= 0 || l3 >= 0)) {
    return 0;
  }
  if (polarity === 'dark' && (l2 <= 0 || l3 <= 0)) {
    return 0;
  }

  const abs2 = Math.abs(l2);
  const abs3 = Math.abs(l3);
  if (abs3 < 1e-12) {
    return 0;
  }

  const ra = abs2 / abs3;
  const rb = Math.abs(l1) / Math.sqrt(abs2 * abs3);
  const s = Math.sqrt(l1 * l1 + l2 * l2 + l3 * l3);

  const plate = 1 - Math.exp(-(ra * ra) / (2 * alpha * alpha));
  const blob = Math.exp(-(rb * rb) / (2 * beta * beta));
  const structure = 1 - Math.exp(-(s * s) / (2 * c * c));

  return plate * blob * structure;
}

function positiveOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Scale-normalises a Hessian by `σ²`.
 *
 * Without this the maximum over scales is decided by the arithmetic instead of by the
 * anatomy — see the module note.
 */
export function scaleNormalise(hessian: number[], sigma: number): number[] {
  const s = Number(sigma);
  const factor = Number.isFinite(s) && s > 0 ? s * s : 1;
  return (hessian ?? []).map(v => Number(v) * factor);
}

/**
 * Half the maximum Hessian Frobenius norm over the volume.
 *
 * The value Frangi suggests, computed from the data rather than fixed — a constant tuned
 * on one dataset silently kills the response on a dataset with a different intensity
 * range, and the failure looks like "no vessels here".
 */
export function suggestC(hessianNorms: ArrayLike<number>): number {
  let max = 0;
  for (let i = 0; i < (hessianNorms?.length ?? 0); i++) {
    const value = Number(hessianNorms[i]);
    if (Number.isFinite(value) && value > max) {
      max = value;
    }
  }
  return max / 2;
}

export function frobeniusNorm(eigenvalues: [number, number, number]): number {
  const [a, b, c] = eigenvalues ?? [0, 0, 0];
  return Math.sqrt(a * a + b * b + c * c);
}

export interface Volume {
  data: ArrayLike<number>;
  width: number;
  height: number;
  depth: number;
}

const at = (volume: Volume, x: number, y: number, z: number): number => {
  const { width, height, depth } = volume;
  const cx = Math.min(width - 1, Math.max(0, x));
  const cy = Math.min(height - 1, Math.max(0, y));
  const cz = Math.min(depth - 1, Math.max(0, z));
  return Number(volume.data[cz * width * height + cy * width + cx]) || 0;
};

/** 1-D Gaussian kernel, truncated at 3σ. */
export function gaussianKernel(sigma: number): number[] {
  const s = Math.max(0.3, Number(sigma) || 1);
  const radius = Math.max(1, Math.ceil(3 * s));
  const kernel: number[] = [];
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const value = Math.exp(-(i * i) / (2 * s * s));
    kernel.push(value);
    sum += value;
  }
  return kernel.map(v => v / sum);
}

/** Separable Gaussian blur. Clamps at the border rather than wrapping. */
export function gaussianBlur(volume: Volume, sigma: number): Float32Array {
  const { width, height, depth } = volume;
  const kernel = gaussianKernel(sigma);
  const radius = (kernel.length - 1) / 2;
  const size = width * height * depth;

  let source: ArrayLike<number> = volume.data;
  let target = new Float32Array(size);

  const passes: Array<[number, number, number]> = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];

  for (const [dx, dy, dz] of passes) {
    const current: Volume = { data: source, width, height, depth };
    for (let z = 0; z < depth; z++) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let sum = 0;
          for (let k = -radius; k <= radius; k++) {
            sum += kernel[k + radius] * at(current, x + k * dx, y + k * dy, z + k * dz);
          }
          target[z * width * height + y * width + x] = sum;
        }
      }
    }
    source = target;
    target = new Float32Array(size);
  }

  return source as Float32Array;
}

/** Central-difference Hessian at one voxel: [xx, yy, zz, xy, xz, yz]. */
export function hessianAt(volume: Volume, x: number, y: number, z: number): number[] {
  const c = at(volume, x, y, z);
  const xx = at(volume, x + 1, y, z) - 2 * c + at(volume, x - 1, y, z);
  const yy = at(volume, x, y + 1, z) - 2 * c + at(volume, x, y - 1, z);
  const zz = at(volume, x, y, z + 1) - 2 * c + at(volume, x, y, z - 1);
  const xy =
    (at(volume, x + 1, y + 1, z) - at(volume, x + 1, y - 1, z) -
      at(volume, x - 1, y + 1, z) + at(volume, x - 1, y - 1, z)) / 4;
  const xz =
    (at(volume, x + 1, y, z + 1) - at(volume, x + 1, y, z - 1) -
      at(volume, x - 1, y, z + 1) + at(volume, x - 1, y, z - 1)) / 4;
  const yz =
    (at(volume, x, y + 1, z + 1) - at(volume, x, y + 1, z - 1) -
      at(volume, x, y - 1, z + 1) + at(volume, x, y - 1, z - 1)) / 4;
  return [xx, yy, zz, xy, xz, yz];
}

export interface MultiscaleResult {
  /** Vesselness per voxel, 0..1. */
  response: Float32Array;
  /** σ that produced the maximum at each voxel — the caliber estimate. */
  scale: Float32Array;
}

export interface MultiscaleOptions {
  scales: number[];
  polarity: VesselPolarity;
  alpha?: number;
  beta?: number;
  /** Overrides the data-derived `c`. */
  c?: number;
}

/**
 * Frangi over several scales, keeping the maximum and the σ that produced it.
 *
 * A single-scale filter is not a vessel filter; it is a filter for vessels of one size.
 * Returning the winning σ means the caller gets the caliber for free instead of running
 * the filter three times and throwing that information away.
 *
 * `c` is derived from the data across all scales when not supplied, so the structureness
 * term is comparable between them.
 */
export function multiscaleVesselness(
  volume: Volume,
  options: MultiscaleOptions
): MultiscaleResult {
  const { width, height, depth } = volume;
  const size = width * height * depth;
  const response = new Float32Array(size);
  const scale = new Float32Array(size);

  const scales = (options?.scales ?? []).map(Number).filter(s => Number.isFinite(s) && s > 0);
  if (!scales.length || size <= 0) {
    return { response, scale };
  }

  // First pass: eigenvalues everywhere, so `c` can come from the data.
  const perScale: Array<{ sigma: number; eigen: Float32Array }> = [];
  let maxNorm = 0;

  for (const sigma of scales) {
    const blurred = gaussianBlur(volume, sigma);
    const smoothed: Volume = { data: blurred, width, height, depth };
    const eigen = new Float32Array(size * 3);
    for (let z = 0; z < depth; z++) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const index = z * width * height + y * width + x;
          const h = scaleNormalise(hessianAt(smoothed, x, y, z), sigma);
          const values = symmetricEigenvalues(h[0], h[1], h[2], h[3], h[4], h[5]);
          eigen[index * 3] = values[0];
          eigen[index * 3 + 1] = values[1];
          eigen[index * 3 + 2] = values[2];
          const norm = frobeniusNorm(values);
          if (norm > maxNorm) {
            maxNorm = norm;
          }
        }
      }
    }
    perScale.push({ sigma, eigen });
  }

  const c = positiveOr(options?.c, maxNorm / 2 || 1);
  const params: FrangiParams = {
    alpha: options?.alpha,
    beta: options?.beta,
    c,
    polarity: options?.polarity,
  };

  for (const { sigma, eigen } of perScale) {
    for (let index = 0; index < size; index++) {
      const value = vesselness(
        [eigen[index * 3], eigen[index * 3 + 1], eigen[index * 3 + 2]],
        params
      );
      if (value > response[index]) {
        response[index] = value;
        scale[index] = sigma;
      }
    }
  }

  return { response, scale };
}
