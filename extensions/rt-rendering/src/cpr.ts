/**
 * Curved planar reformation — pure core (RTV-14, RTV-61).
 *
 * Produces the 3D sample positions a renderer reads voxels at, for the three CPR modes
 * from Kanitsar et al., *Curved Planar Reformation of CT Angiographies* (IEEE Vis 2002).
 * It does **not** read voxels: keeping the geometry separate from the sampling is what
 * lets the whole thing be tested without a volume.
 *
 * The three modes answer different questions, and the difference is not cosmetic:
 *
 * - **Straightened** — every row is perpendicular to the centerline, so the vessel
 *   becomes a straight column. Cross-sections are true, and a stenosis measured across
 *   a row is a real diameter. Global geometry is destroyed: the image says nothing
 *   about where the vessel actually goes.
 * - **Stretched** — rows stay parallel to a fixed *up* direction while the centerline is
 *   laid out by arc length. Distances **along** the vessel are true, and the shape is
 *   recognisable. Rows are not perpendicular where the vessel runs oblique, so
 *   cross-sections there are cut at an angle and read wider than they are.
 * - **Projected** — the vessel is projected onto a plane. Spatial relationships to
 *   neighbouring structures survive, at the cost of both of the above.
 *
 * Reading a diameter off a *stretched* CPR is the classic error, which is why
 * {@link CPR_MODE_CAVEATS} exists and the panel should show it.
 *
 * Framework-free. Zero-fork per RTV-114.
 */

import { add, cross, dot, Frame, normalise, scale, sub, Vec3 } from './centerline';

export type CprMode = 'straightened' | 'stretched' | 'projected';

export const CPR_MODES: CprMode[] = ['straightened', 'stretched', 'projected'];

export const CPR_MODE_LABELS: Record<CprMode, string> = {
  straightened: 'Straightened',
  stretched: 'Stretched',
  projected: 'Projected',
};

/**
 * What each mode is safe to measure on. Shown next to the mode picker: reading a
 * diameter off a stretched CPR overestimates it wherever the vessel runs oblique.
 */
export const CPR_MODE_CAVEATS: Record<CprMode, string> = {
  straightened:
    'Cross-sections are true — measure diameters here. The vessel course is not preserved.',
  stretched:
    'Lengths along the vessel are true. Cross-sections are cut obliquely where the vessel is not perpendicular, so diameters read wide.',
  projected:
    'Shows the vessel in context. Foreshortened wherever it runs out of plane, so neither diameters nor lengths along the vessel are reliable.',
};

export interface CprOptions {
  /** Half-width of the reformation, in mm either side of the centerline. */
  widthMm?: number;
  /** Sample spacing across the row, in mm. */
  pixelSpacingMm?: number;
  /**
   * Fixed "up" direction for stretched and projected modes, in patient coordinates.
   * Defaults to +Z (superior), which puts a coronal-ish vessel the right way up.
   */
  up?: Vec3;
}

export const CPR_WIDTH_MM_DEFAULT = 20;
export const CPR_WIDTH_MM_MAX = 200;
export const CPR_PIXEL_MM_DEFAULT = 0.5;

export interface CprGeometry {
  mode: CprMode;
  /** Rows, in centerline order; each row is a list of 3D sample positions. */
  rows: Vec3[][];
  /** Samples per row. */
  columns: number;
  /** Nominal mm between rows — the centerline spacing. */
  rowSpacingMm: number;
  /**
   * Vertical position of each row in the reformatted image, in mm.
   *
   * This is where the three modes actually differ in layout. Straightened and stretched
   * place rows at uniform ARC LENGTH, so the vertical axis is true distance along the
   * vessel. Projected places them at the centerline's projection onto `up`, which is
   * foreshortened wherever the vessel runs out of plane — that foreshortening is the
   * whole reason a length must not be read off a projected CPR.
   */
  rowOffsetsMm: number[];
  /** mm between samples within a row. */
  columnSpacingMm: number;
  /** The constant row direction used by stretched/projected; null when straightened. */
  rowDirection: Vec3 | null;
  caveat: string;
}

function clampWidth(mm: unknown): number {
  const n = Number(mm);
  if (!Number.isFinite(n) || n <= 0) {
    return CPR_WIDTH_MM_DEFAULT;
  }
  return Math.min(CPR_WIDTH_MM_MAX, n);
}

function clampPixel(mm: unknown): number {
  const n = Number(mm);
  if (!Number.isFinite(n) || n <= 0) {
    return CPR_PIXEL_MM_DEFAULT;
  }
  return Math.min(5, Math.max(0.05, n));
}

/**
 * The average tangent over a set of frames — the vessel's overall direction.
 * Used to pick the constant row direction for the non-straightened modes.
 */
export function meanTangent(frames: Frame[]): Vec3 {
  const list = (frames ?? []).filter(f => f?.tangent);
  if (!list.length) {
    return [1, 0, 0];
  }
  let acc: Vec3 = [0, 0, 0];
  for (const f of list) {
    acc = add(acc, f.tangent);
  }
  return normalise(acc) ?? list[0].tangent;
}

/**
 * The constant row direction for stretched and projected modes.
 *
 * Perpendicular to both `up` and the vessel's overall direction, so the reformation has
 * a sensible "horizontal" that does not depend on where along the vessel you are. It is
 * **constant** on purpose: that is precisely what distinguishes a stretched CPR from a
 * straightened one, and what preserves distance along the vessel.
 *
 * Degenerate when the vessel runs parallel to `up` (a vertical aorta with `up = +Z`);
 * any vector perpendicular to `up` will do then, and without the fallback the direction
 * would be zero and the whole reformation would collapse to a line.
 */
