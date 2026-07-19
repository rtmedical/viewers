/**
 * @ohif/extension-rt-dvh
 *
 * DVH (Dose Volume Histogram) viewer for OHIF v3 (RTV-131). Client-side DVH
 * parser (the DVH lives inside RTDOSE — there is no separate DVH SOP class) plus
 * a dose×volume chart panel. Follows RTV-114 (extension-first / zero fork).
 *
 * Architecture note: it deliberately does NOT register a SopClassHandler for
 * RTDOSE — that would duplicate the dose-grid display set the cornerstone
 * extension already produces. The panel reads existing RTDOSE display sets and
 * parses their embedded DVHSequence; structure names come from a loaded RTSTRUCT.
 */
export * from './dvhParser';
export * from './dvhChart';

import getPanelModule from './getPanelModule';

const id = '@ohif/extension-rt-dvh';

const rtDvhExtension = {
  id,
  getPanelModule,
};

export default rtDvhExtension;
