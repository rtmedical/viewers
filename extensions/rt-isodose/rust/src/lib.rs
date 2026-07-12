//! Rust→WASM compute kernels for the RT dose viewer (RTV Wave 4 / Phase 5).
//!
//! First kernel: `dose_to_band_labelmap` — the hot per-voxel loop of the Eclipse
//! "Isodose Color Wash", ported 1:1 from the JS `doseToBandLabelmap`
//! (extensions/rt-isodose/src/doseBands.ts) so the WASM path is a drop-in
//! accelerator with identical output. Compiled to WASM via Docker (see
//! ../Dockerfile / ../build.sh); the JS side loads pkg/ and falls back to the
//! pure-JS core when WASM is unavailable.

use wasm_bindgen::prelude::*;

/// Assign each voxel to an isodose band: the number of ascending dose thresholds
/// its value reaches (band 0 = no/void dose, band N = at/above the highest level).
///
/// Mirrors the JS reference algorithm; comparisons are in f32, so it is identical
/// to the JS core *within f32 precision* — feed both the same f32-quantized inputs
/// (the JS loader does) and the two agree bit-for-bit. `levels_gy` is filtered to
/// finite values and sorted ascending here, so the caller may pass them in any
/// order. Non-positive, NaN and infinite doses map to band 0. ≤255 levels.
#[wasm_bindgen]
pub fn dose_to_band_labelmap(scalar: &[f32], levels_gy: &[f32]) -> Vec<u8> {
    let mut out = vec![0u8; scalar.len()];

    let mut levels: Vec<f32> = levels_gy
        .iter()
        .copied()
        .filter(|v| v.is_finite())
        .collect();
    if levels.is_empty() {
        return out;
    }
    levels.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n_levels = levels.len().min(255);

    for (i, &d) in scalar.iter().enumerate() {
        if !(d > 0.0) || !d.is_finite() {
            continue; // band 0
        }
        let mut band: u8 = 0;
        for k in 0..n_levels {
            if d >= levels[k] {
                band = (k + 1) as u8;
            } else {
                break;
            }
        }
        out[i] = band;
    }
    out
}

use std::collections::HashMap;

const EDGE_T: u8 = 0;
const EDGE_R: u8 = 1;
const EDGE_B: u8 = 2;
const EDGE_L: u8 = 3;

/// Exact-bit point key (f32 bit patterns packed into a u64). Shared cell edges
/// interpolate the same node pair in the same canonical direction, so crossing
/// points are bit-identical between neighbouring cells — no epsilon needed.
#[inline]
fn pkey(p: [f32; 2]) -> u64 {
    ((p[0].to_bits() as u64) << 32) | (p[1].to_bits() as u64)
}

/// Marching-squares case → directed segments (from-edge, to-edge), oriented so
/// the inside (>= level) region is on the left of travel (x right, y down).
/// The consistent winding makes adjacent-cell segments chain head→tail.
/// Case bits: TL<<3 | TR<<2 | BR<<1 | BL, where a corner is set when >= level.
#[inline]
fn case_segments(case: u8, center_inside: bool) -> &'static [(u8, u8)] {
    match case {
        1 => &[(EDGE_B, EDGE_L)],
        2 => &[(EDGE_R, EDGE_B)],
        3 => &[(EDGE_R, EDGE_L)],
        4 => &[(EDGE_T, EDGE_R)],
        5 => {
            if center_inside {
                &[(EDGE_T, EDGE_L), (EDGE_B, EDGE_R)]
            } else {
                &[(EDGE_T, EDGE_R), (EDGE_B, EDGE_L)]
            }
        }
        6 => &[(EDGE_T, EDGE_B)],
        7 => &[(EDGE_T, EDGE_L)],
        8 => &[(EDGE_L, EDGE_T)],
        9 => &[(EDGE_B, EDGE_T)],
        10 => {
            if center_inside {
                &[(EDGE_R, EDGE_T), (EDGE_L, EDGE_B)]
            } else {
                &[(EDGE_L, EDGE_T), (EDGE_R, EDGE_B)]
            }
        }
        11 => &[(EDGE_R, EDGE_T)],
        12 => &[(EDGE_L, EDGE_R)],
        13 => &[(EDGE_B, EDGE_R)],
        14 => &[(EDGE_L, EDGE_B)],
        _ => &[],
    }
}

/// Crossing point on a cell edge. Canonical interpolation direction (horizontal
/// edges left→right, vertical edges top→bottom) so both cells sharing an edge
/// compute a bit-identical point. Only called on crossed edges, where one node
/// is >= level and the other < level, so the denominator is never zero.
#[inline]
fn edge_point(
    edge: u8,
    cx: usize,
    cy: usize,
    level: f32,
    v00: f32,
    v10: f32,
    v01: f32,
    v11: f32,
) -> [f32; 2] {
    let (fx, fy) = (cx as f32, cy as f32);
    match edge {
        EDGE_T => {
            let t = (level - v00) / (v10 - v00);
            [fx + t, fy]
        }
        EDGE_B => {
            let t = (level - v01) / (v11 - v01);
            [fx + t, fy + 1.0]
        }
        EDGE_L => {
            let t = (level - v00) / (v01 - v00);
            [fx, fy + t]
        }
        _ => {
            let t = (level - v10) / (v11 - v10);
            [fx + 1.0, fy + t]
        }
    }
}

