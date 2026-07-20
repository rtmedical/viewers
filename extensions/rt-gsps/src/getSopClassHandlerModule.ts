/**
 * OHIF SopClassHandler for **Grayscale Softcopy Presentation States** (RTV-200).
 *
 * Lets OHIF turn a GSPS instance loaded from a study into a non-image display
 * set carrying the parsed presentation summary (`ds.gsps`) so a mode can list
 * it and apply it via the `applyGsps` command. The actual parsing is the
 * framework-free {@link ./parseGspsInstance}; this module is the thin OHIF
 * adapter (RTV-114 zero-fork: no `@ohif/core` changes).
 *
 * It deliberately avoids importing `@ohif/core`: under pnpm the extension has a
 * nested `@ohif/core` (from its peerDependency) whose published UMD build breaks
 * against Cornerstone3D 5.x at bundle time, so we generate the display-set UID
 * locally instead of using `@ohif/core` `utils.guid`.
 */
import { GSPS_SOP_CLASS_UID } from './gspsDataset';
import { parseGspsInstance } from './parseGspsInstance';

const EXTENSION_ID = '@ohif/extension-rt-gsps';
const HANDLER_NAME = 'gsps';
const SOP_CLASS_HANDLER_ID = `${EXTENSION_ID}.sopClassHandlerModule.${HANDLER_NAME}`;

const sopClassUids = [GSPS_SOP_CLASS_UID];

/** RFC4122-ish v4 GUID for `displaySetInstanceUID` (no `@ohif/core` dependency). */
function guid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Build one display set per GSPS instance. Each carries the parsed summary on
 * `gsps` so a mode/panel can show and apply the stored presentation state
 * without re-parsing DICOM.
 */
function makeDisplaySets(instances: Record<string, any>[]) {
  return (instances ?? []).map(instance => {
    const gsps = parseGspsInstance(instance);
    const {
      SeriesDescription,
      SeriesNumber,
      SeriesDate,
      SOPInstanceUID,
      SeriesInstanceUID,
      StudyInstanceUID,
      SOPClassUID,
    } = instance;

    return {
      Modality: 'PR',
      displaySetInstanceUID: guid(),
      SeriesDescription: gsps.contentLabel || SeriesDescription || 'Presentation State',
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
      // ---- GSPS specifics ----
      gsps,
      label: gsps.contentLabel || SeriesDescription || 'Presentation State',
    };
  });
}

export function getSopClassHandlerModule() {
  return [
    {
      name: HANDLER_NAME,
      sopClassUids,
      getDisplaySetsFromSeries: makeDisplaySets,
    },
  ];
}

export { SOP_CLASS_HANDLER_ID, makeDisplaySets };
export default getSopClassHandlerModule;
