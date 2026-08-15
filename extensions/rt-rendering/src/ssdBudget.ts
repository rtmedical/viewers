/**
 * SSD pre-flight budget — pure core (RTV-17).
 *
 * ## Why this exists
 *
 * The ticket's acceptance criterion is "SSD de CT skull renderiza em <10s". Marching
 * cubes is O(voxels), and a routine CT is not small: 512 x 512 x 400 is **105 million
 * voxels**. Running that unthrottled in the browser's main thread does not take ten
 * seconds — it locks the tab long enough that the user reloads. The extraction itself
 * is `vtkImageMarchingCubes` (already bundled, not reimplemented here); what was
 * missing is deciding *how* to call it so the answer arrives.
 *
 * So this module is the pre-flight: how many voxels are we about to march, what
 * stride keeps that under budget, roughly how many triangles come out, and is this
 * volume even a sensible thing to threshold in Hounsfield units.
 *
 * The estimates are deliberately rough and documented as such. The point is not
 * predicting the millisecond — it is the difference between "this will take a moment"
 * and "this will hang the tab".
 *
 * Framework-free. Zero-fork per RTV-114.
 */

import { clampThresholdHu } from './ssdPresets';

/**
 * Voxels we are willing to march at full resolution.
 *
 * Order-of-magnitude, from marching cubes being a few operations per voxel in JS:
 * ~30 M voxels lands in the low seconds on a normal workstation, which fits the
 * 10 s criterion with room for the surface build. It is a *budget*, not a
 * measurement — the honest knob to turn if real timings say otherwise.
 */
export const SSD_VOXEL_BUDGET = 30_000_000;

/** Never stride past this: beyond 4 the surface stops resembling anatomy. */
export const SSD_MAX_SAMPLE_RATE = 4;

export interface VolumeDims {
  /** [columns, rows, slices]. */
  dimensions?: number[];
  /** Voxel spacing in mm, [x, y, z]. */
  spacing?: number[];
  modality?: string;
}

export interface SsdBudget {
  voxelCount: number;
  /** Integer stride to pass to the extractor; 1 means full resolution. */
  sampleRate: number;
  /** Voxels actually marched at that stride. */
  effectiveVoxelCount: number;
  /** Rough triangle count of the resulting surface. */
  estimatedTriangles: number;
  /** True when the stride had to go above 1. */
  downsampled: boolean;
  /** Blocking problems — extraction should not run. */
  errors: string[];
  /** Non-blocking concerns worth telling the reader. */
  warnings: string[];
}

function positiveInts(dimensions?: number[]): number[] | null {
  if (!Array.isArray(dimensions) || dimensions.length < 3) {
    return null;
  }
  const dims = dimensions.slice(0, 3).map(d => Math.floor(Number(d)));
  return dims.every(d => Number.isFinite(d) && d > 0) ? dims : null;
}

/** Voxels in the volume, or 0 when the dimensions are unusable. */
export function estimateVoxelCount(dimensions?: number[]): number {
  const dims = positiveInts(dimensions);
  return dims ? dims[0] * dims[1] * dims[2] : 0;
}

/**
 * Smallest integer stride that brings the volume under `budget`.
 *
 * Striding by `s` divides the voxel count by `s³`, so the growth is fast: stride 2 is
 * already an 8x cut. Capped at {@link SSD_MAX_SAMPLE_RATE} — past that the surface is
 * blocky enough to mislead, and refusing is better than rendering a lie.
 */
export function recommendSampleRate(voxelCount: number, budget = SSD_VOXEL_BUDGET): number {
  const count = Number(voxelCount);
  const limit = Number(budget) > 0 ? Number(budget) : SSD_VOXEL_BUDGET;
  if (!Number.isFinite(count) || count <= 0) {
    return 1;
  }
  for (let rate = 1; rate <= SSD_MAX_SAMPLE_RATE; rate++) {
    if (count / rate ** 3 <= limit) {
      return rate;
    }
  }
  return SSD_MAX_SAMPLE_RATE;
}

/**
 * Rough triangle count for an isosurface through `voxelCount` voxels.
 *
 * A closed surface through a volume scales with its cross-section, i.e. ~N^(2/3),
 * times a shape factor for how convoluted the surface is. `factor` defaults to 2,
 * which is in the right ballpark for bone; a lung or vessel surface is far more
 * convoluted and will exceed it. Used only to warn about a heavy mesh, never to
 * decide correctness.
 */
