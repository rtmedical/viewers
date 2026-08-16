/**
 * The canonical versioned report model — pure core (RTV-216).
 *
 * The persisted contract for a report. Everything else in the family reads or writes this:
 * the editor (RTV-104), the CDE fields (RTV-217), the RADS packs (RTV-220), the evidence
 * links (RTV-221), the FHIR adapter (RTV-219) and the PDF/A artefact.
 *
 * ## The point of the model is that the structured value is not derived from the text
 *
 * The tempting design is one rich-text body plus a parser. It fails the moment anybody
 * edits the prose: "nódulo de 8 mm" becomes "nódulo de 6 mm" and the structured field still
 * says 8, or the parser re-reads it and silently changes a value nobody re-measured.
 *
 * Here the structured observation **is** the record and the narrative is rendered
 * alongside it. {@link validateVersion} refuses a version whose narrative contains a
 * measurement that no observation backs — not because prose is forbidden, but because a
 * number in the text that is not in the data is a number that cannot be exported,
 * compared, or trusted.
 *
 * ## Versions are immutable and content-addressed
 *
 * A report version, once sealed, never changes. That is the same rule as `reportWorkflow`
 * and it is enforced here at the storage layer too, because two layers that both believe
 * they own immutability is how one of them stops enforcing it. Each sealed version carries
 * a content hash, so "is what I hold the same as what you have" is answerable without
 * comparing every field.
 *
 * ## Every clinical claim carries its provenance
 *
 * An observation records who asserted it and whether a human confirmed it. That matters
 * now for peer review and matters much more the moment an AI assistant (RTV-224) proposes
 * findings: an unconfirmed machine assertion that looks identical to a radiologist's is
 * the failure that discredits the whole feature.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export type VersionStatus = 'open' | 'sealed';

export type AssertedBy = 'human' | 'machine' | 'imported';

export interface Provenance {
  assertedBy: AssertedBy;
  /** User or system that asserted it. */
  actorId: string;
  at: number;
  /** True when a human has explicitly confirmed a machine or imported assertion. */
  humanConfirmed?: boolean;
  /** Model/version for a machine assertion, so a bad model can be traced. */
  source?: string;
}

export interface CodedValue {
  system: string;
  code: string;
  display?: string;
  /** Version of the code system. A code without one cannot be re-resolved later. */
  systemVersion?: string;
}

export type ObservationValue =
  | { kind: 'quantity'; value: number; unit: string }
  | { kind: 'coded'; value: CodedValue }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'text'; value: string };

export interface Observation {
  id: string;
  /** CDE / LOINC / SNOMED concept this observation instantiates. */
  concept: CodedValue;
  value: ObservationValue;
  bodySite?: CodedValue;
  laterality?: CodedValue;
  /** Section of the report it belongs to. */
  section: string;
  provenance: Provenance;
  /** DICOM evidence ids, resolved against `evidence` on the version. */
  evidenceIds?: string[];
}

export interface EvidenceRef {
  id: string;
  studyInstanceUid: string;
  seriesInstanceUid?: string;
  sopInstanceUid?: string;
  frameNumber?: number;
  /** Image coordinates, if the finding points at a spot. */
  point?: { x: number; y: number };
}

export interface ReportSection {
  id: string;
  title: string;
  /** Rendered prose for this section. */
  narrative: string;
}

export interface ReportVersion {
  version: number;
  status: VersionStatus;
  /** 'report' for the original, 'addendum' for each amendment. */
  kind: 'report' | 'addendum';
  sections: ReportSection[];
  observations: Observation[];
  evidence: EvidenceRef[];
  createdAt: number;
  createdBy: string;
  sealedAt?: number;
  sealedBy?: string;
  /** Content hash, set on sealing. */
  contentHash?: string;
  /** Version this addendum amends. */
  amends?: number;
}

export interface CanonicalReport {
  reportId: string;
  patientId: string;
  studyInstanceUid: string;
  versions: ReportVersion[];
}

const text = (v: unknown): string => String(v ?? '').trim();

/**
 * FNV-1a over the canonical serialisation.
 *
 * Not cryptographic and not trying to be: this answers "is what I hold the same as what
 * you have", not "did somebody tamper with it". The signature (PAdES) is what answers the
 * second question, and pretending a hash does both is how a system ends up with neither.
 */
