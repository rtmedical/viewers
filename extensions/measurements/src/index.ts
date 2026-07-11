/**
 * @ohif/extension-measurements
 *
 * Advanced measurement calculators for OHIF v3 (RTV-27 epic): HU statistics
 * (RTV-28), SUVbw (RTV-29), Cobb angle (RTV-30), Agatston calcium score
 * (RTV-46). Follows RTV-114 (extension-first / zero fork).
 *
 * Scope: the pure calculators + commands + a status panel are delivered.
 * Capturing the ROI pixels / line annotations / lesion masks from the cornerstone
 * viewport to feed them is an integration follow-up.
 */
export * from './measurements';
export * from './lineProfile';
export { getCommandsModule } from './getCommandsModule';

import { addTool, Enums as csToolsEnums } from '@cornerstonejs/tools';
import { eventTarget } from '@cornerstonejs/core';
import getCommandsModule from './getCommandsModule';
import getPanelModule from './getPanelModule';
import LineProfileTool, { onLineProfileCompleted } from './LineProfileTool';

const id = '@ohif/extension-measurements';

const measurementsExtension = {
  id,
  /**
   * RTV-32: register the LineProfile cornerstone tool once and listen for its
   * completion globally (the handler no-ops for other tools). The mode adds
   * 'LineProfile' to its tool group + a toolbar button; the panel reads the
   * published profile. This runs at app init, before any mode is entered.
   */
  preRegistration({ servicesManager }: { servicesManager: any }): void {
    try {
      addTool(LineProfileTool);
    } catch (e) {
      /* already registered — addTool throws on duplicate */
    }
    eventTarget.addEventListener(csToolsEnums.Events.ANNOTATION_COMPLETED, (evt: any) =>
      onLineProfileCompleted(servicesManager, evt)
    );
  },
  getCommandsModule,
  getPanelModule,
};

export default measurementsExtension;
