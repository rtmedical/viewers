/**
 * Isodose LINE extraction (vector contours) — pure marching-squares core.
 *
 * Framework-free and `@ohif/*`-free: given a 2D dose field sampled on the
 * viewport's camera plane, extracts the iso-contour polylines at each isodose
 * level (Gy) with linear interpolation along cell edges, and chains the raw
 * segments into ordered polylines. The viewport overlay (SVG layer fed by
 * sampling the RTDOSE volume) lives in the command layer; this module is the
 * geometry core so it is unit-tested in isolation — same split as
 * {@link ./doseBands} for the wash.
 */

export type Point2 = [number, number];
export type Polyline = Point2[];

/**
 * Trilinear sample of a 3D scalar grid at continuous IJK coordinates.
 * Out-of-bounds samples return 0 (physically: no dose outside the grid).
 *
 * @param data Flat scalar array, x-fastest (index = i + j*dimX + k*dimX*dimY).
 * @param dims [dimX, dimY, dimZ].
 */
export function trilinearSample(
  data: ArrayLike<number>,
  dims: [number, number, number],
  i: number,
  j: number,
  k: number
): number {
  const [nx, ny, nz] = dims;
  if (i < 0 || j < 0 || k < 0 || i > nx - 1 || j > ny - 1 || k > nz - 1) {
    return 0;
  }
  const i0 = Math.floor(i);
  const j0 = Math.floor(j);
  const k0 = Math.floor(k);
  const i1 = Math.min(i0 + 1, nx - 1);
  const j1 = Math.min(j0 + 1, ny - 1);
  const k1 = Math.min(k0 + 1, nz - 1);
  const fx = i - i0;
  const fy = j - j0;
  const fz = k - k0;
  const sxy = nx * ny;
  const at = (x: number, y: number, z: number) => data[x + y * nx + z * sxy] || 0;
  const c00 = at(i0, j0, k0) * (1 - fx) + at(i1, j0, k0) * fx;
  const c10 = at(i0, j1, k0) * (1 - fx) + at(i1, j1, k0) * fx;
  const c01 = at(i0, j0, k1) * (1 - fx) + at(i1, j0, k1) * fx;
  const c11 = at(i0, j1, k1) * (1 - fx) + at(i1, j1, k1) * fx;
  const c0 = c00 * (1 - fy) + c10 * fy;
  const c1 = c01 * (1 - fy) + c11 * fy;
  return c0 * (1 - fz) + c1 * fz;
}

