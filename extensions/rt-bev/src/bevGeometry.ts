/**
 * Pure BEV geometry: isocenter-plane mm → RTIMAGE pixel transform, rotation
 * about a point (collimator), and per-leaf MLC aperture rectangles.
 *
 * Port of the load-bearing math of connectviewer
 * `DrawBlockAndMlcTool.js:264-285` (see viewers-artifacts/bev-mlc-port-plan.md).
 * Framework-free; all functions are pure.
 */

import type { BevBeam } from './rtBevParser';

export interface RtImageGeometry {
  /**
   * RTImagePosition (3002,0012): [x, y] mm of the CENTER of the first
   * (top-left) transmitted pixel, in the IEC X-RAY IMAGE RECEPTOR plane.
   */
  rtImagePositionMm: [number, number];
  /**
   * Pixel spacing as **[xSpacingMm, ySpacingMm]** (column spacing, row
   * spacing). NOTE: the raw ImagePlanePixelSpacing (3002,0011) attribute is
   * ordered [row, col] — swap when pixels are non-square (the legacy tool
   * used spacing[0] for x on square DRR pixels, where both agree).
   */
  pixelSpacingMm: [number, number];
  /** RadiationMachineSAD (3002,0022), mm. */
  sadMm?: number;
  /** RTImageSID (3002,0026), mm. */
  sidMm?: number;
}

export interface LeafRect {
  xMm1: number;
  yMm1: number;
  xMm2: number;
  yMm2: number;
  /** Leaf pair index, 0-based. */
  leafIndex: number;
  bank: 'A' | 'B';
}

/**
 * Map a point given in **mm at the isocenter plane** (IEC beam-limiting
 * device / BEV coordinates: +x to the right, +y up-screen) to RTIMAGE pixel
 * coordinates (x right, y DOWN).
 *
 * Legacy transform (DrawBlockAndMlcTool.js:264-285):
 * ```
 * xc = -RTImagePosition[0] / spacing[0]      // beam-axis pixel column
 * yc =  RTImagePosition[1] / spacing[1]      // beam-axis pixel row
 * px = xc + x * mag / spacing[0]
 * py = yc - y * mag / spacing[1]
 * ```
 * with `mag = sid / sad` when both are known, else 1.
 *
 * Sign convention (derived from the port plan): image pixel y grows DOWN
 * while IEC BEV +y points up-screen, hence the minus on py. For the jaws
 * this means Y2 (the positive-Y jaw, top of the field) maps to
 * `yc - Y2/spacing` and Y1 (the negative-Y jaw, e.g. -182 mm) maps to
 * `yc - (-182)/spacing = yc + 182/spacing`, i.e. BELOW the beam axis. The
 * legacy code wrote the latter as `yc + Y1/spacing` only because it stored
 * Y1 as an unsigned magnitude; with signed DICOM LeafJawPositions the single
 * formula above covers both jaws (and every leaf/block vertex).
 *
 * SID/SAD magnification: DICOM PS3.3 C.8.8.2 defines ImagePlanePixelSpacing
 * (3002,0011) and RTImagePosition (3002,0012) AT the RT image plane (distance
 * RTImageSID from the source), while LeafJawPositions (300A,011C) are
 * projected to the ISOCENTER plane (distance SAD). Divergent-beam geometry
 * therefore magnifies isocenter-plane lengths by **SID/SAD** at the image
 * plane. The legacy tool applied NO magnification and still lined up because
 * Eclipse/Varian DRRs report spacing/position already retro-projected to the
 * isocenter plane with SID == SAD (as in the real fixture: both 1000), so
 * every Eclipse DRR takes the mag = 1 path either way; the explicit factor
 * only engages on detector-plane RTIMAGEs (e.g. portal images, SID 1400 /
 * SAD 1000 → mag 1.4). Missing/zero SID or SAD falls back to 1.
 */
