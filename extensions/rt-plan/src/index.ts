/**
 * @ohif/extension-rt-plan
 *
 * RT Plan (RTPLAN) viewer for OHIF v3 (RTV-132). Client-side RT Plan IOD parser
 * + a "Ficha" right panel (plan / prescriptions / beams) and a SopClassHandler
 * that turns RTPLAN objects into display sets. Follows RTV-114 (extension-first /
 * zero fork of @ohif/core, @ohif/app, @ohif/ui).
 *
 * Scope: the legacy connectviewer "Ficha" also rendered a server-computed manual
 * MU-recalculation QA sheet (Sc/Sp factors, TMR/PDP, UMcalculada…). That physics
 * recompute is backend-dependent (Connect) and tracked separately; this extension
 * covers everything the RTPLAN object itself carries.
 */
export * from './rtPlanParser';
export { getSopClassHandlerModule } from './getSopClassHandlerModule';

import getSopClassHandlerModule from './getSopClassHandlerModule';
import getPanelModule from './getPanelModule';

const id = '@ohif/extension-rt-plan';

const rtPlanExtension = {
  id,
  getSopClassHandlerModule,
  getPanelModule,
};

export default rtPlanExtension;