/** Interpolated crossing position between two corner values. */
function lerpT(va: number, vb: number, level: number): number {
  const d = vb - va;
  if (!Number.isFinite(d) || d === 0) {
    return 0.5;
  }
  const t = (level - va) / d;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

const keyOf = (p: Point2) => `${Math.round(p[0] * 4096)},${Math.round(p[1] * 4096)}`;

/**
 * Marching squares: iso-contour polylines of `field` (width×height, row-major,
 * index = x + y*width) at `level`. Corner is "inside" when value >= level.
 * Returns polylines in grid coordinates (cell units, linearly interpolated);
 * closed loops repeat their first point at the end.
 */
export function marchingSquaresPolylines(
  field: ArrayLike<number>,
  width: number,
  height: number,
  level: number
): Polyline[] {
  if (width < 2 || height < 2 || !Number.isFinite(level)) {
    return [];
  }
  const segments: Array<[Point2, Point2]> = [];
  // Zero-length segments arise when a corner sits exactly on the level (point
  // tangency) — geometrically empty, and they break chaining with duplicates.
  const pushSeg = (a: Point2, b: Point2) => {
    if (keyOf(a) !== keyOf(b)) {
      segments.push([a, b]);
    }
  };
  for (let y = 0; y < height - 1; y++) {
    const row = y * width;
    for (let x = 0; x < width - 1; x++) {
      const v0 = field[row + x] || 0; // top-left
      const v1 = field[row + x + 1] || 0; // top-right
      const v2 = field[row + width + x + 1] || 0; // bottom-right
      const v3 = field[row + width + x] || 0; // bottom-left
      let caseIdx = 0;
      if (v0 >= level) caseIdx |= 1;
      if (v1 >= level) caseIdx |= 2;
      if (v2 >= level) caseIdx |= 4;
      if (v3 >= level) caseIdx |= 8;
      if (caseIdx === 0 || caseIdx === 15) {
        continue;
      }
      const T: Point2 = [x + lerpT(v0, v1, level), y];
      const R: Point2 = [x + 1, y + lerpT(v1, v2, level)];
      const B: Point2 = [x + lerpT(v3, v2, level), y + 1];
      const L: Point2 = [x, y + lerpT(v0, v3, level)];
      switch (caseIdx) {
        case 1:
          pushSeg(L, T);
          break;
        case 2:
          pushSeg(T, R);
          break;
        case 3:
          pushSeg(L, R);
          break;
        case 4:
          pushSeg(R, B);
          break;
        case 5: {
          // saddle: TL+BR inside — disambiguate by the cell-center value
          const center = (v0 + v1 + v2 + v3) / 4;
          if (center >= level) {
            pushSeg(T, R);
            pushSeg(B, L);
          } else {
            pushSeg(L, T);
            pushSeg(R, B);
          }
          break;
        }
        case 6:
          pushSeg(T, B);
          break;
        case 7:
          pushSeg(L, B);
          break;
        case 8:
          pushSeg(B, L);
          break;
        case 9:
          pushSeg(T, B);
          break;
        case 10: {
          // saddle: TR+BL inside
          const center = (v0 + v1 + v2 + v3) / 4;
          if (center >= level) {
            pushSeg(L, T);
            pushSeg(R, B);
          } else {
            pushSeg(T, R);
            pushSeg(B, L);
          }
          break;
        }
        case 11:
          pushSeg(R, B);
          break;
        case 12:
          pushSeg(R, L);
          break;
        case 13:
          pushSeg(T, R);
          break;
        case 14:
          pushSeg(L, T);
          break;
      }
    }
  }
  return chainSegments(segments);
}

/** Chain unordered segments into polylines by joining coincident endpoints. */
function chainSegments(segments: Array<[Point2, Point2]>): Polyline[] {
  const used = new Array(segments.length).fill(false);
  // endpoint key → list of [segmentIndex, endIndex(0|1)]
  const adj = new Map<string, Array<[number, number]>>();
  segments.forEach(([a, b], idx) => {
    for (const [end, p] of [a, b].entries()) {
      const k = keyOf(p);
      const list = adj.get(k);
      if (list) {
        list.push([idx, end]);
      } else {
        adj.set(k, [[idx, end]]);
      }
    }
  });
  const takeNext = (p: Point2): [number, number] | undefined => {
    const list = adj.get(keyOf(p));
    if (!list) {
      return undefined;
    }
    for (const [idx, end] of list) {
      if (!used[idx]) {
        return [idx, end];
      }
    }
    return undefined;
  };
  const polylines: Polyline[] = [];
  for (let s = 0; s < segments.length; s++) {
    if (used[s]) {
      continue;
    }
    used[s] = true;
    const line: Polyline = [segments[s][0], segments[s][1]];
    // extend forward from the tail
    for (;;) {
      const next = takeNext(line[line.length - 1]);
      if (!next) {
        break;
      }
      const [idx, end] = next;
      used[idx] = true;
      line.push(segments[idx][end === 0 ? 1 : 0]);
    }
    // extend backward from the head
    for (;;) {
      const prev = takeNext(line[0]);
      if (!prev) {
        break;
      }
      const [idx, end] = prev;
      used[idx] = true;
      line.unshift(segments[idx][end === 0 ? 1 : 0]);
    }
    polylines.push(line);
  }
  return polylines;
}

export interface IsodoseLinesLevel {
  levelGy: number;
  polylines: Polyline[];
}

/** Contours for several isodose levels (Gy) over the same field. */
export function isodoseLinesForLevels(
  field: ArrayLike<number>,
  width: number,
  height: number,
  levelsGy: number[]
): IsodoseLinesLevel[] {
  return levelsGy
    .filter(v => Number.isFinite(v) && v > 0)
    .map(levelGy => ({
      levelGy,
      polylines: marchingSquaresPolylines(field, width, height, levelGy),
    }));
}

export default marchingSquaresPolylines;
