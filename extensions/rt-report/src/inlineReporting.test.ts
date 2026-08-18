import {
  INLINE_RT_CHROME,
  INLINE_RT_MODALITIES,
  inlineAssertSameObligations,
  inlineBlockingFields,
  inlineDescribePresentation,
  inlineFilterTemplates,
  inlinePlanPresentation,
  inlinePlanUnmount,
  inlineSuppressRtChrome,
  inlineTemplateEligible,
  type InlineStudyContext,
  type InlineTemplate,
  type InlineTemplateField,
} from './inlineReporting';

const FIELDS: InlineTemplateField[] = [
  { fieldId: 'tecnica', label: 'Tecnica', section: 'tecnica' },
  { fieldId: 'pulmoes', label: 'Pulmoes', section: 'achados', assertive: true },
  { fieldId: 'mediastino', label: 'Mediastino', section: 'achados', assertive: true },
  { fieldId: 'ossos', label: 'Ossos', section: 'achados' },
  { fieldId: 'impressao', label: 'Impressao', section: 'impressao', required: true },
];

function radiology(over: Partial<InlineTemplate> = {}): InlineTemplate {
  return {
    templateId: 'RX-TORAX',
    version: 1,
    title: 'Torax CT diagnostico',
    domain: 'radiology',
    modalities: ['CT'],
    fields: FIELDS,
    approved: true,
    ...over,
  };
}

function rtTemplate(over: Partial<InlineTemplate> = {}): InlineTemplate {
  return {
    templateId: 'RT-TORAX',
    version: 1,
    title: 'Torax plano de tratamento',
    domain: 'radiotherapy',
    modalities: ['CT'],
    fields: [
      { fieldId: 'dose', label: 'Dose prescrita', section: 'prescricao', assertive: true },
      { fieldId: 'fracionamento', label: 'Fracionamento', section: 'prescricao' },
    ],
    approved: true,
    ...over,
  };
}

function context(over: Partial<InlineStudyContext> = {}): InlineStudyContext {
  return { modality: 'CT', readDomain: 'radiology', ...over };
}

/* ------------------------------------------------------------------ */

describe('inlineTemplateEligible decides by domain, never by title', () => {
  it('accepts a radiology template for a radiology read', () => {
    expect(inlineTemplateEligible(radiology(), context()).ok).toBe(true);
  });

  it('refuses an RT template for a radiology read even when the title matches the body part', () => {
    const result = inlineTemplateEligible(rtTemplate(), context());
    expect(result.ok).toBe(false);
    expect(result.code).toBe('wrong-domain');
    expect(result.reason).toContain('plano de tratamento');
  });

  it('refuses a radiology template for a radiotherapy read', () => {
    const result = inlineTemplateEligible(radiology(), context({ readDomain: 'radiotherapy' }));
    expect(result.ok).toBe(false);
    expect(result.code).toBe('wrong-domain');
  });

  it('refuses a template with no declared domain, naming the title ambiguity', () => {
    const result = inlineTemplateEligible(radiology({ domain: undefined as never }), context());
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('inferido do titulo');
  });

  it('refuses an unapproved template', () => {
    const result = inlineTemplateEligible(radiology({ approved: false }), context());
    expect(result.ok).toBe(false);
    expect(result.code).toBe('template-not-approved');
  });

  it('refuses a modality the template was not written for', () => {
    const result = inlineTemplateEligible(radiology({ modalities: ['MR'] }), context());
    expect(result.ok).toBe(false);
    expect(result.code).toBe('modality-mismatch');
  });

  it('accepts any modality when the template lists none', () => {
    expect(inlineTemplateEligible(radiology({ modalities: [] }), context()).ok).toBe(true);
  });

  it('compares modality case-insensitively', () => {
    expect(
      inlineTemplateEligible(radiology({ modalities: ['ct'] }), context({ modality: 'CT' })).ok
    ).toBe(true);
  });

  it('refuses a template with no fields', () => {
    expect(inlineTemplateEligible(radiology({ fields: [] }), context()).code).toBe(
      'invalid-template'
    );
  });

  it('refuses a context with no modality', () => {
    expect(inlineTemplateEligible(radiology(), context({ modality: '' })).code).toBe(
      'invalid-context'
    );
  });

  it('refuses a context with no read domain', () => {
    const result = inlineTemplateEligible(
      radiology(),
      context({ readDomain: undefined as never })
    );
    expect(result.code).toBe('invalid-context');
  });
});

