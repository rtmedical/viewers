import {
  AI_CHECK_IDS,
  AI_HIGH_STAKES_SECTIONS,
  aiApplySuggestion,
  aiAssertReadyToSign,
  aiAssertSignable,
  aiAuditEntry,
  aiAvailability,
  aiCheckSeverity,
  aiDescribeSuggestion,
  aiDraftSegment,
  aiEvaluateSignability,
  aiIsDecided,
  aiRunQa,
  aiSummarizeFeedback,
  type AiAuditEntry,
  type AiDecision,
  type AiPolicy,
  type AiSegment,
  type AiSuggestion,
} from './aiCopilot';

const T0 = 1_760_000_000_000;

function policy(over: Partial<AiPolicy> = {}): AiPolicy {
  return {
    tenantId: 'HOSP1',
    enabled: true,
    enabledForRoles: ['radiologist'],
    modelId: 'rt-laudo',
    modelVersion: '2026.07.1',
    ...over,
  };
}

function suggestion(over: Partial<AiSuggestion> = {}): AiSuggestion {
  return {
    suggestionId: 'SUG-1',
    kind: 'impression',
    section: 'impression',
    proposedText: 'Nodulo pulmonar de 1,5 cm no lobo superior direito, provavelmente benigno.',
    modelId: 'rt-laudo',
    modelVersion: '2026.07.1',
    contextRef: 'ctx-abc123',
    producedAt: T0 - 10_000,
    reportVersion: 1,
    ...over,
  };
}

function decision(over: Partial<AiDecision> = {}): AiDecision {
  return {
    suggestionId: 'SUG-1',
    action: 'accept',
    decidedBy: 'CRM-SP-123456',
    decidedAt: T0,
    ...over,
  };
}

function segment(over: Partial<AiSegment> = {}): AiSegment {
  return {
    segmentId: 'SEG-1',
    section: 'findings',
    text: 'Nodulo de 1,5 cm.',
    provenance: 'human',
    ...over,
  };
}

/* ------------------------------------------------------------------ */

describe('aiAvailability fails closed', () => {
  it('is available for an enabled tenant and permitted role', () => {
    const result = aiAvailability(policy(), { role: 'radiologist', modality: 'CT' });
    expect(result.available).toBe(true);
  });

  it('is unavailable when the tenant disabled it', () => {
    expect(aiAvailability(policy({ enabled: false }), { role: 'radiologist', modality: 'CT' }).available).toBe(
      false
    );
  });

  it('grants nothing when the role allow-list is empty, rather than everything', () => {
    const result = aiAvailability(policy({ enabledForRoles: [] }), {
      role: 'radiologist',
      modality: 'CT',
    });
    expect(result.available).toBe(false);
  });

  it('is unavailable for a role that is not listed', () => {
    expect(
      aiAvailability(policy(), { role: 'resident', modality: 'CT' }).available
    ).toBe(false);
  });

  it('allows every modality when the modality list is absent', () => {
    expect(aiAvailability(policy(), { role: 'radiologist', modality: 'MG' }).available).toBe(true);
  });

  it('restricts to the listed modalities when they are given', () => {
    const restricted = policy({ enabledForModalities: ['CT', 'MR'] });
    expect(aiAvailability(restricted, { role: 'radiologist', modality: 'CT' }).available).toBe(true);
    expect(aiAvailability(restricted, { role: 'radiologist', modality: 'MG' }).available).toBe(false);
  });

  it('compares modality case-insensitively', () => {
    const restricted = policy({ enabledForModalities: ['ct'] });
    expect(aiAvailability(restricted, { role: 'radiologist', modality: 'CT' }).available).toBe(true);
  });

  it('refuses to run without a model identity, because nothing could be audited', () => {
    const result = aiAvailability(policy({ modelVersion: '' }), {
      role: 'radiologist',
      modality: 'CT',
    });
    expect(result.available).toBe(false);
    expect(result.reason).toContain('auditada');
  });

  it('is unavailable for a missing policy', () => {
    expect(aiAvailability(undefined as never, { role: 'radiologist', modality: 'CT' }).available).toBe(
      false
    );
  });
});

