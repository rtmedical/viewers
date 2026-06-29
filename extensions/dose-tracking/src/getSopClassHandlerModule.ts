/**
 * SopClassHandler for Radiation Dose SR (RDSR) objects (RTV-201).
 *
 * No native OHIF handler claims the Radiation Dose SR SOP classes, so this is
 * not a duplicate. Builds one display set per RDSR with the parsed dose report
 * on `doseReport`. Framework-free (no `@ohif/core`; local guid) per the nested
 * `@ohif/core` bundling gotcha.
 */
import {
  RADIATION_DOSE_SR_SOP_CLASS_UID_LIST,
  parseRadiationDoseReport,
} from './rdsrParser';

const EXTENSION_ID = '@ohif/extension-dose-tracking';
const HANDLER_NAME = 'radiationDoseSr';
const SOP_CLASS_HANDLER_ID = `${EXTENSION_ID}.sopClassHandlerModule.${HANDLER_NAME}`;

const sopClassUids = RADIATION_DOSE_SR_SOP_CLASS_UID_LIST;

function guid(): string {
  const rand = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(1);
  return `${rand()}${rand()}-${rand()}-${rand()}-${rand()}-${rand()}${rand()}${rand()}`;
}

function makeDisplaySets(instances: Record<string, any>[]) {
  return (instances ?? []).map(instance => {
    const doseReport = parseRadiationDoseReport(instance);
    const { SeriesDescription, SeriesNumber, SeriesDate, SOPInstanceUID, SeriesInstanceUID, StudyInstanceUID, SOPClassUID } = instance;
    const label = SeriesDescription || 'Radiation Dose Report';
    return {
      Modality: 'SR',
      displaySetInstanceUID: guid(),
      SeriesDescription: SeriesDescription || label,
      SeriesNumber,
      SeriesDate,
      SOPInstanceUID,
      SeriesInstanceUID,
      StudyInstanceUID,
      SOPClassHandlerId: SOP_CLASS_HANDLER_ID,
      SOPClassUID,
      sopClassUids,
      referencedImages: null,
      measurements: null,
      isDerivedDisplaySet: true,
      isLoaded: true,
      numImageFrames: 0,
      numInstances: 1,
      instances: [instance],
      instance,
      doseReport,
      label,
      thumbnailSrc: null,
    };
  });
}

export function getSopClassHandlerModule() {
  return [{ name: HANDLER_NAME, sopClassUids, getDisplaySetsFromSeries: makeDisplaySets }];
}

export { SOP_CLASS_HANDLER_ID, makeDisplaySets };
export default getSopClassHandlerModule;