describe('inlineFilterTemplates explains an empty picker', () => {
  it('keeps only the eligible templates', () => {
    const result = inlineFilterTemplates([radiology(), rtTemplate()], context());
    expect(result.ok).toBe(true);
    expect(result.value.eligible.length).toBe(1);
    expect(result.value.eligible[0].templateId).toBe('RX-TORAX');
  });

  it('records why each template was rejected', () => {
    const result = inlineFilterTemplates([radiology(), rtTemplate()], context());
    expect(result.value.rejected.length).toBe(1);
    expect(result.value.rejected[0].code).toBe('wrong-domain');
    expect(result.value.rejected[0].templateId).toBe('RT-TORAX');
  });

  it('refuses with an explanation when nothing is eligible', () => {
    const result = inlineFilterTemplates([rtTemplate()], context());
    expect(result.ok).toBe(false);
    expect(result.code).toBe('no-eligible-template');
    expect(result.reason).toContain('wrong-domain');
  });

  it('says the library is empty when it is', () => {
    const result = inlineFilterTemplates([], context());
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('vazia');
  });

  it('tolerates a missing list', () => {
    expect(inlineFilterTemplates(undefined as never, context()).ok).toBe(false);
  });

  it('offers the RT template for a radiotherapy read', () => {
    const result = inlineFilterTemplates(
      [radiology(), rtTemplate()],
      context({ readDomain: 'radiotherapy' })
    );
    expect(result.value.eligible[0].templateId).toBe('RT-TORAX');
  });
});

describe('inlinePlanPresentation collapses but never omits', () => {
  it('validates every field in inline mode', () => {
    const result = inlinePlanPresentation({ template: radiology(), mode: 'inline' });
    expect(result.ok).toBe(true);
    expect(result.value.validatedFieldIds.length).toBe(FIELDS.length);
  });

  it('validates every field even with sections collapsed', () => {
    const result = inlinePlanPresentation({
      template: radiology(),
      mode: 'inline',
      collapsedSections: ['tecnica', 'achados', 'impressao'],
      answeredFieldIds: ['impressao'],
      confirmedAssertiveFieldIds: ['pulmoes', 'mediastino'],
    });
    expect(result.value.validatedFieldIds.length).toBe(FIELDS.length);
  });

  it('collapses a section with nothing blocking in it', () => {
    const result = inlinePlanPresentation({
      template: radiology(),
      mode: 'inline',
      collapsedSections: ['tecnica'],
    });
    const tecnica = result.value.sections.filter(s => s.section === 'tecnica')[0];
    expect(tecnica.collapsed).toBe(true);
    expect(tecnica.forcedOpen).toBe(false);
  });

  it('forces open a collapsed section holding an unconfirmed assertive field', () => {
    const result = inlinePlanPresentation({
      template: radiology(),
      mode: 'inline',
      collapsedSections: ['achados'],
    });
    const achados = result.value.sections.filter(s => s.section === 'achados')[0];
    expect(achados.forcedOpen).toBe(true);
    expect(achados.collapsed).toBe(false);
    expect(achados.blockingFieldIds).toEqual(['pulmoes', 'mediastino']);
  });

  it('says why a section was reopened', () => {
    const result = inlinePlanPresentation({
      template: radiology(),
      mode: 'inline',
      collapsedSections: ['achados'],
    });
    expect(result.value.message).toContain('por que a assinatura esta recusada');
  });

  it('allows the section to stay collapsed once the assertive fields are confirmed', () => {
    const result = inlinePlanPresentation({
      template: radiology(),
      mode: 'inline',
      collapsedSections: ['achados'],
      confirmedAssertiveFieldIds: ['pulmoes', 'mediastino'],
    });
    const achados = result.value.sections.filter(s => s.section === 'achados')[0];
    expect(achados.collapsed).toBe(true);
    expect(achados.blockingFieldIds).toEqual([]);
  });

  it('forces open a section with an unanswered required field', () => {
    const result = inlinePlanPresentation({
      template: radiology(),
      mode: 'inline',
      collapsedSections: ['impressao'],
      confirmedAssertiveFieldIds: ['pulmoes', 'mediastino'],
    });
    const impressao = result.value.sections.filter(s => s.section === 'impressao')[0];
    expect(impressao.forcedOpen).toBe(true);
  });

  it('stops treating a required field as blocking once answered', () => {
    const result = inlinePlanPresentation({
      template: radiology(),
      mode: 'inline',
      collapsedSections: ['impressao'],
      answeredFieldIds: ['impressao'],
      confirmedAssertiveFieldIds: ['pulmoes', 'mediastino'],
    });
    const impressao = result.value.sections.filter(s => s.section === 'impressao')[0];
    expect(impressao.collapsed).toBe(true);
  });

  it('groups fields into sections in template order', () => {
    const result = inlinePlanPresentation({ template: radiology(), mode: 'inline' });
    expect(result.value.sections.map(s => s.section)).toEqual([
      'tecnica',
      'achados',
      'impressao',
    ]);
  });

  it('puts a field with no section into a general one', () => {
    const result = inlinePlanPresentation({
      template: radiology({
        fields: [{ fieldId: 'solto', label: 'Solto', section: '' }],
      }),
      mode: 'inline',
    });
    expect(result.value.sections[0].section).toBe('geral');
  });

  it('reports every blocking field regardless of collapse', () => {
    const result = inlinePlanPresentation({
      template: radiology(),
      mode: 'inline',
      collapsedSections: ['achados', 'impressao'],
    });
    expect(inlineBlockingFields(result.value).sort()).toEqual([
      'impressao',
      'mediastino',
      'pulmoes',
    ]);
  });

  it('refuses a template with no fields', () => {
    expect(inlinePlanPresentation({ template: radiology({ fields: [] }), mode: 'inline' }).code).toBe(
      'invalid-template'
    );
  });

  it('refuses with no template', () => {
    expect(
      inlinePlanPresentation({ template: undefined as never, mode: 'inline' }).code
    ).toBe('invalid-template');
  });

  it('treats an unknown mode as inline', () => {
    const result = inlinePlanPresentation({ template: radiology(), mode: 'popup' as never });
    expect(result.value.mode).toBe('inline');
  });

  it('returns nothing blocking for a missing presentation', () => {
    expect(inlineBlockingFields(undefined as never)).toEqual([]);
  });
});

