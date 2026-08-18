/**
 * Institutional governance: template versioning and clinical approval, CDE/RADS pack
 * pinning, macro scoping and the AI policy switch -- pure core (RTV-230).
 *
 * The ticket says it: "templates e IA precisam de governanca institucional, senao viram
 * comportamento imprevisivel". The governance question that actually bites is not who may
 * click edit. It is **what happens to reports that were already signed** when the thing they
 * were signed against changes underneath them.
 *
 * ## An approved template is immutable, and editing it forks
 *
 * A report signed on 12 March asserts what it asserts partly by reference: it used template
 * "Torax CT" and that template decided which fields existed, which were assertive, and what
 * their default text said. Edit that template in place and the signed report's meaning
 * changes retroactively -- the audit trail says "conforme o template Torax CT" and the
 * template it names is no longer the one that was used. Nobody is notified, and there is no
 * diff to look at.
 *
 * So {@link govEditTemplate} **refuses** to modify an approved version and returns a fork
 * instead. Draft versions are freely editable, because nothing has been signed against them.
 *
 * ## Clinical approval is not "an administrator saved it"
 *
 * A template that ships pre-filled normality text is making clinical assertions on behalf of
 * whoever signs it (this is the failure RTV-228 blocks per field). Deciding that wording is
 * a clinical act, and the approval record therefore requires a named clinician with a
 * professional registration. An IT administrator with template-management rights is not that
 * person, and {@link govApproveTemplate} refuses their approval by asking for the
 * registration rather than by checking a role -- a role can be granted, a CRM cannot.
 *
 * A template carrying assertive fields additionally requires the approver to acknowledge
 * them, so "eu aprovei o template" cannot be a statement about the layout while the assertive
 * defaults ride along unread.
 *
 * ## "Import without deploy" must not mean "import into clinical use"
 *
 * The acceptance criterion is that an admin imports RadReport/CDE without a deploy. That is
 * about release process, not about trust: an imported MRRT file is third-party content that
 * has never been read by anyone at this institution. {@link govImportTemplate} therefore
 * always lands the import as a **draft**, and there is no parameter that changes that. The
 * import and the approval are two acts by two people.
 *
 * ## A pack version cannot be retired while reports point at it
 *
 * A report records a finding as CDE element `RDE818` with value `RDE818.2`. If the pack is
 * updated and that value's meaning or allowed set changes, the historical report becomes
 * uninterpretable -- and worse, it stays *readable*, so a reader gets today's meaning for
 * yesterday's finding. Reports therefore pin the pack version, and
 * {@link govRetirePackVersion} refuses while any report references it. Retiring is about
 * stopping new use, not about erasing.
 *
 * ## Macro shadowing
 *
 * Macros exist at three scopes -- radiologist, group, institution -- and the same trigger can
 * exist at more than one. Most specific wins, which is the only rule that does not surprise
 * anybody. The part worth building is the **report**: when an institution adds a macro whose
 * trigger a radiologist already uses, that radiologist's macro keeps winning and the
 * institutional one silently never fires. {@link govResolveMacros} returns the shadowed
 * pairs so an admin can see it, because the alternative is a macro that "does not work" with
 * no visible cause.
 *
 * Framework-free, no `@ohif/*`, no clock, no randomness, no `throw`. Zero-fork per RTV-114.
 */

/* ------------------------------------------------------------------ */
/* Result type                                                         */
/* ------------------------------------------------------------------ */

export type GovRefusalCode =
  | 'immutable-approved'
  | 'not-draft'
  | 'missing-registration'
  | 'assertive-not-acknowledged'
  | 'self-approval'
  | 'invalid-template'
  | 'invalid-timestamp'
  | 'unattributed'
  | 'missing-justification'
  | 'pack-in-use'
  | 'pack-not-found'
  | 'version-not-pinned'
  | 'unknown-scope'
  | 'duplicate-trigger'
  | 'invalid-policy'
  | 'policy-incomplete'
  | 'audit-incomplete';

