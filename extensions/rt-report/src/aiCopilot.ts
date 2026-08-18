/**
 * AI copilot governance: provenance, the accept gate, the QA pass and the audit record --
 * pure core (RTV-224).
 *
 * The ticket's own framing is the requirement: "a IA deve ser copiloto, nao autora final".
 * That sentence is easy to agree with and hard to enforce, because the failure is not a
 * model saying something wrong -- models say wrong things and a radiologist catches them.
 * The failure is **a machine-written sentence becoming a signed human assertion without
 * anybody deciding that it should**. Everything here exists to make that transition
 * explicit, attributable and reversible.
 *
 * ## Suggested text and accepted text are different substances
 *
 * A suggestion sitting in the editor looks exactly like a sentence the radiologist typed.
 * Once it is in the document there is no way to tell them apart, and the signature covers
 * both. So provenance is carried on the **segment**, not on the document: every piece of
 * report content knows whether a human wrote it, a human accepted it, a human edited it, or
 * nobody has touched it yet. {@link aiAssertSignable} refuses a document containing any
 * segment in the untouched state, and that refusal is the whole ticket in one function.
 *
 * "Accepted" is deliberately not the same as "edited". Both are human acts, but they answer
 * different questions in an audit: accepted means somebody read this and agreed; edited
 * means somebody read this and changed it, which is stronger evidence of attention and is
 * worth being able to count separately when evaluating whether the model helps.
 *
 * ## Silence is not consent, and neither is a banner
 *
 * The gate is per suggestion. A single "revisei as sugestoes da IA" checkbox is not a
 * decision about the fourteen sentences it covers -- it is a decision about the checkbox.
 * {@link aiApplySuggestion} therefore takes one suggestion and one action, and there is no
 * bulk-accept entry point in this module. That is a deliberate omission, not a gap: a bulk
 * accept is exactly the affordance that turns the copilot into the author.
 *
 * ## The impression is the part that must not be generated unattended
 *
 * A findings paragraph that is slightly wrong is a paragraph a reader can check against the
 * images. An **impression** that is slightly wrong is the part the referring physician acts
 * on, often without reading the rest. So the impression carries a stricter rule: it may be
 * drafted, but a generated impression that was never edited is reported as a distinct,
 * louder finding than a generated finding in the same state.
 *
 * ## QA that blocks, and QA that is configured to block
 *
 * The checks themselves are not the interesting part -- missing laterality, a measurement
 * with no unit, a contradiction between findings and impression, an empty impression, a
 * critical finding with no communication recorded. What matters is that each one has a
 * configured severity **per institution**, and that a check whose severity nobody
 * configured defaults to **blocking**. A new check that defaults to advisory is a check that
 * does nothing on the day it ships, which is the day it was needed.
 *
 * ## An audit that can answer "which model wrote this sentence"
 *
 * Months later, the question is about one sentence in one report: what produced it, from
 * what context, which version, who accepted it. A log that records "IA usada" cannot answer
 * that, and cannot support withdrawing a cohort of reports when a model version turns out to
 * have a systematic error. {@link aiAuditEntry} refuses to emit a record missing any of the
 * five, and reports its gaps by name rather than filing a record that looks complete.
 *
 * Framework-free, no `@ohif/*`, no clock, no randomness, no `throw`. Zero-fork per RTV-114.
 */

/* ------------------------------------------------------------------ */
/* Result type                                                         */
/* ------------------------------------------------------------------ */

export type AiRefusalCode =
  | 'ai-disabled'
  | 'invalid-suggestion'
  | 'invalid-action'
  | 'invalid-timestamp'
  | 'unattributed-action'
  | 'missing-edit-text'
  | 'missing-reject-reason'
  | 'already-decided'
  | 'stale-suggestion'
  | 'untouched-ai-content'
  | 'qa-blocking'
  | 'audit-incomplete'
  | 'unknown-check'
  | 'invalid-policy';