describe('aiCheckSeverity defaults to blocking', () => {
  it('treats an unconfigured check as blocking', () => {
    for (const check of AI_CHECK_IDS) {
      expect(aiCheckSeverity(policy(), check)).toBe('blocking');
    }
  });

  it('honours an explicit advisory setting', () => {
    const relaxed = policy({ checkSeverity: { 'missing-laterality': 'advisory' } });
    expect(aiCheckSeverity(relaxed, 'missing-laterality')).toBe('advisory');
  });

  it('keeps other checks blocking when one is relaxed', () => {
    const relaxed = policy({ checkSeverity: { 'missing-laterality': 'advisory' } });
    expect(aiCheckSeverity(relaxed, 'empty-impression')).toBe('blocking');
  });

  it('treats an explicit blocking setting as blocking', () => {
    const strict = policy({ checkSeverity: { 'empty-impression': 'blocking' } });
    expect(aiCheckSeverity(strict, 'empty-impression')).toBe('blocking');
  });
});

describe('aiDraftSegment', () => {
  it('produces content marked as undecided', () => {
    const result = aiDraftSegment({ segmentId: 'S1', section: 'findings', text: 'texto' });
    expect(result.ok).toBe(true);
    expect(result.value.provenance).toBe('ai-suggested');
  });

  it('refuses a draft with no text', () => {
    expect(aiDraftSegment({ segmentId: 'S1', section: 'findings', text: '  ' }).ok).toBe(false);
  });

  it('refuses a draft with an unknown section', () => {
    expect(aiDraftSegment({ segmentId: 'S1', section: 'resumo' as never, text: 'x' }).ok).toBe(false);
  });
});

