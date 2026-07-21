import {
  SlabProjectionMode,
  SlabProjectionState,
  CsBlendModeName,
  applyProjectionRequest,
  adjustSlab,
  blendModeNameFor,
  modeForBlendModeName,
  normalizeMode,
} from './mipSlab';

/**
 * RTV-15 (MIP/MinIP/AvgIP) + RTV-19 (2D slab) — command glue for the toolbar.
 *
 * Applies slab projections to the ACTIVE viewport through the public
 * Cornerstone3D VolumeViewport API (verified against the installed
 * @cornerstonejs/core 5.0.2, dist/esm/RenderingEngine/VolumeViewport.d.ts):
 *   - setBlendMode(blendMode, filterActorUIDs?, immediate?)
 *   - setSlabThickness(slabThickness, filterActorUIDs?)
 *   - resetSlabThickness()            // back to the 0.05 mm hair-thin default
 *   - getBlendMode() / getSlabThickness()
 *
 * StackViewport has none of these (a stack has no volume to project through)
 * and VolumeViewport3D stubs them all as no-ops (VolumeViewport3D.js:76-81),
 * so both get an honest "requires an MPR/volume viewport" toast instead of a
 * silent no-op.
 *
 * ⚠️ No '@cornerstonejs/core' import in this package — rtmedical-theme carries
 * a nested DEAD copy of it (see touchGestures.ts). BlendModes' numeric values
 * are assigned 1:1 from @kitware/vtk.js VolumeMapper BlendMode constants
 * (core's enums/BlendModes.js — identical in the app's 5.0.2 and the nested
 * legacy 4.15.29), so this glue carries that tiny table and the pure model
 * (./mipSlab) speaks enum NAMES only.
 */

/** vtk.js VolumeMapper BlendMode constants ≡ core Enums.BlendModes values. */
const BLEND_MODE_VALUE_BY_NAME: Record<CsBlendModeName, number> = {
  COMPOSITE: 0,
  MAXIMUM_INTENSITY_BLEND: 1,
  MINIMUM_INTENSITY_BLEND: 2,
  AVERAGE_INTENSITY_BLEND: 3,
};

/** Cornerstone3D Enums.ViewportType.VOLUME_3D — slab APIs are no-ops there. */
const VIEWPORT_TYPE_VOLUME_3D = 'volume3d';

/** Toast titles/labels. */
const TOAST_TITLE = 'Slab Projection';
const MODE_LABEL: Record<SlabProjectionMode, string> = {
  none: 'Projection off',
  mip: 'MIP',
  minip: 'MinIP',
  avg: 'AvgIP',
};

/** The subset of the Cornerstone3D VolumeViewport API this glue touches. */
interface SlabCapableViewport {
  type?: string;
  setBlendMode: (blendMode: number, filterActorUIDs?: unknown[], immediate?: boolean) => void;
  setSlabThickness: (slabThickness: number, filterActorUIDs?: unknown[]) => void;
  resetSlabThickness?: () => void;
  getBlendMode?: () => number;
  getSlabThickness?: () => number;
  render?: () => void;
}

interface MipSlabParams {
  servicesManager: { services: Record<string, any> };
}

/** Working slab APIs = orthographic VolumeViewport (not stack, not 3D stubs). */
function isSlabCapable(viewport: unknown): viewport is SlabCapableViewport {
  const vp = viewport as SlabCapableViewport | undefined;
  return (
    !!vp &&
    typeof vp.setBlendMode === 'function' &&
    typeof vp.setSlabThickness === 'function' &&
    vp.type !== VIEWPORT_TYPE_VOLUME_3D &&
    // GenericViewport path renames the 3D type (getLegacyViewportType.ts).
    (vp as { type?: string }).type !== 'volume3dNext'
  );
}

/**
 * Blend/slab must touch ONLY the base image actor: an empty filterActorUIDs
 * hits EVERY actor in the viewport — a dose-wash overlay would start showing
 * max-dose-over-slab and labelmap actors would lose their projection blend
 * (review MAJOR; same failure family as the dose-wash VOI sync lesson).
 */
function defaultActorFilter(viewport: SlabCapableViewport): string[] | undefined {
  const uid = (viewport as { getDefaultActor?: () => { uid?: string } | undefined })
    .getDefaultActor?.()?.uid;
  return uid ? [uid] : undefined;
}

/**
 * Builds the RTV-15/19 command actions. Dependency-injected (services only,
 * no cornerstone imports) so the whole module is jest-testable with plain
 * object mocks — same pattern as the other rtmedical-theme view models.
 */
