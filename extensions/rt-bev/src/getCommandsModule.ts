/**
 * rt-bev commands (Phase B).
 *
 * `showBev` / `hideBev` / `toggleBev` — attach/detach the BEV aperture overlay
 * (MLC leaves + jaws + crosshair, see ./bevOverlay) on every STACK viewport
 * currently showing an RTIMAGE (DRR/portal). `setBevControlPoint` — select the
 * control point the attached overlays render (clamped to the beam's CP count).
 * `showMlcCine` (RTV-139) — show the overlay AND reveal the BEV side panel,
 * whose cine player steps the control points.
 *
 * Resolution chain (display-only, no core changes):
 *   RTIMAGE instance ← metaData.get('instance', viewport.getCurrentImageId())
 *   (fallback: match displaySetService RTIMAGE instances by imageId)
 *   beam ← parseRtPlanBev(active RTPLAN displaySet instance)
 *            .find(beamNumber === RTIMAGE ReferencedBeamNumber)
 * The RTPLAN parse is cached per displaySetInstanceUID; the cache is
 * invalidated on displaySetService DISPLAY_SETS_REMOVED / metadata
 * invalidation and pruned to the active display sets on DISPLAY_SETS_CHANGED
 * (no unbounded growth across studies, no stale beams after invalidation).
 */
import { metaData } from '@cornerstonejs/core';
import i18n from 'i18next';
import parseRtPlanBev, {
  BevBeam,
  referencedBeamNumber,
} from './rtBevParser';
import {
  attachBevOverlay,
  bevViewportIds,
  detachBevOverlay,
  getBevControlPointIndex,
  hasBevOverlay,
  setBevControlPointIndex,
} from './bevOverlay';

/** parseRtPlanBev cache, keyed by the RTPLAN displaySetInstanceUID. */
const planCache = new Map<string, BevBeam[]>();

/** displaySetServices already wired for planCache invalidation. */
const invalidationWired = new WeakSet<object>();

/**
 * Keep {@link planCache} honest: drop entries whose display set is removed or
 * metadata-invalidated (same UID, new metadata), and prune to the active
 * display sets on DISPLAY_SETS_CHANGED so the map cannot grow unboundedly
 * across studies in a long session. Wired once per displaySetService
 * instance, for the app's lifetime (module-scoped cache → no unsubscribe).
 */
export function wirePlanCacheInvalidation(displaySetService: any): void {
  if (!displaySetService?.subscribe || invalidationWired.has(displaySetService)) {
    return;
  }
  invalidationWired.add(displaySetService);
  const EVENTS = displaySetService.EVENTS ?? {};
  if (EVENTS.DISPLAY_SETS_REMOVED) {
    // Payload: { displaySetInstanceUIDs: string[] }.
    displaySetService.subscribe(EVENTS.DISPLAY_SETS_REMOVED, (payload: any) => {
      const uids = payload?.displaySetInstanceUIDs;
      if (Array.isArray(uids) && uids.length) {
        uids.forEach((uid: string) => planCache.delete(uid));
      } else {
        planCache.clear();
      }
    });
  }
  if (EVENTS.DISPLAY_SET_SERIES_METADATA_INVALIDATED) {
    // Payload: { displaySetInstanceUID, invalidateData } — same UID may carry
    // NEW metadata afterwards, so the cached parse is stale.
    displaySetService.subscribe(
      EVENTS.DISPLAY_SET_SERIES_METADATA_INVALIDATED,
      (payload: any) => {
        const uid = payload?.displaySetInstanceUID;
        if (uid) {
          planCache.delete(uid);
        } else {
          planCache.clear();
        }
      }
    );
  }
  if (EVENTS.DISPLAY_SETS_CHANGED) {
    // Payload: the full activeDisplaySets list — prune entries that left it.
    displaySetService.subscribe(EVENTS.DISPLAY_SETS_CHANGED, (activeSets: any) => {
      const active = new Set(
        (Array.isArray(activeSets) ? activeSets : []).map(
          (ds: any) => ds?.displaySetInstanceUID
        )
      );
      [...planCache.keys()].forEach(uid => {
        if (!active.has(uid)) {
          planCache.delete(uid);
        }
      });
    });
  }
}

function activeDisplaySets(displaySetService: any): any[] {
  return (
    displaySetService?.getActiveDisplaySets?.() ??
    displaySetService?.activeDisplaySets ??
    []
  );
}

