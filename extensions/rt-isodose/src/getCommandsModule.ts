/**
 * rt-isodose commands (RTV Wave 4 / Phase 5+).
 *
 * `showDoseWash`/`hideDoseOverlay` — Eclipse-style RTDOSE color wash on the MPR.
 * `showIsodoseLines`/`hideIsodoseLines`/`toggleIsodoseLines` — Eclipse-style
 * vector isodose LINES (marching squares over the dose grid sampled on each
 * camera plane, SVG overlay — see isodoseLinesOverlay / marchingSquares).
 * `rtDoseKernelSelfTest` — a diagnostic that loads the Rust→WASM iso-band kernel
 * and verifies its output matches the pure-JS reference on fixed + pseudo-random
 * inputs. Proves the WASM toolchain end-to-end in the running app.
 */
import { volumeLoader, cache as csCache, eventTarget, Enums } from '@cornerstonejs/core';
import { doseToBandLabelmap as doseToBandLabelmapJs } from './doseBands';
import { initDoseKernel } from './doseBandsWasm';
import { dose_to_band_labelmap } from '../rust/pkg/rt_dose_kernel.js';
import { resolveIsodoseLineLevels } from './isodoseLineLevels';
import { derivePrescription } from './rxDose';
import {
  attachIsodoseLines,
  detachIsodoseLines,
  hasIsodoseLines,
  isodoseLinesViewportIds,
} from './isodoseLinesOverlay';

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

  /**
   * Load (or reuse) the RTDOSE streaming volume, patch its z-spacing from
   * GridFrameOffsetVector, and scan its max raw scalar. Shared by the dose wash
   * and the isodose lines. Returns null (after notifying) when unusable.
   *
   * The generic streaming loader builds the RTDOSE with correct dims but a
   * z-spacing of 0 (it can't derive slice spacing from the multiframe RTDOSE)
   * → downstream 1/0 = Infinity → `new Uint8Array(Infinity)` crash. Load the
   * streaming volume (its scheme has a real image loader) and PATCH the
   * z-spacing from GridFrameOffsetVector before using it. A createLocalVolume
   * rebuild also works but its custom volumeId scheme has no image loader.
   */
  const ensureDoseVolume = async (
    doseDs: any,
    notify: (message: string, type?: string) => void
  ): Promise<{ vol: any; volumeId: string; maxDose: number } | null> => {
    const volumeId = `${DOSE_VOLUME_PREFIX}${doseDs.displaySetInstanceUID}`;
    try {
      const imageIds = doseImageIds(doseDs);
      if (imageIds.length < 2) {
        notify('RTDOSE has too few frames for a volume.', 'warning');
        return null;
      }
      let vol: any = csCache.getVolume?.(volumeId);
      if (!vol) {
        vol = await volumeLoader.createAndCacheVolume(volumeId, { imageIds });
      }
      await vol?.load?.();

      // Max dose drives the colormap VOI + the low-dose transparency threshold.
      // (Values are the RTDOSE stored pixels; the threshold is a *fraction* of
      // the max, so it's correct whether or not DoseGridScaling was applied.)
      // A streaming volume's load() resolves before every frame has arrived, so
      // a scan here can race to ~0; wait for the load-complete event (or a short
      // timeout) when the first scan is empty, then rescan. Cached/complete
      // volumes scan non-zero immediately and skip the wait.
      const scanMaxDose = (): number => {
        const sd: ArrayLike<number> | undefined = vol?.voxelManager?.getCompleteScalarDataArray?.();
        let m = 0;
        if (sd?.length) {
          for (let i = 0; i < sd.length; i += 101) {
            if (sd[i] > m) m = sd[i];
          }
        }
        return m;
      };
      let maxDose = scanMaxDose();
      if (maxDose <= 0) {
        await new Promise<void>(resolve => {
          let settled = false;
          const evt = Enums.Events.IMAGE_VOLUME_LOADING_COMPLETED;
          const done = () => {
            if (settled) return;
            settled = true;
            eventTarget.removeEventListener(evt, handler);
            resolve();
          };
          const handler = (e: any) => {
            const id = e?.detail?.volumeId ?? e?.detail?.volume?.volumeId;
            if (!id || id === volumeId) done();
          };
          eventTarget.addEventListener(evt, handler);
          setTimeout(done, 4000);
        });
        maxDose = scanMaxDose();
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
      return { vol, volumeId, maxDose };
    } catch (e) {
      notify('Failed to load the dose volume.', 'error');
      return null;
    }
  };

  const actions = {
    /**
     * Eclipse "Dose Color Wash": overlay the RTDOSE as a coloured layer on the CT
     * MPR viewports via the stock `addDisplaySetAsLayer` command — it expands all
     * RTDOSE frames into a correctly-geometried volume and applies the registered
     * `Isodose` colormap (DoseGridScaling already applied by the loader). Renders
     * natively in every MPR plane. Display-only.
     */
    showDoseWash: async ({
      colormap = 'Isodose',
      opacity = 0.4,
      threshold = 0.1,
    }: { colormap?: string; opacity?: number; threshold?: number } = {}) => {
      const { uiNotificationService } = servicesManager.services;
      const notify = (message: string, type = 'info') =>
        uiNotificationService?.show?.({ title: 'Dose (RTDOSE)', message, type });
      const doseDs = findDose();
      if (!doseDs) {
        notify('No RTDOSE loaded.', 'info');
        return false;
      }
      const vps = orthographicViewports();
      if (!vps.length) {
        notify('No MPR viewport in the current layout.', 'warning');
        return false;
      }
      const ensured = await ensureDoseVolume(doseDs, notify);
      if (!ensured) {
        return false;
      }
      const { volumeId, maxDose } = ensured;

      const voiRange = maxDose > 0 ? { lower: 0, upper: maxDose } : undefined;
      // Eclipse-style wash: keep cold regions fully transparent below a low-dose
      // threshold (default 10% of max) so the CT reads through, then a flat fill
      // above it — instead of a uniform wash over the whole grid (which looked
      // saturated). `opacity` is a piecewise transfer function over the dose
      // (Gy) scalar range; fall back to a flat scalar opacity if this CS3D build
      // rejects the array form.
      const washColormap =
        maxDose > 0 && threshold > 0
          ? (() => {
              const thr = threshold * maxDose;
              const eps = maxDose * 1e-3;
              return {
                name: colormap,
                opacity: [
                  { value: 0, opacity: 0 },
                  { value: Math.max(0, thr - eps), opacity: 0 },
                  { value: thr, opacity },
                  { value: maxDose, opacity },
                ],
              };
            })()
          : { name: colormap, opacity };
      let added = 0;
      for (const vp of vps) {
        try {
          if (!vp.getAllVolumeIds?.().includes(volumeId)) {
            await vp.addVolumes([{ volumeId }], false, true);
          }
          // suppressEvents=true: the dose VOI must NOT emit VOI_MODIFIED — the
          // hanging protocol's VOI sync group would replay it onto the DEFAULT
          // (CT) volume of the sibling MPR viewports (window 2.4M → black CT
          // panes). Each viewport gets its dose properties directly here.
          try {
            vp.setProperties(
              { colormap: washColormap, ...(voiRange ? { voiRange } : {}) },
              volumeId,
              true
            );
          } catch (tfErr) {
            // piecewise opacity unsupported → flat opacity
            vp.setProperties(
              { colormap: { name: colormap, opacity }, ...(voiRange ? { voiRange } : {}) },
              volumeId,
              true
            );
          }
          vp.render();
          added++;
        } catch (e) {
          /* viewport can't take the overlay — skip */
        }
      }
      notify(added ? 'Dose color wash applied (Isodose colormap).' : 'Nothing to render.', added ? 'info' : 'warning');
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
        message: removed ? 'Dose removed.' : 'No active overlay.',
        type: 'info',
      });
      return removed > 0;
    },

    /**
     * Eclipse-style ISODOSE LINES: vector contours at the isodose levels drawn
     * over each MPR viewport (SVG overlay; marching squares over the RTDOSE
     * sampled on the camera plane). Levels come from the RTPLAN prescription
     * (Gy, via DoseGridScaling) or fall back to percent-of-max. Display-only.
     */
    showIsodoseLines: async ({ percents }: { percents?: number[] } = {}) => {
      const { uiNotificationService, displaySetService } = servicesManager.services;
      const notify = (message: string, type = 'info') =>
        uiNotificationService?.show?.({ title: 'Isodoses', message, type });
      const doseDs = findDose();
      if (!doseDs) {
        notify('No RTDOSE loaded.', 'info');
        return false;
      }
      const vps = orthographicViewports();
      if (!vps.length) {
        notify('No MPR viewport in the current layout.', 'warning');
        return false;
      }
      const ensured = await ensureDoseVolume(doseDs, notify);
      if (!ensured || !(ensured.maxDose > 0)) {
        if (ensured) {
          notify('Dose volume has no data to contour.', 'warning');
        }
        return false;
      }
      const inst = doseDs.instances?.[0] ?? doseDs.instance ?? {};
      const spec = resolveIsodoseLineLevels(
        ensured.maxDose,
        Number(inst.DoseGridScaling),
        derivePrescription(displaySetService),
        percents
      );
      if (!spec.levels.length) {
        notify('No isodose levels to draw.', 'warning');
        return false;
      }
      let attached = 0;
      for (const vp of vps) {
        try {
          if (attachIsodoseLines(vp, ensured.vol, spec.levels)) {
            attached++;
          }
        } catch (e) {
          /* viewport without a usable DOM container — skip */
        }
      }
      const how =
        spec.mode === 'absolute'
          ? 'levels in Gy from the prescription'
          : 'levels as % of the max dose (no prescription found)';
      notify(
        attached ? `Isodose lines drawn (${how}).` : 'Nothing to draw.',
        attached ? 'info' : 'warning'
      );
      // expose for programmatic E2E assertion
      (window as any).__rtIsodoseLines = {
        mode: spec.mode,
        gyPerRaw: spec.gyPerRaw,
        levels: spec.levels.map(l => ({ percent: l.percent, doseGy: l.doseGy, hex: l.hex })),
        viewports: isodoseLinesViewportIds(),
      };
      return attached > 0;
    },

    /** Remove the isodose-line overlays from every viewport. */
    hideIsodoseLines: () => {
      const removed = detachIsodoseLines();
      servicesManager.services.uiNotificationService?.show?.({
        title: 'Isodoses',
        message: removed ? 'Isodose lines removed.' : 'No isodose lines shown.',
        type: 'info',
      });
      return removed > 0;
    },

    /** Toolbar toggle: show the lines, or remove them when already shown. */
    toggleIsodoseLines: async ({ percents }: { percents?: number[] } = {}) => {
      if (hasIsodoseLines()) {
        return actions.hideIsodoseLines();
      }
      return actions.showIsodoseLines({ percents });
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
            ? `WASM OK — matches JS across ${n} samples.`
            : `WASM diverged from JS on ${mismatches} samples!`
          : 'WASM unavailable — using JS fallback.',
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
      showIsodoseLines: { commandFn: actions.showIsodoseLines },
      hideIsodoseLines: { commandFn: actions.hideIsodoseLines },
      toggleIsodoseLines: { commandFn: actions.toggleIsodoseLines },
      rtDoseKernelSelfTest: { commandFn: actions.rtDoseKernelSelfTest },
    },
    defaultContext: 'DEFAULT',
  };
}

export default getCommandsModule;
