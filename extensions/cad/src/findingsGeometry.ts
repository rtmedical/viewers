/**
 * Pure helpers for the CAD finding-marker overlay (RTV-79/78 follow-up).
 *
 * Framework-free and DOM-free so every marker-geometry decision (ellipse from
 * 4 SCOORD axis endpoints, circle from center+perimeter, label sizing/clamping,
 * frame matching, stack-index resolution) is unit-testable in isolation. The
 * DOM/cornerstone glue lives in ./findingsOverlay.
 */

import type { CadFinding } from './cadSr';

export type Point2 = [number, number];

/** Affine 2D map built from three probe points (see {@link buildAffine2D}). */
export interface Affine2D {
  /** Image of source (0,0). */
  origin: Point2;
  /** Image of the source x unit vector (column step). */
  basisX: Point2;
  /** Image of the source y unit vector (row step). */
  basisY: Point2;
  /** Map a source point through the affine. */
  apply: (pt: Point2) => Point2;
}

/**
 * Build an affine 2D map from THREE probe points: the images of source
 * (0,0), (1,0) and (0,1). Any affine map (scale/rotation/flip/translation —
 * e.g. cornerstone's image-coords → canvas CSS-px transform) is fully
 * determined by them, so the renderer probes the expensive mapping three
 * times per redraw and turns every subsequent point into pure arithmetic.
 * (Same recipe as rt-bev's bevGeometry.buildAffine2D.)
 */
export function buildAffine2D(p00: Point2, p10: Point2, p01: Point2): Affine2D {
  const origin: Point2 = [p00[0], p00[1]];
  const basisX: Point2 = [p10[0] - p00[0], p10[1] - p00[1]];
  const basisY: Point2 = [p01[0] - p00[0], p01[1] - p00[1]];
  return {
    origin,
    basisX,
    basisY,
    apply: ([x, y]: Point2): Point2 => [
      origin[0] + x * basisX[0] + y * basisY[0],
      origin[1] + x * basisX[1] + y * basisY[1],
    ],
  };
}

/** Chunk a flat SCOORD GraphicData list into [column, row] pairs. */
export function chunkPairs(flat: number[] | undefined | null): Point2[] {
  const out: Point2[] = [];
  if (!Array.isArray(flat)) {
    return out;
  }
  for (let i = 0; i + 1 < flat.length; i += 2) {
    out.push([flat[i], flat[i + 1]]);
  }
  return out;
}

export interface CanvasCircle {
  cx: number;
  cy: number;
  r: number;
}

/** SCOORD CIRCLE: [center, point-on-perimeter] → SVG circle parameters. */
export function circleFromCenterPerimeter(pts: Point2[]): CanvasCircle | undefined {
  if (!pts || pts.length < 2) {
    return undefined;
  }
  const [center, onPerimeter] = pts;
  return {
    cx: center[0],
    cy: center[1],
    r: Math.hypot(onPerimeter[0] - center[0], onPerimeter[1] - center[1]),
  };
}

export interface CanvasEllipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Major-axis angle, degrees, SVG rotate() convention (clockwise, y-down). */
  rotationDeg: number;
}

/**
 * SCOORD ELLIPSE: 4 points — major axis endpoints then minor axis endpoints —
 * → SVG ellipse approximation: center = midpoint of the major axis, rx/ry =
 * half the axis lengths, rotation = major-axis angle. Exact when the two axes
 * are perpendicular and share a midpoint (the DICOM definition); a reasonable
 * approximation otherwise.
 */
