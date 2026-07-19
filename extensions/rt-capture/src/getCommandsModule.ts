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
 */
import { rgbaToRgb, ScPatientStudyContext, ScSourceImageRef } from './scDataset';
import { buildScDatasetWithRealUids, newUid, toDa } from './scSerialize';
import { canvasPixels, composeLayoutCanvas, composeViewportCanvas } from './captureCompose';

/** One capture series per study per session, so captures group in the PACS. */
const seriesByStudy = new Map<string, string>();
let instanceCounter = 0;

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

export function getCommandsModule({ servicesManager, extensionManager }: any) {
  const {
    viewportGridService,
    cornerstoneViewportService,
    uiNotificationService,
  } = servicesManager.services;

  const notify = (type: 'success' | 'error' | 'info', title: string, message: string) => {
    try {
      uiNotificationService?.show?.({ title, message, type, duration: 4000 });
    } catch (e) {
      /* toasts must never break the command */
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
  };

  return {
    actions,
    definitions: {
      captureViewportSc: { commandFn: actions.captureViewportSc },
      captureLayoutSc: { commandFn: actions.captureLayoutSc },
    },
    defaultContext: 'CORNERSTONE',
  };
}

export default getCommandsModule;
