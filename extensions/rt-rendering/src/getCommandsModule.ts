/**
 * SSD commands (RTV-17) — the glue.
 *
 * The extraction itself is `vtkImageMarchingCubes` and the export is vtk.js's
 * `STLWriter`; both ship with the bundled vtk.js and neither is reimplemented here.
 * This module decides *whether* to run (see {@link ./ssdBudget}), with what
 * threshold (see {@link ./ssdPresets}), and hands the result to the viewport.
 *
 * vtk.js is pulled in with a dynamic `import()` inside the actions rather than at
 * module load: it is a large dependency, SSD is an occasional operation, and keeping
 * it out of the module graph means the pure cores stay testable without it.
 */
import {
  applyPreset,
  defaultSsdSettings,
  describeSsd,
  setColor,
  setOpacity,
  setThresholdHu,
  SsdSettings,
} from './ssdPresets';
import { describeBudget, planSsdExtraction, SsdBudget } from './ssdBudget';

interface ServicesManagerLike {
  services: Record<string, any>;
}

export interface SsdResult {
  ok: boolean;
  reason?: string;
  settings?: SsdSettings;
  budget?: SsdBudget;
}

export function createSsdActions({ servicesManager }: { servicesManager?: ServicesManagerLike }) {
  let settings: SsdSettings = defaultSsdSettings();
  /** The polydata of the last extraction, kept so export does not re-march. */
  let lastSurface: any = null;

  const services = () => servicesManager?.services ?? {};

  const notify = (message: string, type: 'info' | 'warning' | 'error' = 'info') =>
    services().uiNotificationService?.show?.({ title: 'SSD', message, type, duration: 4000 });

  /** The active viewport's image data, or null. */
  function activeVolume(): { viewport: any; imageData: any } | null {
    const { viewportGridService, cornerstoneViewportService } = services();
    const viewportId =
      viewportGridService?.getActiveViewportId?.() ??
      viewportGridService?.getState?.()?.activeViewportId;
    if (!viewportId) {
      return null;
    }
    const viewport = cornerstoneViewportService?.getCornerstoneViewport?.(viewportId);
    const imageData = viewport?.getImageData?.()?.imageData ?? viewport?.getImageData?.();
    return viewport && imageData ? { viewport, imageData } : null;
  }

  /** Dimensions/spacing/modality for the pre-flight. */
  function volumeDims(imageData: any, viewport: any) {
    const dimensions =
      imageData?.getDimensions?.() ?? imageData?.dimensions ?? undefined;
    const spacing = imageData?.getSpacing?.() ?? imageData?.spacing ?? undefined;
    const modality =
      viewport?.getImageData?.()?.metadata?.Modality ??
      viewport?.modality ??
      undefined;
    return { dimensions, spacing, modality };
  }

  const actions = {
    rtSsdGetSettings: (): SsdSettings => ({ ...settings, color: [...settings.color] as never }),

    rtSsdApplyPreset: ({ presetId }: { presetId?: string } = {}): SsdResult => {
      settings = applyPreset(presetId ?? 'corticalBone');
      notify(describeSsd(settings));
      return { ok: true, settings };
    },

    rtSsdSetThreshold: ({ thresholdHu }: { thresholdHu?: number } = {}): SsdResult => {
      settings = setThresholdHu(settings, thresholdHu);
      return { ok: true, settings };
    },

    rtSsdSetColor: ({ color }: { color?: unknown } = {}): SsdResult => {
      settings = setColor(settings, color);
      return { ok: true, settings };
    },

    rtSsdSetOpacity: ({ opacity }: { opacity?: number } = {}): SsdResult => {
      settings = setOpacity(settings, opacity);
      return { ok: true, settings };
    },

    /**
     * Pre-flight only: what would happen if we extracted now. Cheap, so a panel can
     * call it on every threshold change to keep the estimate live.
     */
    rtSsdPlan: (): SsdResult => {
      const active = activeVolume();
      if (!active) {
        return { ok: false, reason: 'No active viewport.' };
      }
      const budget = planSsdExtraction(
        volumeDims(active.imageData, active.viewport),
        settings.thresholdHu
      );
      return { ok: !budget.errors.length, reason: budget.errors[0], budget, settings };
    },

    /** Extracts the isosurface and adds it to the viewport. */
    rtSsdExtract: async (): Promise<SsdResult> => {
      const active = activeVolume();
      if (!active) {
        notify('No active viewport.', 'warning');
        return { ok: false, reason: 'No active viewport.' };
      }

      const budget = planSsdExtraction(
        volumeDims(active.imageData, active.viewport),
        settings.thresholdHu
      );
      if (budget.errors.length) {
        notify(budget.errors[0], 'error');
        return { ok: false, reason: budget.errors[0], budget };
      }
      budget.warnings.forEach(w => notify(w, 'warning'));

      try {
        const { default: vtkImageMarchingCubes } = await import(
          '@kitware/vtk.js/Filters/General/ImageMarchingCubes'
        );
        const marchingCubes = vtkImageMarchingCubes.newInstance({
          contourValue: settings.thresholdHu,
          computeNormals: true,
          mergePoints: true,
        });
        // The stride is what keeps a 105 M voxel CT from locking the tab.
        marchingCubes.setSampleRate?.(budget.sampleRate);
        marchingCubes.setInputData(active.imageData);
        lastSurface = marchingCubes.getOutputData();

        const added = addSurfaceToViewport(active.viewport, lastSurface, settings);
        if (!added) {
          return {
            ok: false,
            reason: 'The surface was extracted but the viewport could not display it.',
            budget,
            settings,
          };
        }
        notify(`${describeSsd(settings)} — ${describeBudget(budget)}`);
        return { ok: true, budget, settings };
      } catch (error) {
        const reason = `Surface extraction failed: ${(error as Error)?.message ?? 'unknown error'}`;
        notify(reason, 'error');
        return { ok: false, reason, budget };
      }
    },

    /** Exports the last extracted surface as binary STL. */
    rtSsdExportStl: async ({ filename }: { filename?: string } = {}): Promise<SsdResult> => {
      if (!lastSurface) {
        const reason = 'Extract a surface before exporting.';
        notify(reason, 'warning');
        return { ok: false, reason };
      }
      try {
        const { default: vtkSTLWriter } = await import('@kitware/vtk.js/IO/Geometry/STLWriter');
        const writer = vtkSTLWriter.newInstance({ format: 'binary' });
        writer.setInputData(lastSurface);
        const blob = new Blob([writer.getOutputData()], { type: 'model/stl' });
        downloadBlob(blob, filename || `ssd-${settings.thresholdHu}hu.stl`);
        return { ok: true, settings };
      } catch (error) {
        const reason = `STL export failed: ${(error as Error)?.message ?? 'unknown error'}`;
        notify(reason, 'error');
        return { ok: false, reason };
      }
    },

    /** Removes the surface from the viewport. */
    rtSsdClear: (): SsdResult => {
      const active = activeVolume();
      lastSurface = null;
      if (active?.viewport?.removeActors) {
        try {
          active.viewport.removeActors([SSD_ACTOR_UID]);
          active.viewport.render?.();
        } catch {
          // A viewport mid-teardown must not turn "clear" into an error.
        }
      }
      return { ok: true, settings };
    },
  };

  return actions;
}

