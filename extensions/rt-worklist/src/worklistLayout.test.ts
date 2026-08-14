import {
  ariaSort,
  CARBON_G80_SURFACES,
  CARBON_HEADER_HEIGHT_PX,
  CARBON_ROW_HEIGHT_PX,
  clampColumnWidth,
  COLUMN_MAX_WIDTH_PX,
  COLUMN_MIN_WIDTH_PX,
  emptyStateCopy,
  headerAppearance,
  nextSortState,
  resizeColumn,
  rowAppearance,
  rowsPerPage,
  sortIndicator,
  SortState,
} from './worklistLayout';

describe('Carbon measurements', () => {
  it('uses the Carbon data-table row and large-header heights', () => {
    expect(CARBON_ROW_HEIGHT_PX).toBe(40);
    expect(CARBON_HEADER_HEIGHT_PX).toBe(48);
  });
});

describe('rowAppearance', () => {
  it('stripes odd rows only, and subtly', () => {
    expect(rowAppearance({ index: 0 }).style.backgroundColor).toBe('transparent');
    expect(rowAppearance({ index: 1 }).style.backgroundColor).toBe(CARBON_G80_SURFACES.zebra);
  });

  it('fixes the row height rather than relying on padding', () => {
    // A predictable height is what makes PageUp/PageDown jump a real screenful.
    expect(rowAppearance({ index: 0 }).style.height).toBe(`${CARBON_ROW_HEIGHT_PX}px`);
  });

  it('gives a selected row the layer-02 surface and the Blue 60 accent', () => {
    const { style } = rowAppearance({ index: 0, selected: true });
    expect(style.backgroundColor).toBe(CARBON_G80_SURFACES.layer02);
    expect(style.boxShadow).toContain(CARBON_G80_SURFACES.accent);
  });

  it('draws the accent with inset box-shadow, not a border', () => {
    // border-left would shift the row content by 2px, making the table jitter as
    // the reader arrows down.
    const { style } = rowAppearance({ index: 0, selected: true });
    expect(String(style.boxShadow)).toMatch(/^inset /);
    expect(style.borderLeft).toBeUndefined();
  });

  it('lets selection win over the zebra stripe', () => {
    expect(rowAppearance({ index: 1, selected: true }).style.backgroundColor).toBe(
      CARBON_G80_SURFACES.layer02
    );
  });

  it('shows focus as a hairline, distinct from selection', () => {
    const focused = rowAppearance({ index: 0, focused: true });
    expect(focused.style.outline).toContain(CARBON_G80_SURFACES.accent);
    expect(focused.style.backgroundColor).toBe('transparent');
  });

  it('does not outline a row that is already selected', () => {
    expect(rowAppearance({ index: 0, selected: true, focused: true }).style.outline).toBeUndefined();
  });

  it('makes a group header bolder', () => {
    expect(rowAppearance({ index: 0, isGroupHeader: true }).className).toContain('font-medium');
  });

  it('disables the transition, as Carbon does for dense tables', () => {
    expect(rowAppearance({ index: 0 }).className).toContain('transition-none');
  });
});

describe('headerAppearance', () => {
  it('is sticky, 48px, on the layer-01 surface', () => {
    const { className, style } = headerAppearance();
    expect(className).toContain('sticky');
    expect(className).toContain('top-0');
    expect(style.height).toBe(`${CARBON_HEADER_HEIGHT_PX}px`);
    expect(style.backgroundColor).toBe(CARBON_G80_SURFACES.layer01);
  });
});

describe('nextSortState', () => {
  const none: SortState = { columnId: null, direction: 'asc' };

  it('starts a new column ascending', () => {
    expect(nextSortState(none, 'patient')).toEqual({ columnId: 'patient', direction: 'asc' });
  });

  it('flips the active column', () => {
    expect(nextSortState({ columnId: 'patient', direction: 'asc' }, 'patient')).toEqual({
      columnId: 'patient',
      direction: 'desc',
    });
  });

  it('clears on the third click, back to the natural order', () => {
    // Without a third state there is no way back to the default once sorted.
    expect(nextSortState({ columnId: 'patient', direction: 'desc' }, 'patient')).toEqual({
      columnId: null,
      direction: 'asc',
    });
  });

  it('switching columns starts ascending again', () => {
    expect(nextSortState({ columnId: 'patient', direction: 'desc' }, 'date')).toEqual({
      columnId: 'date',
      direction: 'asc',
    });
  });

  it('ignores an empty column id', () => {
    expect(nextSortState(none, '')).toBe(none);
  });
});

