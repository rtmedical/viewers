/**
 * Reference-grid SVG overlay (RTV-142).
 *
 * Splits into a **pure builder** and a thin **attach/detach**, following
 * `extensions/rt-isodose`'s SVG-overlay approach: the markup is a pure function of
 * the grid lines, so it is unit-testable without a viewport, and only the mounting
 * touches the DOM.
 *
 * The grid is drawn in **image pixel space** and mapped to the screen by a single
 * SVG transform supplied by the caller, rather than by re-projecting every line on
 * every frame. That is what keeps it cheap during pan and zoom: the transform
 * changes, the geometry does not.
 */

import { GridLine, GridLines } from './grid';

export const GRID_OVERLAY_CLASS = 'rt-reference-grid';

export interface GridSvgStyle {
  /** Minor line colour. */
  color?: string;
  /** Major line colour; defaults to `color`. */
  majorColor?: string;
  minorWidth?: number;
  majorWidth?: number;
  opacity?: number;
  /** Draw the mm label on major lines. */
  labels?: boolean;
}

const DEFAULT_STYLE: Required<Omit<GridSvgStyle, 'majorColor'>> & { majorColor: string } = {
  // Cyan reads over both bone and soft tissue without being mistaken for an
  // annotation (which the viewer draws in yellow/green).
  color: '#4589ff',
  majorColor: '#78a9ff',
  minorWidth: 0.5,
  majorWidth: 1,
  opacity: 0.6,
  labels: true,
};

function escapeAttr(value: string | number): string {
  return String(value).replace(/[<>&"']/g, ch => {
    switch (ch) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

/**
 * Builds the grid as SVG markup, in image pixel coordinates.
 *
 * Returns an empty string when there is nothing to draw, so the caller can treat
 * "no grid" and "grid with no lines" the same way.
 */
export function buildGridSvg(
  lines: GridLines,
  widthPx: number,
  heightPx: number,
  style: GridSvgStyle = {}
): string {
  const vertical = lines?.vertical ?? [];
  const horizontal = lines?.horizontal ?? [];
  if (!vertical.length && !horizontal.length) {
    return '';
  }

  const s = { ...DEFAULT_STYLE, ...style };
  const majorColor = style.majorColor ?? s.color;
  const w = Math.max(0, Number(widthPx) || 0);
  const h = Math.max(0, Number(heightPx) || 0);

  const line = (line: GridLine, x1: number, y1: number, x2: number, y2: number) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${escapeAttr(
      line.major ? majorColor : s.color
    )}" stroke-width="${line.major ? s.majorWidth : s.minorWidth}" />`;

  const parts: string[] = [];
  for (const l of vertical) {
    parts.push(line(l, l.px, 0, l.px, h));
  }
  for (const l of horizontal) {
    parts.push(line(l, 0, l.px, w, l.px));
  }

  if (s.labels) {
    // Labels only on major lines, and only the axis labels along the top/left —
    // a number at every intersection would bury the image.
    for (const l of vertical.filter(v => v.major)) {
      parts.push(
        `<text x="${l.px + 2}" y="10" fill="${escapeAttr(majorColor)}" font-size="9">${escapeAttr(
          l.mm
        )}</text>`
      );
    }
    for (const l of horizontal.filter(v => v.major && v.px > 12)) {
      parts.push(
        `<text x="2" y="${l.px - 2}" fill="${escapeAttr(majorColor)}" font-size="9">${escapeAttr(
          l.mm
        )}</text>`
      );
    }
  }

  return (
    `<g class="${GRID_OVERLAY_CLASS}" opacity="${s.opacity}" ` +
    `pointer-events="none" shape-rendering="crispEdges">${parts.join('')}</g>`
  );
}

/**
 * Wraps the grid group in a standalone `<svg>` sized to the image.
 *
 * `viewBox` in image pixels plus `preserveAspectRatio="none"` is what lets the
 * host scale the overlay with the image using CSS alone — no per-frame recompute.
 */
export function buildGridSvgDocument(
  lines: GridLines,
  widthPx: number,
  heightPx: number,
  style: GridSvgStyle = {}
): string {
  const body = buildGridSvg(lines, widthPx, heightPx, style);
  if (!body) {
    return '';
  }
  const w = Math.max(0, Number(widthPx) || 0);
  const h = Math.max(0, Number(heightPx) || 0);
  return (
    `<svg class="${GRID_OVERLAY_CLASS}-svg" xmlns="http://www.w3.org/2000/svg" ` +
    `viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" ` +
    `style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none">${body}</svg>`
  );
}

/**
 * Mounts (or replaces) the grid overlay inside a host element.
 *
 * Idempotent: mounting twice replaces rather than stacks, so a re-render cannot
 * leave two grids fighting. Returns whether anything is now drawn.
 */
export function mountGridOverlay(
  host: { querySelector: (s: string) => Element | null; insertAdjacentHTML?: (p: string, h: string) => void } | null,
  markup: string
): boolean {
  if (!host) {
    return false;
  }
  const existing = host.querySelector?.(`.${GRID_OVERLAY_CLASS}-svg`);
  existing?.remove?.();
  if (!markup) {
    return false;
  }
  host.insertAdjacentHTML?.('beforeend', markup);
  return true;
}

/** Removes the overlay. Returns true when one was there. */
export function unmountGridOverlay(host: { querySelector: (s: string) => Element | null } | null): boolean {
  const existing = host?.querySelector?.(`.${GRID_OVERLAY_CLASS}-svg`);
  if (!existing) {
    return false;
  }
  existing.remove?.();
  return true;
}
