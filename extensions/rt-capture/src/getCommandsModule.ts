/**
 * Secondary Capture commands (RTV-203):
 *
 * - `captureViewportSc`  — screenshot of the ACTIVE viewport (image + burned
 *   annotations) → DICOM SC → STOW-RS to the active data source.
 * - `captureLayoutSc`    — the whole current layout composed as ONE image.
 *
 * The SC is filed under the SOURCE study, in a dedicated "RT Medical Captures"
 * series (one SeriesInstanceUID per study per app session, so successive
 * captures group together). Success/failure surfaces as a toast; STOW failure
 * (PACS offline) is caught and reported without crashing (acceptance item 5).
 *
 * Cine export command (RTV-95):
 *
 * - `exportCineVideo`    — sweep the ACTIVE viewport's frames/slices and
 *   record them (image + burned annotations, ≥1080p) into an MP4 or WebM
 *   download. MP4/H.264 depends on the browser's MediaRecorder encoders
 *   (Chrome ≥126); otherwise it falls back to WebM. Audio (recorded report
 *   narration) is a follow-up.
 *
 * Rotational 3D cine command (RTV-96):
 *
 * - `exportRotational3D` — spin the layout's 3D (volume3d) viewport camera a
 *   full 360° turn around its focal point (default axis: the camera's own
 *   viewUp — a turntable spin) and record the sweep into the same MP4/WebM
 *   download pipeline. The viewport does not need to be active; the original
 *   camera is restored afterwards.
 */
import { Enums as csEnums, utilities as csUtils } from '@cornerstonejs/core';
import { rgbaToRgb, ScPatientStudyContext, ScSourceImageRef } from './scDataset';
import { buildScDatasetWithRealUids, newUid, toDa } from './scSerialize';
import { canvasPixels, composeLayoutCanvas, composeViewportCanvas } from './captureCompose';
import { orbitStep, Vec3 } from './orbitCamera';
import {
  downloadBlob,
  exportFilename,
  pickVideoMimeType,
  recordCanvasFrames,
} from './cineExport';

/** Exported videos target at least this on the longer side (RTV-95: ≥1080p). */
const CINE_EXPORT_MIN_MAX_SIDE = 1080;

/** Frame rate when neither the caller nor the viewport's cine specify one. */
const CINE_EXPORT_DEFAULT_FPS = 24;

/** RTV-96: full-turn frame count when the caller gives none (5 s at 24 fps). */
const ROTATIONAL_3D_DEFAULT_FRAMES = 120;

/** Cornerstone3D Enums.ViewportType.VOLUME_3D (+ the -next variant). */
const VOLUME_3D_VIEWPORT_TYPES = ['volume3d', 'volume3dNext'];

/** One capture series per study per session, so captures group in the PACS. */
const seriesByStudy = new Map<string, string>();
let instanceCounter = 0;
/** RTV-95: one cine export at a time (concurrent runs fight over the slice). */
let cineExportInProgress = false;

function scSeriesFor(studyInstanceUID: string): string {
  let uid = seriesByStudy.get(studyInstanceUID);
  if (!uid) {
    uid = newUid();
    seriesByStudy.set(studyInstanceUID, uid);
  }
  return uid;
}

/** Pull patient/study identity + source refs from the viewport's display sets. */
function contextFromDisplaySets(displaySets: any[]): {
  context: ScPatientStudyContext | null;
  sourceImages: ScSourceImageRef[];
} {
  const sourceImages: ScSourceImageRef[] = [];
  let context: ScPatientStudyContext | null = null;
  for (const ds of displaySets ?? []) {
    const instance = ds?.instances?.[0] ?? ds?.instance;
    if (!instance) {
      continue;
    }
    if (!context && instance.StudyInstanceUID) {
      context = {
        PatientName: instance.PatientName,
        PatientID: instance.PatientID,
        PatientBirthDate: instance.PatientBirthDate,
        PatientSex: instance.PatientSex,
        StudyInstanceUID: instance.StudyInstanceUID,
        StudyDate: instance.StudyDate,
        StudyTime: instance.StudyTime,
        AccessionNumber: instance.AccessionNumber,
        ReferringPhysicianName: instance.ReferringPhysicianName,
        StudyID: instance.StudyID,
      };
    }
    if (instance.SOPClassUID && instance.SOPInstanceUID) {
      sourceImages.push({
        ReferencedSOPClassUID: instance.SOPClassUID,
        ReferencedSOPInstanceUID: instance.SOPInstanceUID,
      });
    }
  }
  return { context, sourceImages };
}

