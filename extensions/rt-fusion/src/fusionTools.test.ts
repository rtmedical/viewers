import {
  CHESS_TILE_DEFAULT,
  CHESS_TILE_MAX,
  CHESS_TILE_MIN,
  chessRegions,
  clampChessTile,
  defaultFusionToolState,
  defaultMovingTransform,
  FUSION_SCALE_MAX,
  FUSION_SCALE_MIN,
  FUSION_TOOL_LABELS,
  FUSION_TOOLS,
  FUSION_WINDOW_MIN,
  movingWindowRegion,
  MOVING_WINDOW_MIN_PX,
  panMoving,
  Rect,
  regionsToClipPath,
  regionStats,
  regionWindowLevelMoving,
  revealRegions,
  selectTool,
  splitRegion,
  windowLevelMoving,
  zoomMovingAbout,
} from './fusionTools';

const SIZE = { width: 800, height: 600 };
const area = (rects: Rect[]) => rects.reduce((sum, r) => sum + r.width * r.height, 0);

describe('the tool set', () => {
  it('has all seven, each labelled', () => {
    expect(FUSION_TOOLS).toHaveLength(7);
    for (const tool of FUSION_TOOLS) {
      expect(FUSION_TOOL_LABELS[tool]).toBeTruthy();
    }
  });
});

describe('splitRegion', () => {
  it('reveals the right half by default', () => {
    expect(splitRegion(SIZE)).toEqual([{ x: 400, y: 0, width: 400, height: 600 }]);
  });

  it('moves with the divider', () => {
    expect(splitRegion(SIZE, 0.25)[0]).toMatchObject({ x: 200, width: 600 });
  });

  it('splits horizontally when asked', () => {
    expect(splitRegion(SIZE, 0.5, 'horizontal')).toEqual([
      { x: 0, y: 300, width: 800, height: 300 },
    ]);
  });

  it('emits nothing rather than a zero-width rect at the far edge', () => {
    // Some clip implementations render a zero-size rect as "everything".
    expect(splitRegion(SIZE, 1)).toEqual([]);
    expect(splitRegion(SIZE, 1, 'horizontal')).toEqual([]);
  });

  it('reveals everything at position 0', () => {
    expect(splitRegion(SIZE, 0)[0]).toMatchObject({ x: 0, width: 800 });
  });

  it('clamps a nonsense position instead of throwing', () => {
    expect(splitRegion(SIZE, -5)[0].x).toBe(0);
    expect(splitRegion(SIZE, NaN)[0].x).toBe(400);
  });

  it('handles a degenerate viewport', () => {
    expect(splitRegion({ width: 0, height: 600 })).toEqual([]);
    expect(splitRegion(undefined as never)).toEqual([]);
  });
});

describe('chessRegions', () => {
  it('covers about half the viewport', () => {
    // The alternating pattern is what makes a misregistration obvious.
    const rects = chessRegions({ width: 128, height: 128 }, 32);
    expect(rects).toHaveLength(8); // 4x4 board, half the squares
    expect(area(rects)).toBe(128 * 128 / 2);
  });

  it('starts with the top-left tile on', () => {
    expect(chessRegions({ width: 64, height: 64 }, 32)[0]).toEqual({
      x: 0,
      y: 0,
      width: 32,
      height: 32,
    });
  });

  it('clips edge tiles instead of spilling', () => {
    const rects = chessRegions({ width: 100, height: 100 }, 32);
    for (const r of rects) {
      expect(r.x + r.width).toBeLessThanOrEqual(100);
      expect(r.y + r.height).toBeLessThanOrEqual(100);
    }
  });

  it('clamps the tile size', () => {
    expect(clampChessTile(1)).toBe(CHESS_TILE_MIN);
    expect(clampChessTile(9999)).toBe(CHESS_TILE_MAX);
    expect(clampChessTile(NaN)).toBe(CHESS_TILE_DEFAULT);
    expect(clampChessTile(48)).toBe(48);
  });

  it('handles a degenerate viewport', () => {
    expect(chessRegions({ width: 0, height: 0 })).toEqual([]);
  });
});

describe('movingWindowRegion', () => {
  it('centres the lens by default', () => {
    expect(movingWindowRegion(SIZE)).toEqual([{ x: 300, y: 200, width: 200, height: 200 }]);
  });

  it('follows the centre', () => {
    expect(movingWindowRegion(SIZE, { x: 0.25, y: 0.75 })[0]).toMatchObject({ x: 100, y: 350 });
  });

  it('clamps the lens inside the viewport', () => {
    // Half a lens over the border reads as a rendering bug and loses the reference.
    const rect = movingWindowRegion(SIZE, { x: 0, y: 0 })[0];
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
    const far = movingWindowRegion(SIZE, { x: 1, y: 1 })[0];
    expect(far.x + far.width).toBe(SIZE.width);
    expect(far.y + far.height).toBe(SIZE.height);
  });

  it('never shrinks below the minimum or grows past the viewport', () => {
    expect(movingWindowRegion(SIZE, undefined, { width: 1, height: 1 })[0]).toMatchObject({
      width: MOVING_WINDOW_MIN_PX,
      height: MOVING_WINDOW_MIN_PX,
    });
    expect(movingWindowRegion(SIZE, undefined, { width: 99999, height: 99999 })[0]).toMatchObject({
      width: SIZE.width,
      height: SIZE.height,
    });
  });

  it('handles a degenerate viewport', () => {
    expect(movingWindowRegion({ width: 0, height: 0 })).toEqual([]);
  });
});

