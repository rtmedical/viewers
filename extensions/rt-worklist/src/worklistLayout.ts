/**
 * Carbon G80 layout for the worklist — pure core (RTV-192).
 *
 * The worklist is the most-used screen in the system, so it has to be dense,
 * consistent with the rest of the viewer, and legible. This module owns the
 * measurements and the state→appearance rules; the page only spreads the results
 * onto elements.
 *
 * ## Token provenance
 *
 * The colours are the Carbon Gray 80 surfaces that RTV-181 already established in
 * `extensions/rtmedical-theme/src/whiteLabeling/carbonTheme.ts`. They are restated
 * here as literals rather than imported: the `rt-*` extension cores in this repo
 * are self-contained (see `extensions/rt-plan/README.md`), and `rt-worklist`
 * pulling in `rtmedical-theme` for four hex values would couple two extensions for
 * no gain. {@link CARBON_G80_SURFACES} is the single place to change them.
 *
 * Framework-free and unit-tested. Zero-fork per RTV-114.
 */

/** Carbon G80 surface ramp, as used by the viewer chrome (RTV-181). */
export const CARBON_G80_SURFACES = {
  /** Page background. */
  background: '#161616',
  /** Header, toolbar. */
  layer01: '#393939',
  /** Selected row, raised surface. */
  layer02: '#525252',
  /** Row hover. */
  layerHover01: '#474747',
  /** Zebra stripe — deliberately very close to the background. */
  zebra: '#2e2e2e',
  /** Subtle divider. */
  borderSubtle: '#525252',
  /** Blue 60 — the selection accent. */
  accent: '#0f62fe',
  /** Red 50 — overdue / emergency. */
  danger: '#fa4d56',
} as const;

/**
 * Carbon row/header heights, in pixels.
 *
 * 40 px is Carbon's standard data-table row and 48 px its large header. They are
 * fixed numbers, not padding, because a *predictable* row height is what makes
 * PageUp/PageDown jump a real screenful and lets a virtualised list compute
 * offsets — see `rowsPerPage`.
 */
export const CARBON_HEADER_HEIGHT_PX = 48;
export const CARBON_ROW_HEIGHT_PX = 40;

/** Column width bounds for drag-to-resize. */
export const COLUMN_MIN_WIDTH_PX = 64;
export const COLUMN_MAX_WIDTH_PX = 640;

export interface RowStateInput {
  /** Position in the visible list, for the zebra stripe. */
  index: number;
  selected?: boolean;
  /** Keyboard focus, which is distinct from selection. */
  focused?: boolean;
  /** Patient rows read as a group heading, not as data. */
  isGroupHeader?: boolean;
}

export interface RowAppearance {
  className: string;
  style: Record<string, string | number>;
}

/**
 * Appearance for a worklist row.
 *
 * Selection wins over hover, and the 2 px Blue 60 left border is drawn with
 * `box-shadow: inset` rather than `border-left` so that selecting a row does not
 * shift its content by 2 px — a whole table jittering as the reader arrows down
 * is the classic version of this bug.
 */
export function rowAppearance(input: RowStateInput): RowAppearance {
  const { index, selected, focused, isGroupHeader } = input ?? { index: 0 };
  const classes = [
    'flex items-center',
    // Carbon transitions rows instantly; a fade makes a dense table feel laggy.
    'transition-none',
    'cursor-pointer',
    selected ? 'text-white' : 'text-white/80',
    isGroupHeader ? 'font-medium' : '',
  ].filter(Boolean);

  const style: Record<string, string | number> = {
    height: `${CARBON_ROW_HEIGHT_PX}px`,
    backgroundColor: selected
      ? CARBON_G80_SURFACES.layer02
      : index % 2 === 1
        ? CARBON_G80_SURFACES.zebra
        : 'transparent',
  };

  if (selected) {
    style.boxShadow = `inset 2px 0 0 0 ${CARBON_G80_SURFACES.accent}`;
  }
  if (focused && !selected) {
    // Focus must be visible without looking selected: a hairline, not a fill.
    style.outline = `1px solid ${CARBON_G80_SURFACES.accent}`;
    style.outlineOffset = '-1px';
  }

  return { className: classes.join(' '), style };
}

