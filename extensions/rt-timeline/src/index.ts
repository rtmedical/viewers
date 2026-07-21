/**
 * @ohif/extension-rt-timeline
 *
 * RT Summary / Course Timeline panel for OHIF v3 (epic RTV-162): a
 * CourseTimelinePanel (RTV-164) with stacked lanes over a shared calendar axis
 * — Prescriptions (RTV-165), Treatments (RTV-166), placeholders for Imaging /
 * Overrides / Trends (RTV-167/168/169) — plus calendar options (RTV-175), the
 * plan filter (RTV-174) and the 180-day complete-history window (RTV-176).
 * Follows RTV-114 (extension-first / zero fork).
 *
 * Panel-only: it consumes the parsed `rtPlan` / `rtRecord` models the sibling
 * extensions (@ohif/extension-rt-plan, @ohif/extension-rt-record) attach to their
 * display sets — duck-typed, so there is no cross-extension import.
 */
export * from './courseTimeline';
export * from './timelineWindow';
export * from './timelinePrefs';

import getPanelModule from './getPanelModule';

const id = '@ohif/extension-rt-timeline';

const rtTimelineExtension = {
  id,
  getPanelModule,
};

export default rtTimelineExtension;
