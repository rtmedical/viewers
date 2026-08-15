/**
 * The seven fusion tools — pure core (RTV-136).
 *
 * Migration of the connectviewer `FusionTools`: SplitWindow, ChessWindow, MovingWindow,
 * FusionPan, FusionWWWC, FusionZoom and FusionRegionWWWC.
 *
 * They fall into two families, and the split is what makes them testable:
 *
 * - **Reveal tools** (split / chess / moving window) decide *where* the moving image
 *   shows through the fixed one. That is pure geometry: a viewport size and a handle
 *   position in, a set of rectangles out. The renderer turns them into a clip path or a
 *   mask; nothing here knows about canvases.
 * - **Transform tools** (pan / zoom / window-level / region window-level) change *how*
 *   the moving layer is drawn. That is pure arithmetic on a small state object.
 *
 * Every tool applies to the **moving** layer only. Panning the fixed image would
 * silently destroy the registration the reader is checking, which is the one thing a
 * fusion tool must never do.
 *
 * Framework-free. Zero-fork per RTV-114.
 */

export type FusionToolId =
  | 'split'
  | 'chess'
  | 'movingWindow'
  | 'pan'
  | 'zoom'
  | 'windowLevel'
  | 'regionWindowLevel';

export const FUSION_TOOLS: FusionToolId[] = [
  'split',
  'chess',
  'movingWindow',
  'pan',
  'zoom',
  'windowLevel',
  'regionWindowLevel',
];

export const FUSION_TOOL_LABELS: Record<FusionToolId, string> = {
  split: 'Split window',
  chess: 'Chess window',
  movingWindow: 'Moving window',
  pan: 'Pan (moving)',
  zoom: 'Zoom (moving)',
  windowLevel: 'Window/level (moving)',
  regionWindowLevel: 'Region window/level (moving)',
};

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const finite = (value: unknown, fallback = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const clamp01 = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 0.5;
  }
  return n < 0 ? 0 : n > 1 ? 1 : n;
};

function normalizeSize(size: Size | undefined): Size {
  const width = Math.max(0, Math.floor(finite(size?.width)));
  const height = Math.max(0, Math.floor(finite(size?.height)));
  return { width, height };
}

// --- Reveal tools ----------------------------------------------------------

export type SplitOrientation = 'vertical' | 'horizontal';

/**
 * Where the moving image shows through, for a split window.
 *
 * `position` is a fraction of the viewport, so the divider survives a resize — storing
 * it in pixels means the split jumps whenever the panel layout changes.
 *
 * Returns the region for the **moving** layer; the fixed layer is everything else, so
 * the renderer only ever needs one clip.
 */
export function splitRegion(
  size: Size,
  position = 0.5,
  orientation: SplitOrientation = 'vertical'
): Rect[] {
  const { width, height } = normalizeSize(size);
  if (!width || !height) {
    return [];
  }
  const fraction = clamp01(position);

  if (orientation === 'horizontal') {
    const y = Math.round(height * fraction);
    // A degenerate band is dropped rather than emitted as a zero-height rect, which
    // some clip implementations render as "everything".
    return height - y > 0 ? [{ x: 0, y, width, height: height - y }] : [];
  }
  const x = Math.round(width * fraction);
  return width - x > 0 ? [{ x, y: 0, width: width - x, height }] : [];
}

export const CHESS_TILE_MIN = 8;
export const CHESS_TILE_MAX = 256;
export const CHESS_TILE_DEFAULT = 32;

export function clampChessTile(tile: unknown): number {
  const n = Math.round(finite(tile, CHESS_TILE_DEFAULT));
  return Math.min(CHESS_TILE_MAX, Math.max(CHESS_TILE_MIN, n));
}

/**
 * Checkerboard tiles that show the moving image.
 *
 * The alternating pattern is what makes a misregistration obvious: a structure that
 * steps at every tile boundary is misaligned, and the eye catches that far faster than
 * it catches a blend being slightly soft.
 *
 * Only the "on" tiles are returned, and edge tiles are clipped to the viewport so the
 * pattern does not spill.
 */