/**
 * Refusals travel as values. `value?: undefined` / `reason?: undefined` are required:
 * `strictNullChecks` is off in this repo, so a boolean-literal union does not narrow.
 */
export type AiResult<T> =
  | { ok: true; value: T; code?: undefined; reason?: undefined }
  | { ok: false; code: AiRefusalCode; reason: string; value?: undefined };

function aiOk<T>(value: T): AiResult<T> {
  return { ok: true, value };
}

function aiRefuse<T>(code: AiRefusalCode, reason: string): AiResult<T> {
  return { ok: false, code, reason };
}

function aiText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function aiIsEpochMs(value: unknown): boolean {
  return typeof value === 'number' && isFinite(value) && value > 0 && Math.floor(value) === value;
}

/* ------------------------------------------------------------------ */
/* Provenance                                                          */
/* ------------------------------------------------------------------ */

/**
 * Who is responsible for a piece of report content.
 *
 * `ai-suggested` is the only state that blocks signature, and it is the default for
 * everything the model produces. There is no state meaning "probably fine".
 */
export type AiProvenance =
  /** A human typed or dictated it. */
  | 'human'
  /** The model produced it and nobody has decided yet. Blocks signature. */
  | 'ai-suggested'
  /** A human read it and agreed, unchanged. */
  | 'ai-accepted'
  /** A human read it and changed it. Stronger evidence of attention. */
  | 'ai-edited';

export const AI_PROVENANCE_LABELS: Record<AiProvenance, string> = {
  human: 'escrito pelo radiologista',
  'ai-suggested': 'sugerido pela IA, ainda nao decidido',
  'ai-accepted': 'sugerido pela IA e aceito sem alteracao',
  'ai-edited': 'sugerido pela IA e editado pelo radiologista',
};

/** Provenance states that represent a human decision having been made. */
export const AI_DECIDED_PROVENANCE: AiProvenance[] = ['human', 'ai-accepted', 'ai-edited'];

export function aiIsDecided(provenance: AiProvenance): boolean {
  return AI_DECIDED_PROVENANCE.indexOf(provenance) >= 0;
}

/** Sections of a report, ordered by how much a wrong sentence costs. */
export type AiSection = 'technique' | 'findings' | 'impression' | 'recommendation';

export const AI_SECTION_LABELS: Record<AiSection, string> = {
  technique: 'tecnica',
  findings: 'achados',
  impression: 'impressao',
  recommendation: 'recomendacao',
};

/**
 * Sections where undecided machine text is reported more loudly.
 *
 * The impression and the recommendation are what the referring physician acts on, often
 * without reading the findings. A wrong findings sentence can be checked against the images;
 * a wrong impression is acted upon.
 */
export const AI_HIGH_STAKES_SECTIONS: AiSection[] = ['impression', 'recommendation'];

export interface AiSegment {
  segmentId: string;
  section: AiSection;
  text: string;
  provenance: AiProvenance;
  /** Set for anything the model produced, so the audit can find its origin. */
  suggestionId?: string;
}

/* ------------------------------------------------------------------ */
/* Policy                                                             */
/* ------------------------------------------------------------------ */

export type AiCheckId =
  | 'missing-laterality'
  | 'measurement-without-unit'
  | 'findings-impression-contradiction'
  | 'empty-impression'
  | 'critical-finding-not-communicated'
  | 'untouched-ai-impression';

export const AI_CHECK_IDS: AiCheckId[] = [
  'missing-laterality',
  'measurement-without-unit',
  'findings-impression-contradiction',
  'empty-impression',
  'critical-finding-not-communicated',
  'untouched-ai-impression',
];

export const AI_CHECK_LABELS: Record<AiCheckId, string> = {
  'missing-laterality': 'lateralidade ausente em achado que a exige',
  'measurement-without-unit': 'medida sem unidade',
  'findings-impression-contradiction': 'contradicao entre achados e impressao',
  'empty-impression': 'impressao vazia',
  'critical-finding-not-communicated': 'achado critico sem comunicacao registrada',
  'untouched-ai-impression': 'impressao gerada pela IA e nunca editada',
};

