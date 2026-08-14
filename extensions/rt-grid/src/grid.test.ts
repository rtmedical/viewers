import {
  adjustSpacingMm,
  buildGridLines,
  clampSpacingMm,
  defaultGridState,
  describeGrid,
  deserializeGrid,
  GRID_MAX_LINES_PER_AXIS,
  GRID_SCHEMA_VERSION,
  GRID_SPACING_MM_DEFAULT,
  GRID_SPACING_MM_MAX,
  GRID_SPACING_MM_MIN,
  GRID_SPACING_MM_STEP,
  moveGridMm,
  normalizeOffsetMm,
  resetGridOffset,
  resolvePixelSpacing,
  serializeGrid,
  toggleGrid,
} from './grid';

describe('clampSpacingMm', () => {
  it('clamps to the allowed range', () => {
    expect(clampSpacingMm(0)).toBe(GRID_SPACING_MM_MIN);
    expect(clampSpacingMm(9999)).toBe(GRID_SPACING_MM_MAX);
    expect(clampSpacingMm(25)).toBe(25);
  });

  it('rounds to 0.1 mm', () => {
    expect(clampSpacingMm(10.04)).toBe(10);
    expect(clampSpacingMm(10.06)).toBe(10.1);
  });

  it('falls back to the default for nonsense', () => {
    expect(clampSpacingMm(NaN)).toBe(GRID_SPACING_MM_DEFAULT);
    expect(clampSpacingMm(undefined)).toBe(GRID_SPACING_MM_DEFAULT);
    expect(clampSpacingMm('wide')).toBe(GRID_SPACING_MM_DEFAULT);
  });
});

describe('adjustSpacingMm', () => {
  it('steps up and down', () => {
    expect(adjustSpacingMm(10, 5)).toBe(15);
    expect(adjustSpacingMm(10, -5)).toBe(5);
  });

  it('clamps at both ends', () => {
    expect(adjustSpacingMm(2, -50)).toBe(GRID_SPACING_MM_MIN);
    expect(adjustSpacingMm(199, 50)).toBe(GRID_SPACING_MM_MAX);
  });

  it('falls back to a positive step for an invalid delta', () => {
    expect(adjustSpacingMm(10, 0)).toBe(10 + GRID_SPACING_MM_STEP);
    expect(adjustSpacingMm(10, NaN)).toBe(10 + GRID_SPACING_MM_STEP);
  });
});

describe('normalizeOffsetMm', () => {
  it('reduces the offset into one cell', () => {
    // Offsetting a 10 mm grid by 10 mm is the same grid.
    expect(normalizeOffsetMm({ x: 10, y: 25 }, 10)).toEqual({ x: 0, y: 5 });
  });

  it('uses a positive modulo', () => {
    // -1 mm on a 10 mm grid reads as 9 mm, not -1.
    expect(normalizeOffsetMm({ x: -1, y: -11 }, 10)).toEqual({ x: 9, y: 9 });
  });

  it('substitutes 0 for a non-finite component', () => {
    expect(normalizeOffsetMm({ x: NaN, y: 3 } as never, 10)).toEqual({ x: 0, y: 3 });
  });

  it('handles a missing offset object', () => {
    expect(normalizeOffsetMm(undefined as never, 10)).toEqual({ x: 0, y: 0 });
  });
});

describe('moveGridMm', () => {
  it('accumulates a drag and wraps', () => {
    let state = defaultGridState();
    state = moveGridMm(state, 3, 4);
    expect(state.offsetMm).toEqual({ x: 3, y: 4 });
    state = moveGridMm(state, 8, 8);
    // 3+8 = 11, wrapped into a 10 mm cell.
    expect(state.offsetMm).toEqual({ x: 1, y: 2 });
  });

  it('ignores a non-finite delta rather than corrupting the offset', () => {
    const state = moveGridMm(defaultGridState(), NaN, undefined);
    expect(state.offsetMm).toEqual({ x: 0, y: 0 });
  });

  it('leaves the rest of the state alone', () => {
    const before = { ...defaultGridState(), visible: true, spacingMm: 20 };
    const after = moveGridMm(before, 5, 0);
    expect(after.visible).toBe(true);
    expect(after.spacingMm).toBe(20);
  });
});

