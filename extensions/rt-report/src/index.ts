/**
 * @ohif/extension-rt-report
 *
 * The radiology report (laudo) core.
 *
 * - **Lifecycle** (RTV-107): draft, preliminary, signed, addendum — with the
 *   rule everything else hangs off, which is that a signed report is immutable
 *   and the only way to change one is to write an addendum.
 * - **Macros** (RTV-106): shortcut-triggered phrases with fill-in fields, and
 *   the pre-sign guard that refuses a report still containing them.
 * - **Critical findings** (RTV-202): the append-only record of an urgent
 *   communication to the referring physician, and the escalation clock that
 *   keeps asking until somebody acknowledges it. Pre-report, not part of
 *   distribution.
 * - **Peer review** (RTV-108): the `awaitingReview` state that sits before the
 *   signature and has no path through it, plus the agreement scale and the
 *   discrepancy KPI that refuses to state a rate for a biased sample.
 * - **Turnaround** (RTV-109): the deadline clock, measured to the first
 *   actionable report rather than to the signature, and stopped while the
 *   radiologist cannot act.
 * - **FHIR export** (RTV-219): DiagnosticReport + Observation, with a status
 *   mapping that never lets an unsigned report claim `final`, and references
 *   that have to resolve outside the database that made them.
 * - **Canonical model** (RTV-216): the persisted contract — immutable
 *   content-addressed versions, structured observations that are the record
 *   rather than a parse of the prose, and provenance on every clinical claim.
 * - **CDE catalogue** (RTV-217): validating an observation against its element
 *   definition — unit mismatch as an error rather than a silent conversion,
 *   versioned value sets, and cardinality.
 * - **Image evidence** (RTV-221): the link back to the pixels, in DICOM SR
 *   shape, with the coordinate space recorded rather than inferred — because a
 *   2D coordinate does not survive a re-reconstruction and a 3D one does.
 * - **RADS packs** (RTV-220): TI-RADS, PI-RADS, BI-RADS and LI-RADS — computed
 *   where the rules are deterministic, with the size that decides the action
 *   required rather than optional.
 * - **Safety net** (RTV-229): follow-up recommendations tracked to closure,
 *   where closure needs evidence rather than the passage of time and a
 *   matching study is proposed rather than auto-closed.
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
export * from './macros';
export * from './criticalFindings';
export * from './peerReview';
export * from './turnaround';
export * from './canonicalReport';
export * from './reportTemplate';
export * from './mrrtImport';
export * from './templateLibrary';
export * from './distribution';
export * from './speechAdapter';
export * from './hubQueue';
export * from './findingBlock';
export * from './cdeCatalog';
export * from './imageEvidence';
export * from './radsPacks';
export * from './safetyNet';
export * from './fhirExport';

const id = '@ohif/extension-rt-report';

const rtReportExtension = { id };

export { id };
export default rtReportExtension;
export * from './signOff';
export * from './versionDiff';
export * from './audioCapture';
export * from './reportDocument';
export * from './aiCopilot';