/**
 * Refusals travel as values. `value?: undefined` / `reason?: undefined` are required because
 * `strictNullChecks` is off in this repo.
 */
export type GovResult<T> =
  | { ok: true; value: T; code?: undefined; reason?: undefined }
  | { ok: false; code: GovRefusalCode; reason: string; value?: undefined };

function govOk<T>(value: T): GovResult<T> {
  return { ok: true, value };
}

function govRefuse<T>(code: GovRefusalCode, reason: string): GovResult<T> {
  return { ok: false, code, reason };
}

function govText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function govIsEpochMs(value: unknown): boolean {
  return typeof value === 'number' && isFinite(value) && value > 0 && Math.floor(value) === value;
}

function govIsPositiveInt(value: unknown): boolean {
  return typeof value === 'number' && isFinite(value) && value >= 1 && Math.floor(value) === value;
}

/* ------------------------------------------------------------------ */
/* Templates                                                          */
/* ------------------------------------------------------------------ */

export type GovLifecycle = 'draft' | 'approved' | 'retired';

export const GOV_LIFECYCLE_LABELS: Record<GovLifecycle, string> = {
  draft: 'rascunho',
  approved: 'aprovado para uso clinico',
  retired: 'retirado de uso novo',
};

export type GovTemplateOrigin = 'local' | 'mrrt-import' | 'radreport-import';

export const GOV_TEMPLATE_ORIGIN_LABELS: Record<GovTemplateOrigin, string> = {
  local: 'criado nesta instituicao',
  'mrrt-import': 'importado de MRRT',
  'radreport-import': 'importado do RadReport',
};

export interface GovTemplateField {
  fieldId: string;
  label: string;
  /**
   * True when the field's default text states a clinical fact ("sem alteracoes").
   * These are the fields RTV-228 blocks per field until confirmed, and the reason an
   * approver has to acknowledge them here.
   */
  assertive?: boolean;
  /** CDE element the field is bound to, if any. */
  cdeElementId?: string;
}

export interface GovTemplateVersion {
  templateId: string;
  version: number;
  title: string;
  origin: GovTemplateOrigin;
  lifecycle: GovLifecycle;
  fields: GovTemplateField[];
  /** Pack version the CDE bindings were resolved against. */
  cdePackVersion?: string;
  createdBy: string;
  createdAt: number;
  approval?: GovApproval;
  /** Version this one was forked from, when it was. */
  forkedFromVersion?: number;
}

export interface GovApproval {
  approvedBy: string;
  /** Professional registration of the approver. Required: a role is not a licence. */
  registration: string;
  approvedAt: number;
  /** Explicit acknowledgement that the assertive defaults were read. */
  acknowledgedAssertiveFields: string[];
  justification: string;
}

export function govAssertiveFields(template: GovTemplateVersion): GovTemplateField[] {
  return (template?.fields ?? []).filter(f => f && f.assertive === true);
}

/**
 * Imports third-party template content.
 *
 * Always as a draft, and there is no parameter that changes that. "Import without deploy" is
 * a statement about release process, not about trust: an imported MRRT file is content
 * nobody at this institution has read, and landing it approved would put its assertive
 * defaults straight into signed reports.
 */