export function chessRegions(size: Size, tile: number = CHESS_TILE_DEFAULT): Rect[] {
  const { width, height } = normalizeSize(size);
  const step = clampChessTile(tile);
  if (!width || !height) {
    return [];
  }

  const rects: Rect[] = [];
  const cols = Math.ceil(width / step);
  const rows = Math.ceil(height / step);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if ((row + col) % 2 !== 0) {
        continue;
      }
      const x = col * step;
      const y = row * step;
      rects.push({
        x,
        y,
        width: Math.min(step, width - x),
        height: Math.min(step, height - y),
      });
    }
  }
  return rects;
}

export const MOVING_WINDOW_MIN_PX = 24;

/**
 * The lens rectangle for the moving-window tool, clamped inside the viewport.
 *
 * `centre` is in fractions of the viewport for the same reason the split position is;
 * the size is in pixels, because a lens is a physical thing the reader sizes to the
 * structure they are checking, not a proportion of the panel.
 *
 * The lens is clamped rather than allowed to hang off the edge: half a lens over the
 * border reads as a rendering bug, and the reader loses the reference frame that makes
 * the comparison work.
 */
export function movingWindowRegion(
  size: Size,
  centre: { x: number; y: number } = { x: 0.5, y: 0.5 },
  lens: Size = { width: 200, height: 200 }
): Rect[] {
  const { width, height } = normalizeSize(size);
  if (!width || !height) {
    return [];
  }

  const lensWidth = Math.min(width, Math.max(MOVING_WINDOW_MIN_PX, Math.round(finite(lens?.width, 200))));
  const lensHeight = Math.min(
    height,
    Math.max(MOVING_WINDOW_MIN_PX, Math.round(finite(lens?.height, 200)))
  );

  const cx = clamp01(centre?.x) * width;
  const cy = clamp01(centre?.y) * height;

  const x = Math.round(Math.min(width - lensWidth, Math.max(0, cx - lensWidth / 2)));
  const y = Math.round(Math.min(height - lensHeight, Math.max(0, cy - lensHeight / 2)));

  return [{ x, y, width: lensWidth, height: lensHeight }];
}

// --- Transform tools -------------------------------------------------------

export interface MovingLayerTransform {
  /** Offset in viewport pixels. */
  offsetX: number;
  offsetY: number;
  scale: number;
  windowWidth: number;
  windowCenter: number;
}

export const FUSION_SCALE_MIN = 0.1;
export const FUSION_SCALE_MAX = 10;

export function defaultMovingTransform(): MovingLayerTransform {
  return { offsetX: 0, offsetY: 0, scale: 1, windowWidth: 400, windowCenter: 40 };
}

/** Pans the moving layer. The fixed layer never moves — see the module note. */
export function panMoving(
  transform: MovingLayerTransform,
  deltaX: unknown,
  deltaY: unknown
): MovingLayerTransform {
  return {
    ...transform,
    offsetX: finite(transform?.offsetX) + finite(deltaX),
    offsetY: finite(transform?.offsetY) + finite(deltaY),
  };
}

/**
 * Zooms the moving layer about a viewport point.
 *
 * Zooming about the cursor rather than the viewport centre is what keeps the structure
 * under the pointer from sliding away; anchoring at the centre makes the reader chase
 * the anatomy with pan after every wheel click.
 */
export function zoomMovingAbout(
  transform: MovingLayerTransform,
  factor: unknown,
  anchor: { x: number; y: number } = { x: 0, y: 0 }
): MovingLayerTransform {
  const current = finite(transform?.scale, 1) || 1;
  const requested = finite(factor, 1);
  const next = Math.min(FUSION_SCALE_MAX, Math.max(FUSION_SCALE_MIN, current * (requested || 1)));
  const ratio = next / current;

  const ax = finite(anchor?.x);
  const ay = finite(anchor?.y);
  const offsetX = finite(transform?.offsetX);
  const offsetY = finite(transform?.offsetY);

  return {
    ...transform,
    scale: next,
    // Keep the anchor point fixed: p_screen stays put while the layer scales around it.
    offsetX: ax - (ax - offsetX) * ratio,
    offsetY: ay - (ay - offsetY) * ratio,
  };
}

