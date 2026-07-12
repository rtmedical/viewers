/* @ts-self-types="./rt_dose_kernel.d.ts" */

/**
 * Assign each voxel to an isodose band: the number of ascending dose thresholds
 * its value reaches (band 0 = no/void dose, band N = at/above the highest level).
 *
 * Mirrors the JS reference algorithm; comparisons are in f32, so it is identical
 * to the JS core *within f32 precision* — feed both the same f32-quantized inputs
 * (the JS loader does) and the two agree bit-for-bit. `levels_gy` is filtered to
 * finite values and sorted ascending here, so the caller may pass them in any
 * order. Non-positive, NaN and infinite doses map to band 0. ≤255 levels.
 * @param {Float32Array} scalar
 * @param {Float32Array} levels_gy
 * @returns {Uint8Array}
 */
export function dose_to_band_labelmap(scalar, levels_gy) {
    const ptr0 = passArrayF32ToWasm0(scalar, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF32ToWasm0(levels_gy, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.dose_to_band_labelmap(ptr0, len0, ptr1, len1);
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * Version probe so the JS loader can confirm the WASM module is the expected one.
 * v2 = adds `marching_squares_multi` (vector isodose lines).
 * @returns {number}
 */
export function kernel_version() {
    const ret = wasm.kernel_version();
    return ret >>> 0;
}

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
 * @param {Float32Array} grid
 * @param {number} width
 * @param {number} height
 * @param {Float32Array} levels
 * @returns {Float32Array}
 */
export function marching_squares_multi(grid, width, height, levels) {
    const ptr0 = passArrayF32ToWasm0(grid, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF32ToWasm0(levels, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.marching_squares_multi(ptr0, len0, width, height, ptr1, len1);
    var v3 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v3;
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./rt_dose_kernel_bg.js": import0,
    };
}

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedFloat32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('rt_dose_kernel_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
