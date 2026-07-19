/**
 * SopClassHandler for Radiation Dose SR (RDSR) objects (RTV-201).
 *
 * No native OHIF handler claims the Radiation Dose SR SOP classes, so this is
 * not a duplicate. Builds one display set per RDSR with the parsed dose report
 * on `doseReport`. Framework-free (no `@ohif/core`; local guid) per the nested
 * `@ohif/core` bundling gotcha.
 */
import { RADIATION_DOSE_SR_SOP_CLASS_UID_LIST, parseRadiationDoseReport } from './rdsrParser';

const EXTENSION_ID = '@ohif/extension-dose-tracking';
const HANDLER_NAME = 'radiationDoseSr';
const SOP_CLASS_HANDLER_ID = `${EXTENSION_ID}.sopClassHandlerModule.${HANDLER_NAME}`;

const sopClassUids = RADIATION_DOSE_SR_SOP_CLASS_UID_LIST;

function guid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function makeDisplaySets(instances: Record<string, any>[]) {
  return (instances ?? []).map(instance => {
    const doseReport = parseRadiationDoseReport(instance);
    const {
      SeriesDescription,
      SeriesNumber,
      SeriesDate,
      SOPInstanceUID,
      SeriesInstanceUID,
      StudyInstanceUID,
      SOPClassUID,
    } = instance;
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
