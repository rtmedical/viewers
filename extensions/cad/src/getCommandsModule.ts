/**
 * CAD commands (RTV-79/78 follow-up).
 *
 * `showCadFindings` / `hideCadFindings` / `toggleCadFindings` — attach/detach
 * the finding-marker overlay (./findingsOverlay) on every STACK viewport (the
 * overlay itself only draws on images referenced by a loaded CAD SR, so
 * blanket attachment is harmless and keeps markers appearing while the user
 * scrolls).
 *
 * `jumpToCadFinding({ finding })` — bring the finding's image on screen:
 * resolve its display set (displaySetService.getDisplaySetForSOPInstanceUID),
 * reuse a viewport already showing it or load it into the ACTIVE viewport,
 * scroll the stack to the referenced SOP (+frame for multiframe) with the
 * repo's `utilities.scroll(viewport, { delta })` idiom (usAnnotation panel),
 * then highlight the finding and (re-)attach the overlay.
 */
import { metaData, utilities } from '@cornerstonejs/core';
import i18n from 'i18next';
import type { CadFinding } from './cadSr';
import { frameNumberFromImageId, targetImageIndexInDisplaySet } from './findingsGeometry';
import {
  attachCadFindingsOverlay,
  cadFindingsViewportIds,
  detachCadFindingsOverlay,
  getHighlightedFinding,
  hasCadFindingsOverlay,
  setHighlightedFinding,
} from './findingsOverlay';

function activeDisplaySets(displaySetService: any): any[] {
  return displaySetService?.getActiveDisplaySets?.() ?? displaySetService?.activeDisplaySets ?? [];
}

/** Findings of every loaded CAD SR display set (handler puts them on `cadSr`). */
export function getAllCadFindings(displaySetService: any): CadFinding[] {
  const out: CadFinding[] = [];
  for (const ds of activeDisplaySets(displaySetService)) {
    const findings = ds?.cadSr?.findings;
    if (Array.isArray(findings) && findings.length) {
      out.push(...findings);
    }
  }
  return out;
}

/** All STACK viewports of the current rendering engine (rt-bev recipe). */
export function findStackViewports(servicesManager: any): any[] {
  const { cornerstoneViewportService } = servicesManager.services;
  const renderingEngine = cornerstoneViewportService?.getRenderingEngine?.();
  return renderingEngine
    ? renderingEngine.getViewports().filter((vp: any) => vp?.type === 'stack')
    : [];
}

/**
 * Stack index of (SOP, frame) in a viewport: primary — scan the viewport's own
 * imageIds (authoritative ordering); fallback — pure computation from the
 * display set's instances (frames enumerate consecutively per instance).
 */
export function resolveTargetImageIndex(
  viewport: any,
  displaySet: any,
  sopInstanceUID: string,
  frameNumber: number
): number | undefined {
  try {
    const imageIds: string[] = viewport?.getImageIds?.() ?? [];
    const index = imageIds.findIndex(id => {
      const instance = metaData.get('instance', id) as any;
      return (
        instance?.SOPInstanceUID === sopInstanceUID &&
        (frameNumberFromImageId(id, imageIds) ?? 1) === frameNumber
      );
    });
    if (index >= 0) {
      return index;
    }
  } catch (e) {
    /* metaData provider unavailable — use the display-set fallback */
  }
  return targetImageIndexInDisplaySet(displaySet, sopInstanceUID, frameNumber);
}

/**
 * Wait until Cornerstone, not only ViewportGridService, has applied a display
 * set to a stack viewport. ViewportGridService resolves after dispatching its
 * reducer, while the old Cornerstone viewport can still expose stale imageIds.
 */
export async function waitForStackViewport(
  cornerstoneViewportService: any,
  viewportId: string,
  displaySetInstanceUID: string,
  targetSopInstanceUID: string,
  timeoutMs = 5000,
  pollIntervalMs = 100
): Promise<any | undefined> {
  const started = Date.now();
  for (;;) {
    let viewport: any;
    let containsDisplaySet = false;
    try {
      viewport = cornerstoneViewportService?.getCornerstoneViewport?.(viewportId);
      containsDisplaySet =
        cornerstoneViewportService
          ?.getViewportInfo?.(viewportId)
          ?.hasDisplaySet?.(displaySetInstanceUID) === true;
    } catch (e) {
      viewport = undefined;
    }
    const imageIds: string[] = viewport?.getImageIds?.() ?? [];
    const containsTargetImage = imageIds.some(imageId => {
      try {
        return (metaData.get('instance', imageId) as any)?.SOPInstanceUID === targetSopInstanceUID;
      } catch (e) {
        return false;
      }
    });
    if (containsDisplaySet && viewport?.type === 'stack' && containsTargetImage) {
      return viewport;
    }
    if (Date.now() - started >= timeoutMs) {
      return undefined;
    }
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }
}

/** Reuse only a visible STACK viewport already showing the target display set. */
export function findVisibleStackViewportId(
  gridViewports: any,
  cornerstoneViewportService: any,
  displaySetInstanceUID: string
): string | undefined {
  let viewportId: string | undefined;
  gridViewports?.forEach?.((gridViewport: any, candidateId: string) => {
    if (viewportId || !gridViewport?.displaySetInstanceUIDs?.includes?.(displaySetInstanceUID)) {
      return;
    }
    try {
      if (cornerstoneViewportService?.getCornerstoneViewport?.(candidateId)?.type === 'stack') {
        viewportId = candidateId;
      }
    } catch (e) {
      /* viewport is being rebuilt — use the active viewport fallback */
    }
  });
  return viewportId;
}