describe('aiApplySuggestion, the per-suggestion gate', () => {
  it('accepts a suggestion and marks it accepted', () => {
    const result = aiApplySuggestion({
      suggestion: suggestion(),
      decision: decision(),
      currentReportVersion: 1,
      policy: policy(),
    });
    expect(result.ok).toBe(true);
    expect(result.value.provenance).toBe('ai-accepted');
    expect(result.value.appliedText).toContain('1,5 cm');
  });

  it('marks an edited suggestion as edited, not accepted', () => {
    const result = aiApplySuggestion({
      suggestion: suggestion(),
      decision: decision({ action: 'edit', editedText: 'Nodulo de 1,5 cm, indeterminado.' }),
      currentReportVersion: 1,
      policy: policy(),
    });
    expect(result.value.provenance).toBe('ai-edited');
    expect(result.value.appliedText).toContain('indeterminado');
  });

  it('produces no segment for a rejection', () => {
    const result = aiApplySuggestion({
      suggestion: suggestion(),
      decision: decision({ action: 'reject' }),
      currentReportVersion: 1,
      policy: policy(),
    });
    expect(result.ok).toBe(true);
    expect(result.value.segment).toBe(null);
    expect(result.value.appliedText).toBe('');
  });

  it('refuses an edit with no replacement text', () => {
    const result = aiApplySuggestion({
      suggestion: suggestion(),
      decision: decision({ action: 'edit', editedText: '   ' }),
      currentReportVersion: 1,
      policy: policy(),
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('missing-edit-text');
  });

  it('refuses a decision with nobody behind it', () => {
    const result = aiApplySuggestion({
      suggestion: suggestion(),
      decision: decision({ decidedBy: '  ' }),
      currentReportVersion: 1,
      policy: policy(),
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('unattributed-action');
  });

  it('refuses an unknown action', () => {
    const result = aiApplySuggestion({
      suggestion: suggestion(),
      decision: decision({ action: 'talvez' as never }),
      currentReportVersion: 1,
      policy: policy(),
    });
    expect(result.code).toBe('invalid-action');
  });

  it('refuses a decision that names a different suggestion', () => {
    const result = aiApplySuggestion({
      suggestion: suggestion(),
      decision: decision({ suggestionId: 'SUG-9' }),
      currentReportVersion: 1,
      policy: policy(),
    });
    expect(result.code).toBe('invalid-action');
  });

  it('refuses a second decision on the same suggestion', () => {
    const result = aiApplySuggestion({
      suggestion: suggestion(),
      decision: decision(),
      currentReportVersion: 1,
      policy: policy(),
      alreadyDecided: true,
    });
    expect(result.code).toBe('already-decided');
  });

  it('refuses a suggestion produced against an older report version', () => {
    const result = aiApplySuggestion({
      suggestion: suggestion({ reportVersion: 1 }),
      decision: decision(),
      currentReportVersion: 2,
      policy: policy(),
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('stale-suggestion');
    expect(result.reason).toContain('reintroduziria');
  });

  it('refuses when the copilot is disabled', () => {
    const result = aiApplySuggestion({
      suggestion: suggestion(),
      decision: decision(),
      currentReportVersion: 1,
      policy: policy({ enabled: false }),
    });
    expect(result.code).toBe('ai-disabled');
  });

  it('refuses an invalid timestamp', () => {
    const result = aiApplySuggestion({
      suggestion: suggestion(),
      decision: decision({ decidedAt: 0 }),
      currentReportVersion: 1,
      policy: policy(),
    });
    expect(result.code).toBe('invalid-timestamp');
  });

  it('refuses a suggestion with no text', () => {
    const result = aiApplySuggestion({
      suggestion: suggestion({ proposedText: '   ' }),
      decision: decision(),
      currentReportVersion: 1,
      policy: policy(),
    });
    expect(result.code).toBe('invalid-suggestion');
  });
});

describe('aiEvaluateSignability, the ticket in one function', () => {
  it('is signable when every segment was decided', () => {
    const report = aiEvaluateSignability([
      segment({ segmentId: 'A', provenance: 'human' }),
      segment({ segmentId: 'B', provenance: 'ai-accepted' }),
      segment({ segmentId: 'C', provenance: 'ai-edited' }),
    ]);
    expect(report.signable).toBe(true);
    expect(report.undecided.length).toBe(0);
  });

  it('blocks on a single undecided segment', () => {
    const report = aiEvaluateSignability([
      segment({ segmentId: 'A', provenance: 'human' }),
      segment({ segmentId: 'B', provenance: 'ai-suggested' }),
    ]);
    expect(report.signable).toBe(false);
    expect(report.undecided.length).toBe(1);
    expect(report.message).toContain('afirmacao assinada');
  });

  it('reports an undecided impression more loudly than an undecided finding', () => {
    const impression = aiEvaluateSignability([
      segment({ segmentId: 'A', section: 'impression', provenance: 'ai-suggested' }),
    ]);
    const findings = aiEvaluateSignability([
      segment({ segmentId: 'A', section: 'findings', provenance: 'ai-suggested' }),
    ]);
    expect(impression.undecidedHighStakes.length).toBe(1);
    expect(findings.undecidedHighStakes.length).toBe(0);
    expect(impression.message.length > findings.message.length).toBe(true);
  });

  it('treats a recommendation as high stakes too', () => {
    const report = aiEvaluateSignability([
      segment({ segmentId: 'A', section: 'recommendation', provenance: 'ai-suggested' }),
    ]);
    expect(report.undecidedHighStakes.length).toBe(1);
  });

  it('counts each provenance state', () => {
    const report = aiEvaluateSignability([
      segment({ segmentId: 'A', provenance: 'human' }),
      segment({ segmentId: 'B', provenance: 'human' }),
      segment({ segmentId: 'C', provenance: 'ai-accepted' }),
      segment({ segmentId: 'D', provenance: 'ai-suggested' }),
    ]);
    expect(report.counts.human).toBe(2);
    expect(report.counts['ai-accepted']).toBe(1);
    expect(report.counts['ai-suggested']).toBe(1);
  });

  it('treats an unrecognised provenance as undecided, not as human', () => {
    const report = aiEvaluateSignability([
      segment({ segmentId: 'A', provenance: 'probably-fine' as never }),
    ]);
    expect(report.signable).toBe(false);
  });

  it('is signable for an empty document, which is a different problem', () => {
    expect(aiEvaluateSignability([]).signable).toBe(true);
  });

  it('carries an excerpt so the UI can point at the text', () => {
    const report = aiEvaluateSignability([
      segment({ segmentId: 'A', provenance: 'ai-suggested', text: 'Sem alteracoes.' }),
    ]);
    expect(report.undecided[0].excerpt).toContain('Sem alteracoes');
  });

  it('aiAssertSignable turns the block into a refusal', () => {
    const result = aiAssertSignable([segment({ provenance: 'ai-suggested' })]);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('untouched-ai-content');
  });

  it('aiIsDecided agrees with the states that represent a human act', () => {
    expect(aiIsDecided('human')).toBe(true);
    expect(aiIsDecided('ai-accepted')).toBe(true);
    expect(aiIsDecided('ai-edited')).toBe(true);
    expect(aiIsDecided('ai-suggested')).toBe(false);
  });

  it('names the impression and recommendation as the high-stakes sections', () => {
    expect(AI_HIGH_STAKES_SECTIONS.indexOf('impression') >= 0).toBe(true);
    expect(AI_HIGH_STAKES_SECTIONS.indexOf('recommendation') >= 0).toBe(true);
    expect(AI_HIGH_STAKES_SECTIONS.indexOf('findings')).toBe(-1);
  });
});

describe('aiRunQa', () => {
  const impression = segment({
    segmentId: 'IMP',
    section: 'impression',
    text: 'Nodulo indeterminado.',
    provenance: 'human',
  });

  it('passes a clean report', () => {
    const result = aiRunQa({ segments: [impression], assertions: [] }, policy());
    expect(result.ok).toBe(true);
    expect(result.value.passed).toBe(true);
  });

  it('blocks an empty impression', () => {
    const result = aiRunQa({ segments: [segment()], assertions: [] }, policy());
    expect(result.value.passed).toBe(false);
    expect(result.value.blocking.some(f => f.check === 'empty-impression')).toBe(true);
  });

  it('blocks a missing laterality where it is required', () => {
    const result = aiRunQa(
      { segments: [impression], assertions: [{ segmentId: 'A', lateralityRequired: true }] },
      policy()
    );
    expect(result.value.blocking.some(f => f.check === 'missing-laterality')).toBe(true);
  });

  it('does not complain about laterality where it is not required', () => {
    const result = aiRunQa(
      { segments: [impression], assertions: [{ segmentId: 'A', lateralityRequired: false }] },
      policy()
    );
    expect(result.value.passed).toBe(true);
  });

  it('blocks a measurement with no unit', () => {
    const result = aiRunQa(
      { segments: [impression], assertions: [{ segmentId: 'A', measurementValue: 15 }] },
      policy()
    );
    expect(result.value.blocking.some(f => f.check === 'measurement-without-unit')).toBe(true);
  });

  it('accepts a measurement that carries its unit', () => {
    const result = aiRunQa(
      {
        segments: [impression],
        assertions: [{ segmentId: 'A', measurementValue: 15, measurementUnit: 'mm' }],
      },
      policy()
    );
    expect(result.value.passed).toBe(true);
  });

  it('flags a measurement of zero, which is a value and not an absence', () => {
    const result = aiRunQa(
      { segments: [impression], assertions: [{ segmentId: 'A', measurementValue: 0 }] },
      policy()
    );
    expect(result.value.blocking.some(f => f.check === 'measurement-without-unit')).toBe(true);
  });

  it('blocks a critical finding with no communication recorded', () => {
    const result = aiRunQa(
      { segments: [impression], assertions: [{ segmentId: 'A', critical: true }] },
      policy()
    );
    expect(result.value.blocking.some(f => f.check === 'critical-finding-not-communicated')).toBe(
      true
    );
  });

  it('accepts a critical finding once communication is recorded', () => {
    const result = aiRunQa(
      {
        segments: [impression],
        assertions: [{ segmentId: 'A', critical: true, communicatedAt: T0 }],
      },
      policy()
    );
    expect(result.value.passed).toBe(true);
  });

  it('blocks a contradiction, naming why nobody sees it', () => {
    const result = aiRunQa(
      { segments: [impression], assertions: [{ segmentId: 'A', contradictsImpression: true }] },
      policy()
    );
    const finding = result.value.blocking.filter(
      f => f.check === 'findings-impression-contradiction'
    )[0];
    expect(finding.detail).toContain('nenhum leitor isolado');
  });

  it('blocks an AI impression that was accepted without editing', () => {
    const result = aiRunQa(
      {
        segments: [{ ...impression, provenance: 'ai-accepted' }],
        assertions: [],
      },
      policy()
    );
    expect(result.value.blocking.some(f => f.check === 'untouched-ai-impression')).toBe(true);
  });

  it('does not flag an AI impression that was edited', () => {
    const result = aiRunQa(
      { segments: [{ ...impression, provenance: 'ai-edited' }], assertions: [] },
      policy()
    );
    expect(result.value.passed).toBe(true);
  });

  it('lets an institution downgrade a check to advisory', () => {
    const result = aiRunQa(
      { segments: [impression], assertions: [{ segmentId: 'A', lateralityRequired: true }] },
      policy({ checkSeverity: { 'missing-laterality': 'advisory' } })
    );
    expect(result.value.passed).toBe(true);
    expect(result.value.advisory.length).toBe(1);
  });

  it('refuses a policy with no institution', () => {
    const result = aiRunQa({ segments: [impression] }, policy({ tenantId: '' }));
    expect(result.ok).toBe(false);
    expect(result.code).toBe('invalid-policy');
  });

  it('reports several blocking findings at once', () => {
    const result = aiRunQa(
      {
        segments: [segment()],
        assertions: [{ segmentId: 'A', lateralityRequired: true, measurementValue: 3 }],
      },
      policy()
    );
    expect(result.value.blocking.length).toBe(3);
  });
});

describe('aiAssertReadyToSign', () => {
  const goodImpression = segment({
    segmentId: 'IMP',
    section: 'impression',
    text: 'Nodulo indeterminado.',
    provenance: 'human',
  });

  it('passes when machine content is decided and QA is clean', () => {
    expect(aiAssertReadyToSign({ segments: [goodImpression], assertions: [] }, policy()).ok).toBe(
      true
    );
  });

  it('checks provenance before QA, because unread machine text outranks a missing unit', () => {
    const result = aiAssertReadyToSign(
      {
        segments: [{ ...goodImpression, provenance: 'ai-suggested' }],
        assertions: [{ segmentId: 'A', measurementValue: 3 }],
      },
      policy()
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe('untouched-ai-content');
  });

  it('reports a QA block once provenance is settled', () => {
    const result = aiAssertReadyToSign(
      { segments: [goodImpression], assertions: [{ segmentId: 'A', measurementValue: 3 }] },
      policy()
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe('qa-blocking');
  });
});

describe('aiAuditEntry', () => {
  it('records everything needed to answer which model wrote a sentence', () => {
    const result = aiAuditEntry({
      reportId: 'LAU-77',
      suggestion: suggestion(),
      decision: decision(),
      policy: policy(),
    });
    expect(result.ok).toBe(true);
    expect(result.value.modelId).toBe('rt-laudo');
    expect(result.value.modelVersion).toBe('2026.07.1');
    expect(result.value.contextRef).toBe('ctx-abc123');
    expect(result.value.actorId).toBe('CRM-SP-123456');
    expect(result.value.action).toBe('accept');
    expect(result.value.complete).toBe(true);
  });

  it('refuses a record with no model version, which is what a withdrawal needs', () => {
    const result = aiAuditEntry({
      reportId: 'LAU-77',
      suggestion: suggestion({ modelVersion: '' }),
      decision: decision(),
      policy: policy({ modelVersion: '' }),
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('audit-incomplete');
    expect(result.reason).toContain('versao do modelo');
  });

  it('refuses a record with no context reference', () => {
    const result = aiAuditEntry({
      reportId: 'LAU-77',
      suggestion: suggestion({ contextRef: '' }),
      decision: decision(),
      policy: policy(),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('contexto');
  });

  it('refuses a record with no report', () => {
    const result = aiAuditEntry({
      reportId: '  ',
      suggestion: suggestion(),
      decision: decision(),
      policy: policy(),
    });
    expect(result.ok).toBe(false);
  });

  it('refuses a record with no actor', () => {
    const result = aiAuditEntry({
      reportId: 'LAU-77',
      suggestion: suggestion(),
      decision: decision({ decidedBy: '' }),
      policy: policy(),
    });
    expect(result.ok).toBe(false);
  });

  it('falls back to the policy model identity when the suggestion omits it', () => {
    const result = aiAuditEntry({
      reportId: 'LAU-77',
      suggestion: suggestion({ modelId: '', modelVersion: '' }),
      decision: decision(),
      policy: policy(),
    });
    expect(result.ok).toBe(true);
    expect(result.value.modelId).toBe('rt-laudo');
  });

  it('keeps the edited text on an edit decision', () => {
    const result = aiAuditEntry({
      reportId: 'LAU-77',
      suggestion: suggestion(),
      decision: decision({ action: 'edit', editedText: 'texto revisto' }),
      policy: policy(),
    });
    expect(result.value.editedText).toBe('texto revisto');
  });

  it('does not keep edited text on an accept', () => {
    const result = aiAuditEntry({
      reportId: 'LAU-77',
      suggestion: suggestion(),
      decision: decision({ editedText: 'ignorado' }),
      policy: policy(),
    });
    expect(result.value.editedText).toBe(undefined);
  });

  it('keeps a rejection reason when one was given', () => {
    const result = aiAuditEntry({
      reportId: 'LAU-77',
      suggestion: suggestion(),
      decision: decision({ action: 'reject', reason: 'lateralidade errada' }),
      policy: policy(),
    });
    expect(result.value.reason).toBe('lateralidade errada');
  });

  it('lists every gap at once rather than the first', () => {
    const result = aiAuditEntry({
      reportId: '',
      suggestion: suggestion({ contextRef: '', modelVersion: '' }),
      decision: decision({ decidedBy: '' }),
      policy: policy({ modelVersion: '', tenantId: '' }),
    });
    expect(result.ok).toBe(false);
    expect(result.reason.split(',').length >= 4).toBe(true);
  });
});

describe('aiSummarizeFeedback', () => {
  function entry(action: 'accept' | 'reject' | 'edit', version = '2026.07.1'): AiAuditEntry {
    return {
      reportId: 'LAU-1',
      suggestionId: 'S',
      kind: 'impression',
      section: 'impression',
      modelId: 'rt-laudo',
      modelVersion: version,
      contextRef: 'ctx',
      tenantId: 'HOSP1',
      action,
      actorId: 'CRM',
      at: T0,
      complete: true,
      gaps: [],
    };
  }

  it('reports acceptance and usefulness separately', () => {
    const summary = aiSummarizeFeedback([
      entry('accept'),
      entry('edit'),
      entry('edit'),
      entry('reject'),
    ]);
    expect(summary.acceptanceRate).toBe(0.25);
    expect(summary.usefulnessRate).toBe(0.75);
  });

  it('does not divide by zero', () => {
    const summary = aiSummarizeFeedback([]);
    expect(summary.acceptanceRate).toBe(null);
    expect(summary.usefulnessRate).toBe(null);
    expect(summary.message).toContain('Nenhuma');
  });

  it('breaks the counts down by model version, which is the unit that changes', () => {
    const summary = aiSummarizeFeedback([
      entry('accept', '2026.07.1'),
      entry('reject', '2026.08.1'),
    ]);
    expect(summary.byModelVersion['rt-laudo@2026.07.1'].accepted).toBe(1);
    expect(summary.byModelVersion['rt-laudo@2026.08.1'].rejected).toBe(1);
  });

  it('counts the total from the three actions', () => {
    const summary = aiSummarizeFeedback([entry('accept'), entry('edit'), entry('reject')]);
    expect(summary.total).toBe(3);
  });

  it('tolerates a missing list', () => {
    expect(aiSummarizeFeedback(undefined as never).total).toBe(0);
  });
});

describe('aiDescribeSuggestion', () => {
  it('names the section, the model and the obligation', () => {
    const text = aiDescribeSuggestion(suggestion());
    expect(text).toContain('impressao');
    expect(text).toContain('2026.07.1');
    expect(text).toContain('aceitar');
  });

  it('is empty for no suggestion', () => {
    expect(aiDescribeSuggestion(undefined as never)).toBe('');
  });
});
