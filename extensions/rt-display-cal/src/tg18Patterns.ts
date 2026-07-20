/**
 * AAPM TG18-style display QC pattern specs (RTV-211) — pure geometry, no DOM.
 *
 * Each function returns a {@link PatternSpec}: a background gray plus rectangles
 * in NORMALIZED coordinates ({x, y, w, h} ∈ [0, 1], gray ∈ [0, 1] where 0 is
 * black and 1 is white). Rects are painted in array order (later over earlier).
 * `renderPattern.ts` is the (untested) DOM glue that rasterizes a spec onto a
 * canvas; everything about the pattern content is unit-testable here.
 *
 * These are visual-QA adaptations of the TG18 patterns (browser cannot drive a
 * photometer — see gsdf.ts scope note), following the RTV-211 spec:
 *   - TG18-QC-style composite: 50% background, 16 grayscale patches 0–100%,
 *     low-contrast corner checks and a banding ramp. Note: TG18-QC proper embeds
 *     5%-in-0% and 95%-in-100% squares; RTV-211 specifies the inverted-but-
 *     equivalent-contrast pair (5%/95% corner patches with 0%/100% inner
 *     squares), which is what the checklist asks the operator to resolve.
 *   - TG18-LN-style: the N luminance-response levels (TG18-LN12-01..18 shows
 *     one per screen for photometer measurement) composited into one grid so an
 *     operator can visually confirm all steps are distinguishable.
 *   - Full-screen luminance ramp for banding/contouring checks.
 */

export interface PatternRect {
  /** Left edge, normalized [0, 1]. */
  x: number;
  /** Top edge, normalized [0, 1]. */
  y: number;
  /** Width, normalized [0, 1]. */
  w: number;
  /** Height, normalized [0, 1]. */
  h: number;
  /** Gray level: 0 = black … 1 = white. */
  gray: number;
  /** Semantic tag (tests + tooling; renderer ignores it). */
  role?: 'patch' | 'corner' | 'corner-inner' | 'ramp';
}

export interface PatternSpec {
  /** Stable pattern id (also used by the pattern selector / E2E). */
  name: string;
  /** Full-canvas background gray, [0, 1]. */
  background: number;
  /** Rects painted in order over the background. */
  rects: PatternRect[];
}

function assertPositiveIntegerSteps(steps: number, minimum: number, label: string): void {
  if (!Number.isInteger(steps) || steps < minimum) {
    throw new RangeError(`${label} must be an integer >= ${minimum}, got ${steps}`);
  }
}

/** Grid of `count` patches with grays equally spaced 0..1, row-major. */
function patchGrid(
  count: number,
  columns: number,
  region: { x: number; y: number; w: number; h: number },
  patchFraction = 0.8
): PatternRect[] {
  const rows = Math.ceil(count / columns);
  const cellW = region.w / columns;
  const cellH = region.h / rows;
  const rects: PatternRect[] = [];
  for (let i = 0; i < count; i++) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const w = cellW * patchFraction;
    const h = cellH * patchFraction;
    rects.push({
      x: region.x + col * cellW + (cellW - w) / 2,
      y: region.y + row * cellH + (cellH - h) / 2,
      w,
      h,
      gray: i / (count - 1),
      role: 'patch',
    });
  }
  return rects;
}

/** Horizontal ramp of `steps` contiguous bars, gray 0 → 1 left to right. */
function rampRects(
  steps: number,
  region: { x: number; y: number; w: number; h: number }
): PatternRect[] {
  const rects: PatternRect[] = [];
  for (let i = 0; i < steps; i++) {
    rects.push({
      x: region.x + (region.w * i) / steps,
      y: region.y,
      w: region.w / steps,
      h: region.h,
      gray: i / (steps - 1),
      role: 'ramp',
    });
  }
  return rects;
}

/** Corner patch + centered inner square (the low-contrast visual check). */
function cornerPatch(
  x: number,
  y: number,
  size: number,
  gray: number,
  innerGray: number
): PatternRect[] {
  const innerSize = size * 0.4;
  const innerOffset = (size - innerSize) / 2;
  return [
    { x, y, w: size, h: size, gray, role: 'corner' },
    {
      x: x + innerOffset,
      y: y + innerOffset,
      w: innerSize,
      h: innerSize,
      gray: innerGray,
      role: 'corner-inner',
    },
  ];
}

/**
 * TG18-QC-style composite pattern: 50% background, 16 grayscale patches
 * (0–100% in equal steps, 4×4 grid), 5%/95% corner patches with 0%/100% inner
 * squares (diagonally paired) and a horizontal ramp strip for banding.
 */
export function tg18qcSpec(rampSteps = 256): PatternSpec {
  assertPositiveIntegerSteps(rampSteps, 2, 'rampSteps');
  const cornerSize = 0.12;
  const margin = 0.02;
  const far = 1 - margin - cornerSize;
  return {
    name: 'tg18-qc',
    background: 0.5,
    rects: [
      ...patchGrid(16, 4, { x: 0.22, y: 0.16, w: 0.56, h: 0.48 }),
      // Diagonal pairs: 5% patches (0% inner) TL/BR, 95% patches (100% inner) TR/BL.
      ...cornerPatch(margin, margin, cornerSize, 0.05, 0),
      ...cornerPatch(far, far, cornerSize, 0.05, 0),
      ...cornerPatch(far, margin, cornerSize, 0.95, 1),
      ...cornerPatch(margin, far, cornerSize, 0.95, 1),
      ...rampRects(rampSteps, { x: 0.1, y: 0.72, w: 0.8, h: 0.08 }),
    ],
  };
}

/**
 * TG18-LN-style luminance-response levels composited into one grid: `steps`
 * patches with grays equally spaced 0..1 on a 20% background (TG18-LN measures
 * one level per screen with a photometer; the grid is the visual-QA adaptation
 * — the operator confirms every step is distinguishable from its neighbours).
 */
export function tg18lnSpec(steps = 18): PatternSpec {
  assertPositiveIntegerSteps(steps, 2, 'steps');
  const columns = Math.ceil(Math.sqrt(steps * 2)); // wide grid (6 cols for 18)
  return {
    name: 'tg18-ln',
    background: 0.2,
    rects: patchGrid(steps, columns, { x: 0.1, y: 0.2, w: 0.8, h: 0.6 }),
  };
}

/**
 * Full-screen horizontal luminance ramp (`steps` contiguous bars, 0 → 1) for
 * banding/contouring inspection. With steps ≥ 256 an 8-bit pipeline shows a
 * visually continuous gradient; distinct bands indicate LUT/bit-depth trouble.
 */
export function luminanceRampSpec(steps = 256): PatternSpec {
  assertPositiveIntegerSteps(steps, 2, 'steps');
  return {
    name: 'ramp',
    background: 0,
    rects: rampRects(steps, { x: 0, y: 0, w: 1, h: 1 }),
  };
}
