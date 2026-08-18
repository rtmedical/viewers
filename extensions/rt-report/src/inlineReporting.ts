/**
 * Inline reporting in the right panel: template eligibility, presentation without omission,
 * and surviving an unmount -- pure core (RTV-121).
 *
 * This ticket reuses the reporting extension in a smaller container, and the whole risk of a
 * reuse like this is that "smaller" gets implemented as "less". A fullscreen editor and an
 * inline panel must produce **the same document with the same obligations**; only the
 * presentation may differ. Every rule here is a way of pinning that down.
 *
 * ## An RT template offered for a radiology read
 *
 * The template library holds both radiology templates and radiotherapy ones, and an RT
 * template's fields are about a treatment plan: prescribed dose, fractionation, target
 * volumes, organ-at-risk constraints. Offering one for a chest CT read is not merely untidy --
 * its pre-filled defaults are clinical assertions about a treatment that does not exist, and
 * RTV-228 will then block the signature over fields the radiologist cannot even interpret.
 *
 * So eligibility is decided by an explicit `domain` on the template, never inferred from its
 * title. "Torax" appears in the name of both a diagnostic chest template and an RT thorax
 * plan template, and a title match would sooner or later pick the wrong one.
 *
 * ## Smaller must not mean fewer fields
 *
 * This is the failure worth building against. The inline panel is narrow, so the obvious
 * implementation collapses sections or drops the ones that do not fit. Two things then go
 * wrong, and the second is serious:
 *
 * 1. a blocking item inside a collapsed section leaves the radiologist unable to see **why**
 *    signing is refused, so they conclude the button is broken;
 * 2. an implementation that validates only what is rendered lets the report be signed with an
 *    unconfirmed assertive field -- which is exactly the "laudo normal por omissao" that
 *    RTV-228 exists to prevent, reintroduced by the layout.
 *
 * {@link inlinePlanPresentation} therefore returns a presentation in which every template
 * field is still present and still validated, sections may be collapsed, and **any section
 * holding a blocking item is forced open**. {@link inlineAssertSameObligations} is the
 * assertion that the inline field set equals the fullscreen one, so a divergence is a test
 * failure rather than a discovery in production.
 *
 * ## Hiding RT chrome is fine; hiding RT data is not
 *
 * "Sem distracoes RT-specific" is about the toolbar. If the study being read also carries an
 * RTSTRUCT or an RTPLAN, that is clinical context -- a patient under treatment whose chest CT
 * is being read diagnostically. Suppressing the fact silently means reporting the study
 * without knowing the patient is on treatment. {@link inlineSuppressRtChrome} distinguishes
 * the two and reports the data that must stay visible.
 *
 * ## The right panel unmounts
 *
 * A hanging-protocol change, a layout switch, or the user collapsing the sidebar all unmount
 * the panel, and they happen mid-sentence. An unmount that drops the draft loses dictated
 * text the radiologist watched themselves produce. {@link inlinePlanUnmount} refuses to
 * discard and returns what has to be persisted first.
 *
 * Framework-free, no `@ohif/*`, no React, no clock, no randomness, no `throw`. Zero-fork per
 * RTV-114.
 */

/* ------------------------------------------------------------------ */
/* Result type                                                         */
/* ------------------------------------------------------------------ */

export type InlineRefusalCode =
  | 'wrong-domain'
  | 'modality-mismatch'
  | 'template-not-approved'
  | 'no-eligible-template'
  | 'field-omitted'
  | 'obligations-diverged'
  | 'draft-would-be-lost'
  | 'invalid-template'
  | 'invalid-context';

/**
 * Refusals travel as values. `value?: undefined` / `reason?: undefined` are required because
 * `strictNullChecks` is off in this repo.
 */
export type InlineResult<T> =
  | { ok: true; value: T; code?: undefined; reason?: undefined }
  | { ok: false; code: InlineRefusalCode; reason: string; value?: undefined };

function inlineOk<T>(value: T): InlineResult<T> {
  return { ok: true, value };
}

function inlineRefuse<T>(code: InlineRefusalCode, reason: string): InlineResult<T> {
  return { ok: false, code, reason };
}

function inlineText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/* ------------------------------------------------------------------ */
/* Template eligibility                                               */
/* ------------------------------------------------------------------ */

export type InlineDomain = 'radiology' | 'radiotherapy';

export const INLINE_DOMAIN_LABELS: Record<InlineDomain, string> = {
  radiology: 'radiologia diagnostica',
  radiotherapy: 'radioterapia',
};