export function isocenterMmToImagePx(
  [xMm, yMm]: [number, number],
  geom: RtImageGeometry
): [number, number] {
  const [sx, sy] = geom.pixelSpacingMm;
  const xc = -geom.rtImagePositionMm[0] / sx;
  const yc = geom.rtImagePositionMm[1] / sy;
  const mag = geom.sadMm && geom.sidMm ? geom.sidMm / geom.sadMm : 1;
  return [xc + (xMm * mag) / sx, yc - (yMm * mag) / sy];
}

/** Affine 2D map built from three probe points (see {@link buildAffine2D}). */
export interface Affine2D {
  /** Image of source (0,0). */
  origin: [number, number];
  /** Image of the source x unit vector (column step). */
  basisX: [number, number];
  /** Image of the source y unit vector (row step). */
  basisY: [number, number];
  /** Map a source point through the affine. */
  apply: (pt: [number, number]) => [number, number];
}

/**
 * Build an affine 2D map from THREE probe points: the images of source
 * (0,0), (1,0) and (0,1). Any affine map (scale/rotation/flip/translation —
 * e.g. cornerstone's image-index → canvas CSS-px transform) is fully
 * determined by them, so a renderer can probe the expensive mapping three
 * times per redraw and turn every subsequent point into pure arithmetic.
 */
export function buildAffine2D(
  p00: [number, number],
  p10: [number, number],
  p01: [number, number]
): Affine2D {
  const origin: [number, number] = [p00[0], p00[1]];
  const basisX: [number, number] = [p10[0] - p00[0], p10[1] - p00[1]];
  const basisY: [number, number] = [p01[0] - p00[0], p01[1] - p00[1]];
  return {
    origin,
    basisX,
    basisY,
    apply: ([x, y]: [number, number]): [number, number] => [
      origin[0] + x * basisX[0] + y * basisY[0],
      origin[1] + x * basisX[1] + y * basisY[1],
    ],
  };
}

/**
 * Rotate `pt` about `center` by `angleDeg` (mathematical convention:
 * positive = counter-clockwise in a y-UP frame; in pixel space, where y
 * grows down, a positive angle therefore appears clockwise).
 *
 * The legacy renderer rotates every drawn point about the beam-axis pixel
 * [xc, yc] by **-collimatorAngle** in PIXEL space. In the y-up isocenter mm
 * frame the equivalent is **+collimatorAngle** about (0, 0) (conjugating a
 * rotation by the y-flip negates the angle) — algebraically identical for
 * square pixels, and the mm-space form stays correct for non-square
 * ImagePlanePixelSpacing because the rotation then precedes the anisotropic
 * scaling (rotation and non-uniform scaling do not commute). The overlay
 * therefore rotates in mm space BEFORE projecting through
 * {@link isocenterMmToImagePx}.
 */
export function rotateAboutDeg(
  pt: [number, number],
  center: [number, number],
  angleDeg: number
): [number, number] {
  const a = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = pt[0] - center[0];
  const dy = pt[1] - center[1];
  return [center[0] + dx * cos - dy * sin, center[1] + dx * sin + dy * cos];
}

/**
 * Per-leaf rectangles bounding the OPEN aperture for one control point, in
 * **mm at the isocenter plane** (rects are what the renderer fills as the
 * leaf bodies visible inside the jaw window; their inner edge is the leaf
 * tip, i.e. the open-aperture edge).
 *
 * Geometry per leaf pair `i` (MLCX — leaves travel along X):
 * - the pair spans `leafBoundariesMm[i] .. leafBoundariesMm[i+1]` on Y (the
 *   leaf-travel-perpendicular axis);
 * - bank A's body extends from the negative side up to its tip `bankA[i]`,
 *   bank B's from its tip `bankB[i]` toward the positive side;
 * - everything is CLIPPED to the CP's jaw window (legacy: "folhas dos 2
 *   carros, cropadas ao jaw"); fully-hidden leaves yield no rect, so closed
 *   pairs parked behind a jaw disappear.
 *
 * For MLCY the axes swap (leaves travel along Y, boundaries span X).
 * Returns [] when the beam has no MLC, no boundaries, or `cpIndex` is
 * out of range. When a jaw pair is missing (e.g. jawless MLC-only machines),
 * the travel axis falls back to the banks' own extent PADDED by
 * {@link TRAVEL_FALLBACK_PAD_MM} — without the pad, the most-open leaf of
 * each bank (the one whose tip IS the extremum) would clip to zero width and
 * its aperture edge would vanish — and the span axis to the boundary extent.
 */
