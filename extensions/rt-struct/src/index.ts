/**
 * @ohif/extension-rt-struct
 *
 * RT Structure Set summary for OHIF v3 (RTV-146). Client-side RTSTRUCT parser +
 * a read-only structures panel (name / color / interpreted type / contour count
 * / approximate volume) with CSV export. Follows RTV-114 (extension-first / zero
 * fork).
 *
 * Panel-only by design: the cornerstone extension already registers a
 * SopClassHandler for RTSTRUCT, so registering another here would duplicate the
 * display set. The contour *editor* (drawing/editing) is a separate viewport
 * integration (follow-up); this delivers the verifiable summary slice of RTV-146.
 */
export * from './rtStructParser';

import getPanelModule from './getPanelModule';
import getCommandsModule from './getCommandsModule';

const id = '@ohif/extension-rt-struct';

const rtStructExtension = {
  id,
  getPanelModule,
  getCommandsModule,
};

export default rtStructExtension;