export function createMipSlabActions({ servicesManager }: MipSlabParams) {
  const notify = (type: 'error' | 'info' | 'success', message: string): void => {
    try {
      servicesManager.services.uiNotificationService?.show?.({
        title: TOAST_TITLE,
        message,
        type,
        duration: 3000,
      });
    } catch (e) {
      /* toasts must never break the command */
    }
  };

  /** ACTIVE viewport or null, with the honest toast already shown. */
  const requireSlabViewport = (): SlabCapableViewport | null => {
    const { viewportGridService, cornerstoneViewportService } = servicesManager.services;
    const activeViewportId =
      viewportGridService?.getActiveViewportId?.() ??
      viewportGridService?.getState?.()?.activeViewportId;
    const viewport = cornerstoneViewportService?.getCornerstoneViewport?.(activeViewportId);
    if (!viewport) {
      notify('error', 'No active viewport.');
      return null;
    }
    if (!isSlabCapable(viewport)) {
      notify('error', 'Slab projection requires an MPR/volume viewport.');
      return null;
    }
    return viewport;
  };

  /** Read the viewport's live blend mode + slab back into the pure model. */
  const currentStateOf = (viewport: SlabCapableViewport): SlabProjectionState => {
    const blendValue = viewport.getBlendMode?.();
    const blendName = (Object.keys(BLEND_MODE_VALUE_BY_NAME) as CsBlendModeName[]).find(
      name => BLEND_MODE_VALUE_BY_NAME[name] === blendValue
    );
    return {
      mode: modeForBlendModeName(blendName),
      slabMm: viewport.getSlabThickness?.() ?? 0,
    };
  };

  /** Back to normal rendering: composite blend + hair-thin default slab. */
  const turnOff = (viewport: SlabCapableViewport): boolean => {
    const filter = defaultActorFilter(viewport);
    viewport.setBlendMode(BLEND_MODE_VALUE_BY_NAME.COMPOSITE, filter ?? [], false);
    // resetSlabThickness has no actor filter upstream — restore the default
    // hair-thin slab on the base actor explicitly when overlays are present.
    if (filter) {
      viewport.setSlabThickness(0.05, filter);
    } else {
      viewport.resetSlabThickness?.();
    }
    viewport.render?.();
    notify('info', MODE_LABEL.none + '.');
    return true;
  };

  return {
    /**
     * Apply MIP/MinIP/AvgIP over a slab to the ACTIVE viewport.
     * `mode`: 'mip' | 'minip' | 'avg' | 'none' (case-insensitive).
     * `slabMm`: optional thickness, clamped to 0.5–100 mm; omitted → keep the
     * current slab (or 10 mm), and re-requesting the active mode TOGGLES off.
     */
    setSlabProjection: ({ mode, slabMm }: { mode?: string; slabMm?: number } = {}): boolean => {
      const requested = normalizeMode(mode);
      if (!requested) {
        notify('error', `Unknown slab projection mode: ${String(mode)}`);
        return false;
      }
      const viewport = requireSlabViewport();
      if (!viewport) {
        return false;
      }
      const next = applyProjectionRequest(currentStateOf(viewport), requested, slabMm);
      if (next.mode === 'none') {
        return turnOff(viewport);
      }
      const filter = defaultActorFilter(viewport);
      viewport.setBlendMode(BLEND_MODE_VALUE_BY_NAME[blendModeNameFor(next.mode)], filter ?? [], false);
      viewport.setSlabThickness(next.slabMm, filter);
      viewport.render?.();
      notify('info', `${MODE_LABEL[next.mode]} — ${next.slabMm} mm slab.`);
      return true;
    },

    /**
     * Step the ACTIVE viewport's slab thickness by `deltaMm` (RTV-19). Works
     * in any blend mode — with composite blending a thick slab is the plain
     * 2D thick-slab reformat; with MIP/MinIP/AvgIP it resizes the projection.
     */
    adjustSlabThickness: ({ deltaMm }: { deltaMm?: number } = {}): boolean => {
      const viewport = requireSlabViewport();
      if (!viewport) {
        return false;
      }
      const nextMm = adjustSlab(viewport.getSlabThickness?.(), deltaMm);
      viewport.setSlabThickness(nextMm, defaultActorFilter(viewport));
      viewport.render?.();
      notify('info', `Slab thickness: ${nextMm} mm.`);
      return true;
    },

    /** Back to normal rendering (composite blend, default hair-thin slab). */
    clearSlabProjection: (): boolean => {
      const viewport = requireSlabViewport();
      if (!viewport) {
        return false;
      }
      return turnOff(viewport);
    },
  };
}

export type MipSlabActions = ReturnType<typeof createMipSlabActions>;
