/**
 * Reference grid — pure core (RTV-142).
 *
 * Migrates the legacy connectviewer `DrawGridTool` + `MoveGridTool` + `grid_tool`
 * Redux store. A reference grid over the image is how an RT physicist eyeballs
 * distances and checks field placement without measuring: a 10 mm lattice anchored
 * somewhere meaningful, draggable to line up with a landmark.
 *
 * Spacing is in **millimetres**, not pixels. That is the whole point — a grid in
 * pixels tells you nothing about the patient, and changes meaning with zoom and
 * with each series' pixel spacing. Millimetres survive both.
 *
 * Framework-free and `@ohif/*`-free, like the other `rt-*` cores. Zero-fork per
 * RTV-114.
 */

/** Grid spacing bounds, in mm. */
export const GRID_SPACING_MM_MIN = 1;
export const GRID_SPACING_MM_MAX = 200;
export const GRID_SPACING_MM_DEFAULT = 10;
/** Step applied by the toolbar +/- buttons. */
export const GRID_SPACING_MM_STEP = 5;

/** Every Nth line is drawn heavier. 0 disables major lines. */
export const GRID_MAJOR_EVERY_DEFAULT = 5;

/**
 * Hard cap on how many lines are generated per axis.
 *
 * A 1 mm grid over a 500 mm field is 500 lines per axis — 1000 primitives redrawn
 * on every pan, zoom and scroll. The cap keeps a mis-set spacing from turning into
 * a frozen viewport, and {@link buildGridLines} reports when it bites so the UI can
 * say so instead of quietly drawing a wrong grid.
 */
export const GRID_MAX_LINES_PER_AXIS = 200;

export interface GridOffsetMm {
  x: number;
  y: number;
}

export interface GridState {
  visible: boolean;
  spacingMm: number;
  /** Grid origin offset from the image origin, in mm. */
  offsetMm: GridOffsetMm;
  majorEvery: number;
}