describe('sortIndicator / ariaSort', () => {
  it('marks only the active column', () => {
    const sort: SortState = { columnId: 'date', direction: 'asc' };
    expect(sortIndicator(sort, 'date')).toBe('▴');
    expect(sortIndicator(sort, 'patient')).toBe('');
  });

  it('flips the glyph with the direction', () => {
    expect(sortIndicator({ columnId: 'date', direction: 'desc' }, 'date')).toBe('▾');
  });

  it('shows nothing when the sort is cleared', () => {
    expect(sortIndicator({ columnId: null, direction: 'asc' }, 'date')).toBe('');
  });

  it('announces the sort as well as drawing it', () => {
    expect(ariaSort({ columnId: 'date', direction: 'asc' }, 'date')).toBe('ascending');
    expect(ariaSort({ columnId: 'date', direction: 'desc' }, 'date')).toBe('descending');
    expect(ariaSort({ columnId: 'date', direction: 'asc' }, 'patient')).toBe('none');
  });
});

describe('column resize', () => {
  it('clamps to the allowed range', () => {
    expect(clampColumnWidth(10)).toBe(COLUMN_MIN_WIDTH_PX);
    expect(clampColumnWidth(99999)).toBe(COLUMN_MAX_WIDTH_PX);
    expect(clampColumnWidth(200)).toBe(200);
  });

  it('rounds to whole pixels', () => {
    expect(clampColumnWidth(200.6)).toBe(201);
  });

  it('falls back to the minimum for nonsense', () => {
    expect(clampColumnWidth(NaN)).toBe(COLUMN_MIN_WIDTH_PX);
    expect(clampColumnWidth(undefined)).toBe(COLUMN_MIN_WIDTH_PX);
    expect(clampColumnWidth('wide')).toBe(COLUMN_MIN_WIDTH_PX);
  });

  it('applies a drag delta', () => {
    expect(resizeColumn(200, 50)).toBe(250);
    expect(resizeColumn(200, -50)).toBe(150);
  });

  it('clamps a drag that goes too far', () => {
    expect(resizeColumn(200, -9999)).toBe(COLUMN_MIN_WIDTH_PX);
    expect(resizeColumn(200, 9999)).toBe(COLUMN_MAX_WIDTH_PX);
  });

  it('treats a missing delta as no movement', () => {
    expect(resizeColumn(200, undefined)).toBe(200);
    expect(resizeColumn(200, NaN)).toBe(200);
  });
});

describe('rowsPerPage', () => {
  it('counts rows that fit, minus the sticky header', () => {
    // 448 - 48 header = 400 usable / 40 per row = 10.
    expect(rowsPerPage(448)).toBe(10);
  });

  it('can ignore the header', () => {
    expect(rowsPerPage(400, false)).toBe(10);
  });

  it('always pages at least one row', () => {
    expect(rowsPerPage(10)).toBe(1);
    expect(rowsPerPage(0)).toBe(1);
    expect(rowsPerPage(-5)).toBe(1);
    expect(rowsPerPage(NaN)).toBe(1);
  });
});

describe('emptyStateCopy', () => {
  it('says loading while loading', () => {
    expect(emptyStateCopy({ isLoading: true }).title).toMatch(/loading/i);
  });

  it('never dresses a failure up as emptiness', () => {
    const copy = emptyStateCopy({ hasError: true });
    expect(copy.title).toMatch(/could not be loaded/i);
    expect(copy.hint).toBeTruthy();
  });

  it('tells the reader the filters are why the list is empty', () => {
    const copy = emptyStateCopy({ hasFilters: true });
    expect(copy.title).toMatch(/filters/i);
    expect(copy.hint).toMatch(/clear/i);
  });

  it('reads as a quiet worklist when nothing is filtered', () => {
    const copy = emptyStateCopy({});
    expect(copy.title).toMatch(/no studies pending/i);
    expect(copy.hint).toBeTruthy();
  });

  it('ranks loading above error above filters', () => {
    expect(emptyStateCopy({ isLoading: true, hasError: true, hasFilters: true }).title).toMatch(
      /loading/i
    );
    expect(emptyStateCopy({ hasError: true, hasFilters: true }).title).toMatch(/not be loaded/i);
  });

  it('handles missing input', () => {
    expect(emptyStateCopy(undefined as never).title).toBeTruthy();
  });
});