export interface InlineTemplateField {
  fieldId: string;
  label: string;
  section: string;
  /** True when the field's default text states a clinical fact. See RTV-228. */
  assertive?: boolean;
  /** True when the field must be answered before signature. */
  required?: boolean;
}

export interface InlineTemplate {
  templateId: string;
  version: number;
  title: string;
  /**
   * Explicit, never inferred from the title. "Torax" is in the name of both a diagnostic
   * chest template and an RT thorax plan template.
   */
  domain: InlineDomain;
  /** Modalities the template is written for. Empty means every modality in its domain. */
  modalities: string[];
  fields: InlineTemplateField[];
  approved: boolean;
}

export interface InlineStudyContext {
  modality: string;
  /** Additional modalities present in the study, e.g. an RTSTRUCT alongside a CT. */
  additionalModalities?: string[];
  /** The read being performed, which is not always implied by what the study contains. */
  readDomain: InlineDomain;
}

/** Modalities that only ever appear as radiotherapy objects. */
export const INLINE_RT_MODALITIES = ['RTSTRUCT', 'RTPLAN', 'RTDOSE', 'RTRECORD', 'RTIMAGE'];

/**
 * Whether one template may be offered for this read.
 *
 * Domain first, and by the explicit field. An RT template's pre-filled defaults are clinical
 * assertions about a treatment plan, so offering one for a diagnostic read puts assertions the
 * radiologist cannot interpret in front of the signature gate.
 */
export function inlineTemplateEligible(
  template: InlineTemplate,
  context: InlineStudyContext
): InlineResult<InlineTemplate> {
  if (!template || !inlineText(template.templateId)) {
    return inlineRefuse('invalid-template', 'Template sem identificador.');
  }
  if (!template.fields || !template.fields.length) {
    return inlineRefuse('invalid-template', 'Template sem campos.');
  }
  if (!context || !inlineText(context.modality)) {
    return inlineRefuse('invalid-context', 'Contexto do estudo sem modalidade.');
  }
  if (!INLINE_DOMAIN_LABELS[template.domain]) {
    return inlineRefuse(
      'invalid-template',
      'Template sem dominio declarado -- o dominio nao pode ser inferido do titulo, porque "Torax" esta no nome de um template diagnostico e de um de plano de radioterapia.'
    );
  }
  if (!INLINE_DOMAIN_LABELS[context.readDomain]) {
    return inlineRefuse('invalid-context', 'Leitura sem dominio declarado.');
  }

  if (template.domain !== context.readDomain) {
    return inlineRefuse(
      'wrong-domain',
      'Template de ' +
        INLINE_DOMAIN_LABELS[template.domain] +
        ' nao serve para uma leitura de ' +
        INLINE_DOMAIN_LABELS[context.readDomain] +
        ' -- seus campos pre-preenchidos sao afirmacoes clinicas sobre um plano de tratamento, e a assinatura ficaria bloqueada por campos que o radiologista nao consegue interpretar.'
    );
  }

  if (!template.approved) {
    return inlineRefuse(
      'template-not-approved',
      'Template nao aprovado clinicamente nao pode ser usado num laudo (ver RTV-230).'
    );
  }

  const modalities = (template.modalities ?? []).map(m => inlineText(m).toUpperCase()).filter(Boolean);
  const modality = inlineText(context.modality).toUpperCase();
  if (modalities.length && modalities.indexOf(modality) < 0) {
    return inlineRefuse(
      'modality-mismatch',
      'Template escrito para ' + modalities.join(', ') + ' e o estudo e ' + modality + '.'
    );
  }

  return inlineOk(template);
}

export interface InlineTemplateChoice {
  eligible: InlineTemplate[];
  /** Why each rejected template was rejected, so the picker can explain an empty list. */
  rejected: Array<{ templateId: string; code: InlineRefusalCode; reason: string }>;
  message: string;
}

/**
 * Filters the library for this read.
 *
 * Returns the rejections alongside the survivors, because an empty picker with no explanation
 * is the state in which somebody picks an RT template by hand to make the panel work.
 */
