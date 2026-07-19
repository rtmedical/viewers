/* tslint:disable */
/* eslint-disable */

/**
 * Assign each voxel to an isodose band: the number of ascending dose thresholds
 * its value reaches (band 0 = no/void dose, band N = at/above the highest level).
 *
 * Mirrors the JS reference exactly: `levels_gy` is filtered to finite values and
 * sorted ascending here, so the caller may pass them in any order. Non-positive,
 * NaN and infinite doses map to band 0. Up to 255 levels are supported.
 */
export function dose_to_band_labelmap(scalar: Float32Array, levels_gy: Float32Array): Uint8Array;

/**
 * Version probe so the JS loader can confirm the WASM module is the expected one.
 */
export function kernel_version(): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly dose_to_band_labelmap: (a: number, b: number, c: number, d: number) => [number, number];
    readonly kernel_version: () => number;
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