export function govImportTemplate(input: {
  templateId: string;
  title: string;
  origin: GovTemplateOrigin;
  fields: GovTemplateField[];
  importedBy: string;
  importedAt: number;
  cdePackVersion?: string;
}): GovResult<GovTemplateVersion> {
  if (!input) {
    return govRefuse('invalid-template', 'Importacao vazia.');
  }
  if (!govText(input.templateId) || !govText(input.title)) {
    return govRefuse('invalid-template', 'Template importado sem identificador ou sem titulo.');
  }
  if (!GOV_TEMPLATE_ORIGIN_LABELS[input.origin]) {
    return govRefuse('invalid-template', 'Origem do template desconhecida.');
  }
  if (!govText(input.importedBy)) {
    return govRefuse('unattributed', 'Importacao sem responsavel identificado.');
  }
  if (!govIsEpochMs(input.importedAt)) {
    return govRefuse('invalid-timestamp', 'Importacao sem horario valido.');
  }
  const fields = (input.fields ?? []).filter(f => f && govText(f.fieldId));
  if (!fields.length) {
    return govRefuse('invalid-template', 'Template importado sem campos utilizaveis.');
  }

  return govOk({
    templateId: govText(input.templateId),
    version: 1,
    title: govText(input.title),
    origin: input.origin,
    lifecycle: 'draft',
    fields,
    cdePackVersion: govText(input.cdePackVersion) || undefined,
    createdBy: govText(input.importedBy),
    createdAt: input.importedAt,
  });
}

export interface GovTemplateEdit {
  title?: string;
  fields?: GovTemplateField[];
  cdePackVersion?: string;
}

export interface GovEditOutcome {
  template: GovTemplateVersion;
  /** True when the edit produced a new version instead of changing the given one. */
  forked: boolean;
  message: string;
}

/**
 * Applies an edit, forking when the target is approved.
 *
 * Editing an approved version in place would change, retroactively, what a report signed
 * against it asserted -- the audit trail names a template that no longer exists in the form
 * it was used, nobody is notified, and there is no diff to look at. A draft has nothing
 * signed against it and is edited directly.
 */
export function govEditTemplate(input: {
  template: GovTemplateVersion;
  edit: GovTemplateEdit;
  editedBy: string;
  editedAt: number;
}): GovResult<GovEditOutcome> {
  if (!input || !input.template) {
    return govRefuse('invalid-template', 'Template ausente.');
  }
  const template = input.template;
  const edit = input.edit ?? {};

  if (!govText(input.editedBy)) {
    return govRefuse('unattributed', 'Edicao sem responsavel identificado.');
  }
  if (!govIsEpochMs(input.editedAt)) {
    return govRefuse('invalid-timestamp', 'Edicao sem horario valido.');
  }
  if (template.lifecycle === 'retired') {
    return govRefuse(
      'not-draft',
      'Template retirado nao aceita edicao -- crie uma versao nova a partir dele.'
    );
  }

  const fields =
    edit.fields === undefined
      ? template.fields
      : (edit.fields ?? []).filter(f => f && govText(f.fieldId));
  if (!fields.length) {
    return govRefuse('invalid-template', 'Edicao deixaria o template sem campos.');
  }

  const nextTitle = edit.title === undefined ? template.title : govText(edit.title);
  if (!nextTitle) {
    return govRefuse('invalid-template', 'Edicao deixaria o template sem titulo.');
  }

  const nextPack =
    edit.cdePackVersion === undefined
      ? template.cdePackVersion
      : govText(edit.cdePackVersion) || undefined;

  if (template.lifecycle === 'approved') {
    return govOk({
      template: {
        templateId: template.templateId,
        version: template.version + 1,
        title: nextTitle,
        origin: template.origin,
        lifecycle: 'draft',
        fields,
        cdePackVersion: nextPack,
        createdBy: govText(input.editedBy),
        createdAt: input.editedAt,
        forkedFromVersion: template.version,
      },
      forked: true,
      message:
        'A versao ' +
        template.version +
        ' esta aprovada e e imutavel: laudos assinados a referenciam. Foi criada a versao ' +
        (template.version + 1) +
        ' como rascunho.',
    });
  }

  return govOk({
    template: {
      ...template,
      title: nextTitle,
      fields,
      cdePackVersion: nextPack,
    },
    forked: false,
    message: 'Rascunho atualizado.',
  });
}

