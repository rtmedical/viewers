/**
 * Commands for the mammography extension (RTV-37 export, RTV-39 PACS push):
 * a BI-RADS assessment as a Mammography CAD SR (TID 2000). Builder is pure
 * ({@link ./mammographyCadSr}); byte writing is {@link ./srExport} (dcmjs).
 *
 * - `downloadBiradsSr`    — build + save a Part-10 file locally.
 * - `storeBiradsSrToPacs` — build the SAME dataset and send it to the active
 *   data source via STOW-RS (`dataSource.store.dicom`), following the
 *   rt-capture pattern: the SR is filed under the study shown in the active
 *   viewport (explicit `StudyInstanceUID`/patient options override),
 *   success/failure surfaces as a toast, a STOW failure (PACS offline) is
 *   caught and reported without crashing, and the study's cached metadata is
 *   invalidated so the new series shows after refresh. An offline queue that
 *   retries when the PACS is back (RTVW desktop) is a follow-up.
 */
import { downloadBiradsSr, buildBiradsSrWithRealUids, SrSerializeOptions } from './srExport';
import { BiradsAssessment } from './birads';

/** Patient/study identity needed to file an SR under an existing study. */
export interface SrStudyContext {
  PatientName?: string;
  PatientID?: string;
  PatientBirthDate?: string;
  PatientSex?: string;
  StudyInstanceUID?: string;
  StudyDate?: string;
  StudyTime?: string;
  AccessionNumber?: string;
  ReferringPhysicianName?: string;
  StudyID?: string;
}

/** One SR store at a time (review M1): concurrent STOWs double-post series. */
let srStoreInProgress = false;

/**
 * Normalize a naturalized PatientName (string, `{ Alphabetic }` or an array
 * of those) to the plain string the SR builder takes. Pure.
 */
export function toPnString(pn: unknown): string | undefined {
  if (pn == null) {
    return undefined;
  }
  if (typeof pn === 'string') {
    return pn;
  }
  if (Array.isArray(pn)) {
    return toPnString(pn[0]);
  }
  if (typeof pn === 'object' && typeof (pn as any).Alphabetic === 'string') {
    return (pn as any).Alphabetic;
  }
  return undefined;
}

/**
 * Pull the patient/study identity from a viewport's display sets (first
 * instance that carries a StudyInstanceUID wins) — the same field set as
 * rt-capture's `contextFromDisplaySets` (review M2). Pure.
 */
export function srContextFromDisplaySets(displaySets: any[]): SrStudyContext | null {
  for (const ds of displaySets ?? []) {
    const instance = ds?.instances?.[0] ?? ds?.instance;
    if (!instance?.StudyInstanceUID) {
      continue;
    }
    return {
      PatientName: toPnString(instance.PatientName),
      PatientID: instance.PatientID,
      PatientBirthDate: instance.PatientBirthDate,
      PatientSex: instance.PatientSex,
      StudyInstanceUID: instance.StudyInstanceUID,
      StudyDate: instance.StudyDate,
      StudyTime: instance.StudyTime,
      AccessionNumber: instance.AccessionNumber,
      ReferringPhysicianName: toPnString(instance.ReferringPhysicianName),
      StudyID: instance.StudyID,
    };
  }
  return null;
}

export function getCommandsModule({ servicesManager, extensionManager }: any = {}) {
  const notify = (type: 'success' | 'error', title: string, message: string) => {
    try {
      servicesManager?.services?.uiNotificationService?.show?.({
        title,
        message,
        type,
        duration: 4000,
      });
    } catch (e) {
      /* toasts must never break the command */
    }
  };

  /** Study context from the ACTIVE viewport's display sets. */
  const activeViewportContext = (): SrStudyContext | null => {
    const { viewportGridService, cornerstoneViewportService } = servicesManager?.services ?? {};
    const activeViewportId =
      viewportGridService?.getActiveViewportId?.() ??
      viewportGridService?.getState?.()?.activeViewportId;
    const displaySets =
      cornerstoneViewportService?.getViewportDisplaySets?.(activeViewportId) ?? [];
    return srContextFromDisplaySets(displaySets);
  };

  const actions = {
    /** Build + download a Mammography CAD SR for a BI-RADS assessment. */
    downloadBiradsSr: ({
      assessment,
      filename,
      ...options
    }: { assessment?: BiradsAssessment; filename?: string } & SrSerializeOptions = {}): boolean => {
      if (!assessment) return false;
      downloadBiradsSr(assessment, { filename, ...options });
      return true;
    },

    /**
     * Build a Mammography CAD SR (TID 2000) and STOW it to the PACS.
     * Guarded (M1): a second store while one is in flight is refused with a
     * toast; the flag is set right before the ONLY await (everything before
     * it is synchronous, so this is race-free) and always cleared in
     * `finally`.
     *
     * NOTE: keep the guarded await a FLAT try/catch/finally — this repo's
     * `@babel/runtime` regenerator miscompiles an awaited rejection caught by
     * a try/catch NESTED inside a try/finally (the rejection escapes;
     * verified under jest with a minimal repro).
     */
    storeBiradsSrToPacs: async ({
      assessment,
      ...options
    }: { assessment?: BiradsAssessment } & SrSerializeOptions = {}): Promise<boolean> => {
      if (!assessment) {
        notify('error', 'BI-RADS SR', 'No BI-RADS assessment to send.');
        return false;
      }
      if (srStoreInProgress) {
        notify('error', 'BI-RADS SR', 'An SR store is already running.');
        return false;
      }
      const context = activeViewportContext();
      if (!context && !options.StudyInstanceUID) {
        notify('error', 'BI-RADS SR', 'No study loaded to attach the SR to.');
        return false;
      }
      const dataSource =
        extensionManager?.getActiveDataSource?.()?.[0] ??
        extensionManager?.getDataSources?.()?.[0];
      if (!dataSource?.store?.dicom) {
        notify('error', 'BI-RADS SR', 'The active data source does not support STOW-RS.');
        return false;
      }
      const dataset = buildBiradsSrWithRealUids(assessment, { ...context, ...options });
      srStoreInProgress = true;
      try {
        await dataSource.store.dicom(dataset);
      } catch (e) {
        notify('error', 'BI-RADS SR', 'Failed to store on the PACS (offline?). Try again.');
        return false;
      } finally {
        srStoreInProgress = false;
      }
      // Invalidate cached study metadata so the new series shows after refresh.
      try {
        dataSource.deleteStudyMetadataPromise?.(dataset.StudyInstanceUID);
      } catch (e) {
        /* refresh hint only */
      }
      notify('success', 'BI-RADS SR', 'SR saved to the PACS.');
      return true;
    },
  };

  const definitions = {
    downloadBiradsSr: { commandFn: actions.downloadBiradsSr },
    storeBiradsSrToPacs: { commandFn: actions.storeBiradsSrToPacs },
  };

  return { actions, definitions, defaultContext: 'DEFAULT' };
}

export default getCommandsModule;
