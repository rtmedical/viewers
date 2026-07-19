import {
  marchingSquaresPolylines,
  isodoseLinesForLevels,
  trilinearSample,
  Polyline,
} from './marchingSquares';

function makeField(width: number, height: number, fn: (x: number, y: number) => number) {
  const f = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      f[x + y * width] = fn(x, y);
    }
  }
  return f;
}

const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Signed area via the shoelace formula (closed polyline). */
function shoelaceArea(line: Polyline): number {
  let area = 0;
  for (let i = 0; i < line.length - 1; i++) {
    area += line[i][0] * line[i + 1][1] - line[i + 1][0] * line[i][1];
  }
  return Math.abs(area / 2);
}

describe('marchingSquaresPolylines', () => {
  it('returns nothing for a flat field', () => {
    const f = makeField(10, 10, () => 5);
    expect(marchingSquaresPolylines(f, 10, 10, 1)).toEqual([]);
    expect(marchingSquaresPolylines(f, 10, 10, 5)).toEqual([]); // all inside
    expect(marchingSquaresPolylines(f, 10, 10, 9)).toEqual([]);
  });

  it('returns nothing for degenerate grids or bad levels', () => {
    const f = makeField(10, 1, () => 5);
    expect(marchingSquaresPolylines(f, 10, 1, 1)).toEqual([]);
    expect(marchingSquaresPolylines(f, 1, 10, 1)).toEqual([]);
    expect(marchingSquaresPolylines(f, 10, 10, NaN)).toEqual([]);
  });

  it('draws an interpolated vertical line for a step field', () => {
    // 0 for x<=4, 10 for x>=5 → the level-5 contour crosses at x = 4.5
    const f = makeField(10, 10, x => (x <= 4 ? 0 : 10));
    const lines = marchingSquaresPolylines(f, 10, 10, 5);
    expect(lines).toHaveLength(1);
    const [line] = lines;
    for (const [x] of line) {
      expect(x).toBeCloseTo(4.5, 5);
    }
    const ys = line.map(p => p[1]);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(9);
  });

  it('extracts a closed, circle-like contour from a radial field', () => {
    const size = 41;
    const c = (size - 1) / 2; // 20
    const r = 8;
    // dose peaks at the center and falls off 1 Gy per cell → level 20-r is a circle of radius r
    const f = makeField(size, size, (x, y) => 20 - Math.hypot(x - c, y - c));
    const lines = marchingSquaresPolylines(f, size, size, 20 - r);
    expect(lines).toHaveLength(1);
    const [loop] = lines;
    // closed: first == last
    expect(dist(loop[0], loop[loop.length - 1])).toBeLessThan(1e-6);
    expect(loop.length).toBeGreaterThan(8);
    // every vertex sits on the circle within interpolation tolerance
    for (const p of loop) {
      expect(Math.abs(dist(p, [c, c]) - r)).toBeLessThan(0.75);
    }
    // enclosed area ≈ πr²
    const area = shoelaceArea(loop);
    expect(Math.abs(area - Math.PI * r * r) / (Math.PI * r * r)).toBeLessThan(0.05);
  });

  it('chains segments into connected polylines', () => {
    const size = 21;
    const c = (size - 1) / 2;
    const f = makeField(size, size, (x, y) => 20 - Math.hypot(x - c, y - c));
    const [loop] = marchingSquaresPolylines(f, size, size, 15);
    for (let i = 0; i < loop.length - 1; i++) {
      expect(dist(loop[i], loop[i + 1])).toBeLessThan(1.5);
    }
  });

  it('resolves the saddle case into two non-crossing contours', () => {
    // 2×2 checkerboard: TL=10, TR=0, BL=0, BR=10 → case 5 with center 5 at level 6 (center out)
    const f = Float32Array.from([10, 0, 0, 10]);
    const lines = marchingSquaresPolylines(f, 2, 2, 6);
    expect(lines).toHaveLength(2);
  });

  it('treats values exactly at the level as inside', () => {
    const f = makeField(4, 4, x => (x >= 2 ? 5 : 0));
    const lines = marchingSquaresPolylines(f, 4, 4, 5);
    expect(lines).toHaveLength(1);
    // crossing between value 0 (x=1) and value 5 (x=2) at t=1 → x=2
    for (const [x] of lines[0]) {
      expect(x).toBeCloseTo(2, 5);
    }
  });
});

describe('isodoseLinesForLevels', () => {
  it('maps each positive finite level to its contours', () => {
    const size = 41;
    const c = (size - 1) / 2;
    const f = makeField(size, size, (x, y) => 20 - Math.hypot(x - c, y - c));
    const result = isodoseLinesForLevels(f, size, size, [12, 16, NaN, -3, 0]);
    expect(result.map(r => r.levelGy)).toEqual([12, 16]);
    // lower level → bigger circle → larger area
    const area12 = shoelaceArea(result[0].polylines[0]);
    const area16 = shoelaceArea(result[1].polylines[0]);
    expect(area12).toBeGreaterThan(area16);
  });
});

describe('trilinearSample', () => {
  const dims: [number, number, number] = [3, 3, 3];
  // linear ramp f(i,j,k) = i + 10j + 100k
  const data = new Float32Array(27);
  for (let k = 0; k < 3; k++) {
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 3; i++) {
        data[i + j * 3 + k * 9] = i + 10 * j + 100 * k;
      }
    }
  }

  it('reproduces grid values at integer coordinates', () => {
    expect(trilinearSample(data, dims, 0, 0, 0)).toBe(0);
    expect(trilinearSample(data, dims, 2, 1, 1)).toBe(112);
  });

  it('interpolates linearly between voxels', () => {
    expect(trilinearSample(data, dims, 0.5, 0, 0)).toBeCloseTo(0.5, 6);
    expect(trilinearSample(data, dims, 1, 0.25, 0)).toBeCloseTo(3.5, 6);
    expect(trilinearSample(data, dims, 0.5, 0.5, 0.5)).toBeCloseTo(0.5 + 5 + 50, 6);
  });

  it('returns 0 outside the grid', () => {
    expect(trilinearSample(data, dims, -0.01, 0, 0)).toBe(0);
    expect(trilinearSample(data, dims, 0, 0, 2.01)).toBe(0);
  });
});
