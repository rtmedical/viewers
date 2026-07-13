/**
 * Pure geometry + color model for the AHA 17-segment bullseye (RTV-48).
 *
 * Segmentation and nomenclature follow the AHA standard: Cerqueira MD et al.,
 * "Standardized Myocardial Segmentation and Nomenclature for Tomographic
 * Imaging of the Heart", Circulation 2002;105:539–542.
 *
 * Encoded polar convention (matches the standard bullseye figure, i.e. the
 * left ventricle seen from the APEX looking toward the base):
 *   - apex (17) at the center, then apical, mid and basal rings outward;
 *   - the ANTERIOR wall at 12 o'clock (top), the SEPTUM on the LEFT, the
 *     INFERIOR wall at 6 o'clock and the LATERAL wall on the RIGHT;
 *   - angles are measured in degrees from 12 o'clock, increasing CLOCKWISE on
 *     screen; a segment sweeps clockwise from `startDeg` to `endDeg`
 *     (endDeg > startDeg; startDeg may be negative for arcs crossing 0°);
 *   - segment NUMBERING advances COUNTERCLOCKWISE per the AHA chart
 *     (1 basal anterior → 2 basal anteroseptal → 3 basal inferoseptal →
 *     4 basal inferior → 5 basal inferolateral → 6 basal anterolateral, and
 *     likewise 7–12 for the mid ring), so successive segments have
 *     decreasing angles;
 *   - basal + mid rings: 6 × 60° with the anterior segment centered at the
 *     top (spanning −30°…+30°); apical ring: 4 × 90° (13 anterior top,
 *     14 septal left, 15 inferior bottom, 16 lateral right); 17 = full disc.
 *
 * No rendering dependency — the panel renders raw `<svg>` from this (same
 * pattern as extensions/rt-dvh/src/dvhChart.ts).
 */

export type AhaRing = 'basal' | 'mid' | 'apical' | 'apex';

export interface AhaSegment {
  /** AHA segment number, 1–17. */
  id: number;
  ring: AhaRing;
  /** i18n key in the RTMedical namespace (rtEn / rtPtBR bundles). */
  labelKey: string;
  /** Degrees clockwise from 12 o'clock. May be negative (arc crossing top). */
  startDeg: number;
  /** endDeg > startDeg; endDeg − startDeg is the clockwise sweep. */
  endDeg: number;
}

/** The 17 standard AHA myocardial segments (see module docblock). */
export const AHA_SEGMENTS: readonly AhaSegment[] = [
  // Basal ring (1–6), 6 × 60°, numbered counterclockwise from anterior (top).
  { id: 1, ring: 'basal', labelKey: 'cardio_seg_basal_anterior', startDeg: -30, endDeg: 30 },
  { id: 2, ring: 'basal', labelKey: 'cardio_seg_basal_anteroseptal', startDeg: 270, endDeg: 330 },
  { id: 3, ring: 'basal', labelKey: 'cardio_seg_basal_inferoseptal', startDeg: 210, endDeg: 270 },
  { id: 4, ring: 'basal', labelKey: 'cardio_seg_basal_inferior', startDeg: 150, endDeg: 210 },
  { id: 5, ring: 'basal', labelKey: 'cardio_seg_basal_inferolateral', startDeg: 90, endDeg: 150 },
  { id: 6, ring: 'basal', labelKey: 'cardio_seg_basal_anterolateral', startDeg: 30, endDeg: 90 },
  // Mid ring (7–12), same angular layout as basal.
  { id: 7, ring: 'mid', labelKey: 'cardio_seg_mid_anterior', startDeg: -30, endDeg: 30 },
  { id: 8, ring: 'mid', labelKey: 'cardio_seg_mid_anteroseptal', startDeg: 270, endDeg: 330 },
  { id: 9, ring: 'mid', labelKey: 'cardio_seg_mid_inferoseptal', startDeg: 210, endDeg: 270 },
  { id: 10, ring: 'mid', labelKey: 'cardio_seg_mid_inferior', startDeg: 150, endDeg: 210 },
  { id: 11, ring: 'mid', labelKey: 'cardio_seg_mid_inferolateral', startDeg: 90, endDeg: 150 },
  { id: 12, ring: 'mid', labelKey: 'cardio_seg_mid_anterolateral', startDeg: 30, endDeg: 90 },
  // Apical ring (13–16), 4 × 90°: anterior top, septal left, inferior bottom,
  // lateral right.
  { id: 13, ring: 'apical', labelKey: 'cardio_seg_apical_anterior', startDeg: -45, endDeg: 45 },
  { id: 14, ring: 'apical', labelKey: 'cardio_seg_apical_septal', startDeg: 225, endDeg: 315 },
  { id: 15, ring: 'apical', labelKey: 'cardio_seg_apical_inferior', startDeg: 135, endDeg: 225 },
  { id: 16, ring: 'apical', labelKey: 'cardio_seg_apical_lateral', startDeg: 45, endDeg: 135 },
  // Apex (17): full disc at the center.
  { id: 17, ring: 'apex', labelKey: 'cardio_seg_apex', startDeg: 0, endDeg: 360 },
];

