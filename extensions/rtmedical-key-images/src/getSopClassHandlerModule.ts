/**
 * OHIF SopClassHandler for **Key Object Selection (KOS) Documents** (RTV-148).
 *
 * Lets OHIF turn an existing KOS instance loaded from a study into a display set
 * whose parsed key-image references the Key Images panel can consume. The actual
 * parsing is the framework-free {@link ./parseKosInstance}; this module is the
 * thin OHIF adapter (RTV-114 zero-fork: no `@ohif/core` changes).
 *
 * It deliberately avoids importing `@ohif/core`: under pnpm the extension has a
 * nested `@ohif/core` (from its peerDependency) whose published UMD build breaks
 * against Cornerstone3D 5.x at bundle time, so we generate the display-set UID
 * locally instead of using `@ohif/core` `utils.guid`.
 */
import { KEY_OBJECT_SELECTION_SOP_CLASS_UID } from './kos';
import { parseKosInstance } from './parseKosInstance';

const EXTENSION_ID = '@ohif/extension-rtmedical-key-images';
const HANDLER_NAME = 'kos';
const SOP_CLASS_HANDLER_ID = `${EXTENSION_ID}.sopClassHandlerModule.${HANDLER_NAME}`;

const sopClassUids = [KEY_OBJECT_SELECTION_SOP_CLASS_UID];

/** RFC4122-ish v4 GUID for `displaySetInstanceUID` (no `@ohif/core` dependency). */
function guid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Build one display set per KOS instance. Each carries the parsed references on
 * `keyImageReferences` so a mode/panel can hydrate the selection from a stored
 * KOS without re-parsing DICOM.
 */
function makeDisplaySets(instances: Record<string, any>[]) {
  return (instances ?? []).map(instance => {
    const parsed = parseKosInstance(instance);
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
      Modality: 'KO',
      displaySetInstanceUID: guid(),
      SeriesDescription: SeriesDescription || parsed.title?.CodeMeaning || 'Key Object Selection',
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
      // ---- Key Images specifics ----
      keyImageReferences: parsed.references,
      kosTitle: parsed.title,
      kosDescription: parsed.description,
      label: SeriesDescription || parsed.title?.CodeMeaning || 'Key Images',
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
