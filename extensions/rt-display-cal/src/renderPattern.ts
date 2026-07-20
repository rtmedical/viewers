/**
 * PatternSpec → canvas rasterization (RTV-211) — DOM glue — validated interactively against the /display-calibration route (no committed Playwright spec yet; jsdom has no canvas).
 *
 * Not unit-tested on purpose: the interesting logic (pattern geometry, gray
 * levels, counts, monotonicity) lives in tg18Patterns.ts and is unit-tested
 * there; this file only maps normalized rects to `fillRect` calls. Pixel output
 * is verified in the running app during the E2E pass of each release of this page.
 *
 * Rendering notes:
 *   - gray ∈ [0, 1] maps to 8-bit sRGB `rgb(v,v,v)` with v = round(gray·255);
 *     solid fills only, so image smoothing never applies.
 *   - Rect edges are snapped to whole device pixels so adjacent ramp bars stay
 *     contiguous (no hairline seams from fractional coordinates).
 *   - Callers should size `canvas.width/height` to DEVICE pixels (CSS size ×
 *     devicePixelRatio) for a 1:1 pixel mapping — CSS scaling of the canvas
 *     would resample the pattern and can itself introduce banding.
 */
import { PatternSpec } from './tg18Patterns';

/** Gray level [0, 1] → CSS 8-bit gray. */
function grayToCss(gray: number): string {
  const v = Math.round(Math.min(1, Math.max(0, gray)) * 255);
  return `rgb(${v},${v},${v})`;
}

/** Paints `spec` onto the canvas' full pixel area. No-op without a 2D context. */
export function renderPatternToCanvas(canvas: HTMLCanvasElement, spec: PatternSpec): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  const { width, height } = canvas;
  ctx.fillStyle = grayToCss(spec.background);
  ctx.fillRect(0, 0, width, height);
  for (const rect of spec.rects) {
    const x0 = Math.round(rect.x * width);
    const y0 = Math.round(rect.y * height);
    const x1 = Math.round((rect.x + rect.w) * width);
    const y1 = Math.round((rect.y + rect.h) * height);
    ctx.fillStyle = grayToCss(rect.gray);
    ctx.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
  }
}

export default renderPatternToCanvas;