/** Round for compact-but-stable SVG path output. */
function fmtNum(v: number): string {
  return String(Math.round(v * 100) / 100);
}

/**
 * Polar → cartesian using the bullseye convention: `deg` measured clockwise
 * from 12 o'clock (screen "up").
 */
export function polarPoint(
  cx: number,
  cy: number,
  r: number,
  deg: number
): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
}

/**
 * SVG path (`d`) for an annular sector between `rInner` and `rOuter`,
 * sweeping clockwise from `startDeg` to `endDeg` (degrees from 12 o'clock).
 *
 * Full-circle case (sweep ≥ 360°): with `rInner <= 0` it emits a disc (two
 * semicircular arcs — the apex segment); with `rInner > 0` it emits a donut
 * (outer circle clockwise + inner circle counterclockwise, so the hole is
 * preserved under both nonzero and evenodd fill rules).
 */
export function segmentArcPath(
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  startDeg: number,
  endDeg: number
): string {
  const sweep = endDeg - startDeg;

  if (sweep >= 360) {
    const top = { x: cx, y: cy - rOuter };
    const bottom = { x: cx, y: cy + rOuter };
    const disc = [
      `M ${fmtNum(top.x)} ${fmtNum(top.y)}`,
      `A ${fmtNum(rOuter)} ${fmtNum(rOuter)} 0 1 1 ${fmtNum(bottom.x)} ${fmtNum(bottom.y)}`,
      `A ${fmtNum(rOuter)} ${fmtNum(rOuter)} 0 1 1 ${fmtNum(top.x)} ${fmtNum(top.y)}`,
      'Z',
    ].join(' ');
    if (rInner <= 0) {
      return disc;
    }
    const iTop = { x: cx, y: cy - rInner };
    const iBottom = { x: cx, y: cy + rInner };
    const hole = [
      `M ${fmtNum(iTop.x)} ${fmtNum(iTop.y)}`,
      `A ${fmtNum(rInner)} ${fmtNum(rInner)} 0 1 0 ${fmtNum(iBottom.x)} ${fmtNum(iBottom.y)}`,
      `A ${fmtNum(rInner)} ${fmtNum(rInner)} 0 1 0 ${fmtNum(iTop.x)} ${fmtNum(iTop.y)}`,
      'Z',
    ].join(' ');
    return `${disc} ${hole}`;
  }

  const largeArc = sweep > 180 ? 1 : 0;
  const outerStart = polarPoint(cx, cy, rOuter, startDeg);
  const outerEnd = polarPoint(cx, cy, rOuter, endDeg);
  const innerEnd = polarPoint(cx, cy, rInner, endDeg);
  const innerStart = polarPoint(cx, cy, rInner, startDeg);

  return [
    `M ${fmtNum(outerStart.x)} ${fmtNum(outerStart.y)}`,
    // sweep-flag 1 = clockwise on screen (our angle direction).
    `A ${fmtNum(rOuter)} ${fmtNum(rOuter)} 0 ${largeArc} 1 ${fmtNum(outerEnd.x)} ${fmtNum(outerEnd.y)}`,
    `L ${fmtNum(innerEnd.x)} ${fmtNum(innerEnd.y)}`,
    `A ${fmtNum(rInner)} ${fmtNum(rInner)} 0 ${largeArc} 0 ${fmtNum(innerStart.x)} ${fmtNum(innerStart.y)}`,
    'Z',
  ].join(' ');
}

