/**
 * @ohif/extension-rt-display-cal
 *
 * Display-calibration QA for OHIF v3 (RTV-211, Fase 1): DICOM PS3.14 GSDF
 * targets (pure math), AAPM TG18-style test-pattern specs, a fullscreen
 * /display-calibration page (registered via `routes.customRoutes` — no core
 * changes, RTV-114) and a visual-conformance checklist with an auditable,
 * CSV-exportable record trail.
 *
 * SCOPE: real luminance verification (PS3.14 / AAPM TG-270 conformance) needs a
 * photometer — a browser cannot measure emitted cd/m² — and GPU-LUT/ICC
 * calibration is out of scope. The deliverable is visual QA against computed
 * GSDF targets plus the audit trail.
 */
export * from './gsdf';
export * from './tg18Patterns';
export * from './conformanceStore';
export { renderPatternToCanvas } from './renderPattern';
export { CalibrationPage } from './CalibrationPage';

import getCustomizationModule from './getCustomizationModule';

const id = '@ohif/extension-rt-display-cal';

const rtDisplayCalExtension = {
  id,
  getCustomizationModule,
};

export default rtDisplayCalExtension;
