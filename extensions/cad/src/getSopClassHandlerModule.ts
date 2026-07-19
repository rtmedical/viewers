/**
 * OHIF SopClassHandler for **CAD Structured Reports** (RTV-79).
 *
 * Registers Mammography CAD SR (88.50) and Chest CAD SR (88.65) — not claimed by
 * cornerstone-dicom-sr (Basic/Enhanced/Comprehensive SR only), so not a
 * duplicate. Builds a display set per CAD SR with the parsed findings on
 * `cadSr`. Framework-free (no `@ohif/core`; local guid).
 */
import { CAD_SR_SOP_CLASS_UID_LIST, parseCadSr } from './cadSr';

const EXTENSION_ID = '@ohif/extension-cad';
const HANDLER_NAME = 'cadSr';
const SOP_CLASS_HANDLER_ID = `${EXTENSION_ID}.sopClassHandlerModule.${HANDLER_NAME}`;
const sopClassUids = CAD_SR_SOP_CLASS_UID_LIST;

function guid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function makeDisplaySets(instances: Record<string, any>[]) {
  return (instances ?? []).map(instance => {
    const cadSr = parseCadSr(instance);
    const {
      SeriesDescription,
      SeriesNumber,
      SeriesDate,
      SOPInstanceUID,
      SeriesInstanceUID,
      StudyInstanceUID,
      SOPClassUID,
    } = instance;
    const label = SeriesDescription || cadSr.title || 'CAD SR';
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
      isDerivedDisplaySet: true,
      isLoaded: true,
      numImageFrames: 0,
      numInstances: 1,
      instances: [instance],
      instance,
      cadSr,
      label,
    };
  });
}

export function getSopClassHandlerModule() {
  return [{ name: HANDLER_NAME, sopClassUids, getDisplaySetsFromSeries: makeDisplaySets }];
}

export { SOP_CLASS_HANDLER_ID, makeDisplaySets };
export default getSopClassHandlerModule;
