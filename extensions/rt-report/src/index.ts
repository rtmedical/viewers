/**
 * @ohif/extension-rt-report
 *
 * The radiology report (laudo) core.
 *
 * - **Lifecycle** (RTV-107): draft, preliminary, signed, addendum — with the
 *   rule everything else hangs off, which is that a signed report is immutable
 *   and the only way to change one is to write an addendum.
 *
 * This is the state layer the rest of the RTV-103 family sits on: the rich-text
 * editor (RTV-104), templates (RTV-105), macros (RTV-106), peer review
 * (RTV-108) and distribution (RTV-110) all need to agree on when a document may
 * be typed into, when it may be sent, and which version a recipient holds.
 *
 * Framework-free and time-injectable; there is no editor here and no backend
 * client. Follows RTV-114 (extension-first, zero fork).
 */
export * from './reportWorkflow';

const id = '@ohif/extension-rt-report';

const rtReportExtension = { id };

export { id };
export default rtReportExtension;