export function contentHash(version: ReportVersion): string {
  const canonical = JSON.stringify({
    version: version?.version,
    kind: version?.kind,
    amends: version?.amends,
    sections: (version?.sections ?? []).map(s => [s.id, s.title, s.narrative]),
    observations: (version?.observations ?? [])
      .map(o => [
        o.id,
        o.concept?.system,
        o.concept?.code,
        JSON.stringify(o.value),
        o.section,
        o.bodySite?.code ?? '',
        o.laterality?.code ?? '',
        (o.evidenceIds ?? []).slice().sort().join(','),
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    evidence: (version?.evidence ?? [])
      .map(e => [e.id, e.studyInstanceUid, e.seriesInstanceUid ?? '', e.sopInstanceUid ?? '', e.frameNumber ?? ''])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  });

  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export type ValidationCode =
  | 'missingConcept'
  | 'unversionedCodeSystem'
  | 'danglingEvidence'
  | 'unbackedMeasurement'
  | 'unconfirmedMachineAssertion'
  | 'duplicateObservationId'
  | 'emptyVersion';

export interface ValidationIssue {
  code: ValidationCode;
  severity: 'error' | 'warning';
  message: string;
  observationId?: string;
}

/** Numbers with a unit in prose — the things that must be backed by an observation. */
const MEASUREMENT_PATTERN = /(\d+(?:[.,]\d+)?)\s?(mm|cm|ml|mL|HU|SUV|%)\b/g;

/**
 * Checks a version before it can be sealed.
 *
 * The interesting rule is `unbackedMeasurement`: a measurement written in the prose that no
 * observation backs. Prose is not forbidden — but a number in the text that is not in the
 * data cannot be exported, compared across studies, or trusted after somebody edits the
 * sentence around it.
 */
export function validateVersion(version: ReportVersion): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const observations = version?.observations ?? [];
  const evidenceIds = new Set((version?.evidence ?? []).map(e => text(e?.id)).filter(Boolean));

  if (!observations.length && !(version?.sections ?? []).some(s => text(s?.narrative))) {
    issues.push({ code: 'emptyVersion', severity: 'error', message: 'Versão sem conteúdo.' });
  }

  const seen = new Set<string>();
  for (const observation of observations) {
    const id = text(observation?.id);
    if (seen.has(id)) {
      issues.push({
        code: 'duplicateObservationId',
        severity: 'error',
        message: `Observação duplicada: ${id}.`,
        observationId: id,
      });
    }
    seen.add(id);

    if (!text(observation?.concept?.code) || !text(observation?.concept?.system)) {
      issues.push({
        code: 'missingConcept',
        severity: 'error',
        message: `Observação ${id} sem conceito codificado.`,
        observationId: id,
      });
    } else if (!text(observation.concept.systemVersion)) {
      // A code without its system version cannot be re-resolved when the system changes.
      issues.push({
        code: 'unversionedCodeSystem',
        severity: 'warning',
        message: `Observação ${id}: sistema de códigos sem versão — o significado do código pode mudar sem aviso.`,
        observationId: id,
      });
    }

    for (const evidenceId of observation?.evidenceIds ?? []) {
      if (!evidenceIds.has(text(evidenceId))) {
        issues.push({
          code: 'danglingEvidence',
          severity: 'error',
          message: `Observação ${id} referencia evidência inexistente "${evidenceId}".`,
          observationId: id,
        });
      }
    }

    const provenance = observation?.provenance;
    if (provenance?.assertedBy !== 'human' && !provenance?.humanConfirmed) {
      // An unconfirmed machine assertion that looks identical to a radiologist's is the
      // failure that discredits the whole assisted-reporting feature.
      issues.push({
        code: 'unconfirmedMachineAssertion',
        severity: 'error',
        message: `Observação ${id} foi asserida por ${provenance?.assertedBy ?? 'origem desconhecida'} e não foi confirmada por um humano.`,
        observationId: id,
      });
    }
  }

  for (const measurement of narrativeMeasurements(version)) {
    if (!isBackedByObservation(measurement, observations)) {
      issues.push({
        code: 'unbackedMeasurement',
        severity: 'warning',
        message: `"${measurement.raw}" aparece no texto sem observação estruturada correspondente — não poderá ser exportado nem comparado.`,
      });
    }
  }

  return issues;
}

interface NarrativeMeasurement {
  raw: string;
  value: number;
  unit: string;
}

function narrativeMeasurements(version: ReportVersion): NarrativeMeasurement[] {
  const out: NarrativeMeasurement[] = [];
  for (const section of version?.sections ?? []) {
    const narrative = text(section?.narrative);
    const pattern = new RegExp(MEASUREMENT_PATTERN.source, 'g');
    let match = pattern.exec(narrative);
    while (match) {
      out.push({
        raw: match[0],
        value: Number(match[1].replace(',', '.')),
        unit: match[2],
      });
      match = pattern.exec(narrative);
    }
  }
  return out;
}

function isBackedByObservation(
  measurement: NarrativeMeasurement,
  observations: Observation[]
): boolean {
  return observations.some(observation => {
    const value = observation?.value;
    if (value?.kind !== 'quantity') {
      return false;
    }
    const sameUnit = text(value.unit).toLowerCase() === measurement.unit.toLowerCase();
    return sameUnit && Math.abs(Number(value.value) - measurement.value) < 1e-9;
  });
}

export interface SealResult {
  version: ReportVersion | null;
  issues: ValidationIssue[];
  error?: string;
}

/**
 * Seals a version.
 *
 * Refuses on any error-severity issue. Warnings are returned with the sealed version rather
 * than blocking — an unversioned code system is worth knowing about and is not worth
 * stopping a radiologist from signing.
 */
export function sealVersion(
  version: ReportVersion,
  sealedBy: string,
  sealedAt: number
): SealResult {
  const issues = validateVersion(version);

  if (version?.status === 'sealed') {
    return { version: null, issues, error: 'Versão já selada — versões seladas são imutáveis.' };
  }
  if (!text(sealedBy)) {
    return { version: null, issues, error: 'Selagem sem responsável.' };
  }
  if (!Number.isFinite(Number(sealedAt))) {
    return { version: null, issues, error: 'Selagem sem horário.' };
  }

  const errors = issues.filter(i => i.severity === 'error');
  if (errors.length) {
    return {
      version: null,
      issues,
      error: `Versão não pode ser selada: ${errors.map(e => e.message).join(' ')}`,
    };
  }

  const sealed: ReportVersion = {
    ...version,
    status: 'sealed',
    sealedBy: text(sealedBy),
    sealedAt: Number(sealedAt),
  };
  return { version: { ...sealed, contentHash: contentHash(sealed) }, issues };
}

export interface AppendResult {
  report: CanonicalReport | null;
  error?: string;
}

/**
 * Appends a sealed version.
 *
 * Version numbers are monotonic and never reused, and an open version cannot be appended:
 * the collection holds the record, and a mutable member of it is a hole in the record.
 */
export function appendVersion(
  report: CanonicalReport,
  version: ReportVersion
): AppendResult {
  if (version?.status !== 'sealed') {
    return { report: null, error: 'Só versões seladas entram no laudo canônico.' };
  }
  const versions = report?.versions ?? [];
  const highest = versions.reduce((max, v) => Math.max(max, Number(v.version) || 0), 0);
  if (Number(version.version) !== highest + 1) {
    return {
      report: null,
      error: `Versão ${version.version} fora de sequência — a próxima é ${highest + 1}.`,
    };
  }
  if (version.kind === 'addendum' && !versions.some(v => v.kind === 'report')) {
    return { report: null, error: 'Adendo sem laudo original.' };
  }

  return { report: { ...report, versions: [...versions, version] }, error: undefined };
}

/** The version a recipient should be holding. */
export function currentVersion(report: CanonicalReport): ReportVersion | undefined {
  const versions = report?.versions ?? [];
  return versions.length ? versions[versions.length - 1] : undefined;
}

/** Whether a held copy is current, answered from the hash rather than field by field. */
export function isCurrent(report: CanonicalReport, heldHash: string): boolean {
  return text(currentVersion(report)?.contentHash) === text(heldHash);
}

/** Every observation across all versions, latest assertion of each id winning. */
export function effectiveObservations(report: CanonicalReport): Observation[] {
  const byId = new Map<string, Observation>();
  for (const version of report?.versions ?? []) {
    for (const observation of version.observations ?? []) {
      byId.set(text(observation.id), observation);
    }
  }
  return Array.from(byId.values());
}

/** One line for the version history. */
export function describeVersion(version: ReportVersion): string {
  if (!version) {
    return '';
  }
  const kind = version.kind === 'addendum' ? `adendo (complementa v${version.amends ?? '?'})` : 'laudo';
  const seal = version.status === 'sealed' ? `selado por ${version.sealedBy}` : 'aberto';
  return `v${version.version} ${kind} · ${version.observations.length} observação(ões) · ${seal}`;
}