export const FUSION_WINDOW_MIN = 1;

/**
 * Adjusts the moving layer's window/level from a drag.
 *
 * Horizontal drag changes width, vertical changes centre — the convention every
 * radiology viewer uses, so muscle memory carries over. Width is floored at 1 because a
 * zero-width window divides by zero in every renderer downstream.
 */
export function windowLevelMoving(
  transform: MovingLayerTransform,
  deltaX: unknown,
  deltaY: unknown
): MovingLayerTransform {
  const windowWidth = Math.max(FUSION_WINDOW_MIN, finite(transform?.windowWidth, 400) + finite(deltaX));
  const windowCenter = finite(transform?.windowCenter, 40) + finite(deltaY);
  return { ...transform, windowWidth, windowCenter };
}

export interface RegionStats {
  min: number;
  max: number;
  count: number;
}

/** Min/max over the samples inside a region, ignoring non-finite values. */
export function regionStats(samples: ArrayLike<number> | undefined): RegionStats {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let count = 0;
  for (let i = 0; i < (samples?.length ?? 0); i++) {
    const value = samples![i];
    if (!Number.isFinite(value)) {
      continue;
    }
    if (value < min) {
      min = value;
    }
    if (value > max) {
      max = value;
    }
    count += 1;
  }
  return count ? { min, max, count } : { min: 0, max: 0, count: 0 };
}

/**
 * Window/level that fits the samples inside a dragged region (FusionRegionWWWC).
 *
 * Returns the transform unchanged when the region is empty or flat: a flat region would
 * produce a zero-width window, and "the reader dragged over background" should leave
 * the display alone rather than blanking it.
 */
export function regionWindowLevelMoving(
  transform: MovingLayerTransform,
  samples: ArrayLike<number> | undefined
): MovingLayerTransform {
  const stats = regionStats(samples);
  if (!stats.count || stats.max <= stats.min) {
    return transform;
  }
  return {
    ...transform,
    windowWidth: Math.max(FUSION_WINDOW_MIN, stats.max - stats.min),
    windowCenter: (stats.max + stats.min) / 2,
  };
}

// --- Tool state ------------------------------------------------------------

export interface FusionToolState {
  active: FusionToolId | null;
  splitPosition: number;
  splitOrientation: SplitOrientation;
  chessTile: number;
  lensCentre: { x: number; y: number };
  lensSize: Size;
  transform: MovingLayerTransform;
}

export function defaultFusionToolState(): FusionToolState {
  return {
    active: null,
    splitPosition: 0.5,
    splitOrientation: 'vertical',
    chessTile: CHESS_TILE_DEFAULT,
    lensCentre: { x: 0.5, y: 0.5 },
    lensSize: { width: 200, height: 200 },
    transform: defaultMovingTransform(),
  };
}

/** Selecting the active tool. Re-selecting the active one turns it off. */
export function selectTool(state: FusionToolState, tool: unknown): FusionToolState {
  const id = FUSION_TOOLS.includes(tool as FusionToolId) ? (tool as FusionToolId) : null;
  if (!id) {
    return state;
  }
  return { ...state, active: state.active === id ? null : id };
}

/**
 * The regions where the moving layer shows through, for the current state.
 *
 * An empty array means "no reveal mask" — the transform tools do not clip, so the
 * moving layer is drawn whole and the blend mode does the rest.
 */
export function revealRegions(state: FusionToolState, size: Size): Rect[] {
  switch (state?.active) {
    case 'split':
      return splitRegion(size, state.splitPosition, state.splitOrientation);
    case 'chess':
      return chessRegions(size, state.chessTile);
    case 'movingWindow':
      return movingWindowRegion(size, state.lensCentre, state.lensSize);
    default:
      return [];
  }
}

/** An SVG clip-path `d` for the reveal regions, or empty when there is no mask. */
export function regionsToClipPath(regions: Rect[]): string {
  return (regions ?? [])
    .filter(r => r && r.width > 0 && r.height > 0)
    .map(r => `M${r.x},${r.y}h${r.width}v${r.height}h${-r.width}Z`)
    .join('');
}