/**
 * Records clinical approval of a draft.
 *
 * The registration is required and is the point: a template with pre-filled normality text
 * is making clinical assertions on behalf of whoever signs it, so deciding that wording is a
 * clinical act. Asking for a registration rather than checking a role is deliberate -- a role
 * can be granted to an administrator, a professional registration cannot.
 */
export function govApproveTemplate(input: {
  template: GovTemplateVersion;
  approvedBy: string;
  registration: string;
  approvedAt: number;
  acknowledgedAssertiveFields?: string[];
  justification: string;
}): GovResult<GovTemplateVersion> {
  if (!input || !input.template) {
    return govRefuse('invalid-template', 'Template ausente.');
  }
  const template = input.template;

  if (template.lifecycle !== 'draft') {
    return govRefuse(
      'not-draft',
      'Somente rascunho pode ser aprovado (situacao atual: ' +
        GOV_LIFECYCLE_LABELS[template.lifecycle] +
        ').'
    );
  }
  if (!govText(input.approvedBy)) {
    return govRefuse('unattributed', 'Aprovacao sem responsavel identificado.');
  }
  if (!govText(input.registration)) {
    return govRefuse(
      'missing-registration',
      'Aprovacao clinica exige registro profissional -- um template com texto de normalidade pre-preenchido faz afirmacoes clinicas por quem assinar, e decidir essa redacao e ato clinico.'
    );
  }
  if (!govIsEpochMs(input.approvedAt)) {
    return govRefuse('invalid-timestamp', 'Aprovacao sem horario valido.');
  }
  if (!govText(input.justification)) {
    return govRefuse('missing-justification', 'Aprovacao sem justificativa registrada.');
  }
  // The author approving their own template removes the second pair of eyes that the
  // approval step exists to be.
  if (govText(input.approvedBy).toLowerCase() === govText(template.createdBy).toLowerCase()) {
    return govRefuse(
      'self-approval',
      'Quem criou a versao nao pode aprova-la -- a aprovacao existe para ser um segundo par de olhos.'
    );
  }

  const assertive = govAssertiveFields(template).map(f => f.fieldId);
  const acknowledged = (input.acknowledgedAssertiveFields ?? []).map(govText).filter(Boolean);
  const missing = assertive.filter(id => acknowledged.indexOf(id) < 0);
  if (missing.length) {
    return govRefuse(
      'assertive-not-acknowledged',
      'Aprovacao nao reconheceu ' +
        missing.length +
        ' campo(s) com texto afirmativo pre-preenchido (' +
        missing.join(', ') +
        ') -- sem isso "aprovei o template" e uma afirmacao sobre o layout, e os padroes afirmativos entram sem serem lidos.'
    );
  }

  return govOk({
    ...template,
    lifecycle: 'approved',
    approval: {
      approvedBy: govText(input.approvedBy),
      registration: govText(input.registration),
      approvedAt: input.approvedAt,
      acknowledgedAssertiveFields: assertive,
      justification: govText(input.justification),
    },
  });
}

/**
 * Retires a template version.
 *
 * Retiring stops new use; it does not erase. A version a signed report references has to stay
 * resolvable, because otherwise the report's own audit trail points at nothing.
 */
export function govRetireTemplate(input: {
  template: GovTemplateVersion;
  retiredBy: string;
  retiredAt: number;
  justification: string;
}): GovResult<GovTemplateVersion> {
  if (!input || !input.template) {
    return govRefuse('invalid-template', 'Template ausente.');
  }
  if (!govText(input.retiredBy)) {
    return govRefuse('unattributed', 'Retirada sem responsavel identificado.');
  }
  if (!govIsEpochMs(input.retiredAt)) {
    return govRefuse('invalid-timestamp', 'Retirada sem horario valido.');
  }
  if (!govText(input.justification)) {
    return govRefuse('missing-justification', 'Retirada sem justificativa registrada.');
  }
  return govOk({ ...input.template, lifecycle: 'retired' });
}