export type AiSeverity = 'blocking' | 'advisory';

export interface AiPolicy {
  /** Institution the policy belongs to, carried into the audit. */
  tenantId: string;
  /** Whether the copilot is available at all for this tenant. */
  enabled: boolean;
  /** Roles the copilot is available to. Empty means nobody. */
  enabledForRoles: string[];
  /** Modalities the copilot is available for. Empty means every modality. */
  enabledForModalities?: string[];
  /** Per-check severity. A check absent from this map defaults to blocking. */
  checkSeverity?: Partial<Record<AiCheckId, AiSeverity>>;
  /** Model identity, required so the audit can name what produced a sentence. */
  modelId: string;
  modelVersion: string;
}

/**
 * Severity of a check under a policy.
 *
 * An unconfigured check is **blocking**. The alternative -- defaulting to advisory -- means
 * a check added in a release does nothing until somebody configures it, and the day it does
 * nothing is the day it was needed. Making a check advisory has to be a deliberate act by
 * the institution, recorded in the policy.
 */
export function aiCheckSeverity(policy: AiPolicy, check: AiCheckId): AiSeverity {
  const configured = policy?.checkSeverity ? policy.checkSeverity[check] : undefined;
  return configured === 'advisory' ? 'advisory' : 'blocking';
}

export interface AiAvailability {
  available: boolean;
  reason: string;
}

/**
 * Whether the copilot may run for this user, tenant and modality.
 *
 * Every gate fails closed. A tenant with no roles listed gets nothing, not everything: an
 * empty allow-list read as "all" is how a feature reaches a hospital that decided against
 * it.
 */
export function aiAvailability(
  policy: AiPolicy,
  context: { role: string; modality: string }
): AiAvailability {
  if (!policy || policy.enabled !== true) {
    return { available: false, reason: 'Copiloto de IA desativado para esta instituicao.' };
  }
  if (!aiText(policy.modelId) || !aiText(policy.modelVersion)) {
    return {
      available: false,
      reason:
        'Copiloto sem modelo e versao identificados -- sem isso nenhuma sugestao pode ser auditada depois.',
    };
  }
  const roles = (policy.enabledForRoles ?? []).map(aiText).filter(Boolean);
  const role = aiText(context?.role);
  if (!roles.length || roles.indexOf(role) < 0) {
    return {
      available: false,
      reason: 'Copiloto de IA nao habilitado para este perfil.',
    };
  }
  const modalities = (policy.enabledForModalities ?? []).map(aiText).filter(Boolean);
  const modality = aiText(context?.modality).toUpperCase();
  if (modalities.length && modalities.map(m => m.toUpperCase()).indexOf(modality) < 0) {
    return {
      available: false,
      reason: 'Copiloto de IA nao habilitado para esta modalidade.',
    };
  }
  return { available: true, reason: 'Copiloto disponivel.' };
}

/* ------------------------------------------------------------------ */
/* Suggestions and the accept gate                                    */
/* ------------------------------------------------------------------ */

export type AiSuggestionKind =
  | 'draft-section'
  | 'impression'
  | 'recommendation'
  | 'guideline-category'
  | 'rewrite';

export interface AiSuggestion {
  suggestionId: string;
  kind: AiSuggestionKind;
  section: AiSection;
  /** What the model proposes. */
  proposedText: string;
  /** What is there now, so the card can render a diff. */
  currentText?: string;
  modelId: string;
  modelVersion: string;
  /** Identifier of the context bundle that produced it, for the audit. */
  contextRef: string;
  producedAt: number;
  /** Report version the suggestion was produced against. */
  reportVersion: number;
}

export type AiAction = 'accept' | 'reject' | 'edit';

export const AI_ACTION_LABELS: Record<AiAction, string> = {
  accept: 'aceitar sem alteracao',
  reject: 'rejeitar',
  edit: 'editar e incorporar',
};

