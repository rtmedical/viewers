/**
 * rt-isodose commands (RTV Wave 4 / Phase 5).
 *
 * `rtDoseKernelSelfTest` — a diagnostic that loads the Rust→WASM iso-band kernel
 * and verifies its output matches the pure-JS reference on fixed + pseudo-random
 * inputs. Proves the WASM toolchain end-to-end in the running app. Safe/read-only
 * (no viewport mutation). The RTDOSE viewport colorwash awaits a dose-aware
 * volume builder (the next Rust/WASM step) — see doseBands / doseBandsWasm.
 */
import { doseToBandLabelmap as doseToBandLabelmapJs } from './doseBands';
import { initDoseKernel } from './doseBandsWasm';
import { dose_to_band_labelmap } from '../rust/pkg/rt_dose_kernel.js';

function getCommandsModule({ servicesManager }: { servicesManager: any }) {
  const actions = {
    rtDoseKernelSelfTest: async () => {
      const wasmLoaded = await initDoseKernel();
      const levels = [24, 45.6, 48]; // e.g. 50/95/100% of 48 Gy
      // Both paths must consume the same f32-quantized levels (see doseBandsWasm).
      const lvF32 = Float32Array.from(levels);
      // Deterministic pseudo-random dose grid (no Math.random for reproducibility)…
      const rand = 5000;
      // …plus exact-boundary voxels the PRNG would never hit, so this actually
      // exercises the f32 boundary the auditor flagged.
      const boundary: number[] = [];
      for (const l of lvF32) {
        boundary.push(l, l - 1e-4, l + 1e-4, l * (1 + 1e-7), l * (1 - 1e-7));
      }
      const n = rand + boundary.length;
      const scalar = new Float32Array(n);
      let seed = 123456789;
      for (let i = 0; i < rand; i++) {
        seed = (1103515245 * seed + 12345) & 0x7fffffff;
        scalar[i] = (seed / 0x7fffffff) * 55; // 0..55 Gy
      }
      boundary.forEach((v, i) => (scalar[rand + i] = v));

      const js = doseToBandLabelmapJs(scalar, Array.from(lvF32));
      let mismatches = 0;
      let match = true;
      if (wasmLoaded) {
        const wasm = dose_to_band_labelmap(scalar, lvF32);
        if (wasm.length !== js.length) {
          match = false;
        } else {
          for (let i = 0; i < js.length; i++) {
            if (wasm[i] !== js[i]) {
              mismatches++;
            }
          }
          match = mismatches === 0;
        }
      }
      const result = { wasmLoaded, match, mismatches, samples: n };
      servicesManager?.services?.uiNotificationService?.show?.({
        title: 'RT Dose Kernel (WASM)',
        message: wasmLoaded
          ? match
            ? `WASM OK — bate com JS em ${n} amostras.`
            : `WASM divergiu do JS em ${mismatches} amostras!`
          : 'WASM indisponível — usando fallback JS.',
        type: wasmLoaded && match ? 'success' : wasmLoaded ? 'error' : 'warning',
      });
      // expose for programmatic E2E assertion
      (window as any).__rtDoseKernelSelfTest = result;
      return result;
    },
  };

  return {
    actions,
    definitions: {
      rtDoseKernelSelfTest: { commandFn: actions.rtDoseKernelSelfTest },
    },
    defaultContext: 'DEFAULT',
  };
}

export default getCommandsModule;