export const SSD_ACTOR_UID = 'rt-ssd-surface';

/**
 * Adds the polydata to the viewport as an actor.
 *
 * Duck-typed against the Cornerstone3D volume-viewport actor API rather than
 * imported, so this module never depends on `@cornerstonejs/core` and stays
 * loadable in a test. Returns false when the viewport cannot take an actor, which
 * the caller reports instead of pretending the surface is on screen.
 */
function addSurfaceToViewport(viewport: any, polydata: any, settings: SsdSettings): boolean {
  if (!viewport?.addActor || !polydata) {
    return false;
  }
  try {
    // vtk actor/mapper are created by the viewport's own helpers when available.
    const actor = viewport.createActorFromPolyData?.(polydata);
    if (!actor) {
      return false;
    }
    actor.getProperty?.().setColor?.(...settings.color);
    actor.getProperty?.().setOpacity?.(settings.opacity);
    // Phong shading with a modest specular reads as a surface rather than a blob.
    actor.getProperty?.().setInterpolationToPhong?.();
    actor.getProperty?.().setSpecular?.(0.3);
    actor.getProperty?.().setSpecularPower?.(20);
    viewport.addActor({ uid: SSD_ACTOR_UID, actor });
    viewport.render?.();
    return true;
  } catch {
    return false;
  }
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function getCommandsModule({ servicesManager }: { servicesManager?: ServicesManagerLike } = {}) {
  const actions = createSsdActions({ servicesManager });
  const definitions = Object.keys(actions).reduce(
    (acc, name) => {
      acc[name] = { commandFn: actions[name as keyof typeof actions], storeContexts: [], options: {} };
      return acc;
    },
    {} as Record<string, { commandFn: unknown; storeContexts: string[]; options: Record<string, never> }>
  );
  return { actions, definitions, defaultContext: 'CORNERSTONE' };
}

export default getCommandsModule;
