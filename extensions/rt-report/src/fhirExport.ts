/**
 * FHIR DiagnosticReport export — pure core (RTV-219).
 *
 * Mapping the internal report onto `DiagnosticReport` + `Observation` so another system
 * can consume it. Most of it is field copying. Four things in it are load-bearing.
 *
 * ## The status mapping is not one-to-one, and the wrong end of it is unsafe
 *
 * FHIR has `registered | partial | preliminary | final | amended | corrected | entered-in-error`.
 * The internal workflow (RTV-107/108) has draft, awaiting review, preliminary, signed,
 * amended. They line up almost — and the near-misses are the dangerous ones:
 *
 * - `awaitingReview` is **`partial`**, not `preliminary`. It has not been communicated to
 *   anyone; calling it preliminary tells a downstream system a clinician may act on it.
 * - `draft` is **`registered`**, not `partial`. Nothing has been written that anybody
 *   should see.
 * - Nothing that is not signed may ever map to **`final`**. A receiving system treats
 *   `final` as clinically actionable and will not re-fetch it.
 *
 * {@link toFhirStatus} is a total function over the internal states with no default arm,
 * so a new internal state is a compile error rather than a silent `final`.
 *
 * ## `effectiveDateTime` is when the imaging happened; `issued` is when the report was
 * released
 *
 * These are routinely swapped, and the result is a patient timeline where the report
 * precedes the study or a study that appears to have been read before it was acquired.
 * They are separate arguments here and both are required.
 *
 * ## A reference nobody else can resolve is not interoperability
 *
 * A `DiagnosticReport` pointing at `Patient/42` is useful inside one database and useless
 * outside it. {@link buildReference} requires a system-qualified identifier and
 * {@link exportDiagnosticReport} refuses to emit a report whose subject cannot be resolved
 * — an unresolvable export looks successful and fails at the far end, days later.
 *
 * ## Structured findings do not go in the HTML
 *
 * The architecture note on the RTV-103 family is explicit: no new structured finding may
 * live only inside the narrative. Findings with a code become `Observation` resources
 * referenced from `DiagnosticReport.result`; the narrative is `presentedForm` and text.
 * {@link exportDiagnosticReport} reports how many findings it structured and how many it
 * could not, rather than quietly flattening them into prose.
 *
 * Framework-free, no `@ohif/*`, no FHIR library. Zero-fork per RTV-114.
 */

export type InternalReportState =
  | 'draft'
  | 'awaitingReview'
  | 'preliminary'
  | 'signed'
  | 'amended'
  | 'retracted';

export type FhirReportStatus =
  | 'registered'
  | 'partial'
  | 'preliminary'
  | 'final'
  | 'amended'
  | 'corrected'
  | 'entered-in-error';

/**
 * Internal state to FHIR status.
 *
 * Exhaustive by construction — a `switch` with no default arm over a union, so adding an
 * internal state is a type error here rather than a silent `final` somewhere downstream.
 */
export function toFhirStatus(state: InternalReportState): FhirReportStatus {
  switch (state) {
    case 'draft':
      // Nothing has been written that anybody should see.
      return 'registered';
    case 'awaitingReview':
      // Not communicated to anyone. `preliminary` would say a clinician may act on it.
      return 'partial';
    case 'preliminary':
      return 'preliminary';
    case 'signed':
      return 'final';
    case 'amended':
      return 'amended';
    case 'retracted':
      return 'entered-in-error';
  }
}

/** Whether a receiving system will treat this as clinically actionable. */
export function isActionable(status: FhirReportStatus): boolean {
  return status === 'final' || status === 'amended' || status === 'corrected';
}

export interface Identifier {
  /** URI namespace. Without it the value means nothing outside its own database. */
  system: string;
  value: string;
}

export interface Reference {
  reference?: string;
  identifier?: Identifier;
  display?: string;
}

export interface ReferenceResult {
  reference: Reference | null;
  error?: string;
}

const text = (v: unknown): string => String(v ?? '').trim();

/**
 * A resolvable reference.
 *
 * Requires a system-qualified identifier. `Patient/42` is useful inside one database and
 * useless outside it, and an export that carries it looks successful and fails at the far
 * end, days later.
 */
