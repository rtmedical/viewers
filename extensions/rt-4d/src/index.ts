/**
 * @ohif/extension-rt-4d
 *
 * 4D / gated imaging for OHIF v3:
 *
 * - **RTV-93 — 4D-CT respiratory gating.** Labels the phases of a respiratory-gated
 *   4D-CT ("40% EX", not "time point 5 of 10"), flags an incomplete cycle, and adds
 *   the temporal **MIP / MinIP** that RT planning needs for the ITV.
 * - **RTV-92 - binagem respiratoria.** O passo antes do RTV-93: decidir qual aquisicao
 *   vai em qual bin, por fase ou por amplitude, e medir a irregularidade que faz a
 *   binagem por fase produzir o artefato de degrau -- e o ITV subestimar a excursao.
 * - **RTV-51 — ECG gating.** Detects cardiac synchronisation and reports whether the
 *   acquisition was **prospective** or **retrospective**, expressing each phase as a
 *   percentage of the RR interval.
 *
 * ## What this does NOT reimplement
 *
 * Phase navigation and cine already work upstream and are reused as-is: the SOP class
 * handler marks the display set `isDynamicVolume`, `StreamingDynamicImageVolume`
 * exposes a `dimensionGroupNumber` setter, the ui-next `CinePlayer` renders a phase
 * slider from `dynamicVolumeInfo`, and `@cornerstonejs/tools` `playClip` cines across
 * phases rather than slices. This extension adds the two things the stack lacks:
 * **what the phases mean**, and **max/min over time**.
 *
 * Zero-fork per RTV-114: nothing in `platform/`, `extensions/cornerstone`,
 * `extensions/default`, `extensions/cornerstone-dynamic-volume` or `modes/preclinical-4d`
 * is touched.
 */
export * from './phaseDetect';
export * from './respiratoryBinning';
export * from './temporalProjection';
export {
  dynamic4dProtocol,
  dynamic4dProtocols,
  DYNAMIC_4D_PROTOCOL_ID,
} from './getHangingProtocolModule';
export { Rt4dPanel } from './getPanelModule/Rt4dPanel';

import getCommandsModule from './getCommandsModule';
import getHangingProtocolModule from './getHangingProtocolModule';
import getPanelModule from './getPanelModule';

const id = '@ohif/extension-rt-4d';

const rt4dExtension = {
  id,
  getCommandsModule,
  getHangingProtocolModule,
  getPanelModule,
};

export { id };
export default rt4dExtension;