/** Sticky column-header appearance. */
export function headerAppearance(): RowAppearance {
  return {
    className: 'sticky top-0 z-10 flex items-center text-xs uppercase tracking-wide text-white/60',
    style: {
      height: `${CARBON_HEADER_HEIGHT_PX}px`,
      backgroundColor: CARBON_G80_SURFACES.layer01,
      borderBottom: `1px solid ${CARBON_G80_SURFACES.borderSubtle}`,
    },
  };
}

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  columnId: string | null;
  direction: SortDirection;
}

/**
 * Next sort state when a column header is clicked.
 *
 * Clicking a new column starts ascending; clicking the active column flips it;
 * clicking a third time **clears** the sort and returns to the natural order.
 * The third state matters — without it there is no way back to the default once
 * you have sorted, which readers notice immediately.
 */
export function nextSortState(current: SortState, columnId: string): SortState {
  if (!columnId) {
    return current;
  }
  if (current?.columnId !== columnId) {
    return { columnId, direction: 'asc' };
  }
  return current.direction === 'asc'
    ? { columnId, direction: 'desc' }
    : { columnId: null, direction: 'asc' };
}

/**
 * Carbon sort glyph — only ever on the active column.
 * An indicator on every column is noise and hides which one is actually sorted.
 */
export function sortIndicator(sort: SortState, columnId: string): '▴' | '▾' | '' {
  if (!sort || sort.columnId !== columnId) {
    return '';
  }
  return sort.direction === 'asc' ? '▴' : '▾';
}

/** `aria-sort` for the header cell, so the sort is announced, not just drawn. */
export function ariaSort(sort: SortState, columnId: string): 'ascending' | 'descending' | 'none' {
  if (!sort || sort.columnId !== columnId) {
    return 'none';
  }
  return sort.direction === 'asc' ? 'ascending' : 'descending';
}

/** Clamps a dragged column width. */
export function clampColumnWidth(width: unknown): number {
  const value = Number(width);
  if (!Number.isFinite(value)) {
    return COLUMN_MIN_WIDTH_PX;
  }
  return Math.min(COLUMN_MAX_WIDTH_PX, Math.max(COLUMN_MIN_WIDTH_PX, Math.round(value)));
}

/** Width after dragging a resize handle by `deltaX`. */
export function resizeColumn(startWidth: unknown, deltaX: unknown): number {
  const start = Number.isFinite(Number(startWidth)) ? Number(startWidth) : COLUMN_MIN_WIDTH_PX;
  const delta = Number.isFinite(Number(deltaX)) ? Number(deltaX) : 0;
  return clampColumnWidth(start + delta);
}

/**
 * How many rows fit in `viewportHeightPx`, for PageUp/PageDown.
 *
 * At least 1, so a short window still pages. The sticky header is subtracted
 * because it covers rows that would otherwise be counted as reachable.
 */
export function rowsPerPage(viewportHeightPx: unknown, includeHeader = true): number {
  const height = Number(viewportHeightPx);
  if (!Number.isFinite(height) || height <= 0) {
    return 1;
  }
  const usable = includeHeader ? height - CARBON_HEADER_HEIGHT_PX : height;
  return Math.max(1, Math.floor(usable / CARBON_ROW_HEIGHT_PX));
}

export interface EmptyStateCopy {
  title: string;
  hint?: string;
}

/**
 * Contextual empty-state copy.
 *
 * "Nenhum estudo encontrado" when filters are active is a dead end; the reader
 * needs to know *why* the list is empty and what to do. So a filtered empty list
 * says so and offers to clear, an unfiltered one reads as a genuinely quiet
 * worklist, and a failure is never dressed up as emptiness.
 */
export function emptyStateCopy(input: {
  hasFilters?: boolean;
  hasError?: boolean;
  isLoading?: boolean;
}): EmptyStateCopy {
  if (input?.isLoading) {
    return { title: 'Loading studies…' };
  }
  if (input?.hasError) {
    return {
      title: 'The study list could not be loaded.',
      hint: 'Check the PACS connection and try again.',
    };
  }
  if (input?.hasFilters) {
    return {
      title: 'No studies match the current filters.',
      hint: 'Clear the filters to see the full worklist.',
    };
  }
  return { title: 'No studies pending.', hint: 'New studies appear here as they arrive.' };
}
