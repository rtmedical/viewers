/**
 * Commands for MR-quantitative display (RTV-82, RTV-83).
 *
 * `rtApplyParametricMap` pushes the panel's LUT + display range onto the active
 * viewport: the ramp goes over as a Cornerstone3D colormap preset (built from
 * the pure LUT, so `extensions/cornerstone` is never edited — RTV-114), and the
 * display range goes over as VOI window width/centre.
 *
 * `rtDetectDixon` reports the Dixon quartet found in the loaded display sets,
 * which is what a caller needs to decide whether to switch to the 2x2 protocol.
 *
 * ## Scope
 *
 * Colormap + VOI is as far as the public viewport API goes here. Compositing a
 * *separate* parametric volume as a semi-transparent layer over anatomy (the
 * `opacity` / `lowerThreshold` half of the panel) needs a second volume actor on
 * the viewport, which is a cornerstone integration follow-up — the same boundary
 * `rt-fusion` and `rt-isodose` draw. `mapValueToRgba` in
 * {@link ./parametricRange} is the pure function that layer will use; nothing
 * about it changes when the plumbing lands.
 */

import { detectDixonSet, DixonSeriesLike } from './dixon';
import { ParametricLutName, toColormapPreset } from './parametricLut';
import { normalizeRange, ParametricRange, rangeToWindow } from './parametricRange';

interface ServicesManagerLike {
  services: Record<string, any>;
}

export interface ApplyParametricMapOptions {
  lut: ParametricLutName;
  range: ParametricRange;
  opacity?: number;
  lowerThreshold?: number;
}

export interface ApplyParametricMapResult {
  applied: boolean;
  /** Why it did not apply, for the caller to surface. Absent on success. */
  reason?: string;
  colormapName?: string;
  windowWidth?: number;
  windowCenter?: number;
}

function getCommandsModule({ servicesManager }: { servicesManager: ServicesManagerLike }) {
  const services = () => servicesManager?.services ?? {};

  const actions = {
    /**
     * Applies the LUT and display range to the active viewport.
     * Returns a result object rather than throwing: a panel button must not be
     * able to crash the viewer when a viewport is not ready yet.
     */
    rtApplyParametricMap: (options: ApplyParametricMapOptions): ApplyParametricMapResult => {
      const { cornerstoneViewportService, viewportGridService, uiNotificationService } = services();
      const range = normalizeRange(options?.range ?? { min: 0, max: 1 });
      const { windowWidth, windowCenter } = rangeToWindow(range);
      const preset = toColormapPreset(options?.lut ?? 'viridis');

      const fail = (reason: string): ApplyParametricMapResult => {
        uiNotificationService?.show?.({
          title: 'Parametric map',
          message: reason,
          type: 'warning',
        });
        return { applied: false, reason };
      };

      const viewportId = viewportGridService?.getActiveViewportId?.();
      if (!viewportId) {
        return fail('No active viewport.');
      }

      const viewport = cornerstoneViewportService?.getCornerstoneViewport?.(viewportId);
      if (!viewport) {
        return fail('The active viewport is not rendering yet.');
      }

      try {
        viewport.setProperties?.({
          colormap: { name: preset.Name, ...preset },
          voiRange: { lower: range.min, upper: range.max },
        });
        viewport.render?.();
      } catch (error) {
        return fail(`Could not apply the map: ${(error as Error)?.message ?? 'unknown error'}`);
      }

      return {
        applied: true,
        colormapName: preset.Name,
        windowWidth,
        windowCenter,
      };
    },

    /** The Dixon quartet among the loaded display sets. */
    rtDetectDixon: () => {
      const { displaySetService } = services();
      const displaySets: DixonSeriesLike[] = displaySetService?.getActiveDisplaySets?.() ?? [];
      return detectDixonSet(displaySets);
    },
  };

  const definitions = {
    rtApplyParametricMap: {
      commandFn: actions.rtApplyParametricMap,
      storeContexts: [] as string[],
      options: {},
    },
    rtDetectDixon: {
      commandFn: actions.rtDetectDixon,
      storeContexts: [] as string[],
      options: {},
    },
  };

  return { actions, definitions, defaultContext: 'CORNERSTONE' };
}

export default getCommandsModule;