describe('inlineAssertSameObligations', () => {
  it('accepts two presentations of the same template', () => {
    const inline = inlinePlanPresentation({ template: radiology(), mode: 'inline' }).value;
    const full = inlinePlanPresentation({ template: radiology(), mode: 'fullscreen' }).value;
    const result = inlineAssertSameObligations(inline, full);
    expect(result.ok).toBe(true);
    expect(result.value.length).toBe(FIELDS.length);
  });

  it('accepts them even when the inline one has collapsed sections', () => {
    const inline = inlinePlanPresentation({
      template: radiology(),
      mode: 'inline',
      collapsedSections: ['tecnica'],
    }).value;
    const full = inlinePlanPresentation({ template: radiology(), mode: 'fullscreen' }).value;
    expect(inlineAssertSameObligations(inline, full).ok).toBe(true);
  });

  it('refuses when the inline panel dropped a field', () => {
    const reduced = radiology({ fields: FIELDS.filter(f => f.fieldId !== 'ossos') });
    const inline = inlinePlanPresentation({ template: reduced, mode: 'inline' }).value;
    const full = inlinePlanPresentation({ template: radiology(), mode: 'fullscreen' }).value;
    const result = inlineAssertSameObligations(inline, full);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('obligations-diverged');
    expect(result.reason).toContain('ossos');
  });

  it('names the direction of the divergence', () => {
    const reduced = radiology({ fields: FIELDS.filter(f => f.fieldId !== 'ossos') });
    const inline = inlinePlanPresentation({ template: reduced, mode: 'inline' }).value;
    const full = inlinePlanPresentation({ template: radiology(), mode: 'fullscreen' }).value;
    expect(inlineAssertSameObligations(inline, full).reason).toContain('painel lateral');
  });

  it('says why the divergence is invisible in production', () => {
    const reduced = radiology({ fields: FIELDS.filter(f => f.fieldId !== 'ossos') });
    const inline = inlinePlanPresentation({ template: reduced, mode: 'inline' }).value;
    const full = inlinePlanPresentation({ template: radiology(), mode: 'fullscreen' }).value;
    expect(inlineAssertSameObligations(inline, full).reason).toContain('os dois salvam');
  });

  it('refuses when one presentation is missing', () => {
    const full = inlinePlanPresentation({ template: radiology(), mode: 'fullscreen' }).value;
    expect(inlineAssertSameObligations(undefined as never, full).ok).toBe(false);
  });
});