export interface AiDecision {
  suggestionId: string;
  action: AiAction;
  decidedBy: string;
  decidedAt: number;
  /** Required for `edit`: the text the human actually wants. */
  editedText?: string;
  /** Optional for `reject`, but recorded when given -- it is the model feedback. */
  reason?: string;
}

export interface AiApplication {
  decision: AiDecision;
  /** The segment to write into the document. Null for a rejection. */
  segment: AiSegment | null;
  provenance: AiProvenance | null;
  /** Text that ends up in the report. Empty for a rejection. */
  appliedText: string;
}

/**
 * Applies one human decision to one suggestion.
 *
 * One suggestion, one action, on purpose. There is no bulk-accept in this module, and its
 * absence is a design decision rather than an omission: a single "revisei as sugestoes"
 * control is not a decision about the fourteen sentences it covers, it is a decision about
 * the control -- and it is precisely the affordance that turns the copilot into the author.
 */
export function aiApplySuggestion(input: {
  suggestion: AiSuggestion;
  decision: AiDecision;
  currentReportVersion: number;
  policy: AiPolicy;
  alreadyDecided?: boolean;
}): AiResult<AiApplication> {
  if (!input || !input.suggestion) {
    return aiRefuse('invalid-suggestion', 'Sugestao ausente.');
  }
  const suggestion = input.suggestion;
  const decision = input.decision;

  if (!input.policy || input.policy.enabled !== true) {
    return aiRefuse('ai-disabled', 'Copiloto de IA desativado -- nenhuma sugestao pode ser aplicada.');
  }
  if (!aiText(suggestion.suggestionId) || !aiText(suggestion.proposedText)) {
    return aiRefuse('invalid-suggestion', 'Sugestao sem identificador ou sem texto.');
  }
  if (!decision || !AI_ACTION_LABELS[decision.action]) {
    return aiRefuse('invalid-action', 'Acao invalida: use aceitar, rejeitar ou editar.');
  }
  if (aiText(decision.suggestionId) !== aiText(suggestion.suggestionId)) {
    return aiRefuse('invalid-action', 'A decisao nao se refere a esta sugestao.');
  }
  if (!aiIsEpochMs(decision.decidedAt)) {
    return aiRefuse('invalid-timestamp', 'Decisao sem horario valido.');
  }
  // An unattributed decision is the same problem as an unattributed signature: the audit
  // records that somebody accepted a machine-written sentence and cannot say who.
  if (!aiText(decision.decidedBy)) {
    return aiRefuse(
      'unattributed-action',
      'Decisao sobre sugestao da IA sem responsavel identificado.'
    );
  }
  if (input.alreadyDecided === true) {
    return aiRefuse('already-decided', 'Esta sugestao ja foi decidida.');
  }

  // A suggestion produced against v1 and applied to v2 is advice about text that no longer
  // exists. Applying it silently reintroduces the wording the radiologist just changed.
  if (
    typeof suggestion.reportVersion === 'number' &&
    typeof input.currentReportVersion === 'number' &&
    suggestion.reportVersion !== input.currentReportVersion
  ) {
    return aiRefuse(
      'stale-suggestion',
      'Sugestao produzida para a versao ' +
        suggestion.reportVersion +
        ' e o laudo esta na ' +
        input.currentReportVersion +
        ' -- aplicar aqui reintroduziria texto que o radiologista ja alterou.'
    );
  }

  if (decision.action === 'reject') {
    return aiOk({
      decision,
      segment: null,
      provenance: null,
      appliedText: '',
    });
  }

  if (decision.action === 'edit') {
    const edited = aiText(decision.editedText);
    if (!edited) {
      return aiRefuse('missing-edit-text', 'Editar exige o texto que o radiologista quer.');
    }
    return aiOk({
      decision,
      segment: {
        segmentId: suggestion.suggestionId,
        section: suggestion.section,
        text: edited,
        provenance: 'ai-edited',
        suggestionId: suggestion.suggestionId,
      },
      provenance: 'ai-edited',
      appliedText: edited,
    });
  }

  return aiOk({
    decision,
    segment: {
      segmentId: suggestion.suggestionId,
      section: suggestion.section,
      text: suggestion.proposedText,
      provenance: 'ai-accepted',
      suggestionId: suggestion.suggestionId,
    },
    provenance: 'ai-accepted',
    appliedText: suggestion.proposedText,
  });
}

