/**
 * Vector isodose lines — pure marching-squares core (JS reference).
 *
 * Mirrors the Rust→WASM `marching_squares_multi` kernel (rust/src/lib.rs)
 * bit-for-bit: same f32 arithmetic (every intermediate is `Math.fround`ed in
 * Rust's left-associative evaluation order), same row-major scan and per-case
 * emission order, same lowest-unused-index chaining, same packed encoding — so
 * WASM/JS parity is a single element-wise Float32Array compare.
 *
 * Packed buffer layout (all f32):
 *   [ nLevels,
 *     per level (input order):  nPolylines,
 *       per polyline:           nPoints, closed(1|0), x0, y0, x1, y1, … ]
 *
 * Coordinates are GRID coordinates (x ∈ [0,w-1] right, y ∈ [0,h-1] down); the
 * caller maps grid→world→canvas. Non-finite dose values behave as 0 (sanitized
 * up front — wasm NaN payloads are nondeterministic and would poison the
 * bit-pattern point keys). Saddles use the average-center rule.
 *
 * Determinism invariant (do not break): the endpoint maps are LOOKUP-ONLY —
 * never iterate them — and joins always take the lowest-index unused segment,
 * so output is independent of hasher/iteration order on both paths.
 */

export interface IsoPolyline {
  /** Flat [x0, y0, x1, y1, …] in grid coordinates. */
  points: Float32Array;
  /** True when the contour closes on itself (first point NOT duplicated). */
  closed: boolean;
}

/** Outer index = input level index. */
export type IsoContoursByLevel = IsoPolyline[][];

const fr = Math.fround;

const EDGE_T = 0;
const EDGE_R = 1;
const EDGE_B = 2;
const EDGE_L = 3;

/** case → directed segments (from-edge, to-edge), inside (>= level) on the left. */
const CASE_SEGMENTS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  /* 0 */ [],
  /* 1 */ [[EDGE_B, EDGE_L]],
  /* 2 */ [[EDGE_R, EDGE_B]],
  /* 3 */ [[EDGE_R, EDGE_L]],
  /* 4 */ [[EDGE_T, EDGE_R]],
  /* 5 */ [], // saddle — resolved at runtime
  /* 6 */ [[EDGE_T, EDGE_B]],
  /* 7 */ [[EDGE_T, EDGE_L]],
  /* 8 */ [[EDGE_L, EDGE_T]],
  /* 9 */ [[EDGE_B, EDGE_T]],
  /* 10 */ [], // saddle — resolved at runtime
  /* 11 */ [[EDGE_R, EDGE_T]],
  /* 12 */ [[EDGE_L, EDGE_R]],
  /* 13 */ [[EDGE_B, EDGE_R]],
  /* 14 */ [[EDGE_L, EDGE_B]],
  /* 15 */ [],
];

const SADDLE_5_CONNECTED: ReadonlyArray<readonly [number, number]> = [
  [EDGE_T, EDGE_L],
  [EDGE_B, EDGE_R],
];
const SADDLE_5_SEPARATED: ReadonlyArray<readonly [number, number]> = [
  [EDGE_T, EDGE_R],
  [EDGE_B, EDGE_L],
];
const SADDLE_10_CONNECTED: ReadonlyArray<readonly [number, number]> = [
  [EDGE_R, EDGE_T],
  [EDGE_L, EDGE_B],
];
const SADDLE_10_SEPARATED: ReadonlyArray<readonly [number, number]> = [
  [EDGE_L, EDGE_T],
  [EDGE_R, EDGE_B],
];

/** Exact-bit point key — the JS analogue of Rust's `to_bits()` u64 key. */
const keyF32 = new Float32Array(2);
const keyU32 = new Uint32Array(keyF32.buffer);
function ptKey(x: number, y: number): string {
  keyF32[0] = x;
  keyF32[1] = y;
  return keyU32[0] + '_' + keyU32[1];
}

/**
 * Marching squares over a row-major 2D grid at N levels → packed polylines.
 * See the module header for the buffer layout and parity rules.
 */
