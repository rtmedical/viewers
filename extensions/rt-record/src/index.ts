/**
 * @ohif/extension-rt-record
 *
 * RT Treatment Record support for OHIF v3 (RTV-163) — the foundation of the
 * RT Summary / Course Timeline (epic RTV-162). Registers a SopClassHandler for
 * the 4 RT Treatment Record SOP classes (Beams / Brachy / Summary / Ion Beams)
 * and provides a delivery-summary panel. Follows RTV-114 (extension-first /
 * zero fork). No native handler claims these SOPs, so registering one here is
 * not a duplicate.
 */
export * from './rtRecordParser';
export { getSopClassHandlerModule } from './getSopClassHandlerModule';

import getSopClassHandlerModule from './getSopClassHandlerModule';
import getPanelModule from './getPanelModule';

const id = '@ohif/extension-rt-record';

const rtRecordExtension = {
  id,
  getSopClassHandlerModule,
  getPanelModule,
};

export default rtRecordExtension;
