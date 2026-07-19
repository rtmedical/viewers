/* tslint:disable */
/* eslint-disable */

/**
 * Assign each voxel to an isodose band: the number of ascending dose thresholds
 * its value reaches (band 0 = no/void dose, band N = at/above the highest level).
 *
 * Mirrors the JS reference algorithm; comparisons are in f32, so it is identical
 * to the JS core *within f32 precision* — feed both the same f32-quantized inputs
 * (the JS loader does) and the two agree bit-for-bit. `levels_gy` is filtered to
 * finite values and sorted ascending here, so the caller may pass them in any
 * order. Non-positive, NaN and infinite doses map to band 0. ≤255 levels.
 */
export function dose_to_band_labelmap(scalar: Float32Array, levels_gy: Float32Array): Uint8Array;

/**
 * Version probe so the JS loader can confirm the WASM module is the expected one.
 * v2 = adds `marching_squares_multi` (vector isodose lines).
 */
export function kernel_version(): number;

/**
 * Vector isodose lines: marching squares over a row-major 2D dose slice at N
 * levels → packed polyline buffer. Mirrors the JS core (isodoseLines.ts) so
 * parity is a single element-wise Float32Array compare — same f32 arithmetic,
 * same scan/emission/chaining order, same packed encoding:
 *
 * ```text
 * [ nLevels,
 *   per level (input order):  nPolylines,
 *     per polyline:           nPoints, closed(1|0), x0, y0, x1, y1, … ]
 * ```
 *
 * Coordinates are GRID coordinates (x ∈ [0,w-1] right, y ∈ [0,h-1] down); the
 * caller maps grid→world→canvas. Non-finite dose values behave as 0 (sanitized
 * up front — wasm NaN payloads are nondeterministic and would poison the
 * bit-pattern point keys). Saddles use the average-center rule. Determinism:
 * the endpoint maps are lookup-only (never iterated) and joins always take the
 * lowest-index unused segment, so output is independent of the hasher.
 */
export function marching_squares_multi(grid: Float32Array, width: number, height: number, levels: Float32Array): Float32Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly dose_to_band_labelmap: (a: number, b: number, c: number, d: number) => [number, number];
    readonly kernel_version: () => number;
    readonly marching_squares_multi: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
