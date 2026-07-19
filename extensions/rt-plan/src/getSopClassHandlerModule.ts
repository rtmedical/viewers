/**
 * OHIF SopClassHandler for **RT Plan (RTPLAN)** objects (RTV-132).
 *
 * Builds one display set per RTPLAN instance, parsing it (client-side, via the
 * pure {@link ./rtPlanParser}) into a render-ready `rtPlan` model the Ficha panel
 * consumes. Framework-free — it does not import `@ohif/core` (the extension would
 * otherwise resolve a nested `@ohif/core` peer build that fails to bundle under
 * Cornerstone3D 5.x; see RTV-148), so the display-set UID is generated locally.
 */
import { RT_PLAN_SOP_CLASS_UID, parseRtPlan } from './rtPlanParser';

const EXTENSION_ID = '@ohif/extension-rt-plan';
const HANDLER_NAME = 'rtplan';
const SOP_CLASS_HANDLER_ID = `${EXTENSION_ID}.sopClassHandlerModule.${HANDLER_NAME}`;

const sopClassUids = [RT_PLAN_SOP_CLASS_UID];

/** RFC4122-ish v4 GUID for `displaySetInstanceUID` (no `@ohif/core` dependency). */
function guid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function makeDisplaySets(instances: Record<string, any>[]) {
  return (instances ?? []).map(instance => {
    const rtPlan = parseRtPlan(instance);
    const {
      SeriesDescription,
      SeriesNumber,
      SeriesDate,
      SOPInstanceUID,
      SeriesInstanceUID,
      StudyInstanceUID,
      SOPClassUID,
    } = instance;

    const label = rtPlan.label || rtPlan.name || SeriesDescription || 'RT Plan';
    return {
      Modality: 'RTPLAN',
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
      // ---- RT Plan specifics ----
      rtPlan,
      label,
      // OHIF shows this in some viewport/thumbnail contexts.
      thumbnailSrc: null,
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