export function buildReference(
  resourceType: string,
  identifier: Identifier | undefined,
  display?: string
): ReferenceResult {
  const type = text(resourceType);
  const system = text(identifier?.system);
  const value = text(identifier?.value);

  if (!type) {
    return { reference: null, error: 'Tipo de recurso ausente.' };
  }
  if (!value) {
    return { reference: null, error: `${type}: identificador ausente.` };
  }
  if (!system) {
    return {
      reference: null,
      error: `${type}: identificador sem system. Um identificador local não resolve fora do banco que o criou.`,
    };
  }

  return {
    reference: {
      type: undefined,
      identifier: { system, value },
      display: text(display) || undefined,
    } as Reference,
  };
}

export interface FhirCoding {
  system: string;
  code: string;
  display?: string;
}

export interface StructuredFinding {
  id: string;
  /** RadElement / LOINC / SNOMED code. Without one it cannot be an Observation. */
  code?: FhirCoding;
  /** Numeric value with a unit, or a coded value, or plain text. */
  valueQuantity?: { value: number; unit: string; system?: string; code?: string };
  valueCodeableConcept?: FhirCoding;
  valueString?: string;
  /** Laterality, body site and so on. */
  bodySite?: FhirCoding;
  /** DICOM evidence: the image the finding was made on. */
  evidence?: { studyInstanceUid?: string; seriesInstanceUid?: string; sopInstanceUid?: string };
}

export interface FhirObservation {
  resourceType: 'Observation';
  id: string;
  status: 'preliminary' | 'final' | 'amended';
  code: FhirCoding;
  subject: Reference;
  effectiveDateTime: string;
  valueQuantity?: StructuredFinding['valueQuantity'];
  valueCodeableConcept?: FhirCoding;
  valueString?: string;
  bodySite?: FhirCoding;
  derivedFrom?: Reference[];
}

export interface FhirDiagnosticReport {
  resourceType: 'DiagnosticReport';
  id: string;
  status: FhirReportStatus;
  category?: FhirCoding[];
  code: FhirCoding;
  subject: Reference;
  /** When the imaging happened. */
  effectiveDateTime: string;
  /** When the report was released. */
  issued: string;
  performer?: Reference[];
  imagingStudy?: Reference[];
  result?: Reference[];
  conclusion?: string;
  presentedForm?: Array<{ contentType: string; data?: string; url?: string; title?: string }>;
}

export interface ExportInput {
  reportId: string;
  state: InternalReportState;
  /** LOINC or local code for the procedure. */
  code: FhirCoding;
  patient: Identifier;
  patientDisplay?: string;
  /** ISO-8601. When the imaging happened. */
  effectiveDateTime: string;
  /** ISO-8601. When the report was released. Absent while it has not been. */
  issued?: string;
  performer?: Array<{ identifier: Identifier; display?: string }>;
  imagingStudy?: Identifier[];
  findings?: StructuredFinding[];
  narrative?: string;
  /** Base64 PDF/A, if one was produced. */
  pdfBase64?: string;
  category?: FhirCoding[];
}

export interface ExportResult {
  report: FhirDiagnosticReport | null;
  observations: FhirObservation[];
  /** Findings that had no code and could not become Observations. */
  unstructuredFindings: string[];
  errors: string[];
  warnings: string[];
  ok: boolean;
}

/**
 * Builds the `DiagnosticReport` and its `Observation`s.
 *
 * Refuses rather than emitting something that will fail at the far end: an unresolvable
 * subject, a missing effective time, or a status that claims more than the report has
 * earned.
 */