export function inlineFilterTemplates(
  templates: InlineTemplate[],
  context: InlineStudyContext
): InlineResult<InlineTemplateChoice> {
  const list = (templates ?? []).filter(Boolean);
  const eligible: InlineTemplate[] = [];
  const rejected: Array<{ templateId: string; code: InlineRefusalCode; reason: string }> = [];

  for (const template of list) {
    const verdict = inlineTemplateEligible(template, context);
    if (verdict.ok) {
      eligible.push(template);
    } else {
      rejected.push({
        templateId: inlineText(template?.templateId) || '(sem id)',
        code: verdict.code,
        reason: verdict.reason,
      });
    }
  }

  if (!eligible.length) {
    return inlineRefuse(
      'no-eligible-template',
      'Nenhum template elegivel para ' +
        inlineText(context?.modality).toUpperCase() +
        ' em ' +
        (INLINE_DOMAIN_LABELS[context?.readDomain] ?? 'dominio nao declarado') +
        '. ' +
        (rejected.length
          ? rejected.length + ' template(s) recusado(s): ' + rejected.map(r => r.code).join(', ') + '.'
          : 'A biblioteca esta vazia.')
    );
  }

  return inlineOk({
    eligible,
    rejected,
    message: eligible.length + ' template(s) elegivel(is), ' + rejected.length + ' recusado(s).',
  });
}

/* ------------------------------------------------------------------ */
/* Presentation without omission                                      */
/* ------------------------------------------------------------------ */

export type InlineMode = 'inline' | 'fullscreen';

export const INLINE_MODE_LABELS: Record<InlineMode, string> = {
  inline: 'painel lateral',
  fullscreen: 'tela cheia',
};

export interface InlineSectionPresentation {
  section: string;
  collapsed: boolean;
  fieldIds: string[];
  /** True when a blocking item forced this section open. */
  forcedOpen: boolean;
  /** Field ids in this section that block signature until answered. */
  blockingFieldIds: string[];
}

export interface InlinePresentation {
  mode: InlineMode;
  sections: InlineSectionPresentation[];
  /** Every field the template defines. Never a subset of it. */
  validatedFieldIds: string[];
  message: string;
}

/**
 * Lays the template out for a mode, collapsing but never omitting.
 *
 * The two things this prevents, and the second is the serious one: a blocking item inside a
 * collapsed section leaves the radiologist unable to see **why** the signature is refused, so
 * they conclude the button is broken; and an implementation that validates only what it
 * renders lets the report be signed with an unconfirmed assertive field -- the "laudo normal por
 * omissao" of RTV-228, reintroduced by the layout.
 *
 * `validatedFieldIds` is therefore always the complete field list, in both modes, and any
 * section holding a blocking item is forced open.
 */
export function inlinePlanPresentation(input: {
  template: InlineTemplate;
  mode: InlineMode;
  /** Sections the user or a preference collapsed. */
  collapsedSections?: string[];
  /** Fields already answered, so a required field stops blocking. */
  answeredFieldIds?: string[];
  /** Assertive fields the radiologist confirmed. See RTV-228. */
  confirmedAssertiveFieldIds?: string[];
}): InlineResult<InlinePresentation> {
  if (!input || !input.template || !input.template.fields) {
    return inlineRefuse('invalid-template', 'Template ausente.');
  }
  const mode: InlineMode = input.mode === 'fullscreen' ? 'fullscreen' : 'inline';
  const fields = input.template.fields.filter(f => f && inlineText(f.fieldId));
  if (!fields.length) {
    return inlineRefuse('invalid-template', 'Template sem campos utilizaveis.');
  }

  const answered = new Set((input.answeredFieldIds ?? []).map(inlineText).filter(Boolean));
  const confirmed = new Set(
    (input.confirmedAssertiveFieldIds ?? []).map(inlineText).filter(Boolean)
  );
  const requestedCollapsed = new Set(
    (input.collapsedSections ?? []).map(inlineText).filter(Boolean)
  );

  const isBlocking = (field: InlineTemplateField): boolean => {
    if (field.assertive === true && !confirmed.has(field.fieldId)) {
      return true;
    }
    if (field.required === true && !answered.has(field.fieldId)) {
      return true;
    }
    return false;
  };

  const order: string[] = [];
  const bySection: Record<string, InlineTemplateField[]> = {};
  for (const field of fields) {
    const section = inlineText(field.section) || 'geral';
    if (!bySection[section]) {
      bySection[section] = [];
      order.push(section);
    }
    bySection[section].push(field);
  }

  const sections: InlineSectionPresentation[] = order.map(section => {
    const sectionFields = bySection[section];
    const blockingFieldIds = sectionFields.filter(isBlocking).map(f => f.fieldId);
    const wantedCollapsed = requestedCollapsed.has(section);
    const forcedOpen = wantedCollapsed && blockingFieldIds.length > 0;
    return {
      section,
      collapsed: wantedCollapsed && !forcedOpen,
      fieldIds: sectionFields.map(f => f.fieldId),
      forcedOpen,
      blockingFieldIds,
    };
  });

  const validatedFieldIds = fields.map(f => f.fieldId);
  const forced = sections.filter(s => s.forcedOpen);

  return inlineOk({
    mode,
    sections,
    validatedFieldIds,
    message:
      validatedFieldIds.length +
      ' campo(s) validado(s) em ' +
      INLINE_MODE_LABELS[mode] +
      (forced.length
        ? '. ' +
          forced.length +
          ' secao(oes) reaberta(s) por conter pendencia bloqueante: ' +
          forced.map(s => s.section).join(', ') +
          ' -- sem isso o radiologista nao veria por que a assinatura esta recusada.'
        : '.'),
  });
}

