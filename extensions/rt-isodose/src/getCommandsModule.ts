/**
 * rt-isodose commands (RTV Wave 4 / Phase 5).
 *
 * `rtDoseKernelSelfTest` — a diagnostic that loads the Rust→WASM iso-band kernel
 * and verifies its output matches the pure-JS reference on fixed + pseudo-random
 * inputs. Proves the WASM toolchain end-to-end in the running app. Safe/read-only
 * (no viewport mutation). The RTDOSE viewport colorwash awaits a dose-aware
 * volume builder (the next Rust/WASM step) — see doseBands / doseBandsWasm.
 */
import { volumeLoader, cache as csCache } from '@cornerstonejs/core';
import { doseToBandLabelmap as doseToBandLabelmapJs } from './doseBands';
import { initDoseKernel } from './doseBandsWasm';
import { dose_to_band_labelmap } from '../rust/pkg/rt_dose_kernel.js';

const DOSE_VOLUME_PREFIX = 'cornerstoneStreamingImageVolume:';

function getCommandsModule({
  servicesManager,
  commandsManager,
  extensionManager,
}: {
  servicesManager: any;
  commandsManager?: any;
  extensionManager?: any;
}) {
  const findDose = () => {
    const { displaySetService } = servicesManager.services;
    const all =
      displaySetService?.getActiveDisplaySets?.() ?? displaySetService?.activeDisplaySets ?? [];
    return (all as any[]).find(ds => ds?.Modality === 'RTDOSE');
  };
  const orthographicViewports = (): any[] => {
    const { cornerstoneViewportService } = servicesManager.services;
    const re = cornerstoneViewportService?.getRenderingEngine?.();
    return re ? re.getViewports().filter((vp: any) => vp?.type === 'orthographic') : [];
  };
  /** All (multiframe-expanded) imageIds for the RTDOSE display set. */
  const doseImageIds = (doseDs: any): string[] => {
    if (Array.isArray(doseDs?.imageIds) && doseDs.imageIds.length) {
      return doseDs.imageIds;
    }
    try {
      const dataSource = extensionManager?.getActiveDataSource?.()?.[0];
      const ids = dataSource?.getImageIdsForDisplaySet?.(doseDs);
      if (Array.isArray(ids) && ids.length) {
        return ids;
      }
    } catch (e) {
      /* ignore */
    }
    return [];
  };

  const actions = {
    /**
     * Eclipse "Dose Color Wash": overlay the RTDOSE as a coloured layer on the CT
     * MPR viewports via the stock `addDisplaySetAsLayer` command — it expands all
     * RTDOSE frames into a correctly-geometried volume and applies the registered
     * `Isodose` colormap (DoseGridScaling already applied by the loader). Renders
     * natively in every MPR plane. Display-only.
     */
    showDoseWash: async ({ colormap = 'Isodose', opacity = 0.5 }: { colormap?: string; opacity?: number } = {}) => {
      const { uiNotificationService } = servicesManager.services;
      const notify = (message: string, type = 'info') =>
        uiNotificationService?.show?.({ title: 'Dose (RTDOSE)', message, type });
      const doseDs = findDose();
      if (!doseDs) {
        notify('Nenhum RTDOSE carregado.', 'info');
        return false;
      }
      const vps = orthographicViewports();
      if (!vps.length) {
        notify('Nenhum viewport MPR no layout atual.', 'warning');
        return false;
      }

      // The generic streaming loader builds the RTDOSE with correct dims but a
      // z-spacing of 0 (it can't derive slice spacing from the multiframe RTDOSE)
      // → downstream 1/0 = Infinity → `new Uint8Array(Infinity)` crash. Load the
      // streaming volume (its scheme has a real image loader) and PATCH the
      // z-spacing from GridFrameOffsetVector before adding it. A createLocalVolume
      // rebuild also works but its custom volumeId scheme has no image loader.
      const volumeId = `${DOSE_VOLUME_PREFIX}${doseDs.displaySetInstanceUID}`;
      let maxDose = 0;
      try {
        const imageIds = doseImageIds(doseDs);
        if (imageIds.length < 2) {
          notify('RTDOSE sem frames suficientes para o volume.', 'warning');
          return false;
        }
        let vol = csCache.getVolume?.(volumeId);
        if (!vol) {
          vol = await volumeLoader.createAndCacheVolume(volumeId, { imageIds });
        }
        await vol?.load?.();

        // Max dose for the colormap VOI (strided scan; DoseGridScaling applied).
        const scalarData: Float32Array = vol?.voxelManager?.getCompleteScalarDataArray?.();
        if (scalarData?.length) {
          for (let i = 0; i < scalarData.length; i += 101) {
            if (scalarData[i] > maxDose) maxDose = scalarData[i];
          }
        }

        // Patch the z-spacing from GridFrameOffsetVector (frame step, mm).
        const inst = doseDs.instances?.[0] ?? doseDs.instance ?? {};
        const gfov = (Array.isArray(inst.GridFrameOffsetVector) ? inst.GridFrameOffsetVector : [])
          .map(Number)
          .filter((n: number) => Number.isFinite(n));
        const dz = gfov.length > 1 ? Math.abs(gfov[1] - gfov[0]) || 1 : 1;
        const ps = (Array.isArray(inst.PixelSpacing) ? inst.PixelSpacing : [1, 1]).map(Number);
        const sp = vol?.imageData?.getSpacing?.();
        if (sp && (!sp[2] || !Number.isFinite(sp[2]))) {
          vol.imageData.setSpacing([ps[1] || sp[0], ps[0] || sp[1], dz]);
          vol.imageData.modified();
          try {
            (vol as any).spacing = [ps[1] || sp[0], ps[0] || sp[1], dz];
          } catch (e) {
            /* read-only in some builds — imageData spacing is what renders */
          }
        }
      } catch (e) {
        notify('Falha ao carregar o volume de dose.', 'error');
        return false;
      }

      const voiRange = maxDose > 0 ? { lower: 0, upper: maxDose } : undefined;
      let added = 0;
      for (const vp of vps) {
        try {
          if (!vp.getAllVolumeIds?.().includes(volumeId)) {
            await vp.addVolumes([{ volumeId }], false, true);
          }
          vp.setProperties({ colormap: { name: colormap, opacity }, ...(voiRange ? { voiRange } : {}) }, volumeId);
          vp.render();
          added++;
        } catch (e) {
          /* viewport can't take the overlay — skip */
        }
      }
      notify(added ? 'Dose color wash aplicado (colormap Isodose).' : 'Nada a renderizar.', added ? 'info' : 'warning');
      return added > 0;
    },

    /** Remove the RTDOSE overlay from the MPR viewports. */
    hideDoseOverlay: () => {
      const { uiNotificationService } = servicesManager.services;
      const doseDs = findDose();
      if (!doseDs) {
        return false;
      }
      const volumeId = `${DOSE_VOLUME_PREFIX}${doseDs.displaySetInstanceUID}`;
      let removed = 0;
      for (const vp of orthographicViewports()) {
        try {
          if (vp.getAllVolumeIds?.().includes(volumeId)) {
            vp.removeVolumeActors?.([volumeId], true);
            removed++;
          }
        } catch (e) {
          /* skip */
        }
      }
      uiNotificationService?.show?.({
        title: 'Dose (RTDOSE)',
        message: removed ? 'Dose removida.' : 'Nenhuma sobreposição ativa.',
        type: 'info',
      });
      return removed > 0;
    },

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
      showDoseWash: { commandFn: actions.showDoseWash },
      hideDoseOverlay: { commandFn: actions.hideDoseOverlay },
      rtDoseKernelSelfTest: { commandFn: actions.rtDoseKernelSelfTest },
    },
    defaultContext: 'DEFAULT',
  };
}

export default getCommandsModule;