describe('inlineSuppressRtChrome separates chrome from data', () => {
  it('suppresses the radiotherapy toolbar for a diagnostic read', () => {
    const decision = inlineSuppressRtChrome(context());
    expect(decision.suppressedChrome.length).toBe(INLINE_RT_CHROME.length);
  });

  it('keeps RT objects visible and warns that the patient is under treatment', () => {
    const decision = inlineSuppressRtChrome(
      context({ additionalModalities: ['RTSTRUCT', 'RTPLAN'] })
    );
    expect(decision.visibleRtData).toEqual(['RTSTRUCT', 'RTPLAN']);
    expect(decision.warnings.join(' ')).toContain('sob tratamento');
    expect(decision.warnings.join(' ')).toContain('o dado, nao');
  });

  it('does not warn when the study carries no RT objects', () => {
    const decision = inlineSuppressRtChrome(context({ additionalModalities: ['CT'] }));
    expect(decision.visibleRtData).toEqual([]);
    expect(decision.warnings.length).toBe(0);
  });

  it('suppresses nothing for a radiotherapy read', () => {
    const decision = inlineSuppressRtChrome(
      context({ readDomain: 'radiotherapy', additionalModalities: ['RTPLAN'] })
    );
    expect(decision.suppressedChrome.length).toBe(0);
    expect(decision.visibleRtData).toEqual(['RTPLAN']);
  });

  it('recognises every RT modality it lists', () => {
    const decision = inlineSuppressRtChrome(
      context({ additionalModalities: INLINE_RT_MODALITIES.slice() })
    );
    expect(decision.visibleRtData.length).toBe(INLINE_RT_MODALITIES.length);
  });

  it('is case-insensitive about modalities', () => {
    const decision = inlineSuppressRtChrome(context({ additionalModalities: ['rtstruct'] }));
    expect(decision.visibleRtData).toEqual(['RTSTRUCT']);
  });

  it('defaults to a radiology read for a missing context', () => {
    const decision = inlineSuppressRtChrome(undefined as never);
    expect(decision.suppressedChrome.length).toBe(INLINE_RT_CHROME.length);
  });
});

describe('inlinePlanUnmount refuses to drop a draft', () => {
  const draft = { reportId: 'LAU-1', dirtyFieldIds: ['achados'], unsavedChars: 42 };

  it('allows an unmount with nothing unsaved', () => {
    const result = inlinePlanUnmount({
      cause: 'layout-change',
      draft: { reportId: 'LAU-1', dirtyFieldIds: [], unsavedChars: 0 },
    });
    expect(result.ok).toBe(true);
    expect(result.value.safeToUnmount).toBe(true);
  });

  it('refuses a hanging-protocol change with a dirty field', () => {
    const result = inlinePlanUnmount({ cause: 'hanging-protocol-change', draft });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('draft-would-be-lost');
    expect(result.reason).toContain('viu a si mesmo produzir');
  });

  it('refuses a layout change with a dirty field', () => {
    expect(inlinePlanUnmount({ cause: 'layout-change', draft }).ok).toBe(false);
  });

  it('refuses a collapsed sidebar with a dirty field', () => {
    expect(inlinePlanUnmount({ cause: 'sidebar-collapsed', draft }).ok).toBe(false);
  });

  it('refuses a closed study too, which is when a draft is most likely forgotten', () => {
    expect(inlinePlanUnmount({ cause: 'study-closed', draft }).ok).toBe(false);
  });

  it('names the fields to persist', () => {
    const result = inlinePlanUnmount({
      cause: 'layout-change',
      draft: { reportId: 'LAU-1', dirtyFieldIds: ['achados', 'impressao'], unsavedChars: 10 },
    });
    expect(result.reason).toContain('achados');
    expect(result.reason).toContain('impressao');
  });

  it('refuses on unsaved characters even with no field flagged dirty', () => {
    const result = inlinePlanUnmount({
      cause: 'layout-change',
      draft: { reportId: 'LAU-1', dirtyFieldIds: [], unsavedChars: 5 },
    });
    expect(result.ok).toBe(false);
  });

  it('allows the unmount once the caller persisted', () => {
    const result = inlinePlanUnmount({ cause: 'layout-change', draft, persisted: true });
    expect(result.ok).toBe(true);
  });

  it('refuses an unknown cause', () => {
    expect(inlinePlanUnmount({ cause: 'gremlin' as never, draft }).code).toBe('invalid-context');
  });

  it('treats a missing draft as clean', () => {
    const result = inlinePlanUnmount({ cause: 'layout-change', draft: undefined as never });
    expect(result.ok).toBe(true);
  });
});

describe('inlineDescribePresentation', () => {
  it('names the mode, field count and blocking count', () => {
    const presentation = inlinePlanPresentation({ template: radiology(), mode: 'inline' }).value;
    const text = inlineDescribePresentation(presentation);
    expect(text).toContain('painel lateral');
    expect(text).toContain('5 campo(s)');
    expect(text).toContain('3 pendencia(s)');
  });

  it('mentions collapsed sections', () => {
    const presentation = inlinePlanPresentation({
      template: radiology(),
      mode: 'inline',
      collapsedSections: ['tecnica'],
    }).value;
    expect(inlineDescribePresentation(presentation)).toContain('recolhida');
  });

  it('is empty for no presentation', () => {
    expect(inlineDescribePresentation(undefined as never)).toBe('');
  });
});