/**
 * A segment for text the model produced but nobody has decided about.
 *
 * Exposed so a caller cannot construct a drafted segment with any other provenance: a draft
 * written straight into the document as `human` is the failure this module exists to
 * prevent, and it would be one field away.
 */
export function aiDraftSegment(input: {
  segmentId: string;
  section: AiSection;
  text: string;
  suggestionId?: string;
}): AiResult<AiSegment> {
  if (!input || !aiText(input.segmentId) || !aiText(input.text)) {
    return aiRefuse('invalid-suggestion', 'Rascunho da IA sem identificador ou sem texto.');
  }
  if (!AI_SECTION_LABELS[input.section]) {
    return aiRefuse('invalid-suggestion', 'Rascunho da IA sem secao valida.');
  }
  return aiOk({
    segmentId: aiText(input.segmentId),
    section: input.section,
    text: input.text,
    provenance: 'ai-suggested',
    suggestionId: input.suggestionId,
  });
}

/* ------------------------------------------------------------------ */
/* The signature gate                                                 */
/* ------------------------------------------------------------------ */

export interface AiUndecidedSegment {
  segmentId: string;
  section: AiSection;
  highStakes: boolean;
  excerpt: string;
}

export interface AiSignabilityReport {
  signable: boolean;
  undecided: AiUndecidedSegment[];
  /** Undecided segments in the impression or recommendation. Reported separately. */
  undecidedHighStakes: AiUndecidedSegment[];
  counts: Record<AiProvenance, number>;
  message: string;
}

/**
 * Whether a document may be signed with respect to machine-written content.
 *
 * This is the ticket in one function. Any segment still in `ai-suggested` blocks, because
 * once the signature exists there is no way to distinguish a sentence the radiologist wrote
 * from one the model wrote and nobody read -- and the signature covers both.
 */
export function aiEvaluateSignability(segments: AiSegment[]): AiSignabilityReport {
  const list = (segments ?? []).filter(Boolean);
  const counts: Record<AiProvenance, number> = {
    human: 0,
    'ai-suggested': 0,
    'ai-accepted': 0,
    'ai-edited': 0,
  };
  const undecided: AiUndecidedSegment[] = [];

  for (const segment of list) {
    const provenance = AI_PROVENANCE_LABELS[segment.provenance] ? segment.provenance : 'ai-suggested';
    counts[provenance] += 1;
    if (!aiIsDecided(provenance)) {
      undecided.push({
        segmentId: segment.segmentId,
        section: segment.section,
        highStakes: AI_HIGH_STAKES_SECTIONS.indexOf(segment.section) >= 0,
        excerpt: String(segment.text ?? '').slice(0, 80),
      });
    }
  }

  const undecidedHighStakes = undecided.filter(u => u.highStakes);
  const signable = undecided.length === 0;

  let message = 'Nenhum texto da IA pendente de decisao.';
  if (!signable) {
    const parts = [
      undecided.length +
        ' trecho(s) sugerido(s) pela IA sem decisao -- assinar agora tornaria texto de maquina uma afirmacao assinada do radiologista.',
    ];
    if (undecidedHighStakes.length) {
      parts.push(
        undecidedHighStakes.length +
          ' deles em ' +
          undecidedHighStakes.map(u => AI_SECTION_LABELS[u.section]).join(', ') +
          ', que e a parte em que o solicitante age sem ler o resto.'
      );
    }
    message = parts.join(' ');
  }

  return { signable, undecided, undecidedHighStakes, counts, message };
}