export function defaultGridState(): GridState {
  return {
    visible: false,
    spacingMm: GRID_SPACING_MM_DEFAULT,
    offsetMm: { x: 0, y: 0 },
    majorEvery: GRID_MAJOR_EVERY_DEFAULT,
  };
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** Clamps a spacing to [1, 200] mm, rounded to 0.1 mm. */
export function clampSpacingMm(mm: unknown): number {
  const value = Number(mm);
  if (!Number.isFinite(value)) {
    return GRID_SPACING_MM_DEFAULT;
  }
  return round1(Math.min(GRID_SPACING_MM_MAX, Math.max(GRID_SPACING_MM_MIN, value)));
}

/**
 * New spacing after a +/- step. An invalid delta falls back to +step, matching
 * `rtmedical-theme`'s slab stepping so the two toolbars behave the same way.
 */
export function adjustSpacingMm(currentMm: unknown, deltaMm: unknown): number {
  const delta =
    Number.isFinite(Number(deltaMm)) && Number(deltaMm) !== 0
      ? Number(deltaMm)
      : GRID_SPACING_MM_STEP;
  const base = Number.isFinite(Number(currentMm))
    ? Number(currentMm)
    : GRID_SPACING_MM_DEFAULT;
  return clampSpacingMm(base + delta);
}

/**
 * Normalises an offset into one grid cell.
 *
 * Offsetting by 10 mm on a 10 mm grid is the same grid, so the stored offset is
 * always reduced modulo the spacing. Without this, dragging the grid across the
 * image accumulates an ever-growing offset that eventually loses precision and
 * makes "reset" the only way back.
 */
export function normalizeOffsetMm(offsetMm: GridOffsetMm, spacingMm: number): GridOffsetMm {
  const spacing = clampSpacingMm(spacingMm);
  const wrap = (value: unknown) => {
    const v = Number(value);
    if (!Number.isFinite(v)) {
      return 0;
    }
    // Positive modulo, so an offset of -1 mm on a 10 mm grid reads as 9 mm.
    return round1(((v % spacing) + spacing) % spacing);
  };
  return { x: wrap(offsetMm?.x), y: wrap(offsetMm?.y) };
}

/** Moves the grid by a delta in mm (the MoveGridTool drag). */
export function moveGridMm(state: GridState, deltaXMm: unknown, deltaYMm: unknown): GridState {
  const dx = Number.isFinite(Number(deltaXMm)) ? Number(deltaXMm) : 0;
  const dy = Number.isFinite(Number(deltaYMm)) ? Number(deltaYMm) : 0;
  return {
    ...state,
    offsetMm: normalizeOffsetMm(
      { x: (state.offsetMm?.x ?? 0) + dx, y: (state.offsetMm?.y ?? 0) + dy },
      state.spacingMm
    ),
  };
}

/** Puts the grid origin back on the image origin. */
export function resetGridOffset(state: GridState): GridState {
  return { ...state, offsetMm: { x: 0, y: 0 } };
}

export function toggleGrid(state: GridState): GridState {
  return { ...state, visible: !state.visible };
}

export interface GridLine {
  /** Position in image pixels along the axis. */
  px: number;
  /** Distance from the grid origin in mm — for a label. */
  mm: number;
  /** Drawn heavier. */
  major: boolean;
}

export interface GridLines {
  vertical: GridLine[];
  horizontal: GridLine[];
  /** Spacing actually used, in px, per axis. */
  spacingPx: { x: number; y: number };
  /**
   * True when the line cap bit and the grid shown is coarser than requested.
   * The UI must surface this rather than draw a grid that lies about its spacing.
   */
  truncated: boolean;
}

export interface BuildGridLinesInput {
  /** Image size in pixels. */
  widthPx: number;
  heightPx: number;
  /**
   * DICOM PixelSpacing as [rowSpacing, colSpacing] in mm — row spacing governs
   * the vertical axis, column spacing the horizontal one. Omit for a pixel grid.
   */
  pixelSpacingMm?: [number, number] | number;
  spacingMm: number;
  offsetMm?: GridOffsetMm;
  majorEvery?: number;
}

/** Resolves PixelSpacing into per-axis mm-per-pixel, or null when unknown. */
export function resolvePixelSpacing(
  pixelSpacingMm?: [number, number] | number
): { row: number; col: number } | null {
  if (Array.isArray(pixelSpacingMm)) {
    const [row, col] = pixelSpacingMm.map(Number);
    return Number.isFinite(row) && Number.isFinite(col) && row > 0 && col > 0
      ? { row, col }
      : null;
  }
  const square = Number(pixelSpacingMm);
  return Number.isFinite(square) && square > 0 ? { row: square, col: square } : null;
}

/**
 * Generates the grid lines for an image.
 *
 * When PixelSpacing is absent the grid falls back to treating `spacingMm` as
 * **pixels** — a calibrated grid is impossible without it, and silently drawing an
 * uncalibrated grid labelled in mm would be worse than an honest pixel grid. The
 * caller can detect the fallback with {@link resolvePixelSpacing}.
 */
export function buildGridLines(input: BuildGridLinesInput): GridLines {
  const widthPx = Math.max(0, Math.floor(Number(input?.widthPx) || 0));
  const heightPx = Math.max(0, Math.floor(Number(input?.heightPx) || 0));
  const spacingMm = clampSpacingMm(input?.spacingMm);
  const majorEvery = Math.max(0, Math.floor(Number(input?.majorEvery ?? 0)));
  const spacing = resolvePixelSpacing(input?.pixelSpacingMm);

  // mm per pixel per axis; 1 means "spacingMm is really pixels".
  const mmPerPxX = spacing ? spacing.col : 1;
  const mmPerPxY = spacing ? spacing.row : 1;

  const rawSpacingPxX = spacingMm / mmPerPxX;
  const rawSpacingPxY = spacingMm / mmPerPxY;

  const empty: GridLines = {
    vertical: [],
    horizontal: [],
    spacingPx: { x: rawSpacingPxX, y: rawSpacingPxY },
    truncated: false,
  };
  if (!widthPx || !heightPx || !(rawSpacingPxX > 0) || !(rawSpacingPxY > 0)) {
    return empty;
  }

  // Coarsen rather than truncate: skipping every Nth line would draw a grid whose
  // visible spacing is a lie. Multiplying the step keeps it honest.
  const neededX = Math.floor(widthPx / rawSpacingPxX) + 1;
  const neededY = Math.floor(heightPx / rawSpacingPxY) + 1;
  const factor = Math.max(
    1,
    Math.ceil(neededX / GRID_MAX_LINES_PER_AXIS),
    Math.ceil(neededY / GRID_MAX_LINES_PER_AXIS)
  );
  const truncated = factor > 1;

  const stepPxX = rawSpacingPxX * factor;
  const stepPxY = rawSpacingPxY * factor;
  const stepMm = spacingMm * factor;

  const offset = normalizeOffsetMm(input?.offsetMm ?? { x: 0, y: 0 }, spacingMm);
  const offsetPxX = offset.x / mmPerPxX;
  const offsetPxY = offset.y / mmPerPxY;

  const axis = (lengthPx: number, stepPx: number, startPx: number): GridLine[] => {
    const lines: GridLine[] = [];
    // Start at the first gridline at or after 0, then walk to the far edge.
    let index = 0;
    let px = startPx;
    while (px < 0) {
      px += stepPx;
      index += 1;
    }
    while (px <= lengthPx && lines.length < GRID_MAX_LINES_PER_AXIS) {
      lines.push({
        px: round1(px),
        mm: round1(index * stepMm),
        major: majorEvery > 0 && index % majorEvery === 0,
      });
      index += 1;
      px += stepPx;
    }
    return lines;
  };

  return {
    vertical: axis(widthPx, stepPxX, offsetPxX),
    horizontal: axis(heightPx, stepPxY, offsetPxY),
    spacingPx: { x: stepPxX, y: stepPxY },
    truncated,
  };
}

/** One-line summary for the toolbar tooltip / toast. */
export function describeGrid(state: GridState, calibrated = true): string {
  if (!state?.visible) {
    return 'Grid off';
  }
  const unit = calibrated ? 'mm' : 'px (uncalibrated)';
  const offset =
    state.offsetMm.x || state.offsetMm.y
      ? ` · offset ${state.offsetMm.x}/${state.offsetMm.y} mm`
      : '';
  return `Grid ${state.spacingMm} ${unit}${offset}`;
}

// --- Persistence -----------------------------------------------------------

export const GRID_STORAGE_KEY = 'rt.referenceGrid.v1';
export const GRID_SCHEMA_VERSION = 1;

export function serializeGrid(state: GridState): string {
  return JSON.stringify({ version: GRID_SCHEMA_VERSION, ...state });
}

/**
 * Restores the grid settings, falling back to the default for anything odd.
 * Same posture as the study-tabs session: localStorage is shared, survives
 * upgrades and can be hand-edited, so nothing from it is trusted.
 */
export function deserializeGrid(raw: unknown): GridState {
  if (typeof raw !== 'string' || !raw) {
    return defaultGridState();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaultGridState();
  }
  if (!parsed || typeof parsed !== 'object') {
    return defaultGridState();
  }
  const shape = parsed as Partial<GridState> & { version?: number };
  if (shape.version !== GRID_SCHEMA_VERSION) {
    return defaultGridState();
  }
  const spacingMm = clampSpacingMm(shape.spacingMm);
  return {
    visible: shape.visible === true,
    spacingMm,
    offsetMm: normalizeOffsetMm(shape.offsetMm ?? { x: 0, y: 0 }, spacingMm),
    majorEvery: Number.isFinite(Number(shape.majorEvery))
      ? Math.max(0, Math.floor(Number(shape.majorEvery)))
      : GRID_MAJOR_EVERY_DEFAULT,
  };
}