/** Frames/slices the viewport can sweep (stack imageIds, else volume slices). */
function viewportFrameCount(viewport: any): number {
  // getNumberOfSlices counts steps along the CURRENT orientation — on an
  // MPR coronal/sagittal it differs from the acquisition count returned by
  // getImageIds (review M1), so it wins whenever available.
  const fromSlices = viewport?.getNumberOfSlices?.();
  if (Number.isFinite(fromSlices) && fromSlices > 0) {
    return fromSlices;
  }
  const fromImageIds = viewport?.getImageIds?.()?.length;
  return Number.isFinite(fromImageIds) && fromImageIds > 0 ? fromImageIds : 0;
}

/**
 * Navigate the viewport to `imageIndex` — the core `jumpToSlice` utility
 * handles stack AND volume viewports (prior art: cardiology BullseyePanel),
 * with a StackViewport `setImageIdIndex` fallback if the generic jump rejects.
 */
async function jumpToIndex(viewport: any, imageIndex: number): Promise<void> {
  // StackViewport.setImageIdIndex resolves AFTER load+display and has no
  // debounce; the generic jumpToSlice scroll path debounces uncached images
  // (40 ms) and composes deltas, which a fast export loop turns into stale
  // frames or compounded overshoot (review B2). Volume viewports (no
  // setImageIdIndex) keep the synchronous camera-based jumpToSlice.
  if (typeof viewport?.setImageIdIndex === 'function') {
    try {
      await viewport.setImageIdIndex(imageIndex);
      return;
    } catch (e) {
      /* fall through to the generic jump */
    }
  }
  try {
    await csUtils.jumpToSlice(viewport.element, { imageIndex });
  } catch (e) {
    /* frame unavailable — the previous frame is recorded instead */
  }
}

/**
 * Resolve when the viewport reports a render (IMAGE_RENDERED /
 * VOLUME_NEW_IMAGE on its element) or after `timeoutMs` (~2× the frame
 * period), whichever comes first. Never rejects — a missed event only costs
 * the timeout. Attach BEFORE triggering the navigation so the event isn't
 * lost to the race.
 */
function waitForRender(viewport: any, timeoutMs: number): { done: Promise<void> } {
  const done = new Promise<void>(resolve => {
    const element: HTMLElement | undefined = viewport?.element;
    if (!element?.addEventListener) {
      resolve();
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      element.removeEventListener(csEnums.Events.IMAGE_RENDERED, finish);
      element.removeEventListener(csEnums.Events.VOLUME_NEW_IMAGE, finish);
      clearTimeout(timer);
      resolve();
    };
    timer = setTimeout(finish, timeoutMs);
    element.addEventListener(csEnums.Events.IMAGE_RENDERED, finish);
    element.addEventListener(csEnums.Events.VOLUME_NEW_IMAGE, finish);
  });
  return { done };
}