/** Refusal form of {@link aiEvaluateSignability}, for a caller that only needs the gate. */
export function aiAssertSignable(segments: AiSegment[]): AiResult<AiSignabilityReport> {
  const report = aiEvaluateSignability(segments);
  if (!report.signable) {
    return aiRefuse('untouched-ai-content', report.message);
  }
  return aiOk(report);
}

/* ------------------------------------------------------------------ */
/* QA pass                                                            */
/* ------------------------------------------------------------------ */

export interface AiQaFinding {
  check: AiCheckId;
  severity: AiSeverity;
  detail: string;
  segmentId?: string;
}

export interface AiQaReport {
  findings: AiQaFinding[];
  blocking: AiQaFinding[];
  advisory: AiQaFinding[];
  passed: boolean;
  message: string;
}

export interface AiQaInput {
  segments: AiSegment[];
  /** Findings the report asserts, with the fields QA needs. */
  assertions?: Array<{
    segmentId?: string;
    /** Whether this assertion is about a structure where side matters. */
    lateralityRequired?: boolean;
    laterality?: string;
    measurementValue?: number;
    measurementUnit?: string;
    critical?: boolean;
    communicatedAt?: number;
    /** Present when the finding contradicts what the impression says. */
    contradictsImpression?: boolean;
  }>;
}

/**
 * Runs the pre-signature QA pass under a policy.
 *
 * The checks are unremarkable. What matters is the severity resolution: a check the
 * institution has not configured is **blocking** (see {@link aiCheckSeverity}), so a check
 * added in a release is active on the day it ships rather than on the day somebody
 * remembers to switch it on.
 */
export function aiRunQa(input: AiQaInput, policy: AiPolicy): AiResult<AiQaReport> {
  if (!policy || !aiText(policy.tenantId)) {
    return aiRefuse('invalid-policy', 'Politica de QA sem instituicao identificada.');
  }
  const segments = (input?.segments ?? []).filter(Boolean);
  const assertions = (input?.assertions ?? []).filter(Boolean);
  const findings: AiQaFinding[] = [];

  const add = (check: AiCheckId, detail: string, segmentId?: string) => {
    findings.push({ check, severity: aiCheckSeverity(policy, check), detail, segmentId });
  };

  const impression = segments.filter(s => s.section === 'impression');
  const impressionText = impression.map(s => aiText(s.text)).join(' ').trim();
  if (!impressionText) {
    add('empty-impression', 'O laudo nao tem impressao.');
  }

  for (const segment of impression) {
    if (segment.provenance === 'ai-accepted') {
      add(
        'untouched-ai-impression',
        'A impressao foi gerada pela IA e aceita sem edicao -- e a parte em que o solicitante age sem ler o resto.',
        segment.segmentId
      );
    }
  }

  for (const assertion of assertions) {
    if (assertion.lateralityRequired === true && !aiText(assertion.laterality)) {
      add(
        'missing-laterality',
        'Achado que exige lateralidade sem lado informado.',
        assertion.segmentId
      );
    }
    // A measurement with a value and no unit is the failure family this codebase keeps
    // hitting: the same number in cm and in mm differs by ten, and a plausible value in the
    // wrong unit does not look wrong.
    if (typeof assertion.measurementValue === 'number' && isFinite(assertion.measurementValue)) {
      if (!aiText(assertion.measurementUnit)) {
        add(
          'measurement-without-unit',
          'Medida de ' + assertion.measurementValue + ' sem unidade.',
          assertion.segmentId
        );
      }
    }
    if (assertion.critical === true && !aiIsEpochMs(assertion.communicatedAt)) {
      add(
        'critical-finding-not-communicated',
        'Achado critico sem comunicacao registrada ao solicitante.',
        assertion.segmentId
      );
    }
    if (assertion.contradictsImpression === true) {
      add(
        'findings-impression-contradiction',
        'Achado em contradicao com a impressao -- cada metade e consistente sozinha, entao nenhum leitor isolado ve o conflito.',
        assertion.segmentId
      );
    }
  }

  const blocking = findings.filter(f => f.severity === 'blocking');
  const advisory = findings.filter(f => f.severity === 'advisory');

  return aiOk({
    findings,
    blocking,
    advisory,
    passed: blocking.length === 0,
    message: blocking.length
      ? blocking.length +
        ' pendencia(s) bloqueante(s): ' +
        blocking.map(f => AI_CHECK_LABELS[f.check]).join('; ') +
        '.'
      : advisory.length
        ? advisory.length + ' observacao(oes) nao bloqueante(s).'
        : 'QA sem pendencias.',
  });
}

