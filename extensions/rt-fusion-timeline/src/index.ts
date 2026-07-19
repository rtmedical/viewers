/**
 * @ohif/extension-rt-fusion-timeline
 *
 * Fusion Timeline for OHIF v3 (RTV-135): registration displacement over the
 * course as an SVG chart + table. Follows RTV-114 (extension-first / zero fork).
 *
 * Scope: the pure displacement model + chart + panel are delivered; points are
 * parsed from loaded Spatial Registration (REG) objects. Wiring the legacy
 * per-fraction fusion-store history is a backend follow-up.
 */
export * from './fusionTimeline';

import getPanelModule from './getPanelModule';

const id = '@ohif/extension-rt-fusion-timeline';

const rtFusionTimelineExtension = {
  id,
  getPanelModule,
};

export default rtFusionTimelineExtension;
