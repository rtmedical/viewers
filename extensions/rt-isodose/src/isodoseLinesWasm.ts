/**
 * WASM dispatcher for the vector isodose-line kernel (marching squares).
 *
 * Reuses the shared `initDoseKernel` loader (doseBandsWasm.ts). The WASM call
 * itself is synchronous once the module is initialized, so a SYNC entry point
 * is exposed for use inside the tool's `renderAnnotation` (a sync hot path):
 * before init resolves — or when WASM can't load / the committed pkg predates
 * the export — it transparently falls back to the pure-JS core.
 *
 * Parity rule (PR #60): quantize grid AND levels to f32 up front and feed the
 * SAME f32 values to whichever branch runs; the JS core frounds every
 * intermediate, so both paths produce byte-identical packed buffers.
 */
import { marchingSquaresMulti as marchingSquaresMultiJs } from './isodoseLines';
import { initDoseKernel } from './doseBandsWasm';
import { marching_squares_multi } from '../rust/pkg/rt_dose_kernel.js';

let wasmReady = false;

/** Kick the WASM init (idempotent); flips the sync flag when it lands. */
export function warmIsodoseLinesKernel(): Promise<boolean> {
  return initDoseKernel().then(ok => {
    wasmReady = ok && typeof marching_squares_multi === 'function';
    return wasmReady;
  });
}

/** True once the WASM path is usable synchronously. */
export function isIsodoseLinesKernelReady(): boolean {
  return wasmReady;
}

/**
 * Synchronous marching squares: WASM when warmed, else the JS core.
 * Both paths consume the same f32-quantized inputs (see module header).
 */
export function marchingSquaresMultiSync(
  grid: ArrayLike<number>,
  width: number,
  height: number,
  levels: number[]
): Float32Array {
  const g = grid instanceof Float32Array ? grid : Float32Array.from(grid as any);
  const lv = Float32Array.from(levels);
  if (wasmReady) {
    try {
      return marching_squares_multi(g, width, height, lv);
    } catch (e) {
      wasmReady = false; // one-shot demotion; JS core is the reference anyway
    }
  }
  return marchingSquaresMultiJs(g, width, height, Array.from(lv));
}

export default marchingSquaresMultiSync;