function getCommandsModule({ servicesManager }: { servicesManager: any }) {
  // Toasts go through the RTMedical i18n namespace (registered by
  // rtmedical-theme's preRegistration) — same keys the CAD panel renders, so
  // PT-BR users get PT-BR toasts and the strings live in ONE place. The second
  // argument is i18next's defaultValue (bundle not registered, e.g. cad
  // without rtmedical-theme).
  const notify = (key: string, fallback: string, type = 'info') =>
    servicesManager.services.uiNotificationService?.show?.({
      title: i18n.t('RTMedical:cad_panel_title', 'CAD Findings'),
      message: i18n.t(`RTMedical:${key}`, fallback),
      type,
    });

  /** E2E/introspection hook. */
  const syncWindowState = () => {
    try {
      (window as any).__cadFindings = {
        findings: getAllCadFindings(servicesManager.services.displaySetService).length,
        viewports: cadFindingsViewportIds(),
        highlighted: getHighlightedFinding() != null,
      };
    } catch (e) {
      /* no window (tests) — ignore */
    }
  };

  const actions = {
    /** Attach the finding-marker overlay to every stack viewport. */
    showCadFindings: () => {
      const { displaySetService } = servicesManager.services;
      const findings = getAllCadFindings(displaySetService);
      if (!findings.length) {
        notify('cad_none', 'No CAD SR findings loaded.', 'warning');
        syncWindowState();
        return false;
      }
      const stacks = findStackViewports(servicesManager);
      if (!stacks.length) {
        notify(
          'cad_no_stack_viewport',
          'Open an image viewport to display CAD markers.',
          'warning'
        );
        syncWindowState();
        return false;
      }
      let attached = 0;
      for (const viewport of stacks) {
        try {
          // The findings list is read live per redraw, so CAD SRs loaded
          // after attachment appear without re-running the command.
          if (
            attachCadFindingsOverlay(viewport, {
              getFindings: () => getAllCadFindings(displaySetService),
            })
          ) {
            attached++;
          }
        } catch (e) {
          /* viewport without a usable DOM container — skip */
        }
      }
      syncWindowState();
      return attached > 0;
    },

    /** Remove the finding-marker overlays from every viewport. */
    hideCadFindings: () => {
      setHighlightedFinding(null);
      const removed = detachCadFindingsOverlay();
      syncWindowState();
      return removed > 0;
    },

    /** Panel eye toggle: show the markers, or remove them when shown. */
    toggleCadFindings: () => {
      if (hasCadFindingsOverlay()) {
        return actions.hideCadFindings();
      }
      return actions.showCadFindings();
    },

    /**
     * Navigate to a finding's image: put its display set on screen (reusing a
     * viewport that already shows it, else the ACTIVE viewport), scroll to the
     * referenced SOP/frame, highlight the finding and attach the overlay.
     */
    jumpToCadFinding: async ({ finding }: { finding?: CadFinding } = {}) => {
      const { displaySetService, viewportGridService, cornerstoneViewportService } =
        servicesManager.services;
      const sopInstanceUID = finding?.referencedSopInstanceUID;
      if (!sopInstanceUID) {
        return false;
      }
      const displaySet = displaySetService?.getDisplaySetForSOPInstanceUID?.(
        sopInstanceUID,
        finding.referencedSeriesInstanceUID
      );
      if (!displaySet) {
        notify(
          'cad_image_not_loaded',
          'The image referenced by this finding is not loaded.',
          'warning'
        );
        return false;
      }

      // Reuse a visible viewport already showing the display set, else load it
      // into the active one.
      const displaySetInstanceUID = displaySet.displaySetInstanceUID;
      const gridViewports = viewportGridService?.getState?.()?.viewports;
      let viewportId = findVisibleStackViewportId(
        gridViewports,
        cornerstoneViewportService,
        displaySetInstanceUID
      );
      if (!viewportId) {
        viewportId = viewportGridService?.getActiveViewportId?.();
        if (!viewportId) {
          return false;
        }
        // setDisplaySetsForViewport (singular) fires the async plural without
        // returning it — await the plural so the swap lands before we scroll.
        await viewportGridService.setDisplaySetsForViewports([
          {
            viewportId,
            displaySetInstanceUIDs: [displaySetInstanceUID],
            viewportOptions: { viewportType: 'stack' },
          },
        ]);
      }

      const frameNumber = finding.referencedFrameNumber ?? 1;
      const viewport = await waitForStackViewport(
        cornerstoneViewportService,
        viewportId,
        displaySetInstanceUID,
        sopInstanceUID
      );
      if (!viewport) {
        notify(
          'cad_navigation_failed',
          'The referenced image could not be loaded in an image viewport.',
          'warning'
        );
        syncWindowState();
        return false;
      }

      const targetIndex = resolveTargetImageIndex(
        viewport,
        displaySet,
        sopInstanceUID,
        frameNumber
      );
      if (targetIndex != null && targetIndex >= 0) {
        try {
          const delta = targetIndex - (viewport.getCurrentImageIdIndex?.() ?? 0);
          if (delta) {
            utilities.scroll(viewport, { delta });
          }
        } catch (e) {
          /* non-scrollable viewport — the highlight still lands */
        }
      }

      // Highlight BEFORE (re-)attaching so the attach's initial render already
      // draws it; showCadFindings re-attaches idempotently, which also covers
      // a viewport whose element was rebuilt by the display-set swap.
      setHighlightedFinding(finding);
      actions.showCadFindings();
      syncWindowState();
      return true;
    },
  };

  return {
    actions,
    definitions: {
      showCadFindings: { commandFn: actions.showCadFindings },
      hideCadFindings: { commandFn: actions.hideCadFindings },
      toggleCadFindings: { commandFn: actions.toggleCadFindings },
      jumpToCadFinding: { commandFn: actions.jumpToCadFinding },
    },
    defaultContext: 'DEFAULT',
  };
}

export default getCommandsModule;