export function ellipseFromAxisEndpoints(pts: Point2[]): CanvasEllipse | undefined {
  if (!pts || pts.length < 4) {
    return undefined;
  }
  const [majorStart, majorEnd, minorStart, minorEnd] = pts;
  const cx = (majorStart[0] + majorEnd[0]) / 2;
  const cy = (majorStart[1] + majorEnd[1]) / 2;
  const rx = Math.hypot(majorEnd[0] - majorStart[0], majorEnd[1] - majorStart[1]) / 2;
  const ry = Math.hypot(minorEnd[0] - minorStart[0], minorEnd[1] - minorStart[1]) / 2;
  const rotationDeg =
    (Math.atan2(majorEnd[1] - majorStart[1], majorEnd[0] - majorStart[0]) * 180) / Math.PI;
  return { cx, cy, rx, ry, rotationDeg };
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Axis-aligned bounding box of a point list. */
export function boundsOf(pts: Point2[]): Bounds | undefined {
  if (!pts || !pts.length) {
    return undefined;
  }
  let minX = pts[0][0];
  let minY = pts[0][1];
  let maxX = pts[0][0];
  let maxY = pts[0][1];
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Clamp a `w`×`h` rectangle's top-left corner so the whole rectangle stays
 * inside a `boxW`×`boxH` viewport with `pad` px of breathing room.
 */
export function clampToBox(
  x: number,
  y: number,
  w: number,
  h: number,
  boxW: number,
  boxH: number,
  pad = 2
): Point2 {
  const maxX = Math.max(pad, boxW - w - pad);
  const maxY = Math.max(pad, boxH - h - pad);
  return [Math.min(Math.max(x, pad), maxX), Math.min(Math.max(y, pad), maxY)];
}

/**
 * Backdrop-rect size for a marker label. ~0.62em average glyph advance for a
 * sans stack — close enough for backdrop sizing/clamping without forcing a
 * DOM layout (getBBox) on every redraw.
 */
export function estimateLabelBox(text: string, fontSizePx = 11): { w: number; h: number } {
  return {
    w: Math.ceil((text?.length ?? 0) * fontSizePx * 0.62) + 8,
    h: fontSizePx + 6,
  };
}

/**
 * Short marker-label form of a finding type: multi-word types become initials
 * ("Calcification cluster" → "CC"), short single words pass through, long
 * single words are truncated with a dot ("Calcification" → "Calcif.").
 */
export function abbreviateFindingType(type?: string): string {
  const trimmed = (type ?? '').trim();
  if (!trimmed) {
    return 'CAD';
  }
  const words = trimmed.split(/\s+/);
  if (words.length === 1) {
    return words[0].length <= 8 ? words[0] : `${words[0].slice(0, 6)}.`;
  }
  return words
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 4);
}

/** Marker label: abbreviated type + probability % when present. */
export function findingLabel(
  finding: Pick<CadFinding, 'type' | 'codeValue' | 'probability'>
): string {
  const abbrev = abbreviateFindingType(finding?.type ?? finding?.codeValue);
  const p = finding?.probability;
  if (p == null || !Number.isFinite(p)) {
    return abbrev;
  }
  // Same convention as the panel: fractions are percentages, >1 already is one.
  const pct = p <= 1 ? Math.round(p * 100) : Math.round(p);
  return `${abbrev} ${pct}%`;
}

/**
 * 1-based DICOM frame number encoded in a cornerstone imageId, or undefined
 * for a single-frame id. WADO-RS paths and the regular DICOMweb datasource use
 * 1-based values. DicomJSON URLs use `frame=0..N-1`; when the viewport's stack
 * imageIds include frame zero, query values are normalized back to DICOM's
 * 1-based ReferencedFrameNumber.
 */
export function frameNumberFromImageId(
  imageId?: string,
  stackImageIds: string[] = []
): number | undefined {
  if (!imageId) {
    return undefined;
  }
  const wadors = imageId.match(/\/frames\/(\d+)/);
  if (wadors) {
    return Number(wadors[1]);
  }
  const wadouri = imageId.match(/[?&]frame=(\d+)/);
  if (wadouri) {
    const rawFrame = Number(wadouri[1]);
    const zeroBasedStack = stackImageIds.some(id => /[?&]frame=0(?:&|$)/.test(id));
    return rawFrame + (zeroBasedStack ? 1 : 0);
  }
  return undefined;
}

/**
 * Does a finding sit on the image (SOP + 1-based frame) a viewport currently
 * shows? Missing frame numbers on either side default to frame 1 — the
 * cornerstone-dicom-sr `ReferencedFrameNumber || 1` convention.
 */
export function findingMatchesImage(
  finding: Pick<CadFinding, 'referencedSopInstanceUID' | 'referencedFrameNumber'>,
  sopInstanceUID?: string,
  frameNumber?: number
): boolean {
  if (!finding?.referencedSopInstanceUID || !sopInstanceUID) {
    return false;
  }
  if (finding.referencedSopInstanceUID !== sopInstanceUID) {
    return false;
  }
  return (finding.referencedFrameNumber ?? 1) === (frameNumber ?? 1);
}

/**
 * Identity check for a finding across independently parsed copies (the panel
 * may re-parse the SR, producing new objects): reference equality first, then
 * report/index identity when available, with spatial equality as the legacy
 * fallback.
 */
export function sameFinding(a?: CadFinding | null, b?: CadFinding | null): boolean {
  if (!a || !b) {
    return false;
  }
  if (a === b) {
    return true;
  }
  const aHasStableId = !!a.reportSopInstanceUID && Number.isInteger(a.findingIndex);
  const bHasStableId = !!b.reportSopInstanceUID && Number.isInteger(b.findingIndex);
  if (aHasStableId || bHasStableId) {
    return (
      aHasStableId &&
      bHasStableId &&
      a.reportSopInstanceUID === b.reportSopInstanceUID &&
      a.findingIndex === b.findingIndex
    );
  }
  const aPts = a.points ?? [];
  const bPts = b.points ?? [];
  return (
    a.referencedSopInstanceUID === b.referencedSopInstanceUID &&
    (a.referencedFrameNumber ?? 1) === (b.referencedFrameNumber ?? 1) &&
    a.graphicType === b.graphicType &&
    aPts.length === bPts.length &&
    aPts.every((v, i) => v === bPts[i])
  );
}

/**
 * Stack index of (SOPInstanceUID, 1-based frame) within a display set whose
 * imageIds enumerate every instance's frames in order (OHIF's
 * getImageIdsForDisplaySet contract: single-frame instances contribute one id,
 * multiframe instances contribute NumberOfFrames consecutive ids). The frame
 * is clamped into the instance's frame range. Undefined when the SOP is not in
 * the display set.
 */
export function targetImageIndexInDisplaySet(
  displaySet: { images?: unknown[]; instances?: unknown[] } | undefined,
  sopInstanceUID?: string,
  frameNumber = 1
): number | undefined {
  const images = (displaySet?.images ?? displaySet?.instances ?? []) as Array<{
    SOPInstanceUID?: string;
    NumberOfFrames?: number | string;
  }>;
  if (!sopInstanceUID) {
    return undefined;
  }
  let index = 0;
  for (const image of images) {
    const frames = Number(image?.NumberOfFrames) > 1 ? Number(image.NumberOfFrames) : 1;
    if (image?.SOPInstanceUID === sopInstanceUID) {
      const frame = Math.min(Math.max(Math.round(frameNumber) || 1, 1), frames);
      return index + frame - 1;
    }
    index += frames;
  }
  return undefined;
}
