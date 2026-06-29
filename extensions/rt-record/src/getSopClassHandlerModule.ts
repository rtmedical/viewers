/**
 * OHIF SopClassHandler for **RT Treatment Records** (RTV-163).
 *
 * Registers the 4 RT Treatment Record SOP classes (Beams / Brachy / Summary /
 * Ion Beams) — no native OHIF handler claims them, so this is not a duplicate.
 * Builds one display set per record with the parsed delivery summary on
 * `rtRecord`. Framework-free (no `@ohif/core` import; local guid) per the
 * nested-`@ohif/core` bundling gotcha from RTV-148.
 */
import {
  RT_TREATMENT_RECORD_SOP_CLASS_UID_LIST,
  parseRtRecord,
} from './rtRecordParser';

const EXTENSION_ID = '@ohif/extension-rt-record';
const HANDLER_NAME = 'rtRecord';
const SOP_CLASS_HANDLER_ID = `${EXTENSION_ID}.sopClassHandlerModule.${HANDLER_NAME}`;

const sopClassUids = RT_TREATMENT_RECORD_SOP_CLASS_UID_LIST;

function guid(): string {
  const rand = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(1);
  return `${rand()}${rand()}-${rand()}-${rand()}-${rand()}-${rand()}${rand()}${rand()}`;
}

function makeDisplaySets(instances: Record<string, any>[]) {
  return (instances ?? []).map(instance => {
    const rtRecord = parseRtRecord(instance);
    const { SeriesDescription, SeriesNumber, SeriesDate, SOPInstanceUID, SeriesInstanceUID, StudyInstanceUID, SOPClassUID } = instance;
    const label = SeriesDescription || `RT Record (${rtRecord.recordType})`;
    return {
      Modality: 'RTRECORD',
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
      rtRecord,
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