/** Beams of the active RTPLAN display set (parsed once per display set). */
export function getPlanBeams(displaySetService: any): BevBeam[] {
  const planDs = activeDisplaySets(displaySetService).find(
    (ds: any) => ds?.Modality === 'RTPLAN'
  );
  if (!planDs) {
    return [];
  }
  const uid: string = planDs.displaySetInstanceUID;
  const cached = planCache.get(uid);
  if (cached) {
    return cached;
  }
  const instance = planDs.instances?.[0] ?? planDs.instance;
  const beams = instance ? parseRtPlanBev(instance) : [];
  planCache.set(uid, beams);
  return beams;
}

/**
 * Naturalized instance for an imageId: OHIF's MetadataProvider answers the
 * 'instance' metaData query; fall back to matching the RTIMAGE display sets'
 * instances by their imageId.
 */
export function instanceForImageId(displaySetService: any, imageId: string): any {
  try {
    const viaMeta = metaData.get('instance', imageId);
    if (viaMeta) {
      return viaMeta;
    }
  } catch (e) {
    /* provider unavailable — use the display-set fallback */
  }
  for (const ds of activeDisplaySets(displaySetService)) {
    if (ds?.Modality !== 'RTIMAGE') {
      continue;
    }
    const instances: any[] = ds.instances ?? (ds.instance ? [ds.instance] : []);
    const hit = instances.find((i: any) => i?.imageId === imageId);
    if (hit) {
      return hit;
    }
  }
  return undefined;
}

/** Stack viewports whose CURRENT image is an RTIMAGE, with its instance. */
export function findRtImageStackViewports(servicesManager: any): Array<{
  viewport: any;
  imageId: string;
  instance: any;
}> {
  const { cornerstoneViewportService, displaySetService } = servicesManager.services;
  const renderingEngine = cornerstoneViewportService?.getRenderingEngine?.();
  const stacks: any[] = renderingEngine
    ? renderingEngine.getViewports().filter((vp: any) => vp?.type === 'stack')
    : [];
  const targets: Array<{ viewport: any; imageId: string; instance: any }> = [];
  for (const viewport of stacks) {
    let imageId: string | undefined;
    try {
      imageId = viewport.getCurrentImageId?.();
    } catch (e) {
      continue;
    }
    if (!imageId) {
      continue;
    }
    const instance = instanceForImageId(displaySetService, imageId);
    if (instance && (instance.Modality === 'RTIMAGE' || instance.RTImagePosition != null)) {
      targets.push({ viewport, imageId, instance });
    }
  }
  return targets;
}

export interface BevPanelInfo {
  hasPlan: boolean;
  hasRtImageViewport: boolean;
  shown: boolean;
  controlPoint: number;
  beamNumber?: number;
  beamName?: string;
  gantryAngle?: number;
  collimatorAngleDeg?: number;
  cpCount: number;
}

/**
 * Snapshot of the RTIMAGE-linked beam for the BEV panel: number/name/gantry/
 * collimator of the beam referenced by the first RTIMAGE stack viewport, plus
 * CP count and overlay state.
 */
export function getBevPanelInfo(servicesManager: any): BevPanelInfo {
  const { displaySetService } = servicesManager.services;
  const beams = getPlanBeams(displaySetService);
  const targets = findRtImageStackViewports(servicesManager);
  const first = targets[0];
  const beam = first
    ? beams.find(b => b.beamNumber === referencedBeamNumber(first.instance))
    : undefined;
  const cp = beam?.controlPoints?.[
    Math.min(getBevControlPointIndex(), Math.max(0, (beam?.controlPoints?.length ?? 1) - 1))
  ];
  return {
    hasPlan: beams.length > 0,
    hasRtImageViewport: targets.length > 0,
    shown: hasBevOverlay(),
    controlPoint: getBevControlPointIndex(),
    beamNumber: beam?.beamNumber,
    beamName: beam?.name,
    gantryAngle: cp?.gantryAngle,
    collimatorAngleDeg: cp?.collimatorAngleDeg,
    cpCount: beam?.controlPoints?.length ?? 0,
  };
}