export function estimateTriangles(voxelCount: number, factor = 2): number {
  const count = Number(voxelCount);
  if (!Number.isFinite(count) || count <= 0) {
    return 0;
  }
  const f = Number.isFinite(Number(factor)) && Number(factor) > 0 ? Number(factor) : 2;
  return Math.round(f * Math.cbrt(count) ** 2);
}

/** Triangles past which the surface is heavy enough to be worth mentioning. */
export const SSD_TRIANGLE_WARN = 2_000_000;

/**
 * Pre-flight for an SSD extraction.
 *
 * Errors block; warnings inform. The important one is the modality check: a
 * Hounsfield threshold is only defined on CT. Applying 300 HU to an MR volume is not
 * a worse surface, it is a meaningless one — the numbers are arbitrary signal
 * intensities — so that is called out rather than silently rendered.
 */
export function planSsdExtraction(volume: VolumeDims, thresholdHu?: number): SsdBudget {
  const errors: string[] = [];
  const warnings: string[] = [];

  const dims = positiveInts(volume?.dimensions);
  if (!dims) {
    errors.push('The volume has no usable dimensions.');
  } else if (dims.some(d => d < 2)) {
    // Marching cubes needs a cell, which needs two samples on every axis.
    errors.push('The volume is too thin to build a surface (needs at least 2 samples per axis).');
  }

  const modality = String(volume?.modality ?? '').toUpperCase();
  if (modality && modality !== 'CT') {
    warnings.push(
      `Hounsfield thresholds are only defined for CT; this series is ${modality}, so the threshold is an arbitrary intensity.`
    );
  }

  const voxelCount = dims ? dims[0] * dims[1] * dims[2] : 0;
  const sampleRate = recommendSampleRate(voxelCount);
  const effectiveVoxelCount = voxelCount ? Math.floor(voxelCount / sampleRate ** 3) : 0;
  const estimatedTriangles = estimateTriangles(effectiveVoxelCount);

  if (sampleRate > 1) {
    warnings.push(
      `Sampling every ${sampleRate} voxels to stay responsive (${formatCount(
        voxelCount
      )} voxels at full resolution).`
    );
  }
  if (estimatedTriangles > SSD_TRIANGLE_WARN) {
    warnings.push(
      `The surface may exceed ${formatCount(SSD_TRIANGLE_WARN)} triangles and be slow to rotate.`
    );
  }

  // Anisotropy is worth flagging: a 5 mm slice CT makes a visibly stepped surface,
  // and readers blame the renderer rather than the acquisition.
  const spacing = Array.isArray(volume?.spacing) ? volume.spacing.map(Number) : [];
  if (spacing.length >= 3 && spacing.every(s => Number.isFinite(s) && s > 0)) {
    const inPlane = Math.min(spacing[0], spacing[1]);
    if (spacing[2] / inPlane >= 3) {
      warnings.push(
        `Slice spacing is ${round1(spacing[2])} mm against ${round1(
          inPlane
        )} mm in plane — the surface will look stepped.`
      );
    }
  }

  if (thresholdHu != null && clampThresholdHu(thresholdHu) !== Math.round(Number(thresholdHu))) {
    warnings.push('The threshold was clamped to the usable Hounsfield range.');
  }

  return {
    voxelCount,
    sampleRate,
    effectiveVoxelCount,
    estimatedTriangles,
    downsampled: sampleRate > 1,
    errors,
    warnings,
  };
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Compact count for a message: 105000000 -> "105 M". */
export function formatCount(count: number): string {
  const n = Number(count);
  if (!Number.isFinite(n)) {
    return '0';
  }
  if (n >= 1_000_000) {
    return `${round1(n / 1_000_000)} M`;
  }
  if (n >= 1_000) {
    return `${round1(n / 1_000)} k`;
  }
  return String(Math.round(n));
}

/** One-line pre-flight summary for the panel. */
export function describeBudget(budget: SsdBudget): string {
  if (budget.errors.length) {
    return budget.errors[0];
  }
  const parts = [`${formatCount(budget.effectiveVoxelCount)} voxels`];
  if (budget.downsampled) {
    parts.push(`sampled 1:${budget.sampleRate}`);
  }
  parts.push(`~${formatCount(budget.estimatedTriangles)} triangles`);
  return parts.join(' · ');
}