/**
 * The single gate before signature: machine content decided, and QA passed.
 *
 * Combined into one function so a caller cannot check one and forget the other -- and the
 * provenance gate runs first, because unread machine text in the impression outranks a
 * missing unit.
 */
export function aiAssertReadyToSign(input: AiQaInput, policy: AiPolicy): AiResult<AiQaReport> {
  const signable = aiAssertSignable(input?.segments ?? []);
  if (!signable.ok) {
    return aiRefuse(signable.code, signable.reason);
  }
  const qa = aiRunQa(input, policy);
  if (!qa.ok) {
    return qa;
  }
  if (!qa.value.passed) {
    return aiRefuse('qa-blocking', qa.value.message);
  }
  return qa;
}

/* ------------------------------------------------------------------ */
/* Audit                                                              */
/* ------------------------------------------------------------------ */

export interface AiAuditEntry {
  reportId: string;
  suggestionId: string;
  kind: AiSuggestionKind;
  section: AiSection;
  modelId: string;
  modelVersion: string;
  /** Reference to the stored context bundle, not the bundle itself. */
  contextRef: string;
  tenantId: string;
  action: AiAction;
  actorId: string;
  at: number;
  /** Present when the human rewrote the suggestion. */
  editedText?: string;
  reason?: string;
  /** True when the record can answer what, from what, which version, who and which action. */
  complete: boolean;
  gaps: string[];
}

/**
 * Builds the audit record for one decision.
 *
 * The record has to answer a question asked months later about **one sentence in one
 * report**: what produced it, from what context, which model version, who accepted it, and
 * what they did. A log that records "IA usada" answers none of those, and in particular
 * cannot support withdrawing a cohort of reports once a model version is found to have a
 * systematic error -- which is the reason `modelVersion` is not optional.
 *
 * The context is stored by **reference**. Keeping the prompt inline would put patient
 * identifiers into an audit table with a different retention rule than the study, which is
 * a disclosure created by the logging itself.
 */
export function aiAuditEntry(input: {
  reportId: string;
  suggestion: AiSuggestion;
  decision: AiDecision;
  policy: AiPolicy;
}): AiResult<AiAuditEntry> {
  if (!input || !input.suggestion || !input.decision || !input.policy) {
    return aiRefuse('audit-incomplete', 'Registro de auditoria sem sugestao, decisao ou politica.');
  }
  const { suggestion, decision, policy } = input;
  const gaps: string[] = [];

  const reportId = aiText(input.reportId);
  const suggestionId = aiText(suggestion.suggestionId);
  const modelId = aiText(suggestion.modelId) || aiText(policy.modelId);
  const modelVersion = aiText(suggestion.modelVersion) || aiText(policy.modelVersion);
  const contextRef = aiText(suggestion.contextRef);
  const actorId = aiText(decision.decidedBy);
  const tenantId = aiText(policy.tenantId);

  if (!reportId) {
    gaps.push('laudo nao identificado');
  }
  if (!suggestionId) {
    gaps.push('sugestao nao identificada');
  }
  if (!modelId) {
    gaps.push('modelo nao identificado');
  }
  if (!modelVersion) {
    gaps.push('versao do modelo nao identificada');
  }
  if (!contextRef) {
    gaps.push('contexto de entrada nao referenciado');
  }
  if (!actorId) {
    gaps.push('responsavel pela decisao nao identificado');
  }
  if (!tenantId) {
    gaps.push('instituicao nao identificada');
  }
  if (!AI_ACTION_LABELS[decision.action]) {
    gaps.push('acao invalida');
  }
  if (!aiIsEpochMs(decision.decidedAt)) {
    gaps.push('horario invalido');
  }

  if (gaps.length) {
    return aiRefuse(
      'audit-incomplete',
      'Registro de auditoria da IA nao responderia "qual modelo escreveu esta frase": ' +
        gaps.join(', ') +
        '.'
    );
  }

  return aiOk({
    reportId,
    suggestionId,
    kind: suggestion.kind,
    section: suggestion.section,
    modelId,
    modelVersion,
    contextRef,
    tenantId,
    action: decision.action,
    actorId,
    at: decision.decidedAt,
    editedText: decision.action === 'edit' ? aiText(decision.editedText) : undefined,
    reason: aiText(decision.reason) || undefined,
    complete: true,
    gaps: [],
  });
}