/** Whether a version may be selected for a new report. */
export function govIsUsable(template: GovTemplateVersion): boolean {
  return !!template && template.lifecycle === 'approved';
}

/* ------------------------------------------------------------------ */
/* CDE / RADS packs                                                   */
/* ------------------------------------------------------------------ */

export type GovPackSource = 'radelement' | 'acr' | 'local';

export interface GovPackVersion {
  packId: string;
  version: string;
  source: GovPackSource;
  lifecycle: GovLifecycle;
  elementIds: string[];
  /** Clinical validation record, required before the pack may be used. */
  approval?: GovApproval;
  importedAt: number;
}

export interface GovPackUsage {
  /** Number of reports pinned to this pack version. */
  reportCount: number;
  /** Template versions binding fields to it. */
  templateVersions: Array<{ templateId: string; version: number }>;
}

/**
 * Retires a pack version, refusing while anything still points at it.
 *
 * A report records a finding as element `RDE818` with value `RDE818.2`. If the pack changes
 * and that value's allowed set or meaning changes, the historical report does not break --
 * it stays perfectly readable and starts meaning something else. Pinning the pack version per
 * report is what prevents that, and pinning is worthless if the pinned version can be
 * removed.
 */
export function govRetirePackVersion(input: {
  pack: GovPackVersion;
  usage: GovPackUsage;
  retiredBy: string;
  retiredAt: number;
}): GovResult<GovPackVersion> {
  if (!input || !input.pack) {
    return govRefuse('pack-not-found', 'Pacote CDE/RADS ausente.');
  }
  if (!govText(input.retiredBy)) {
    return govRefuse('unattributed', 'Retirada de pacote sem responsavel identificado.');
  }
  if (!govIsEpochMs(input.retiredAt)) {
    return govRefuse('invalid-timestamp', 'Retirada de pacote sem horario valido.');
  }
  const usage = input.usage ?? { reportCount: 0, templateVersions: [] };
  const reportCount = Number(usage.reportCount);
  const templates = (usage.templateVersions ?? []).filter(Boolean);

  if ((isFinite(reportCount) && reportCount > 0) || templates.length > 0) {
    return govRefuse(
      'pack-in-use',
      'O pacote ' +
        input.pack.packId +
        ' ' +
        input.pack.version +
        ' ainda e referenciado por ' +
        (isFinite(reportCount) ? reportCount : 0) +
        ' laudo(s) e ' +
        templates.length +
        ' versao(oes) de template. Remove-lo faria um achado antigo passar a significar o valor de hoje.'
    );
  }

  return govOk({ ...input.pack, lifecycle: 'retired' });
}

/**
 * Resolves the pack version a report must pin.
 *
 * Refuses when nothing is pinned rather than falling back to "the current one". The current
 * pack is the correct answer only when the report is being created; for any report already
 * in existence it is the wrong answer that happens to be available.
 */
export function govResolvePackForReport(input: {
  pinnedVersion?: string;
  currentVersion?: string;
  reportExists: boolean;
}): GovResult<string> {
  const pinned = govText(input?.pinnedVersion);
  if (pinned) {
    return govOk(pinned);
  }
  if (input?.reportExists === true) {
    return govRefuse(
      'version-not-pinned',
      'Laudo existente sem versao de pacote fixada -- usar a versao atual daria ao achado antigo o significado de hoje.'
    );
  }
  const current = govText(input?.currentVersion);
  if (!current) {
    return govRefuse('pack-not-found', 'Nenhuma versao de pacote CDE/RADS disponivel.');
  }
  return govOk(current);
}

/** Whether a pack version may be bound to new content. */
export function govPackIsUsable(pack: GovPackVersion): boolean {
  return !!pack && pack.lifecycle === 'approved' && !!pack.approval;
}

/* ------------------------------------------------------------------ */
/* Macros                                                            */
/* ------------------------------------------------------------------ */

export type GovMacroScope = 'radiologist' | 'group' | 'institution';