export function constantRowDirection(frames: Frame[], up: Vec3): Vec3 {
  const direct = normalise(cross(meanTangent(frames), up));
  if (direct) {
    return direct;
  }
  const fallback = normalise(cross(up, [1, 0, 0])) ?? normalise(cross(up, [0, 1, 0]));
  return fallback ?? [1, 0, 0];
}

/**
 * The direction a row runs.
 *
 * Straightened uses the frame's own normal, so every row is perpendicular to the vessel
 * and cross-sections are true. Stretched and projected use the **constant** direction,
 * so every row is parallel — which is what makes distance along the vessel meaningful
 * and cross-sections oblique.
 */
export function rowDirection(frame: Frame, mode: CprMode, constant: Vec3): Vec3 {
  return mode === 'straightened' ? frame.normal : constant;
}

/**
 * Sample positions for a CPR.
 *
 * `rowSpacingMm` must be the spacing the centerline was resampled at — the caller knows
 * it, and recomputing it here from the frames would just re-derive the same number with
 * floating-point drift.
 */
export function buildCprGeometry(
  frames: Frame[],
  mode: CprMode = 'straightened',
  rowSpacingMm = 0.5,
  options: CprOptions = {}
): CprGeometry {
  const list = (frames ?? []).filter(f => f && f.position && f.tangent && f.normal);
  const widthMm = clampWidth(options.widthMm);
  const columnSpacingMm = clampPixel(options.pixelSpacingMm);
  const up = (options.up && normalise(options.up)) ?? ([0, 0, 1] as Vec3);
  const resolvedMode = CPR_MODES.includes(mode) ? mode : 'straightened';

  const halfColumns = Math.max(1, Math.round(widthMm / columnSpacingMm));
  const columns = halfColumns * 2 + 1;
  const spacing = Number(rowSpacingMm) > 0 ? Number(rowSpacingMm) : 0.5;

  const constant = resolvedMode === 'straightened' ? null : constantRowDirection(list, up);

  const rows: Vec3[][] = list.map(frame => {
    const direction = rowDirection(frame, resolvedMode, constant ?? frame.normal);
    const row: Vec3[] = [];
    for (let c = -halfColumns; c <= halfColumns; c++) {
      row.push(add(frame.position, scale(direction, c * columnSpacingMm)));
    }
    return row;
  });

  const origin = list[0]?.position;
  const rowOffsetsMm = list.map((frame, i) =>
    resolvedMode === 'projected' && origin
      ? dot(sub(frame.position, origin), up)
      : i * spacing
  );

  return {
    mode: resolvedMode,
    rows,
    columns,
    rowSpacingMm: spacing,
    rowOffsetsMm,
    columnSpacingMm,
    rowDirection: constant,
    caveat: CPR_MODE_CAVEATS[resolvedMode],
  };
}

/**
 * Physical size of the reformatted image, in mm.
 * The height is arc length along the vessel, which is the number a reader compares
 * against a reported lesion length.
 */
export function cprExtentMm(geometry: CprGeometry): { widthMm: number; heightMm: number } {
  const widthMm = Math.max(0, (geometry?.columns ?? 1) - 1) * (geometry?.columnSpacingMm ?? 0);
  const offsets = geometry?.rowOffsetsMm ?? [];
  const heightMm = offsets.length
    ? Math.max(...offsets) - Math.min(...offsets)
    : Math.max(0, (geometry?.rows?.length ?? 1) - 1) * (geometry?.rowSpacingMm ?? 0);
  return { widthMm, heightMm };
}

/**
 * Maps a pixel in the reformatted image back to a patient-space position.
 *
 * This is what a measurement or an annotation on the CPR needs to be worth anything —
 * without it a click on the reformation cannot be related to the volume. Returns `null`
 * outside the image rather than extrapolating: a point off the reformation has no
 * defined position, and inventing one would put an annotation somewhere plausible and
 * wrong.
 */
export function cprPixelToPatient(
  geometry: CprGeometry,
  column: number,
  row: number
): Vec3 | null {
  const rows = geometry?.rows ?? [];
  const r = Math.round(Number(row));
  const c = Math.round(Number(column));
  if (!Number.isFinite(r) || !Number.isFinite(c)) {
    return null;
  }
  if (r < 0 || r >= rows.length) {
    return null;
  }
  const line = rows[r];
  if (c < 0 || c >= line.length) {
    return null;
  }
  return line[c];
}

/** Arc-length position of a row, in mm from the start of the centerline. */
export function rowToArcLengthMm(geometry: CprGeometry, row: number): number | null {
  const r = Math.round(Number(row));
  if (!Number.isFinite(r) || r < 0 || r >= (geometry?.rows?.length ?? 0)) {
    return null;
  }
  const offsets = geometry.rowOffsetsMm ?? [];
  return offsets.length > r ? offsets[r] : r * (geometry.rowSpacingMm ?? 0);
}

/** One-line summary for the panel. */
export function describeCpr(geometry: CprGeometry): string {
  if (!geometry?.rows?.length) {
    return 'No centerline';
  }
  const { widthMm, heightMm } = cprExtentMm(geometry);
  return `${CPR_MODE_LABELS[geometry.mode]} · ${Math.round(heightMm)} mm along the vessel · ${Math.round(widthMm)} mm wide`;
}
