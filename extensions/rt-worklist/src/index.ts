/**
 * @ohif/extension-rt-worklist
 *
 * RIS-style study list for OHIF v3 (RTV-161): a patient-grouped worklist page
 * at /worklist-rt (registered via `routes.customRoutes` — no core changes,
 * RTV-114) with client-side filters (name/MRN/date range/modality — QIDO is
 * study-centric, so the PATIENT level is grouped client-side by PatientID),
 * on-demand series expansion, a study-info modal, DICOM import through the
 * existing `dicomUploadComponent` customization, and best-effort feeding of
 * the rtmedical worklist queue (next/prev study in the viewer).
 *
 * SCOPE: study MERGE is not implemented — it is not expressible in DICOMweb
 * and requires a PACS backend API (e.g. Orthanc REST); the button ships
 * disabled as a backend follow-up. Promoting /worklist-rt to '/' is a
 * deployment/config decision (`showStudyList: false`), not code.
 *
 * RTV-157 adds the IHE Invoke Image Display (IID) profile entry points at
 * /ihe-invoke and /IHEInvokeImageDisplay (conformance alias):
 * requestType=STUDY|STUDYBASE64|PATIENT HTTP GET invocations resolve through
 * QIDO and open the study set in the auto-selected mode (radiotherapy when
 * any study carries an RT modality, radiology otherwise). The pure request
 * parsing lives in iheInvoke.ts.
 */
export * from './worklistModel';
export * from './iheInvoke';
export { RtWorklistPage } from './RtWorklistPage';
export { IheInvokePage } from './IheInvokePage';

import getCustomizationModule from './getCustomizationModule';

const id = '@ohif/extension-rt-worklist';

const rtWorklistExtension = {
  id,
  getCustomizationModule,
};

export default rtWorklistExtension;
