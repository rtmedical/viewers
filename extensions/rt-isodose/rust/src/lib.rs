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

/// Version probe so the JS loader can confirm the WASM module is the expected one.
#[wasm_bindgen]
pub fn kernel_version() -> u32 {
    1
}