/**
 * Asserts that the inline presentation carries the same obligations as the fullscreen one.
 *
 * Written as an assertion rather than left to review, because a divergence here is invisible:
 * both panels render, both save, and the difference only shows up as a report missing a
 * section that the template required. Making it a refusal turns it into a test failure.
 */
export function inlineAssertSameObligations(
  inline: InlinePresentation,
  fullscreen: InlinePresentation
): InlineResult<string[]> {
  if (!inline || !fullscreen) {
    return inlineRefuse('obligations-diverged', 'Uma das apresentacoes esta ausente.');
  }
  const a = (inline.validatedFieldIds ?? []).slice().sort();
  const b = (fullscreen.validatedFieldIds ?? []).slice().sort();

  const missingInline = b.filter(id => a.indexOf(id) < 0);
  const missingFullscreen = a.filter(id => b.indexOf(id) < 0);

  if (missingInline.length || missingFullscreen.length) {
    const parts: string[] = [];
    if (missingInline.length) {
      parts.push('faltando no painel lateral: ' + missingInline.join(', '));
    }
    if (missingFullscreen.length) {
      parts.push('faltando na tela cheia: ' + missingFullscreen.join(', '));
    }
    return inlineRefuse(
      'obligations-diverged',
      'O conjunto de campos validados difere entre os modos (' +
        parts.join('; ') +
        ') -- os dois paineis renderizam e os dois salvam, e a diferenca so aparece como um laudo sem uma secao que o template exigia.'
    );
  }
  return inlineOk(a);
}

/** Fields still blocking signature, across every section and regardless of collapse. */
export function inlineBlockingFields(presentation: InlinePresentation): string[] {
  if (!presentation || !presentation.sections) {
    return [];
  }
  return presentation.sections.reduce<string[]>(
    (acc, section) => acc.concat(section.blockingFieldIds ?? []),
    []
  );
}

/* ------------------------------------------------------------------ */
/* RT chrome versus RT data                                           */
/* ------------------------------------------------------------------ */

export interface InlineChromeDecision {
  /** Toolbar groups the inline panel should not show. */
  suppressedChrome: string[];
  /** RT objects present in the study that must stay visible as clinical context. */
  visibleRtData: string[];
  warnings: string[];
  message: string;
}

/** Toolbar groups that are radiotherapy workflow and are noise in a diagnostic read. */
export const INLINE_RT_CHROME = [
  'dose-tracking',
  'isodose',
  'beam-geometry',
  'dvh',
  'structure-set-editing',
  'fraction-navigation',
];

/**
 * Decides what to hide.
 *
 * The distinction the ticket does not make and needs to: hiding RT **chrome** is the point of
 * the ticket, and hiding RT **data** is a different act. A chest CT being read diagnostically
 * on a patient who also has an RTSTRUCT and an RTPLAN in the study means the patient is under
 * treatment, and that is clinical context the report should be written knowing. Suppressing
 * the fact along with the toolbar means reporting the study without it.
 */