function getCommandsModule({ servicesManager }: { servicesManager: any }) {
  wirePlanCacheInvalidation(servicesManager.services.displaySetService);

  // Notifications go through the RTMedical i18n namespace (registered by
  // rtmedical-theme's preRegistration) — same keys the BEV panel renders, so
  // PT-BR users get PT-BR toasts and the strings live in ONE place. The
  // second argument is i18next's defaultValue (bundle not registered, e.g.
  // rt-bev without rtmedical-theme).
  const notify = (key: string, fallback: string, type = 'info') =>
    servicesManager.services.uiNotificationService?.show?.({
      title: i18n.t('RTMedical:bev_panel_title', "BEV (Beam's Eye View)"),
      message: i18n.t(`RTMedical:${key}`, fallback),
      type,
    });

  /** E2E/introspection hook. */
  const syncWindowState = () => {
    try {
      (window as any).__rtBev = {
        beams: getPlanBeams(servicesManager.services.displaySetService).length,
        viewports: bevViewportIds(),
        controlPoint: getBevControlPointIndex(),
      };
    } catch (e) {
      /* no window (tests) — ignore */
    }
  };

  const actions = {
    /**
     * Attach the BEV overlay to every stack viewport currently showing an
     * RTIMAGE. Optional `{ controlPoint }` selects the CP to render.
     */
    showBev: ({ controlPoint }: { controlPoint?: number } = {}) => {
      const { displaySetService } = servicesManager.services;
      const beams = getPlanBeams(displaySetService);
      if (!beams.length) {
        notify('bev_no_plan', 'No RTPLAN loaded.', 'warning');
        syncWindowState();
        return false;
      }
      const targets = findRtImageStackViewports(servicesManager);
      if (!targets.length) {
        notify('bev_no_rtimage', 'Open an RTIMAGE (DRR) in a viewport to see the beam.', 'warning');
        syncWindowState();
        return false;
      }
      if (controlPoint != null && Number.isFinite(Number(controlPoint))) {
        setBevControlPointIndex(Number(controlPoint));
      }
      let attached = 0;
      for (const target of targets) {
        try {
          const ok = attachBevOverlay(target.viewport, {
            getBeams: () => getPlanBeams(displaySetService),
            resolveInstance: (imageId: string) =>
              instanceForImageId(displaySetService, imageId),
          });
          if (ok) {
            attached++;
          }
        } catch (e) {
          /* viewport without a usable DOM container — skip */
        }
      }
      // Re-apply so the CP is clamped against the now-known attached beams.
      setBevControlPointIndex(getBevControlPointIndex());
      syncWindowState();
      return attached > 0;
    },

    /** Remove the BEV overlays from every viewport. */
    hideBev: () => {
      const removed = detachBevOverlay();
      syncWindowState();
      return removed > 0;
    },

    /** Toolbar toggle: show the aperture, or remove it when already shown. */
    toggleBev: ({ controlPoint }: { controlPoint?: number } = {}) => {
      if (hasBevOverlay()) {
        return actions.hideBev();
      }
      return actions.showBev({ controlPoint });
    },

    /**
     * Re-render the attached overlays at control point `index` (clamped to
     * the beam's CP count). Returns the applied index.
     */
    setBevControlPoint: ({ index }: { index?: number } = {}) => {
      const applied = setBevControlPointIndex(Number(index) || 0);
      syncWindowState();
      return applied;
    },

    /**
     * MLC cine entry point (RTV-139, hotkey/toolbar): attach the BEV overlay
     * and reveal the BEV side panel hosting the cine player. Panel activation
     * follows rtmedical-theme's `activateRtPanel` one-liner
     * (`panelService.activatePanel(panelId, true)`) but is best-effort — a
     * missing panelService (tests, headless) must not fail the overlay
     * attach. Returns whether the overlay ended up shown.
     */
    showMlcCine: (): boolean => {
      const shown = actions.showBev({});
      try {
        servicesManager.services.panelService?.activatePanel?.(
          '@ohif/extension-rt-bev.panelModule.bev',
          true
        );
      } catch (e) {
        /* panelService unavailable — the overlay state still stands */
      }
      return shown;
    },
  };

  return {
    actions,
    definitions: {
      showBev: { commandFn: actions.showBev },
      hideBev: { commandFn: actions.hideBev },
      toggleBev: { commandFn: actions.toggleBev },
      setBevControlPoint: { commandFn: actions.setBevControlPoint },
      showMlcCine: { commandFn: actions.showMlcCine },
    },
    defaultContext: 'DEFAULT',
  };
}

export default getCommandsModule;