/** Most specific first. This order is the resolution order. */
export const GOV_MACRO_SCOPE_PRECEDENCE: GovMacroScope[] = ['radiologist', 'group', 'institution'];

export const GOV_MACRO_SCOPE_LABELS: Record<GovMacroScope, string> = {
  radiologist: 'do radiologista',
  group: 'do grupo',
  institution: 'da instituicao',
};

export interface GovMacro {
  macroId: string;
  /** What the radiologist types or says to expand it. */
  trigger: string;
  expansion: string;
  scope: GovMacroScope;
  /** Owner of the scope: user id, group id or tenant id. */
  ownerId: string;
}

export interface GovShadowedMacro {
  trigger: string;
  winner: GovMacro;
  shadowed: GovMacro[];
}

export interface GovMacroResolution {
  /** Trigger to the macro that will actually fire. */
  effective: Record<string, GovMacro>;
  /** Macros that will never fire because a more specific scope uses the same trigger. */
  shadowed: GovShadowedMacro[];
  message: string;
}

function govNormalizeTrigger(trigger: string): string {
  return govText(trigger).toLowerCase();
}

/**
 * Resolves macros across scopes, most specific winning, and reports what is shadowed.
 *
 * The precedence itself is uncontroversial. The report is the part worth building: when an
 * institution adds a macro whose trigger a radiologist already uses, the radiologist's keeps
 * winning and the institutional one **silently never fires**. Without this list the admin
 * sees a macro that "does not work" and has no way to find out why.
 */
export function govResolveMacros(macros: GovMacro[]): GovResult<GovMacroResolution> {
  const list = (macros ?? []).filter(m => m && govText(m.trigger) && govText(m.macroId));
  const byTrigger: Record<string, GovMacro[]> = {};

  for (const macro of list) {
    if (GOV_MACRO_SCOPE_PRECEDENCE.indexOf(macro.scope) < 0) {
      return govRefuse('unknown-scope', 'Macro com escopo desconhecido: ' + String(macro.scope));
    }
    const key = govNormalizeTrigger(macro.trigger);
    if (!byTrigger[key]) {
      byTrigger[key] = [];
    }
    byTrigger[key].push(macro);
  }

  const effective: Record<string, GovMacro> = {};
  const shadowed: GovShadowedMacro[] = [];

  for (const key of Object.keys(byTrigger)) {
    const candidates = byTrigger[key];
    const ordered = GOV_MACRO_SCOPE_PRECEDENCE.reduce<GovMacro[]>((acc, scope) => {
      return acc.concat(candidates.filter(m => m.scope === scope));
    }, []);

    // Two macros at the same scope with the same trigger is not a precedence question, it is
    // a configuration error: which one fires would depend on load order.
    const winnerScope = ordered[0].scope;
    const sameScope = ordered.filter(m => m.scope === winnerScope);
    if (sameScope.length > 1) {
      return govRefuse(
        'duplicate-trigger',
        'Duas macros ' +
          GOV_MACRO_SCOPE_LABELS[winnerScope] +
          ' usam o gatilho "' +
          key +
          '" -- qual dispara dependeria da ordem de carregamento.'
      );
    }

    effective[key] = ordered[0];
    if (ordered.length > 1) {
      shadowed.push({ trigger: key, winner: ordered[0], shadowed: ordered.slice(1) });
    }
  }

  return govOk({
    effective,
    shadowed,
    message: shadowed.length
      ? shadowed.length +
        ' macro(s) nunca dispararao porque um escopo mais especifico usa o mesmo gatilho: ' +
        shadowed.map(s => '"' + s.trigger + '"').join(', ') +
        '.'
      : 'Nenhuma macro sombreada.',
  });
}

/* ------------------------------------------------------------------ */
/* AI policy switch                                                   */
/* ------------------------------------------------------------------ */