/* ------------------------------------------------------------------ */
/* Feedback aggregation                                               */
/* ------------------------------------------------------------------ */

export interface AiFeedbackSummary {
  total: number
  accepted: number;
  rejected: number;
  edited: number;
  /** Accepted over total. Null when there is nothing to divide. */
  acceptanceRate: number | null;
  /** Accepted-or-edited over total: how often the suggestion was worth having. */
  usefulnessRate: number | null;
  byModelVersion: Record<string, { accepted: number; rejected: number; edited: number }>;
  message: string;
}

/**
 * Aggregates decisions for the feedback panel.
 *
 * Acceptance and usefulness are reported separately because they answer different questions,
 * and the naive single number is misleading in both directions. A model whose suggestions
 * are always edited has a poor acceptance rate and is still saving the radiologist typing; a
 * model whose suggestions are always accepted unchanged might be good, or might be a sign
 * that nobody is reading them -- which is why {@link aiRunQa} flags an unedited generated
 * impression regardless of what this rate says.
 *
 * Broken down by model version, because that is the unit that changes.
 */
export function aiSummarizeFeedback(entries: AiAuditEntry[]): AiFeedbackSummary {
  const list = (entries ?? []).filter(Boolean);
  const byModelVersion: Record<string, { accepted: number; rejected: number; edited: number }> = {};

  let accepted = 0;
  let rejected = 0;
  let edited = 0;

  for (const entry of list) {
    const key = entry.modelId + '@' + entry.modelVersion;
    if (!byModelVersion[key]) {
      byModelVersion[key] = { accepted: 0, rejected: 0, edited: 0 };
    }
    if (entry.action === 'accept') {
      accepted += 1;
      byModelVersion[key].accepted += 1;
    } else if (entry.action === 'reject') {
      rejected += 1;
      byModelVersion[key].rejected += 1;
    } else if (entry.action === 'edit') {
      edited += 1;
      byModelVersion[key].edited += 1;
    }
  }

  const total = accepted + rejected + edited;

  return {
    total,
    accepted,
    rejected,
    edited,
    acceptanceRate: total ? accepted / total : null,
    usefulnessRate: total ? (accepted + edited) / total : null,
    byModelVersion,
    message: total
      ? total +
        ' decisao(oes): ' +
        accepted +
        ' aceitas, ' +
        edited +
        ' editadas, ' +
        rejected +
        ' rejeitadas.'
      : 'Nenhuma decisao registrada.',
  };
}

/** One line for the copilot card. */
export function aiDescribeSuggestion(suggestion: AiSuggestion): string {
  if (!suggestion) {
    return '';
  }
  return (
    AI_SECTION_LABELS[suggestion.section] +
    ' - ' +
    suggestion.modelId +
    '@' +
    suggestion.modelVersion +
    ' - exige aceitar, rejeitar ou editar antes de entrar no laudo.'
  );
}