export type ColorScaleName = 'perfusion' | 'viability' | 'grayscale';

/**
 * Color-scale stops ordered from the MINIMUM (t = 0) to the MAXIMUM (t = 1)
 * of the value range:
 *   - `perfusion`: descending perfusion % walks green → yellow → red
 *     (100% = green/normal, 0% = red/defect);
 *   - `viability`: light → dark blues;
 *   - `grayscale`: black → white.
 */
export const COLOR_SCALES: Record<ColorScaleName, readonly string[]> = {
  perfusion: ['#da1e28', '#f1c21b', '#24a148'],
  viability: ['#edf5ff', '#78a9ff', '#0043ce', '#001d6c'],
  grayscale: ['#000000', '#ffffff'],
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** [r,g,b] (0–255) → "#rrggbb", clamped (mirrors rt-dvh's dvhChart helper). */
function rgbToHex(rgb: [number, number, number]): string {
  return (
    '#' +
    rgb
      .map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
      .join('')
  );
}

/**
 * Value → hex color on one of {@link COLOR_SCALES}, linearly interpolated
 * between stops. `value` is clamped to [min, max]; non-finite values map to
 * the minimum stop.
 */
export function colorForValue(
  value: number,
  scale: ColorScaleName,
  min = 0,
  max = 100
): string {
  const stops = COLOR_SCALES[scale] ?? COLOR_SCALES.perfusion;
  const span = max - min;
  const raw = Number.isFinite(value) && span > 0 ? (value - min) / span : 0;
  const t = Math.max(0, Math.min(1, raw));
  const segments = stops.length - 1;
  if (segments <= 0) {
    return stops[0];
  }
  const pos = t * segments;
  const i = Math.min(Math.floor(pos), segments - 1);
  const f = pos - i;
  const a = hexToRgb(stops[i]);
  const b = hexToRgb(stops[i + 1]);
  return rgbToHex([
    a[0] + (b[0] - a[0]) * f,
    a[1] + (b[1] - a[1]) * f,
    a[2] + (b[2] - a[2]) * f,
  ]);
}

/**
 * Half-open slice-index range `[startIdx, endIdx)` covered by an AHA ring in
 * a short-axis stack of `numSlices` slices.
 *
 * The apex takes the last ~10% of the stack (at least 1 slice); the remainder
 * splits into thirds basal / mid / apical. With `apexAtEnd = true` (default)
 * the stack is ordered base → apex (basal ring starts at index 0); with
 * `apexAtEnd = false` the ranges are mirrored for apex-first stacks.
 *
 * The four ranges always partition `[0, numSlices)` — contiguous, monotonic,
 * non-overlapping (individual ranges may be empty for tiny stacks).
 */
export function ringSliceRange(
  ring: AhaRing,
  numSlices: number,
  apexAtEnd = true
): [number, number] {
  const n = Math.max(0, Math.floor(numSlices));
  if (n === 0) {
    return [0, 0];
  }
  const apexCount = Math.min(n, Math.max(1, Math.round(n * 0.1)));
  const rest = n - apexCount;
  const b1 = Math.round(rest / 3);
  const b2 = Math.round((2 * rest) / 3);
  // Base-first order: basal [0,b1) → mid [b1,b2) → apical [b2,rest) → apex [rest,n).
  const spans: Record<AhaRing, [number, number]> = {
    basal: [0, b1],
    mid: [b1, b2],
    apical: [b2, rest],
    apex: [rest, n],
  };
  const [s, e] = spans[ring];
  return apexAtEnd ? [s, e] : [n - e, n - s];
}