export interface GovAiPolicyDraft {
  tenantId: string;
  enabled: boolean;
  enabledForRoles?: string[];
  enabledForModalities?: string[];
  modelId?: string;
  modelVersion?: string;
  /** Provider endpoint identity, recorded so the audit can name it. */
  providerId?: string;
}

export interface GovAiPolicyChange {
  policy: GovAiPolicyDraft;
  changedBy: string;
  changedAt: number;
  justification: string;
  /** Suggestions still awaiting a decision when the switch is flipped. */
  pendingSuggestionIds?: string[];
}

export interface GovAiPolicyOutcome {
  policy: GovAiPolicyDraft;
  /** Pending suggestions that must be discarded, named rather than dropped. */
  discardedSuggestionIds: string[];
  warnings: string[];
  message: string;
}

/**
 * Validates a change to the AI policy.
 *
 * Turning it **on** requires the model and version, because RTV-224 refuses to run without
 * them anyway and failing here gives the administrator the reason instead of leaving the
 * feature mysteriously inert.
 *
 * Turning it **off** is where the interesting case is: suggestions already on screen awaiting
 * accept/reject stop being decidable. They must be reported by id and discarded, not left in
 * the document -- an undecided machine-written segment that nobody can decide about any more
 * would block signature forever, and the radiologist would have no way to clear it.
 */
export function govChangeAiPolicy(change: GovAiPolicyChange): GovResult<GovAiPolicyOutcome> {
  if (!change || !change.policy) {
    return govRefuse('invalid-policy', 'Alteracao de politica de IA sem politica.');
  }
  const policy = change.policy;
  if (!govText(policy.tenantId)) {
    return govRefuse('invalid-policy', 'Politica de IA sem instituicao identificada.');
  }
  if (!govText(change.changedBy)) {
    return govRefuse('unattributed', 'Alteracao de politica de IA sem responsavel identificado.');
  }
  if (!govIsEpochMs(change.changedAt)) {
    return govRefuse('invalid-timestamp', 'Alteracao de politica de IA sem horario valido.');
  }
  if (!govText(change.justification)) {
    return govRefuse('missing-justification', 'Alteracao de politica de IA sem justificativa.');
  }

  const warnings: string[] = [];

  if (policy.enabled === true) {
    if (!govText(policy.modelId) || !govText(policy.modelVersion)) {
      return govRefuse(
        'policy-incomplete',
        'Ligar a IA exige modelo e versao identificados -- sem eles nenhuma sugestao pode ser auditada, e o copiloto se recusaria a rodar sem dizer por que.'
      );
    }
    if (!govText(policy.providerId)) {
      warnings.push(
        'Provedor nao identificado na politica -- a auditoria nao podera nomear para onde o contexto foi enviado.'
      );
    }
    const roles = (policy.enabledForRoles ?? []).map(govText).filter(Boolean);
    if (!roles.length) {
      warnings.push(
        'Nenhum perfil habilitado: a IA fica ligada e indisponivel para todos. Isso e o padrao seguro, e provavelmente nao e a intencao.'
      );
    }
  }

  const pending = (change.pendingSuggestionIds ?? []).map(govText).filter(Boolean);
  const discardedSuggestionIds = policy.enabled === false ? pending : [];

  if (discardedSuggestionIds.length) {
    warnings.push(
      discardedSuggestionIds.length +
        ' sugestao(oes) pendente(s) serao descartadas: sem a IA ligada elas nao podem mais ser decididas, e um trecho de maquina indecidivel bloquearia a assinatura para sempre.'
    );
  }

  return govOk({
    policy: {
      ...policy,
      enabledForRoles: (policy.enabledForRoles ?? []).map(govText).filter(Boolean),
      enabledForModalities: (policy.enabledForModalities ?? []).map(govText).filter(Boolean),
    },
    discardedSuggestionIds,
    warnings,
    message: policy.enabled
      ? 'IA habilitada para ' +
        ((policy.enabledForRoles ?? []).length || 0) +
        ' perfil(is).'
      : 'IA desabilitada para esta instituicao.',
  });
}