export function inlineSuppressRtChrome(context: InlineStudyContext): InlineChromeDecision {
  const readDomain = INLINE_DOMAIN_LABELS[context?.readDomain] ? context.readDomain : 'radiology';
  const additional = (context?.additionalModalities ?? [])
    .map(m => inlineText(m).toUpperCase())
    .filter(Boolean);
  const rtPresent = additional.filter(m => INLINE_RT_MODALITIES.indexOf(m) >= 0);

  if (readDomain === 'radiotherapy') {
    return {
      suppressedChrome: [],
      visibleRtData: rtPresent,
      warnings: [],
      message: 'Leitura de radioterapia -- nada e suprimido.',
    };
  }

  const warnings: string[] = [];
  if (rtPresent.length) {
    warnings.push(
      'O estudo carrega ' +
        rtPresent.join(', ') +
        ' -- o paciente esta sob tratamento, e isso e contexto clinico. A barra de ferramentas de radioterapia e escondida; o dado, nao.'
    );
  }

  return {
    suppressedChrome: INLINE_RT_CHROME.slice(),
    visibleRtData: rtPresent,
    warnings,
    message:
      INLINE_RT_CHROME.length +
      ' grupo(s) de ferramenta de radioterapia suprimido(s); ' +
      rtPresent.length +
      ' objeto(s) de radioterapia permanece(m) visivel(is).',
  };
}

/* ------------------------------------------------------------------ */
/* Surviving an unmount                                               */
/* ------------------------------------------------------------------ */

export type InlineUnmountCause =
  | 'hanging-protocol-change'
  | 'layout-change'
  | 'sidebar-collapsed'
  | 'study-closed';

export const INLINE_UNMOUNT_LABELS: Record<InlineUnmountCause, string> = {
  'hanging-protocol-change': 'troca de hanging protocol',
  'layout-change': 'troca de layout',
  'sidebar-collapsed': 'painel lateral recolhido',
  'study-closed': 'estudo fechado',
};

export interface InlineDraftState {
  reportId: string;
  /** Fields with typed values not yet persisted. */
  dirtyFieldIds: string[];
  /** Characters typed since the last successful save. */
  unsavedChars: number;
}

export interface InlineUnmountPlan {
  cause: InlineUnmountCause;
  /** Fields that must be persisted before the panel goes away. */
  mustPersistFieldIds: string[];
  /** True when the panel may be torn down immediately. */
  safeToUnmount: boolean;
  message: string;
}

/**
 * Decides whether the panel may be torn down.
 *
 * A hanging-protocol change, a layout switch and a collapsed sidebar all unmount the right
 * panel, and they happen mid-sentence -- the radiologist changes layout to look at a
 * comparison while dictating. An unmount that drops the draft loses text they watched
 * themselves produce, so it is refused with the list of fields to persist first.
 *
 * `study-closed` is treated the same way rather than as an exception: closing the study is
 * the moment the draft is most likely to be forgotten.
 */
export function inlinePlanUnmount(input: {
  cause: InlineUnmountCause;
  draft: InlineDraftState;
  /** Set once the caller has persisted the dirty fields. */
  persisted?: boolean;
}): InlineResult<InlineUnmountPlan> {
  if (!input || !INLINE_UNMOUNT_LABELS[input.cause]) {
    return inlineRefuse('invalid-context', 'Motivo de desmontagem desconhecido.');
  }
  const draft = input.draft ?? { reportId: '', dirtyFieldIds: [], unsavedChars: 0 };
  const dirty = (draft.dirtyFieldIds ?? []).map(inlineText).filter(Boolean);
  const unsaved = Number(draft.unsavedChars);
  const hasUnsaved = dirty.length > 0 || (isFinite(unsaved) && unsaved > 0);

  if (hasUnsaved && input.persisted !== true) {
    return inlineRefuse(
      'draft-would-be-lost',
      'Desmontar o painel por ' +
        INLINE_UNMOUNT_LABELS[input.cause] +
        ' com ' +
        dirty.length +
        ' campo(s) nao salvo(s) perderia texto que o radiologista viu a si mesmo produzir. Persista antes: ' +
        (dirty.length ? dirty.join(', ') : 'rascunho em edicao') +
        '.'
    );
  }

  return inlineOk({
    cause: input.cause,
    mustPersistFieldIds: [],
    safeToUnmount: true,
    message: 'Painel pode ser desmontado (' + INLINE_UNMOUNT_LABELS[input.cause] + ').',
  });
}

/** One line for the inline panel header. */
export function inlineDescribePresentation(presentation: InlinePresentation): string {
  if (!presentation) {
    return '';
  }
  const blocking = inlineBlockingFields(presentation).length;
  const collapsed = presentation.sections.filter(s => s.collapsed).length;
  const parts = [
    INLINE_MODE_LABELS[presentation.mode],
    presentation.validatedFieldIds.length + ' campo(s)',
  ];
  if (collapsed) {
    parts.push(collapsed + ' secao(oes) recolhida(s)');
  }
  if (blocking) {
    parts.push(blocking + ' pendencia(s) bloqueante(s)');
  }
  return parts.join(' - ') + '.';
}
