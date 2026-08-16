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
 *
 * RTV-214 adds drawingTools.ts: the Eclipse-shaped Drawing Tools catalogue, the
 * active-tool/active-structure state (kept as independent axes, which is the
 * ticket's stated principle) and the operational right-click menu. Tools that
 * are not implemented yet are listed and disabled rather than hidden or
 * silently no-op. The geometry operations themselves, and the cornerstone
 * annotation tools that make a stroke happen, are RTV-141.
 */
export * from './rtStructParser';
export * from './drawingTools';
export * from './contourGeometry';

import getPanelModule from './getPanelModule';
import getCommandsModule from './getCommandsModule';

const id = '@ohif/extension-rt-struct';

const rtStructExtension = {
  id,
  getPanelModule,
  getCommandsModule,
};

export default rtStructExtension;