describe('resetGridOffset / toggleGrid', () => {
  it('resets the offset to the image origin', () => {
    const moved = moveGridMm(defaultGridState(), 7, 7);
    expect(resetGridOffset(moved).offsetMm).toEqual({ x: 0, y: 0 });
  });

  it('toggles visibility', () => {
    expect(toggleGrid(defaultGridState()).visible).toBe(true);
    expect(toggleGrid(toggleGrid(defaultGridState())).visible).toBe(false);
  });
});

describe('resolvePixelSpacing', () => {
  it('reads a [row, col] pair', () => {
    expect(resolvePixelSpacing([0.5, 0.7])).toEqual({ row: 0.5, col: 0.7 });
  });

  it('accepts a square spacing', () => {
    expect(resolvePixelSpacing(0.5)).toEqual({ row: 0.5, col: 0.5 });
  });

  it('returns null when the spacing is unusable', () => {
    expect(resolvePixelSpacing(undefined)).toBeNull();
    expect(resolvePixelSpacing(0)).toBeNull();
    expect(resolvePixelSpacing(-1)).toBeNull();
    expect(resolvePixelSpacing([0, 1])).toBeNull();
    expect(resolvePixelSpacing(['a', 'b'] as never)).toBeNull();
  });
});

describe('buildGridLines', () => {
  it('places a 10 mm grid on a 1 mm/px image', () => {
    const lines = buildGridLines({
      widthPx: 100,
      heightPx: 100,
      pixelSpacingMm: 1,
      spacingMm: 10,
    });
    expect(lines.vertical.map(l => l.px)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(lines.truncated).toBe(false);
  });

  it('scales with pixel spacing', () => {
    // 0.5 mm/px means 10 mm is 20 px.
    const lines = buildGridLines({
      widthPx: 100,
      heightPx: 100,
      pixelSpacingMm: 0.5,
      spacingMm: 10,
    });
    expect(lines.vertical.map(l => l.px)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(lines.spacingPx.x).toBe(20);
  });

  it('handles anisotropic spacing per axis', () => {
    // [row, col] = [0.5, 1] -> 10 mm is 10 px across, 20 px down.
    const lines = buildGridLines({
      widthPx: 60,
      heightPx: 60,
      pixelSpacingMm: [0.5, 1],
      spacingMm: 10,
    });
    expect(lines.spacingPx).toEqual({ x: 10, y: 20 });
    expect(lines.vertical).toHaveLength(7);
    expect(lines.horizontal).toHaveLength(4);
  });

  it('labels each line with its distance in mm', () => {
    const lines = buildGridLines({ widthPx: 30, heightPx: 30, pixelSpacingMm: 1, spacingMm: 10 });
    expect(lines.vertical.map(l => l.mm)).toEqual([0, 10, 20, 30]);
  });

  it('marks every Nth line as major', () => {
    const lines = buildGridLines({
      widthPx: 100,
      heightPx: 100,
      pixelSpacingMm: 1,
      spacingMm: 10,
      majorEvery: 5,
    });
    expect(lines.vertical.filter(l => l.major).map(l => l.px)).toEqual([0, 50, 100]);
  });

  it('draws no major lines when majorEvery is 0', () => {
    const lines = buildGridLines({
      widthPx: 100,
      heightPx: 100,
      pixelSpacingMm: 1,
      spacingMm: 10,
      majorEvery: 0,
    });
    expect(lines.vertical.some(l => l.major)).toBe(false);
  });

  it('shifts the lattice by the offset', () => {
    const lines = buildGridLines({
      widthPx: 100,
      heightPx: 100,
      pixelSpacingMm: 1,
      spacingMm: 10,
      offsetMm: { x: 3, y: 0 },
    });
    expect(lines.vertical[0].px).toBe(3);
    expect(lines.vertical[1].px).toBe(13);
  });

  it('falls back to a pixel grid when pixel spacing is unknown', () => {
    // Better an honest pixel grid than one labelled mm that is not calibrated.
    const lines = buildGridLines({ widthPx: 100, heightPx: 100, spacingMm: 10 });
    expect(lines.spacingPx).toEqual({ x: 10, y: 10 });
    expect(resolvePixelSpacing(undefined)).toBeNull();
  });

  it('coarsens instead of drawing thousands of lines', () => {
    // A 1 mm grid over a 1000 px field is 1001 lines per axis, redrawn on every
    // pan. Coarsening keeps it honest; skipping lines would not.
    const lines = buildGridLines({
      widthPx: 1000,
      heightPx: 1000,
      pixelSpacingMm: 1,
      spacingMm: 1,
    });
    expect(lines.truncated).toBe(true);
    expect(lines.vertical.length).toBeLessThanOrEqual(GRID_MAX_LINES_PER_AXIS);
    // The reported spacing matches what is actually drawn.
    expect(lines.spacingPx.x).toBe(lines.vertical[1].px - lines.vertical[0].px);
    expect(lines.vertical[1].mm).toBe(lines.spacingPx.x);
  });

  it('does not coarsen a grid that fits', () => {
    const lines = buildGridLines({
      widthPx: 500,
      heightPx: 500,
      pixelSpacingMm: 1,
      spacingMm: 10,
    });
    expect(lines.truncated).toBe(false);
    expect(lines.spacingPx.x).toBe(10);
  });

  it('returns nothing for a degenerate image', () => {
    for (const input of [
      { widthPx: 0, heightPx: 100, spacingMm: 10 },
      { widthPx: 100, heightPx: 0, spacingMm: 10 },
      { widthPx: NaN, heightPx: NaN, spacingMm: 10 },
    ]) {
      const lines = buildGridLines(input as never);
      expect(lines.vertical).toEqual([]);
      expect(lines.horizontal).toEqual([]);
    }
  });

  it('survives a missing input object', () => {
    expect(() => buildGridLines(undefined as never)).not.toThrow();
    expect(buildGridLines(undefined as never).vertical).toEqual([]);
  });
});

describe('describeGrid', () => {
  it('says off when hidden', () => {
    expect(describeGrid(defaultGridState())).toBe('Grid off');
  });

  it('reports the spacing', () => {
    expect(describeGrid({ ...defaultGridState(), visible: true })).toBe('Grid 10 mm');
  });

  it('flags an uncalibrated grid', () => {
    expect(describeGrid({ ...defaultGridState(), visible: true }, false)).toContain('uncalibrated');
  });

  it('mentions a non-zero offset', () => {
    const state = moveGridMm({ ...defaultGridState(), visible: true }, 3, 4);
    expect(describeGrid(state)).toBe('Grid 10 mm · offset 3/4 mm');
  });
});

describe('persistence', () => {
  it('round-trips the settings', () => {
    const before = moveGridMm({ visible: true, spacingMm: 25, offsetMm: { x: 0, y: 0 }, majorEvery: 4 }, 3, 7);
    expect(deserializeGrid(serializeGrid(before))).toEqual(before);
  });

  it('stamps the schema version', () => {
    expect(JSON.parse(serializeGrid(defaultGridState())).version).toBe(GRID_SCHEMA_VERSION);
  });

  it('falls back to the default for junk', () => {
    for (const junk of ['', 'not json', '{', 'null', '7', undefined, null, {}]) {
      expect(deserializeGrid(junk as never)).toEqual(defaultGridState());
    }
  });

  it('refuses a different schema version', () => {
    expect(deserializeGrid(JSON.stringify({ version: 99, spacingMm: 50 }))).toEqual(
      defaultGridState()
    );
  });

  it('sanitises a hand-edited payload', () => {
    const state = deserializeGrid(
      JSON.stringify({
        version: GRID_SCHEMA_VERSION,
        visible: 'yes',
        spacingMm: 9999,
        offsetMm: { x: -1, y: 'x' },
        majorEvery: -3,
      })
    );
    // 'yes' is not true, spacing clamps, offset wraps positive, majorEvery floors at 0.
    expect(state.visible).toBe(false);
    expect(state.spacingMm).toBe(GRID_SPACING_MM_MAX);
    expect(state.offsetMm).toEqual({ x: GRID_SPACING_MM_MAX - 1, y: 0 });
    expect(state.majorEvery).toBe(0);
  });
});