export function marchingSquaresMulti(
  grid: ArrayLike<number>,
  width: number,
  height: number,
  levels: number[]
): Float32Array {
  const w = width | 0;
  const h = height | 0;
  const out: number[] = [levels.length];
  if (w < 2 || h < 2 || grid.length !== w * h) {
    for (let i = 0; i < levels.length; i++) {
      out.push(0);
    }
    return Float32Array.from(out);
  }
  // Sanitize: non-finite → 0, and quantize to f32 (parity with the wasm &[f32]).
  const g = new Float32Array(w * h);
  for (let i = 0; i < g.length; i++) {
    const v = Number(grid[i]);
    g[i] = Number.isFinite(v) ? v : 0;
  }

  for (const levelIn of levels) {
    const level = fr(levelIn);
    // pass 1: directed segments, row-major cell scan (deterministic)
    const segSx: number[] = [];
    const segSy: number[] = [];
    const segEx: number[] = [];
    const segEy: number[] = [];
    for (let cy = 0; cy < h - 1; cy++) {
      const row0 = cy * w;
      const row1 = row0 + w;
      for (let cx = 0; cx < w - 1; cx++) {
        const v00 = g[row0 + cx];
        const v10 = g[row0 + cx + 1];
        const v01 = g[row1 + cx];
        const v11 = g[row1 + cx + 1];
        const caseIdx =
          ((v00 >= level ? 1 : 0) << 3) |
          ((v10 >= level ? 1 : 0) << 2) |
          ((v11 >= level ? 1 : 0) << 1) |
          (v01 >= level ? 1 : 0);
        if (caseIdx === 0 || caseIdx === 15) {
          continue;
        }
        let segs: ReadonlyArray<readonly [number, number]>;
        if (caseIdx === 5 || caseIdx === 10) {
          // average-center rule, f32 per-op in Rust's left-assoc order
          const center = fr(fr(fr(fr(v00 + v10) + v11) + v01) * 0.25);
          const connected = center >= level;
          segs =
            caseIdx === 5
              ? connected
                ? SADDLE_5_CONNECTED
                : SADDLE_5_SEPARATED
              : connected
                ? SADDLE_10_CONNECTED
                : SADDLE_10_SEPARATED;
        } else {
          segs = CASE_SEGMENTS[caseIdx];
        }
        for (const [ef, et] of segs) {
          const s = edgePoint(ef, cx, cy, level, v00, v10, v01, v11);
          const e = edgePoint(et, cx, cy, level, v00, v10, v01, v11);
          if (ptKey(s[0], s[1]) === ptKey(e[0], e[1])) {
            continue; // corner exactly on level → zero-length
          }
          segSx.push(s[0]);
          segSy.push(s[1]);
          segEx.push(e[0]);
          segEy.push(e[1]);
        }
      }
    }
    // pass 2: chain segments into polylines (lowest-unused-index joins)
    const n = segSx.length;
    const byStart = new Map<string, number[]>();
    const byEnd = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
      const ks = ptKey(segSx[i], segSy[i]);
      const ke = ptKey(segEx[i], segEy[i]);
      const ls = byStart.get(ks);
      if (ls) {
        ls.push(i);
      } else {
        byStart.set(ks, [i]);
      }
      const le = byEnd.get(ke);
      if (le) {
        le.push(i);
      } else {
        byEnd.set(ke, [i]);
      }
    }
    const used = new Array<boolean>(n).fill(false);
    const take = (m: Map<string, number[]>, k: string): number => {
      const list = m.get(k);
      if (!list) {
        return -1;
      }
      for (const i of list) {
        if (!used[i]) {
          return i;
        }
      }
      return -1;
    };
    const nPolysAt = out.length;
    out.push(0);
    let nPolys = 0;
    for (let i0 = 0; i0 < n; i0++) {
      if (used[i0]) {
        continue;
      }
      used[i0] = true;
      const pts: number[] = [segSx[i0], segSy[i0], segEx[i0], segEy[i0]];
      const startKey = ptKey(segSx[i0], segSy[i0]);
      let cur = ptKey(segEx[i0], segEy[i0]);
      let closed = false;
      for (;;) {
        const j = take(byStart, cur);
        if (j < 0) {
          break;
        }
        used[j] = true;
        const ek = ptKey(segEx[j], segEy[j]);
        if (ek === startKey) {
          closed = true; // close the loop; do NOT duplicate the first point
          break;
        }
        pts.push(segEx[j], segEy[j]);
        cur = ek;
      }
      if (!closed) {
        let curb = startKey;
        const back: number[] = [];
        for (;;) {
          const j = take(byEnd, curb);
          if (j < 0) {
            break;
          }
          used[j] = true;
          back.push(segSx[j], segSy[j]);
          curb = ptKey(segSx[j], segSy[j]);
        }
        if (back.length) {
          // back was appended forward; prepend in reverse point order
          const rev: number[] = [];
          for (let i = back.length - 2; i >= 0; i -= 2) {
            rev.push(back[i], back[i + 1]);
          }
          pts.unshift(...rev);
        }
      }
      nPolys++;
      out.push(pts.length / 2, closed ? 1 : 0, ...pts);
    }
    out[nPolysAt] = nPolys;
  }
  return Float32Array.from(out);
}

/** Crossing point on a cell edge — canonical direction, f32 per-op (see header). */
function edgePoint(
  edge: number,
  cx: number,
  cy: number,
  level: number,
  v00: number,
  v10: number,
  v01: number,
  v11: number
): [number, number] {
  switch (edge) {
    case EDGE_T: {
      const t = fr(fr(level - v00) / fr(v10 - v00));
      return [fr(cx + t), cy];
    }
    case EDGE_B: {
      const t = fr(fr(level - v01) / fr(v11 - v01));
      return [fr(cx + t), fr(cy + 1)];
    }
    case EDGE_L: {
      const t = fr(fr(level - v00) / fr(v01 - v00));
      return [cx, fr(cy + t)];
    }
    default: {
      const t = fr(fr(level - v10) / fr(v11 - v10));
      return [fr(cx + 1), fr(cy + t)];
    }
  }
}

/** Decode the packed buffer into per-level polyline lists. */
export function decodeIsoContours(packed: Float32Array): IsoContoursByLevel {
  const result: IsoContoursByLevel = [];
  let p = 0;
  const nLevels = packed[p++] | 0;
  for (let li = 0; li < nLevels; li++) {
    const polys: IsoPolyline[] = [];
    const nPolys = (packed[p++] ?? 0) | 0;
    for (let pi = 0; pi < nPolys; pi++) {
      const nPts = (packed[p++] ?? 0) | 0;
      const closed = packed[p++] === 1;
      polys.push({ points: packed.slice(p, p + nPts * 2), closed });
      p += nPts * 2;
    }
    result.push(polys);
  }
  return result;
}

export default marchingSquaresMulti;