describe('panMoving', () => {
  it('accumulates the drag', () => {
    let t = defaultMovingTransform();
    t = panMoving(t, 10, -5);
    t = panMoving(t, 5, 5);
    expect(t).toMatchObject({ offsetX: 15, offsetY: 0 });
  });

  it('ignores a non-finite delta', () => {
    expect(panMoving(defaultMovingTransform(), NaN, undefined)).toMatchObject({
      offsetX: 0,
      offsetY: 0,
    });
  });

  it('leaves the rest of the transform alone', () => {
    expect(panMoving(defaultMovingTransform(), 10, 0).scale).toBe(1);
  });
});

describe('zoomMovingAbout', () => {
  it('scales', () => {
    expect(zoomMovingAbout(defaultMovingTransform(), 2).scale).toBe(2);
  });

  it('keeps the anchor point fixed', () => {
    // Anchoring at the centre instead makes the reader chase the anatomy with pan
    // after every wheel click.
    const anchor = { x: 100, y: 50 };
    const t = zoomMovingAbout(defaultMovingTransform(), 2, anchor);
    // Screen position of the layer point under the anchor is unchanged.
    const before = (anchor.x - 0) / 1;
    const after = (anchor.x - t.offsetX) / t.scale;
    expect(after).toBeCloseTo(before, 6);
  });

  it('does not move the layer when zooming about its own origin', () => {
    const t = zoomMovingAbout(defaultMovingTransform(), 2, { x: 0, y: 0 });
    expect(t.offsetX).toBe(0);
    expect(t.offsetY).toBe(0);
  });

  it('clamps the scale', () => {
    expect(zoomMovingAbout(defaultMovingTransform(), 1000).scale).toBe(FUSION_SCALE_MAX);
    expect(zoomMovingAbout(defaultMovingTransform(), 0.0001).scale).toBe(FUSION_SCALE_MIN);
  });

  it('treats a nonsense factor as no change', () => {
    expect(zoomMovingAbout(defaultMovingTransform(), NaN).scale).toBe(1);
    expect(zoomMovingAbout(defaultMovingTransform(), 0).scale).toBe(1);
  });
});

describe('windowLevelMoving', () => {
  it('drags width horizontally and centre vertically', () => {
    // The convention every radiology viewer uses, so muscle memory carries over.
    const t = windowLevelMoving(defaultMovingTransform(), 100, -20);
    expect(t.windowWidth).toBe(500);
    expect(t.windowCenter).toBe(20);
  });

  it('floors the width at 1', () => {
    // Zero width divides by zero in every renderer downstream.
    expect(windowLevelMoving(defaultMovingTransform(), -9999, 0).windowWidth).toBe(
      FUSION_WINDOW_MIN
    );
  });

  it('ignores a non-finite delta', () => {
    expect(windowLevelMoving(defaultMovingTransform(), NaN, NaN)).toMatchObject({
      windowWidth: 400,
      windowCenter: 40,
    });
  });
});

describe('regionWindowLevelMoving', () => {
  it('fits the window to the samples', () => {
    const t = regionWindowLevelMoving(defaultMovingTransform(), [100, 300, 200]);
    expect(t.windowWidth).toBe(200);
    expect(t.windowCenter).toBe(200);
  });

  it('ignores non-finite samples', () => {
    expect(regionStats([NaN, 10, 20, Infinity])).toEqual({ min: 10, max: 20, count: 2 });
  });

  it('leaves the display alone for an empty or flat region', () => {
    // Dragging over background should not blank the image.
    const base = defaultMovingTransform();
    expect(regionWindowLevelMoving(base, [])).toBe(base);
    expect(regionWindowLevelMoving(base, [50, 50, 50])).toBe(base);
    expect(regionWindowLevelMoving(base, undefined)).toBe(base);
  });
});

describe('tool state', () => {
  it('selects and toggles off', () => {
    let state = defaultFusionToolState();
    state = selectTool(state, 'chess');
    expect(state.active).toBe('chess');
    state = selectTool(state, 'chess');
    expect(state.active).toBeNull();
  });

  it('ignores an unknown tool', () => {
    const state = defaultFusionToolState();
    expect(selectTool(state, 'nope')).toBe(state);
  });

  it('reveals regions only for the reveal tools', () => {
    const base = defaultFusionToolState();
    expect(revealRegions(base, SIZE)).toEqual([]);
    expect(revealRegions({ ...base, active: 'split' }, SIZE)).toHaveLength(1);
    expect(revealRegions({ ...base, active: 'chess' }, SIZE).length).toBeGreaterThan(1);
    expect(revealRegions({ ...base, active: 'movingWindow' }, SIZE)).toHaveLength(1);
    // Transform tools do not clip: the moving layer is drawn whole.
    expect(revealRegions({ ...base, active: 'pan' }, SIZE)).toEqual([]);
  });
});

describe('regionsToClipPath', () => {
  it('emits one subpath per rect', () => {
    expect(regionsToClipPath([{ x: 1, y: 2, width: 3, height: 4 }])).toBe('M1,2h3v4h-3Z');
  });

  it('drops degenerate rects', () => {
    expect(regionsToClipPath([{ x: 0, y: 0, width: 0, height: 10 }])).toBe('');
    expect(regionsToClipPath([])).toBe('');
    expect(regionsToClipPath(undefined as never)).toBe('');
  });

  it('concatenates several', () => {
    const path = regionsToClipPath(chessRegions({ width: 64, height: 64 }, 32));
    expect(path.match(/M/g)).toHaveLength(2);
  });
});
