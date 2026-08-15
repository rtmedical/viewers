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
 *
 * RTV-191 adds the bulk-operation cores: worklistSelection.ts (id-based
 * multi-select with shift+click ranges and a query-mode "select all
 * matching"), worklistBatch.ts (chunked runs with progress, honest partial
 * failure and a 5s undo that restores each study's own previous value) and
 * worklistExport.ts (CSV of the visible columns, with formula-injection
 * escaping). All pure; the batch endpoints do not exist yet and the row
 * checkboxes are not wired into RtWorklistPage.
 *
 * RTV-190 adds worklistActions.ts: the per-study action resolver for the
 * hover row, the overflow and the right-click menu. Permissions arrive as an
 * injected predicate rather than an import from rt-governance, hidden and
 * disabled are distinct answers, and destructive actions are kept off the
 * hover row. Also pure, also not wired into the page yet.
 */
export * from './worklistModel';
export * from './worklistSelection';
export * from './worklistActions';
export * from './worklistBatch';
export * from './worklistExport';
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
