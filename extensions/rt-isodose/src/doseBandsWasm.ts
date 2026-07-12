/**
 * WASM loader for the iso-band kernel (RTV Wave 4 / Phase 5).
 *
 * Loads the Rust→WASM `dose_to_band_labelmap` (compiled via Docker into
 * ./rust/pkg by rust/build.sh) and exposes it with a transparent fallback to the
 * pure-JS {@link ./doseBands} core when the WASM can't load. The .wasm is emitted
 * by rspack as an asset via `new URL(..., import.meta.url)` (same pattern OHIF
 * uses for the ONNX runtime), so no webpack config change is needed. Zero fork.
 */
import { doseToBandLabelmap as doseToBandLabelmapJs } from './doseBands';
import init, { dose_to_band_labelmap, kernel_version } from '../rust/pkg/rt_dose_kernel.js';

let ready: Promise<boolean> | null = null;

/** Initialize the WASM module once. Resolves false if it can't load (→ JS fallback). */
export function initDoseKernel(): Promise<boolean> {
  if (!ready) {
    ready = (async () => {
      try {
        await init(new URL('../rust/pkg/rt_dose_kernel_bg.wasm', import.meta.url));
        return kernel_version() === 1;
      } catch (e) {
        return false;
      }
    })();
  }
  return ready;
}

/** True once the WASM kernel is loaded and version-matched. */
export async function isDoseKernelReady(): Promise<boolean> {
  return initDoseKernel();
}

/**
 * Iso-band labelmap via WASM when available, else the pure-JS core.
 *
 * Both inputs are quantized to f32 up front and BOTH branches consume the same
 * f32 values, so the WASM kernel and the JS fallback produce byte-identical
 * output (f32→f64 widening is exact and order-preserving). Without this, a
 * boundary voxel at e.g. `f32(45.6)` would land in a different band on the two
 * paths, because the Rust kernel compares in f32 while the JS core compares in
 * f64 — and passing f64 levels to JS but f32 levels to WASM would diverge.
 */
export async function doseToBandLabelmapAccelerated(
  scalar: ArrayLike<number>,
  levelsGy: number[]
): Promise<Uint8Array> {
  const s = scalar instanceof Float32Array ? scalar : Float32Array.from(scalar as any);
  const lv = Float32Array.from(levelsGy);
  const ok = await initDoseKernel();
  if (ok) {
    return dose_to_band_labelmap(s, lv);
  }
  // Fallback must see the SAME f32-quantized inputs → identical bands.
  return doseToBandLabelmapJs(s, Array.from(lv));
}

export default doseToBandLabelmapAccelerated;
