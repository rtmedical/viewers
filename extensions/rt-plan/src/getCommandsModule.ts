/**
 * rt-plan commands (RTV-145 — isocenter select + navigate).
 *
 * - `listIsocenters`        — unique isocenters of the active RTPLAN display
 *   set (`ds.rtPlan`, parsed by the SopClassHandler), deduped/ordered by the
 *   pure {@link ./isocenters} module.
 * - `navigateToIsocenter`   — jump every navigable viewport in the grid to an
 *   isocenter, by `{ index }` into that list (default 0) or `{ beamNumber }`.
 *
 * Navigation API (verified against the installed @cornerstonejs/core):
 * `viewport.jumpToWorld(worldPos)` exists on BOTH VolumeViewport and
 * StackViewport and is OHIF's own prior art (SegmentationService.
 * jumpToSegmentCenter). On a VolumeViewport it clamps to the volume bounds and
 * moves the camera ONLY along the view-plane normal — zoom/pan are preserved
 * and each MPR lands on the slice through the point; with the RT mode's
 * always-on crosshairs, the three orthogonal jumps re-center the crosshair on
 * the isocenter. On a StackViewport it navigates to the closest image.
 *
 * Frame of Reference: the RTPLAN isocenter is in the plan FoR (mm, LPS) — the
 * planning CT's coordinates in the normal shared-FoR case, so jumping the CT
 * volume viewports needs no transform. Fused secondaries (rt-fusion) and the
 * BEV beam overlay (rt-bev) follow indirectly: fusion tracks the primary via
 * its FoR registration and BEV reads the same plan's beam geometry.
 */
import i18n from 'i18next';
import { collectIsocenters, formatIsocenter, IsocenterEntry } from './isocenters';

function activeDisplaySets(displaySetService: any): any[] {
  return (
    displaySetService?.getActiveDisplaySets?.() ?? displaySetService?.activeDisplaySets ?? []
  );
}

/**
 * The RTPLAN display set to read isocenters from: the one with
 * `displaySetInstanceUID` when given, else the first plan that actually
 * carries isocenters (a beam-less plan must not shadow a treatable one),
 * else the first plan (so callers can report "no isocenters" honestly).
 */
export function resolvePlanDisplaySet(
  displaySetService: any,
  displaySetInstanceUID?: string
): any {
  const plans = activeDisplaySets(displaySetService).filter((ds: any) => ds?.rtPlan);
  if (displaySetInstanceUID) {
    return plans.find((ds: any) => ds.displaySetInstanceUID === displaySetInstanceUID);
  }
  return plans.find((ds: any) => collectIsocenters(ds.rtPlan).length > 0) ?? plans[0];
}

/** Grid viewports exposing `jumpToWorld` (volume/MPR and stack alike). */
function navigableViewports(servicesManager: any): any[] {
  const renderingEngine =
    servicesManager?.services?.cornerstoneViewportService?.getRenderingEngine?.();
  const viewports: any[] = renderingEngine?.getViewports?.() ?? [];
  return viewports.filter(vp => typeof vp?.jumpToWorld === 'function');
}

export interface NavigateToIsocenterOptions {
  /** Index into `listIsocenters` (default 0). Clamped to the list. */
  index?: number;
  /** Selects the entry referencing this BeamNumber instead of `index`. */
  beamNumber?: number;
  /** RTPLAN display set to read; defaults to the active plan. */
  displaySetInstanceUID?: string;
}

/** Compact human label for a toast/panel row, e.g. '#1, #2 AP'. */
export function isocenterLabel(entry: IsocenterEntry): string {
  const numbers = entry.beamNumbers.length
    ? entry.beamNumbers.map(n => `#${n}`).join(', ')
    : undefined;
  return [numbers, entry.beamName].filter(Boolean).join(' ') || '—';
}

function getCommandsModule({ servicesManager }: { servicesManager: any }) {
  // Toasts use the RTMedical i18n namespace (registered by rtmedical-theme's
  // preRegistration) with i18next defaultValue fallbacks, like rt-bev.
  const notify = (key: string, fallback: string, type = 'info', message?: string) =>
    servicesManager.services.uiNotificationService?.show?.({
      title: i18n.t('RTMedical:plan_isocenters', 'Isocenters'),
      message: message ?? i18n.t(`RTMedical:${key}`, fallback),
      type,
    });

  const actions = {
    /**
     * Unique isocenters of the active RTPLAN (or of the display set given by
     * `displaySetInstanceUID`), ordered by lowest beam number.
     */
    listIsocenters: (
      { displaySetInstanceUID }: { displaySetInstanceUID?: string } = {}
    ): IsocenterEntry[] => {
      const planDs = resolvePlanDisplaySet(
        servicesManager.services.displaySetService,
        displaySetInstanceUID
      );
      return collectIsocenters(planDs?.rtPlan);
    },

    /**
     * Move every navigable grid viewport to the selected isocenter (plan FoR
     * world point). Returns whether at least one viewport jumped.
     */
    navigateToIsocenter: (
      { index, beamNumber, displaySetInstanceUID }: NavigateToIsocenterOptions = {}
    ): boolean => {
      const entries = actions.listIsocenters({ displaySetInstanceUID });
      if (!entries.length) {
        notify('iso_no_plan', 'No RTPLAN with an isocenter loaded.', 'warning');
        return false;
      }

      let entry: IsocenterEntry | undefined;
      if (beamNumber != null) {
        entry = entries.find(
          e => e.beamNumbers.includes(Number(beamNumber)) || e.beamNumber === Number(beamNumber)
        );
        if (!entry) {
          notify('iso_beam_not_found', 'No isocenter found for the requested beam.', 'warning');
          return false;
        }
      } else {
        const i = Math.max(0, Math.min(entries.length - 1, Math.trunc(Number(index) || 0)));
        entry = entries[i];
      }

      const viewports = navigableViewports(servicesManager);
      let moved = 0;
      for (const viewport of viewports) {
        try {
          if (viewport.jumpToWorld([...entry.isocenter]) !== false) {
            moved++;
          }
        } catch (e) {
          /* viewport without loaded image data — skip it */
        }
      }
      if (!moved) {
        notify(
          'iso_no_viewport',
          'No volume/MPR viewport to navigate — load the planning CT.',
          'warning'
        );
        return false;
      }
      notify(
        'iso_navigated',
        '',
        'success',
        `${isocenterLabel(entry)} — ${formatIsocenter(entry.isocenter)}`
      );
      return true;
    },
  };

  return {
    actions,
    definitions: {
      listIsocenters: { commandFn: actions.listIsocenters },
      navigateToIsocenter: { commandFn: actions.navigateToIsocenter },
    },
    defaultContext: 'DEFAULT',
  };
}

export default getCommandsModule;