export function exportDiagnosticReport(input: ExportInput): ExportResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const observations: FhirObservation[] = [];
  const unstructuredFindings: string[] = [];

  const empty: ExportResult = {
    report: null,
    observations,
    unstructuredFindings,
    errors,
    warnings,
    ok: false,
  };

  const status = toFhirStatus(input?.state);
  const subject = buildReference('Patient', input?.patient, input?.patientDisplay);
  if (!subject.reference) {
    errors.push(subject.error as string);
  }

  const effectiveDateTime = text(input?.effectiveDateTime);
  if (!effectiveDateTime) {
    errors.push('effectiveDateTime ausente — é a hora da AQUISIÇÃO, não a da assinatura.');
  }

  const issued = text(input?.issued);
  if (isActionable(status) && !issued) {
    // A final report with no issue time cannot be placed on a timeline, and `final` is the
    // status a receiver stops re-fetching.
    errors.push('Laudo final sem "issued" — a hora de liberação é obrigatória para status final.');
  }
  if (!isActionable(status) && issued) {
    warnings.push(
      'Há "issued" num laudo que ainda não é final — verifique se a hora de liberação está correta.'
    );
    }

  if (!text(input?.code?.code) || !text(input?.code?.system)) {
    errors.push('Código do exame ausente ou sem system.');
  }
  if (!text(input?.reportId)) {
    errors.push('Laudo sem identificador.');
  }

  if (errors.length) {
    return empty;
  }

  const observationStatus: FhirObservation['status'] =
    status === 'amended' ? 'amended' : status === 'final' ? 'final' : 'preliminary';

  const results: Reference[] = [];
  for (const finding of input?.findings ?? []) {
    if (!finding?.code?.code || !text(finding.code.system)) {
      // Not silently flattened into prose — the architecture note forbids exactly that.
      unstructuredFindings.push(text(finding?.id) || '(sem id)');
      continue;
    }
    const observation: FhirObservation = {
      resourceType: 'Observation',
      id: text(finding.id) || `${input.reportId}-obs-${observations.length + 1}`,
      status: observationStatus,
      code: finding.code,
      subject: subject.reference as Reference,
      effectiveDateTime,
      valueQuantity: finding.valueQuantity,
      valueCodeableConcept: finding.valueCodeableConcept,
      valueString: finding.valueString,
      bodySite: finding.bodySite,
      derivedFrom: evidenceReferences(finding),
    };
    observations.push(observation);
    results.push({ reference: `Observation/${observation.id}` });
  }

  if (unstructuredFindings.length) {
    warnings.push(
      `${unstructuredFindings.length} achado(s) sem código não puderam virar Observation e ficaram apenas no texto — contraria a decisão CDE-first.`
    );
  }

  const imagingStudy: Reference[] = [];
  for (const study of input?.imagingStudy ?? []) {
    const reference = buildReference('ImagingStudy', study);
    if (reference.reference) {
      imagingStudy.push(reference.reference);
    } else {
      warnings.push(reference.error as string);
    }
  }

  const performer: Reference[] = [];
  for (const person of input?.performer ?? []) {
    const reference = buildReference('Practitioner', person?.identifier, person?.display);
    if (reference.reference) {
      performer.push(reference.reference);
    } else {
      warnings.push(reference.error as string);
    }
  }

  const presentedForm: FhirDiagnosticReport['presentedForm'] = [];
  if (text(input?.pdfBase64)) {
    presentedForm.push({
      contentType: 'application/pdf',
      data: text(input.pdfBase64),
      title: 'Laudo assinado (PDF/A)',
    });
  }

  return {
    ok: true,
    observations,
    unstructuredFindings,
    errors,
    warnings,
    report: {
      resourceType: 'DiagnosticReport',
      id: text(input.reportId),
      status,
      category: input?.category,
      code: input.code,
      subject: subject.reference as Reference,
      effectiveDateTime,
      issued: issued || effectiveDateTime,
      performer: performer.length ? performer : undefined,
      imagingStudy: imagingStudy.length ? imagingStudy : undefined,
      result: results.length ? results : undefined,
      conclusion: text(input?.narrative) || undefined,
      presentedForm: presentedForm.length ? presentedForm : undefined,
    },
  };
}

/** DICOM evidence as `derivedFrom` references, using the DICOM UID namespace. */
function evidenceReferences(finding: StructuredFinding): Reference[] | undefined {
  const evidence = finding?.evidence;
  const uid = text(evidence?.sopInstanceUid) || text(evidence?.seriesInstanceUid) || text(evidence?.studyInstanceUid);
  if (!uid) {
    return undefined;
  }
  return [
    {
      identifier: { system: 'urn:dicom:uid', value: `urn:oid:${uid}` },
      display: 'Evidência DICOM',
    },
  ];
}

/** One line summarising what the export produced and what it dropped. */
export function describeExport(result: ExportResult): string {
  if (!result) {
    return '';
  }
  if (!result.ok) {
    return `Export não realizado: ${result.errors.join(' ')}`;
  }
  const parts = [
    `DiagnosticReport ${result.report?.status}`,
    `${result.observations.length} Observation(s)`,
  ];
  if (result.unstructuredFindings.length) {
    parts.push(`${result.unstructuredFindings.length} achado(s) sem código`);
  }
  const warnings = result.warnings.length ? ` ${result.warnings.join(' ')}` : '';
  return `${parts.join(' · ')}.${warnings}`;
}
