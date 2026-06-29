/**
 * Pure **print layout geometry** for the RT Print panel (RTV-140).
 *
 * Framework-free and `@ohif/*`-free: computes paper dimensions and grid-zone
 * rectangles (in mm) for A3/A4/A5 × portrait/landscape × 1×1 / 2×2 / 3×3, with
 * configurable padding and gap. Unit-tested in isolation; the panel renders a
 * scaled preview from this and the @media-print CSS uses the same model.
 */

export type PaperSize = 'A3' | 'A4' | 'A5';
export type Orientation = 'portrait' | 'landscape';
export type GridPreset = '1x1' | '2x2' | '3x3';

/** Portrait paper dimensions in millimetres (width × height). */
export const PAPER_SIZES_MM: Record<PaperSize, { width: number; height: number }> = {
  A3: { width: 297, height: 420 },
  A4: { width: 210, height: 297 },
  A5: { width: 148, height: 210 },
};

export const GRID_PRESETS: Record<GridPreset, { rows: number; cols: number }> = {
  '1x1': { rows: 1, cols: 1 },
  '2x2': { rows: 2, cols: 2 },
  '3x3': { rows: 3, cols: 3 },
};

export interface PrintZone {
  index: number;
  row: number;
  col: number;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

export interface PrintLayoutConfig {
  paper?: PaperSize;
  orientation?: Orientation;
  grid?: GridPreset;
  /** Page margin in mm (default 10). */
  paddingMm?: number;
  /** Gap between zones in mm (default 5). */
  gapMm?: number;
}

export interface PrintLayout {
  paper: PaperSize;
  orientation: Orientation;
  grid: GridPreset;
  pageWidthMm: number;
  pageHeightMm: number;
  paddingMm: number;
  gapMm: number;
  zones: PrintZone[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Compute the page size and grid-zone rectangles (mm) for a print config. */
export function computePrintLayout(config: PrintLayoutConfig = {}): PrintLayout {
  const paper: PaperSize = config.paper ?? 'A4';
  const orientation: Orientation = config.orientation ?? 'portrait';
  const grid: GridPreset = config.grid ?? '2x2';
  const paddingMm = config.paddingMm ?? 10;
  const gapMm = config.gapMm ?? 5;

  const base = PAPER_SIZES_MM[paper];
  const pageWidthMm = orientation === 'landscape' ? base.height : base.width;
  const pageHeightMm = orientation === 'landscape' ? base.width : base.height;

  const { rows, cols } = GRID_PRESETS[grid];
  const usableW = pageWidthMm - 2 * paddingMm;
  const usableH = pageHeightMm - 2 * paddingMm;
  const cellW = (usableW - (cols - 1) * gapMm) / cols;
  const cellH = (usableH - (rows - 1) * gapMm) / rows;

  const zones: PrintZone[] = [];
  let index = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      zones.push({
        index: index++,
        row,
        col,
        xMm: round2(paddingMm + col * (cellW + gapMm)),
        yMm: round2(paddingMm + row * (cellH + gapMm)),
        widthMm: round2(cellW),
        heightMm: round2(cellH),
      });
    }
  }

  return {
    paper,
    orientation,
    grid,
    pageWidthMm,
    pageHeightMm,
    paddingMm,
    gapMm,
    zones,
  };
}

/** Number of zones for a grid preset. */
export function zoneCount(grid: GridPreset): number {
  const { rows, cols } = GRID_PRESETS[grid];
  return rows * cols;
}

export default computePrintLayout;