/* ------------------------------------------------------------------ */
/* Audit                                                              */
/* ------------------------------------------------------------------ */

export type GovAuditKind =
  | 'template-imported'
  | 'template-edited'
  | 'template-forked'
  | 'template-approved'
  | 'template-retired'
  | 'pack-imported'
  | 'pack-retired'
  | 'macro-changed'
  | 'ai-policy-changed';

export const GOV_AUDIT_KINDS: GovAuditKind[] = [
  'template-imported',
  'template-edited',
  'template-forked',
  'template-approved',
  'template-retired',
  'pack-imported',
  'pack-retired',
  'macro-changed',
  'ai-policy-changed',
];

export interface GovAuditEntry {
  kind: GovAuditKind;
  tenantId: string;
  actorId: string;
  at: number;
  /** What was acted on: template id + version, pack id + version, macro id, or the tenant. */
  subject: string;
  justification: string;
  /** Registration of the approver, present only for clinical approvals. */
  registration?: string;
  /** Human-readable summary of what changed. */
  detail: string;
  complete: boolean;
  gaps: string[];
}

/**
 * Builds a governance audit record.
 *
 * The question this has to answer is "why does this template say that, and who decided" --
 * asked when a report's wording is challenged, often years later. A record without the
 * justification cannot answer it, so the justification is required rather than optional, and
 * gaps are named instead of a record being filed that looks complete.
 */
export function govAuditEntry(input: {
  kind: GovAuditKind;
  tenantId: string;
  actorId: string;
  at: number;
  subject: string;
  justification: string;
  registration?: string;
  detail?: string;
}): GovResult<GovAuditEntry> {
  if (!input) {
    return govRefuse('audit-incomplete', 'Registro de governanca vazio.');
  }
  const gaps: string[] = [];
  if (GOV_AUDIT_KINDS.indexOf(input.kind) < 0) {
    gaps.push('tipo de evento desconhecido');
  }
  if (!govText(input.tenantId)) {
    gaps.push('instituicao nao identificada');
  }
  if (!govText(input.actorId)) {
    gaps.push('responsavel nao identificado');
  }
  if (!govIsEpochMs(input.at)) {
    gaps.push('horario invalido');
  }
  if (!govText(input.subject)) {
    gaps.push('objeto da alteracao nao identificado');
  }
  if (!govText(input.justification)) {
    gaps.push('justificativa ausente');
  }
  if (input.kind === 'template-approved' && !govText(input.registration)) {
    gaps.push('registro profissional do aprovador ausente');
  }

  if (gaps.length) {
    return govRefuse(
      'audit-incomplete',
      'Registro de governanca nao responderia "por que este template diz isso e quem decidiu": ' +
        gaps.join(', ') +
        '.'
    );
  }

  return govOk({
    kind: input.kind,
    tenantId: govText(input.tenantId),
    actorId: govText(input.actorId),
    at: input.at,
    subject: govText(input.subject),
    justification: govText(input.justification),
    registration: govText(input.registration) || undefined,
    detail: govText(input.detail) || govText(input.subject),
    complete: true,
    gaps: [],
  });
}

/** One line for the admin library row. */
export function govDescribeTemplate(template: GovTemplateVersion): string {
  if (!template) {
    return '';
  }
  const assertive = govAssertiveFields(template).length;
  const parts = [
    template.title + ' v' + template.version,
    GOV_LIFECYCLE_LABELS[template.lifecycle],
    GOV_TEMPLATE_ORIGIN_LABELS[template.origin],
  ];
  if (assertive) {
    parts.push(assertive + ' campo(s) afirmativo(s)');
  }
  if (template.forkedFromVersion !== undefined) {
    parts.push('derivado da v' + template.forkedFromVersion);
  }
  return parts.join(' - ') + '.';
}
