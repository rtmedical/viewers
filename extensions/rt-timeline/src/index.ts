/**
 * @ohif/extension-rt-timeline
 *
 * RT Summary / Course Timeline panel for OHIF v3 (epic RTV-162): a
 * CourseTimelinePanel (RTV-164) hosting the prescription (RTV-165) and treatment
 * (RTV-166) sub-timelines. Follows RTV-114 (extension-first / zero fork).
 *
 * Panel-only: it consumes the parsed `rtPlan` / `rtRecord` models the sibling
 * extensions (@ohif/extension-rt-plan, @ohif/extension-rt-record) attach to their
 * display sets — duck-typed, so there is no cross-extension import.
 */
export * from './courseTimeline';

import getPanelModule from './getPanelModule';

const id = '@ohif/extension-rt-timeline';

const rtTimelineExtension = {
  id,
  getPanelModule,
};

export default rtTimelineExtension;