/// Vector isodose lines: marching squares over a row-major 2D dose slice at N
/// levels → packed polyline buffer. Mirrors the JS core (isodoseLines.ts) so
/// parity is a single element-wise Float32Array compare — same f32 arithmetic,
/// same scan/emission/chaining order, same packed encoding:
///
/// ```text
/// [ nLevels,
///   per level (input order):  nPolylines,
///     per polyline:           nPoints, closed(1|0), x0, y0, x1, y1, … ]
/// ```
///
/// Coordinates are GRID coordinates (x ∈ [0,w-1] right, y ∈ [0,h-1] down); the
/// caller maps grid→world→canvas. Non-finite dose values behave as 0 (sanitized
/// up front — wasm NaN payloads are nondeterministic and would poison the
/// bit-pattern point keys). Saddles use the average-center rule. Determinism:
/// the endpoint maps are lookup-only (never iterated) and joins always take the
/// lowest-index unused segment, so output is independent of the hasher.
#[wasm_bindgen]
pub fn marching_squares_multi(grid: &[f32], width: u32, height: u32, levels: &[f32]) -> Vec<f32> {
    let (w, h) = (width as usize, height as usize);
    let mut out: Vec<f32> = Vec::with_capacity(64);
    out.push(levels.len() as f32);
    if w < 2 || h < 2 || grid.len() != w * h {
        for _ in levels {
            out.push(0.0);
        }
        return out;
    }
    let g: Vec<f32> = grid
        .iter()
        .map(|&v| if v.is_finite() { v } else { 0.0 })
        .collect();

    for &level in levels {
        // pass 1: directed segments, row-major cell scan (deterministic)
        let mut seg_s: Vec<[f32; 2]> = Vec::new();
        let mut seg_e: Vec<[f32; 2]> = Vec::new();
        for cy in 0..h - 1 {
            let (row0, row1) = (cy * w, cy * w + w);
            for cx in 0..w - 1 {
                let (v00, v10) = (g[row0 + cx], g[row0 + cx + 1]);
                let (v01, v11) = (g[row1 + cx], g[row1 + cx + 1]);
                let case = (((v00 >= level) as u8) << 3)
                    | (((v10 >= level) as u8) << 2)
                    | (((v11 >= level) as u8) << 1)
                    | ((v01 >= level) as u8);
                if case == 0 || case == 15 {
                    continue;
                }
                let center_inside = (case == 5 || case == 10)
                    && (((v00 + v10) + v11) + v01) * 0.25 >= level;
                for &(ef, et) in case_segments(case, center_inside) {
                    let s = edge_point(ef, cx, cy, level, v00, v10, v01, v11);
                    let e = edge_point(et, cx, cy, level, v00, v10, v01, v11);
                    if pkey(s) == pkey(e) {
                        continue; // corner exactly on level → zero-length
                    }
                    seg_s.push(s);
                    seg_e.push(e);
                }
            }
        }
        // pass 2: chain segments into polylines (lowest-unused-index joins)
        let n = seg_s.len();
        let mut by_start: HashMap<u64, Vec<u32>> = HashMap::with_capacity(n * 2);
        let mut by_end: HashMap<u64, Vec<u32>> = HashMap::with_capacity(n * 2);
        for i in 0..n {
            by_start.entry(pkey(seg_s[i])).or_default().push(i as u32);
            by_end.entry(pkey(seg_e[i])).or_default().push(i as u32);
        }
        let take = |m: &HashMap<u64, Vec<u32>>, k: u64, used: &[bool]| -> Option<u32> {
            m.get(&k)?.iter().copied().find(|&i| !used[i as usize])
        };
        let mut used = vec![false; n];
        let n_polys_at = out.len();
        out.push(0.0);
        let mut n_polys = 0u32;
        for i0 in 0..n {
            if used[i0] {
                continue;
            }
            used[i0] = true;
            let mut pts: Vec<[f32; 2]> = vec![seg_s[i0], seg_e[i0]];
            let start_key = pkey(seg_s[i0]);
            let mut cur = pkey(seg_e[i0]);
            let mut closed = false;
            while let Some(j) = take(&by_start, cur, &used) {
                used[j as usize] = true;
                let ek = pkey(seg_e[j as usize]);
                if ek == start_key {
                    closed = true; // close the loop; do NOT duplicate the first point
                    break;
                }
                pts.push(seg_e[j as usize]);
                cur = ek;
            }
            if !closed {
                let mut curb = start_key;
                let mut back: Vec<[f32; 2]> = Vec::new();
                while let Some(j) = take(&by_end, curb, &used) {
                    used[j as usize] = true;
                    back.push(seg_s[j as usize]);
                    curb = pkey(seg_s[j as usize]);
                }
                if !back.is_empty() {
                    back.reverse();
                    back.extend_from_slice(&pts);
                    pts = back;
                }
            }
            n_polys += 1;
            out.push(pts.len() as f32);
            out.push(if closed { 1.0 } else { 0.0 });
            for p in &pts {
                out.push(p[0]);
                out.push(p[1]);
            }
        }
        out[n_polys_at] = n_polys as f32;
    }
    out
}

/// Version probe so the JS loader can confirm the WASM module is the expected one.
/// v2 = adds `marching_squares_multi` (vector isodose lines).
#[wasm_bindgen]
pub fn kernel_version() -> u32 {
    2
}
