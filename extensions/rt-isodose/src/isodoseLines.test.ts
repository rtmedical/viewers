/**
 * Tests for the pure marching-squares core (isodoseLines.ts) — the JS parity
 * reference of the Rust→WASM `marching_squares_multi` kernel. The WASM↔JS
 * byte-parity itself is exercised in-app by the `rtIsodoseLinesSelfTest`
 * command (jest can't load the wasm-pack web target).
 */
import { marchingSquaresMulti, decodeIsoContours, IsoPolyline } from './isodoseLines';

/** Convenience: run + decode. */
function contours(grid: number[], w: number, h: number, levels: number[]): IsoPolyline[][] {
  return decodeIsoContours(marchingSquaresMulti(grid, w, h, levels));
}

/** Point list of a polyline as [x,y] pairs. */
function pts(poly: IsoPolyline): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < poly.points.length; i += 2) {
    out.push([poly.points[i], poly.points[i + 1]]);
  }
  return out;
}

describe('marchingSquaresMulti (isodose lines core)', () => {
  it('returns empty level blocks for degenerate grids', () => {
    // width < 2
    expect(contours([0, 0], 1, 2, [1])).toEqual([[]]);
    // height < 2
    expect(contours([0, 0], 2, 1, [1])).toEqual([[]]);
    // size mismatch
    expect(contours([0, 0, 0], 2, 2, [1])).toEqual([[]]);
    // no levels
    expect(contours([0, 0, 0, 0], 2, 2, [])).toEqual([]);
  });

  it('produces no contours when the grid is entirely below or above the level', () => {
    expect(contours([0, 0, 0, 0], 2, 2, [5])).toEqual([[]]);
    expect(contours([9, 9, 9, 9], 2, 2, [5])).toEqual([[]]);
  });

  it('extracts a single open segment for a one-cell crossing (linear interp)', () => {
    // v00=0 v10=0 / v01=0 v11=10, level 5 → case 2 → R(1,0.5) → B(0.5,1)
    const [level] = contours([0, 0, 0, 10], 2, 2, [5]);
    expect(level).toHaveLength(1);
    expect(level[0].closed).toBe(false);
    expect(pts(level[0])).toEqual([
      [1, 0.5],
      [0.5, 1],
    ]);
  });

  it('chains a closed contour around an interior blob (no duplicated first point)', () => {
    // 4x4 nodes, inner 2x2 = 10, border 0, level 5 → one closed octagon, t=0.5
    const g = [
      0, 0, 0, 0,
      0, 10, 10, 0,
      0, 10, 10, 0,
      0, 0, 0, 0,
    ];
    const [level] = contours(g, 4, 4, [5]);
    expect(level).toHaveLength(1);
    const poly = level[0];
    expect(poly.closed).toBe(true);
    const points = pts(poly);
    expect(points).toHaveLength(8);
    // no duplicated closing point
    expect(points[0]).not.toEqual(points[points.length - 1]);
    // the octagon's crossing points, order-independent
    const expected = new Set([
      '0.5,1', '1,0.5', '2,0.5', '2.5,1', '2.5,2', '2,2.5', '1,2.5', '0.5,2',
    ]);
    const got = new Set(points.map(([x, y]) => `${x},${y}`));
    expect(got).toEqual(expected);
  });

  it('chains an open border-to-border contour (exercises backward extension)', () => {
    // 4x3 nodes: top row 10, rest 0 → single open line y=0.5 across the grid
    const g = [
      10, 10, 10, 10,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ];
    const [level] = contours(g, 4, 3, [5]);
    expect(level).toHaveLength(1);
    expect(level[0].closed).toBe(false);
    const points = pts(level[0]);
    expect(points).toHaveLength(4);
    const xs = points.map(([x]) => x);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(3);
    expect(points.every(([, y]) => y === 0.5)).toBe(true);
  });

  it('resolves saddles with the average-center rule (both variants)', () => {
    // v00=10 v10=0 / v01=0 v11=10 → case 10 (TL+BR inside)
    const g = [10, 0, 0, 10];
    // level 5: center = 5 >= 5 → connected: (R→T), (L→B)
    const [conn] = contours(g, 2, 2, [5]);
    expect(conn).toHaveLength(2);
    const connSet = conn.map(p => pts(p));
    expect(connSet).toContainEqual([
      [1, 0.5],
      [0.5, 0],
    ]);
    expect(connSet).toContainEqual([
      [0, 0.5],
      [0.5, 1],
    ]);
    // level 6: center = 5 < 6 → separated: (L→T), (R→B); t = 0.4 / 0.6
    const [sep] = contours(g, 2, 2, [6]);
    expect(sep).toHaveLength(2);
    const sepSet = sep.map(p => pts(p));
    expect(sepSet).toContainEqual([
      [0, Math.fround(0.4)],
      [Math.fround(0.4), 0],
    ]);
    expect(sepSet).toContainEqual([
      [1, Math.fround(0.6)],
      [Math.fround(0.6), 1],
    ]);
  });

  it('keeps levels in caller order (multi-level blocks line up with input)', () => {
    // radial blob: level 3 contour must enclose more area than level 7
    const w = 9;
    const h = 9;
    const g: number[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const d = Math.hypot(x - 4, y - 4);
        g.push(Math.max(0, 10 - 2.5 * d));
      }
    }
    const byLevel = contours(g, w, h, [3, 7]);
    expect(byLevel).toHaveLength(2);
    expect(byLevel[0].length).toBeGreaterThan(0);
    expect(byLevel[1].length).toBeGreaterThan(0);
    // crude area proxy: bounding-box width of the first closed contour
    const span = (polys: IsoPolyline[]) => {
      const xs = polys.flatMap(p => pts(p).map(([x]) => x));
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(span(byLevel[0])).toBeGreaterThan(span(byLevel[1]));
  });

  it('drops zero-length segments when a corner sits exactly on the level', () => {
    // only v10=5 reaches level 5 → T and R crossings coincide at the node (1,0)
    const [level] = contours([0, 5, 0, 0], 2, 2, [5]);
    expect(level).toEqual([]);
  });

  it('treats non-finite dose values as 0', () => {
    const withNaN = contours([NaN, 0, 0, 10], 2, 2, [5]);
    const withZero = contours([0, 0, 0, 10], 2, 2, [5]);
    expect(withNaN).toEqual(withZero);
    const withInf = contours([Infinity, 0, 0, 0], 2, 2, [5]);
    expect(withInf).toEqual([[]]);
  });

  it('is deterministic and survives an encode→decode round trip', () => {
    const w = 16;
    const h = 12;
    const g: number[] = [];
    let seed = 42;
    for (let i = 0; i < w * h; i++) {
      seed = (1103515245 * seed + 12345) & 0x7fffffff;
      g.push((seed / 0x7fffffff) * 10);
    }
    const a = marchingSquaresMulti(g, w, h, [2.5, 5, 7.5]);
    const b = marchingSquaresMulti(g, w, h, [2.5, 5, 7.5]);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(Object.is(a[i], b[i])).toBe(true);
    }
    // decode shape: 3 level blocks, every polyline ≥ 2 points
    const decoded = decodeIsoContours(a);
    expect(decoded).toHaveLength(3);
    decoded.flat().forEach(poly => {
      expect(poly.points.length / 2).toBeGreaterThanOrEqual(2);
      expect(typeof poly.closed).toBe('boolean');
    });
  });

  it('quantizes inputs to f32 (parity contract with the WASM kernel)', () => {
    // a level that is not representable in f32 must behave as its f32 rounding
    const level64 = 5.000000001; // f32-rounds to 5
    const a = marchingSquaresMulti([0, 0, 0, 10], 2, 2, [level64]);
    const b = marchingSquaresMulti([0, 0, 0, 10], 2, 2, [5]);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