/** `YYYYMMDD-HHMMSS` local timestamp for the export filename. */
function fileTimestamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${toDa(d)}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function getCommandsModule({ servicesManager, extensionManager }: any) {
  const {
    viewportGridService,
    cornerstoneViewportService,
    uiNotificationService,
    cineService,
  } = servicesManager.services;

  const notify = (type: 'success' | 'error' | 'info', title: string, message: string) => {
    try {
      uiNotificationService?.show?.({ title, message, type, duration: 4000 });
    } catch (e) {
      /* toasts must never break the command */
    }
  };

  // RTV-159: best-effort background-task tracking via rtmedical-theme's
  // BgTaskService. The service is resolved at CALL time (it registers in a
  // sibling extension's preRegistration) and every call is guarded — the
  // exports must keep working unchanged when it is absent.
  const bgTasks = () => servicesManager.services?.rtmedicalBgTaskService;
  const bgTaskStart = (kind: string, label: string): string | undefined => {
    try {
      return bgTasks()?.startTask?.({ kind, label });
    } catch (e) {
      return undefined;
    }
  };
  const bgTaskProgress = (id: string | undefined, progress: number) => {
    try {
      if (id) {
        bgTasks()?.updateTask?.(id, { progress });
      }
    } catch (e) {
      /* tracking only */
    }
  };
  const bgTaskComplete = (
    id: string | undefined,
    status: 'success' | 'error',
    detail?: string
  ) => {
    try {
      if (id) {
        bgTasks()?.completeTask?.(id, { status, detail });
      }
    } catch (e) {
      /* tracking only */
    }
  };

  /** Compose → build SC → STOW. Shared by both commands. */
  const storeCapture = async (
    canvas: HTMLCanvasElement,
    displaySets: any[],
    what: string
  ): Promise<boolean> => {
    const { context, sourceImages } = contextFromDisplaySets(displaySets);
    if (!context) {
      notify('error', 'Secondary Capture', 'No study loaded in the captured viewport.');
      return false;
    }
    const { rows, columns, rgba } = canvasPixels(canvas);
    const dataset = buildScDatasetWithRealUids(
      { rows, columns, rgb: rgbaToRgb(rgba) },
      context,
      {
        seriesInstanceUID: scSeriesFor(context.StudyInstanceUID),
        instanceNumber: ++instanceCounter,
        imageComments: `RT Medical SC - ${toDa(new Date())} (${what})`,
        sourceImages,
      }
    );

    const dataSource = extensionManager.getActiveDataSources?.()?.[0]
      ?? extensionManager.getDataSources?.()?.[0];
    if (!dataSource?.store?.dicom) {
      notify('error', 'Secondary Capture', 'The active data source does not support STOW-RS.');
      return false;
    }
    try {
      await dataSource.store.dicom(dataset);
    } catch (e) {
      notify('error', 'Secondary Capture', 'Failed to store on the PACS (offline?). Try again.');
      return false;
    }
    // Invalidate cached study metadata so the new series shows after refresh.
    try {
      dataSource.deleteStudyMetadataPromise?.(context.StudyInstanceUID);
    } catch (e) {
      /* refresh hint only */
    }
    notify('success', 'Secondary Capture', 'Image saved to the PACS as Secondary Capture.');
    return true;
  };

  const actions = {
    /** Active viewport (image + annotations) → SC → PACS. */
    captureViewportSc: async () => {
      const activeViewportId = viewportGridService.getActiveViewportId?.()
        ?? viewportGridService.getState?.()?.activeViewportId;
      const viewport = cornerstoneViewportService.getCornerstoneViewport(activeViewportId);
      if (!viewport) {
        notify('error', 'Secondary Capture', 'No active viewport to capture.');
        return false;
      }
      const canvas = await composeViewportCanvas(viewport);
      const displaySets =
        cornerstoneViewportService.getViewportDisplaySets?.(activeViewportId) ?? [];
      return storeCapture(canvas, displaySets, 'viewport');
    },

    /** Every visible viewport composed as ONE image → SC → PACS. */
    captureLayoutSc: async () => {
      const state = viewportGridService.getState?.();
      const viewportIds: string[] = state?.viewports
        ? [...state.viewports.keys()]
        : [];
      const viewports = viewportIds
        .map(id => cornerstoneViewportService.getCornerstoneViewport(id))
        .filter(Boolean);
      if (!viewports.length) {
        notify('error', 'Secondary Capture', 'No viewports to capture.');
        return false;
      }
      const canvas = await composeLayoutCanvas(viewports);
      const displaySets = viewportIds.flatMap(
        id => cornerstoneViewportService.getViewportDisplaySets?.(id) ?? []
      );
      return storeCapture(canvas, displaySets, 'layout');
    },

    /**
     * RTV-95: active viewport's cine (every frame/slice, image + burned
     * annotations) → MP4/WebM download.
     *
     * - fps: explicit option > the viewport's cine player rate > 24.
     * - Resolution: the viewport is upscaled (smoothed drawImage) so the
     *   longer side is ≥1080 px unless an explicit `scale` is given.
     * - MP4 (H.264) when the browser's MediaRecorder can encode it
     *   (Chrome ≥126), WebM otherwise; no encoder at all → error toast.
     * - The viewport is restored to its original frame afterwards.
     */
    exportCineVideo: async ({ fps, bitsPerSecond, scale }: {
      fps?: number;
      bitsPerSecond?: number;
      scale?: number;
    } = {}) => {
      const activeViewportId = viewportGridService.getActiveViewportId?.()
        ?? viewportGridService.getState?.()?.activeViewportId;
      const viewport = cornerstoneViewportService.getCornerstoneViewport(activeViewportId);
      if (!viewport) {
        notify('error', 'Export Cine', 'No active viewport to export.');
        return false;
      }
      const frameCount = viewportFrameCount(viewport);
      if (frameCount < 2) {
        notify(
          'error',
          'Export Cine',
          'The active viewport has a single image. Cine export needs a multi-frame series.'
        );
        return false;
      }
      const mimeType = pickVideoMimeType();
      if (!mimeType) {
        notify('error', 'Export Cine', 'This browser cannot record video (no MP4/WebM encoder).');
        return false;
      }
      const cineFrameRate = cineService?.getState?.()?.cines?.[activeViewportId]?.frameRate;
      const effectiveFps = Math.max(
        1,
        (Number(fps) > 0 && Number(fps)) ||
          (Number(cineFrameRate) > 0 && Number(cineFrameRate)) ||
          CINE_EXPORT_DEFAULT_FPS
      );

      // Export canvas: viewport aspect, upscaled to ≥1080 on the longer side
      // (unless an explicit scale is given). Even dimensions for H.264.
      // Device pixels (the on-screen canvas), NOT clientWidth — on HiDPI the
      // CSS size would throw away half the real resolution before upscaling.
      const srcW = viewport.getCanvas()?.width || viewport.element?.clientWidth || 0;
      const srcH = viewport.getCanvas()?.height || viewport.element?.clientHeight || 0;
      const maxSide = Math.max(srcW, srcH) || 1;
      const effectiveScale =
        Number(scale) > 0
          ? Number(scale)
          : Math.max(1, CINE_EXPORT_MIN_MAX_SIDE / maxSide);
      const toEven = (n: number) => Math.max(2, 2 * Math.round((n * effectiveScale) / 2));
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = toEven(srcW);
      exportCanvas.height = toEven(srcH);
      const ctx = exportCanvas.getContext('2d');
      if (!ctx) {
        notify('error', 'Export Cine', '2D canvas unavailable.');
        return false;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      const originalIndex =
        viewport.getCurrentImageIdIndex?.() ?? viewport.getSliceIndex?.() ?? 0;
      const renderTimeoutMs = Math.max(100, 2 * (1000 / effectiveFps));

      if (cineExportInProgress) {
        notify('error', 'Export Cine', 'A cine export is already running.');
        return false;
      }
      cineExportInProgress = true;
      // RTV-159: track the export as a background task (toast + panel).
      const bgTaskId = bgTaskStart('cine-export', 'Export Cine');
      let bgLastPct = 0;
      // Hidden tabs throttle timers to ≥1 s and pause the render loop — the
      // recording would silently degrade to duplicated frames (review M4).
      let hiddenAbort = false;
      const onVisibility = () => {
        if (document.hidden) {
          hiddenAbort = true;
        }
      };
      document.addEventListener('visibilitychange', onVisibility);
      notify(
        'info',
        'Export Cine',
        `Recording ${frameCount} frames at ${effectiveFps} fps — keep this tab visible...`
      );
      try {
        const blob = await recordCanvasFrames({
          canvas: exportCanvas,
          frameCount,
          fps: effectiveFps,
          mimeType,
          bitsPerSecond,
          drawFrame: async (i: number) => {
            if (hiddenAbort) {
              throw new Error('Export aborted: the tab went to the background.');
            }
            const currentIndex = () =>
              viewport.getCurrentImageIdIndex?.() ?? viewport.getSliceIndex?.();
            // Already displaying this frame → no navigation, no render wait
            // (a forced render here used to fire IMAGE_RENDERED for the OLD
            // image and defeat the wait — review B2).
            if (currentIndex() !== i) {
              const rendered = waitForRender(viewport, renderTimeoutMs);
              await jumpToIndex(viewport, i);
              await rendered.done;
              // Volume path may still be streaming the slice — one bounded
              // re-wait when the reported index hasn't landed yet.
              const idx = currentIndex();
              if (idx !== undefined && idx !== i) {
                await waitForRender(viewport, renderTimeoutMs).done;
              }
            }
            const frame = await composeViewportCanvas(viewport);
            ctx.drawImage(frame, 0, 0, exportCanvas.width, exportCanvas.height);
            // RTV-159: per-frame progress, throttled to ~10% steps.
            const pct = Math.round(((i + 1) / frameCount) * 100);
            if (pct - bgLastPct >= 10 || pct >= 100) {
              bgLastPct = pct;
              bgTaskProgress(bgTaskId, pct);
            }
          },
        });
        const displaySets =
          cornerstoneViewportService.getViewportDisplaySets?.(activeViewportId) ?? [];
        const seriesDescription =
          displaySets[0]?.SeriesDescription ??
          (displaySets[0]?.instances?.[0] ?? displaySets[0]?.instance)?.SeriesDescription;
        const filename = exportFilename(seriesDescription, mimeType, fileTimestamp(new Date()));
        downloadBlob(blob, filename);
        const container = /mp4/i.test(mimeType) ? 'MP4' : 'WebM';
        notify('success', 'Export Cine', `Cine exported as ${container} (${filename}).`);
        bgTaskComplete(bgTaskId, 'success', `${container}: ${filename}`);
        return true;
      } catch (e) {
        const message =
          e instanceof Error && /aborted/.test(e.message)
            ? e.message
            : 'Video recording failed. Try again.';
        notify('error', 'Export Cine', message);
        bgTaskComplete(bgTaskId, 'error', message);
        return false;
      } finally {
        cineExportInProgress = false;
        document.removeEventListener('visibilitychange', onVisibility);
        // Put the viewport back on the frame the user was reading.
        jumpToIndex(viewport, originalIndex).catch(() => undefined);
      }
    },

    /**
     * RTV-96: 3D viewport → rotational cine (360° turntable spin) → MP4/WebM
     * download.
     *
     * - Targets the grid's `volume3d` viewport wherever it sits in the layout
     *   (it does NOT need to be active) — no 3D viewport → honest error toast.
     * - frames (default 120) camera steps of 2π/frames around the focal
     *   point about `axis` (default: the camera's viewUp), each rendered,
     *   composed (image + annotations, ≥1080 on the longer side) and recorded
     *   at `fps` (default 24 → a 5 s full turn).
     * - Shares the single-flight guard with `exportCineVideo` (both drive a
     *   live viewport) and the hidden-tab abort (throttled timers would
     *   silently duplicate frames).
     * - The ORIGINAL camera is restored in `finally`, success or not.
     */
    exportRotational3D: async ({ frames, fps, bitsPerSecond, axis }: {
      frames?: number;
      fps?: number;
      bitsPerSecond?: number;
      axis?: Vec3;
    } = {}) => {
      // Find the 3D viewport anywhere in the grid (active or not).
      const state = viewportGridService.getState?.();
      const viewportIds: string[] = state?.viewports ? [...state.viewports.keys()] : [];
      const viewport3dId = viewportIds.find(id => {
        const vp = cornerstoneViewportService.getCornerstoneViewport(id);
        return vp && VOLUME_3D_VIEWPORT_TYPES.includes((vp as { type?: string }).type);
      });
      const viewport = viewport3dId
        ? cornerstoneViewportService.getCornerstoneViewport(viewport3dId)
        : undefined;
      if (!viewport) {
        notify(
          'error',
          'Export 3D Spin',
          'No 3D (volume) viewport in the current layout. Open a 3D view first.'
        );
        return false;
      }
      if (typeof viewport.getCamera !== 'function' || typeof viewport.setCamera !== 'function') {
        notify('error', 'Export 3D Spin', 'The 3D viewport does not expose camera controls.');
        return false;
      }
      const mimeType = pickVideoMimeType();
      if (!mimeType) {
        notify(
          'error',
          'Export 3D Spin',
          'This browser cannot record video (no MP4/WebM encoder).'
        );
        return false;
      }
      const frameCount =
        Number(frames) >= 2 ? Math.floor(Number(frames)) : ROTATIONAL_3D_DEFAULT_FRAMES;
      const effectiveFps = Math.max(
        1,
        (Number(fps) > 0 && Number(fps)) || CINE_EXPORT_DEFAULT_FPS
      );
      // Degenerate/zero axes would record a static video — fall back to the
      // default (the camera's viewUp) instead.
      const axisVec: Vec3 | undefined =
        Array.isArray(axis) &&
        axis.length === 3 &&
        axis.every(n => Number.isFinite(n)) &&
        Math.hypot(axis[0], axis[1], axis[2]) > 0
          ? (axis.map(Number) as Vec3)
          : undefined;

      // Export canvas: same sizing rule as exportCineVideo — viewport aspect
      // at device pixels, upscaled so the longer side is ≥1080, even
      // dimensions for H.264.
      const srcW = viewport.getCanvas()?.width || viewport.element?.clientWidth || 0;
      const srcH = viewport.getCanvas()?.height || viewport.element?.clientHeight || 0;
      const maxSide = Math.max(srcW, srcH) || 1;
      const effectiveScale = Math.max(1, CINE_EXPORT_MIN_MAX_SIDE / maxSide);
      const toEven = (n: number) => Math.max(2, 2 * Math.round((n * effectiveScale) / 2));
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = toEven(srcW);
      exportCanvas.height = toEven(srcH);
      const ctx = exportCanvas.getContext('2d');
      if (!ctx) {
        notify('error', 'Export 3D Spin', '2D canvas unavailable.');
        return false;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      if (cineExportInProgress) {
        notify('error', 'Export 3D Spin', 'A video export is already running.');
        return false;
      }
      cineExportInProgress = true;
      // RTV-159: track the export as a background task (toast + panel).
      const bgTaskId = bgTaskStart('rotational-3d-export', 'Export 3D Spin');
      let bgLastPct = 0;
      let bgFrameIndex = 0;
      // Snapshot the camera BEFORE the first step so finally can restore the
      // exact view the user set up (copies — getCamera may return live arrays).
      const cam0 = viewport.getCamera();
      const originalCamera = {
        position: [...cam0.position] as Vec3,
        focalPoint: [...cam0.focalPoint] as Vec3,
        viewUp: [...cam0.viewUp] as Vec3,
      };
      const stepAngle = (2 * Math.PI) / frameCount;
      const renderTimeoutMs = Math.max(100, 2 * (1000 / effectiveFps));
      // Hidden tabs throttle timers to ≥1 s and pause the render loop — the
      // recording would silently degrade to duplicated frames (review M4).
      let hiddenAbort = false;
      const onVisibility = () => {
        if (document.hidden) {
          hiddenAbort = true;
        }
      };
      document.addEventListener('visibilitychange', onVisibility);
      notify(
        'info',
        'Export 3D Spin',
        `Recording a 360° spin (${frameCount} frames at ${effectiveFps} fps) — keep this tab visible...`
      );
      try {
        const blob = await recordCanvasFrames({
          canvas: exportCanvas,
          frameCount,
          fps: effectiveFps,
          mimeType,
          bitsPerSecond,
          drawFrame: async () => {
            if (hiddenAbort) {
              throw new Error('Export aborted: the tab went to the background.');
            }
            // One fixed step from the CURRENT camera — the last frame lands
            // back on the starting view (2π/frames × frames = 360°).
            const cam = viewport.getCamera();
            const next = orbitStep(
              {
                position: [...cam.position] as Vec3,
                focalPoint: [...cam.focalPoint] as Vec3,
                viewUp: [...cam.viewUp] as Vec3,
              },
              stepAngle,
              axisVec
            );
            // Attach the render wait BEFORE triggering it (race — review B2).
            const rendered = waitForRender(viewport, renderTimeoutMs);
            viewport.setCamera({ position: next.position, viewUp: next.viewUp });
            viewport.render?.();
            await rendered.done;
            const frame = await composeViewportCanvas(viewport);
            ctx.drawImage(frame, 0, 0, exportCanvas.width, exportCanvas.height);
            // RTV-159: per-frame progress, throttled to ~10% steps (this
            // drawFrame gets no index, so count the recorded frames locally).
            const pct = Math.round((++bgFrameIndex / frameCount) * 100);
            if (pct - bgLastPct >= 10 || pct >= 100) {
              bgLastPct = pct;
              bgTaskProgress(bgTaskId, pct);
            }
          },
        });
        const displaySets =
          cornerstoneViewportService.getViewportDisplaySets?.(viewport3dId) ?? [];
        const seriesDescription =
          displaySets[0]?.SeriesDescription ??
          (displaySets[0]?.instances?.[0] ?? displaySets[0]?.instance)?.SeriesDescription;
        const filename = exportFilename(
          seriesDescription ? `rotational-3d-${seriesDescription}` : 'rotational-3d',
          mimeType,
          fileTimestamp(new Date())
        );
        downloadBlob(blob, filename);
        const container = /mp4/i.test(mimeType) ? 'MP4' : 'WebM';
        notify('success', 'Export 3D Spin', `3D spin exported as ${container} (${filename}).`);
        bgTaskComplete(bgTaskId, 'success', `${container}: ${filename}`);
        return true;
      } catch (e) {
        const message =
          e instanceof Error && /aborted/.test(e.message)
            ? e.message
            : 'Video recording failed. Try again.';
        notify('error', 'Export 3D Spin', message);
        bgTaskComplete(bgTaskId, 'error', message);
        return false;
      } finally {
        cineExportInProgress = false;
        document.removeEventListener('visibilitychange', onVisibility);
        // Put the camera back exactly where the user left it.
        try {
          viewport.setCamera(originalCamera);
          viewport.render?.();
        } catch (e) {
          /* restoring the view must never mask the export outcome */
        }
      }
    },
  };

  return {
    actions,
    definitions: {
      captureViewportSc: { commandFn: actions.captureViewportSc },
      captureLayoutSc: { commandFn: actions.captureLayoutSc },
      exportCineVideo: { commandFn: actions.exportCineVideo },
      exportRotational3D: { commandFn: actions.exportRotational3D },
    },
    defaultContext: 'CORNERSTONE',
  };
}

export default getCommandsModule;