/**
 * Travel-axis margin (mm) added around the banks' own extent when the
 * travel-axis jaw is absent, so every leaf with a finite tip renders a
 * non-degenerate body (see {@link leafApertureRects}).
 */
export const TRAVEL_FALLBACK_PAD_MM = 10;

export function leafApertureRects(beam: BevBeam, cpIndex: number): LeafRect[] {
  const cp = beam?.controlPoints?.[cpIndex];
  const boundaries = beam?.leafBoundariesMm;
  if (!cp || !beam.mlcType || !boundaries || boundaries.length < 2) {
    return [];
  }
  const { bankA, bankB } = cp;
  const nPairs = Math.min(bankA.length, bankB.length, boundaries.length - 1);
  if (nPairs <= 0) {
    return [];
  }

  const sorted = (pair?: [number, number]): [number, number] | undefined =>
    pair && [Math.min(pair[0], pair[1]), Math.max(pair[0], pair[1])];

  // Travel axis = leaf motion (X for MLCX, Y for MLCY); span axis = boundaries.
  const isMlcx = beam.mlcType === 'MLCX';
  const travelJaw = sorted(isMlcx ? cp.jawXmm : cp.jawYmm);
  const spanJaw = sorted(isMlcx ? cp.jawYmm : cp.jawXmm);

  const travelWindow: [number, number] = travelJaw ?? [
    Math.min(...bankA.slice(0, nPairs)) - TRAVEL_FALLBACK_PAD_MM,
    Math.max(...bankB.slice(0, nPairs)) + TRAVEL_FALLBACK_PAD_MM,
  ];
  const spanWindow: [number, number] = spanJaw ?? [
    Math.min(boundaries[0], boundaries[boundaries.length - 1]),
    Math.max(boundaries[0], boundaries[boundaries.length - 1]),
  ];

  const rects: LeafRect[] = [];
  const push = (
    leafIndex: number,
    bank: 'A' | 'B',
    travel1: number,
    travel2: number,
    span1: number,
    span2: number
  ) => {
    if (travel2 <= travel1 || span2 <= span1) {
      return; // clipped away
    }
    rects.push(
      isMlcx
        ? { xMm1: travel1, xMm2: travel2, yMm1: span1, yMm2: span2, leafIndex, bank }
        : { xMm1: span1, xMm2: span2, yMm1: travel1, yMm2: travel2, leafIndex, bank }
    );
  };

  for (let i = 0; i < nPairs; i++) {
    const spanLo = Math.min(boundaries[i], boundaries[i + 1]);
    const spanHi = Math.max(boundaries[i], boundaries[i + 1]);
    const s1 = Math.max(spanLo, spanWindow[0]);
    const s2 = Math.min(spanHi, spanWindow[1]);
    if (s2 <= s1) {
      continue; // pair entirely behind the span-axis jaw
    }
    // Bank A body: from the negative jaw edge to the leaf tip.
    push(i, 'A', travelWindow[0], Math.min(bankA[i], travelWindow[1]), s1, s2);
    // Bank B body: from the leaf tip to the positive jaw edge.
    push(i, 'B', Math.max(bankB[i], travelWindow[0]), travelWindow[1], s1, s2);
  }

  return rects;
}
