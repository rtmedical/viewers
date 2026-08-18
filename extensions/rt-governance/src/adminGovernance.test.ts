import {
  GOV_MACRO_SCOPE_PRECEDENCE,
  govApproveTemplate,
  govAssertiveFields,
  govAuditEntry,
  govChangeAiPolicy,
  govDescribeTemplate,
  govEditTemplate,
  govImportTemplate,
  govIsUsable,
  govPackIsUsable,
  govResolveMacros,
  govResolvePackForReport,
  govRetirePackVersion,
  govRetireTemplate,
  type GovMacro,
  type GovPackVersion,
  type GovTemplateField,
  type GovTemplateVersion,
} from './adminGovernance';

const T0 = 1_760_000_000_000;

const FIELDS: GovTemplateField[] = [
  { fieldId: 'tecnica', label: 'Tecnica' },
  { fieldId: 'pulmoes', label: 'Pulmoes', assertive: true },
  { fieldId: 'mediastino', label: 'Mediastino', assertive: true },
  { fieldId: 'impressao', label: 'Impressao' },
];

function draft(over: Partial<GovTemplateVersion> = {}): GovTemplateVersion {
  return {
    templateId: 'TX-TORAX',
    version: 1,
    title: 'Torax CT',
    origin: 'local',
    lifecycle: 'draft',
    fields: FIELDS,
    createdBy: 'ADM-1',
    createdAt: T0 - 86_400_000,
    ...over,
  };
}

function approved(over: Partial<GovTemplateVersion> = {}): GovTemplateVersion {
  const result = govApproveTemplate({
    template: draft(),
    approvedBy: 'CRM-SP-123456',
    registration: 'CRM-SP-123456',
    approvedAt: T0,
    acknowledgedAssertiveFields: ['pulmoes', 'mediastino'],
    justification: 'Redacao revisada pela chefia de torax.',
  });
  if (!result.ok) {
    throw new Error('fixture broken: ' + result.reason);
  }
  return { ...result.value, ...over };
}

function pack(over: Partial<GovPackVersion> = {}): GovPackVersion {
  return {
    packId: 'LUNG-RADS',
    version: '2022.1',
    source: 'acr',
    lifecycle: 'approved',
    elementIds: ['RDE818'],
    approval: {
      approvedBy: 'CRM-SP-123456',
      registration: 'CRM-SP-123456',
      approvedAt: T0,
      acknowledgedAssertiveFields: [],
      justification: 'Validado clinicamente.',
    },
    importedAt: T0 - 86_400_000,
    ...over,
  };
}

function macro(over: Partial<GovMacro> = {}): GovMacro {
  return {
    macroId: 'M1',
    trigger: 'normaltorax',
    expansion: 'Pulmoes e mediastino sem alteracoes.',
    scope: 'institution',
    ownerId: 'HOSP1',
    ...over,
  };
}

/* ------------------------------------------------------------------ */

describe('govImportTemplate always lands as draft', () => {
  it('imports an MRRT template as a draft', () => {
    const result = govImportTemplate({
      templateId: 'TX-MRRT',
      title: 'Torax RadReport',
      origin: 'mrrt-import',
      fields: FIELDS,
      importedBy: 'ADM-1',
      importedAt: T0,
    });
    expect(result.ok).toBe(true);
    expect(result.value.lifecycle).toBe('draft');
    expect(result.value.version).toBe(1);
  });

  it('cannot be made to import as approved, because there is no such parameter', () => {
    const result = govImportTemplate({
      templateId: 'TX-MRRT',
      title: 'Torax',
      origin: 'mrrt-import',
      fields: FIELDS,
      importedBy: 'ADM-1',
      importedAt: T0,
      lifecycle: 'approved',
    } as never);
    expect(result.value.lifecycle).toBe('draft');
  });

  it('refuses an import with no fields', () => {
    const result = govImportTemplate({
      templateId: 'TX',
      title: 'T',
      origin: 'mrrt-import',
      fields: [],
      importedBy: 'ADM-1',
      importedAt: T0,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('invalid-template');
  });

  it('refuses an unattributed import', () => {
    const result = govImportTemplate({
      templateId: 'TX',
      title: 'T',
      origin: 'mrrt-import',
      fields: FIELDS,
      importedBy: '  ',
      importedAt: T0,
    });
    expect(result.code).toBe('unattributed');
  });

  it('refuses an unknown origin', () => {
    const result = govImportTemplate({
      templateId: 'TX',
      title: 'T',
      origin: 'email' as never,
      fields: FIELDS,
      importedBy: 'ADM-1',
      importedAt: T0,
    });
    expect(result.code).toBe('invalid-template');
  });

  it('refuses an invalid timestamp', () => {
    const result = govImportTemplate({
      templateId: 'TX',
      title: 'T',
      origin: 'local',
      fields: FIELDS,
      importedBy: 'ADM-1',
      importedAt: 0,
    });
    expect(result.code).toBe('invalid-timestamp');
  });
});

describe('govEditTemplate forks an approved version', () => {
  it('edits a draft in place', () => {
    const result = govEditTemplate({
      template: draft(),
      edit: { title: 'Torax CT revisado' },
      editedBy: 'ADM-1',
      editedAt: T0,
    });
    expect(result.ok).toBe(true);
    expect(result.value.forked).toBe(false);
    expect(result.value.template.version).toBe(1);
    expect(result.value.template.title).toBe('Torax CT revisado');
  });

  it('forks instead of mutating an approved version', () => {
    const result = govEditTemplate({
      template: approved(),
      edit: { title: 'Torax CT 2027' },
      editedBy: 'ADM-1',
      editedAt: T0 + 1000,
    });
    expect(result.ok).toBe(true);
    expect(result.value.forked).toBe(true);
    expect(result.value.template.version).toBe(2);
    expect(result.value.template.lifecycle).toBe('draft');
    expect(result.value.template.forkedFromVersion).toBe(1);
  });

  it('says why it forked, naming the signed reports', () => {
    const result = govEditTemplate({
      template: approved(),
      edit: { title: 'x' },
      editedBy: 'ADM-1',
      editedAt: T0 + 1000,
    });
    expect(result.value.message).toContain('laudos assinados');
  });

  it('does not carry the approval onto the fork', () => {
    const result = govEditTemplate({
      template: approved(),
      edit: { title: 'x' },
      editedBy: 'ADM-1',
      editedAt: T0 + 1000,
    });
    expect(result.value.template.approval).toBe(undefined);
  });

  it('refuses to edit a retired version', () => {
    const result = govEditTemplate({
      template: draft({ lifecycle: 'retired' }),
      edit: { title: 'x' },
      editedBy: 'ADM-1',
      editedAt: T0,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('not-draft');
  });

  it('refuses an edit that would leave no fields', () => {
    const result = govEditTemplate({
      template: draft(),
      edit: { fields: [] },
      editedBy: 'ADM-1',
      editedAt: T0,
    });
    expect(result.code).toBe('invalid-template');
  });

  it('refuses an edit that would leave no title', () => {
    const result = govEditTemplate({
      template: draft(),
      edit: { title: '   ' },
      editedBy: 'ADM-1',
      editedAt: T0,
    });
    expect(result.code).toBe('invalid-template');
  });

  it('leaves the fields alone when the edit does not mention them', () => {
    const result = govEditTemplate({
      template: draft(),
      edit: { title: 'novo' },
      editedBy: 'ADM-1',
      editedAt: T0,
    });
    expect(result.value.template.fields.length).toBe(FIELDS.length);
  });

  it('refuses an unattributed edit', () => {
    expect(
      govEditTemplate({ template: draft(), edit: {}, editedBy: '', editedAt: T0 }).code
    ).toBe('unattributed');
  });
});

describe('govApproveTemplate requires a clinical act', () => {
  it('approves a draft with a registration and acknowledgements', () => {
    const result = govApproveTemplate({
      template: draft(),
      approvedBy: 'CRM-SP-123456',
      registration: 'CRM-SP-123456',
      approvedAt: T0,
      acknowledgedAssertiveFields: ['pulmoes', 'mediastino'],
      justification: 'Revisado.',
    });
    expect(result.ok).toBe(true);
    expect(result.value.lifecycle).toBe('approved');
    expect(result.value.approval.registration).toBe('CRM-SP-123456');
  });

  it('refuses an approval with no professional registration', () => {
    const result = govApproveTemplate({
      template: draft(),
      approvedBy: 'ADM-TI',
      registration: '',
      approvedAt: T0,
      acknowledgedAssertiveFields: ['pulmoes', 'mediastino'],
      justification: 'Revisado.',
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('missing-registration');
    expect(result.reason).toContain('ato clinico');
  });

  it('refuses when the assertive fields were not acknowledged', () => {
    const result = govApproveTemplate({
      template: draft(),
      approvedBy: 'CRM-SP-123456',
      registration: 'CRM-SP-123456',
      approvedAt: T0,
      justification: 'Revisado.',
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('assertive-not-acknowledged');
    expect(result.reason).toContain('sem serem lidos');
  });

  it('refuses when only some assertive fields were acknowledged', () => {
    const result = govApproveTemplate({
      template: draft(),
      approvedBy: 'CRM-SP-123456',
      registration: 'CRM-SP-123456',
      approvedAt: T0,
      acknowledgedAssertiveFields: ['pulmoes'],
      justification: 'Revisado.',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('mediastino');
  });

  it('needs no acknowledgement for a template with no assertive fields', () => {
    const result = govApproveTemplate({
      template: draft({ fields: [{ fieldId: 'tecnica', label: 'Tecnica' }] }),
      approvedBy: 'CRM-SP-123456',
      registration: 'CRM-SP-123456',
      approvedAt: T0,
      justification: 'Revisado.',
    });
    expect(result.ok).toBe(true);
  });

  it('refuses the author approving their own version', () => {
    const result = govApproveTemplate({
      template: draft({ createdBy: 'CRM-SP-123456' }),
      approvedBy: 'crm-sp-123456',
      registration: 'CRM-SP-123456',
      approvedAt: T0,
      acknowledgedAssertiveFields: ['pulmoes', 'mediastino'],
      justification: 'Revisado.',
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('self-approval');
  });

  it('refuses approving something that is not a draft', () => {
    const result = govApproveTemplate({
      template: approved(),
      approvedBy: 'CRM-SP-999',
      registration: 'CRM-SP-999',
      approvedAt: T0,
      acknowledgedAssertiveFields: ['pulmoes', 'mediastino'],
      justification: 'Revisado.',
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('not-draft');
  });

  it('refuses an approval with no justification', () => {
    const result = govApproveTemplate({
      template: draft(),
      approvedBy: 'CRM-SP-123456',
      registration: 'CRM-SP-123456',
      approvedAt: T0,
      acknowledgedAssertiveFields: ['pulmoes', 'mediastino'],
      justification: '  ',
    });
    expect(result.code).toBe('missing-justification');
  });

  it('records every assertive field as acknowledged, not just the ones passed', () => {
    const result = govApproveTemplate({
      template: draft(),
      approvedBy: 'CRM-SP-123456',
      registration: 'CRM-SP-123456',
      approvedAt: T0,
      acknowledgedAssertiveFields: ['pulmoes', 'mediastino'],
      justification: 'Revisado.',
    });
    expect(result.value.approval.acknowledgedAssertiveFields).toEqual(['pulmoes', 'mediastino']);
  });

  it('lists the assertive fields of a template', () => {
    expect(govAssertiveFields(draft()).length).toBe(2);
  });
});

describe('govRetireTemplate and govIsUsable', () => {
  it('retires an approved version', () => {
    const result = govRetireTemplate({
      template: approved(),
      retiredBy: 'ADM-1',
      retiredAt: T0 + 1000,
      justification: 'Substituido pela v2.',
    });
    expect(result.ok).toBe(true);
    expect(result.value.lifecycle).toBe('retired');
  });

  it('keeps the approval record after retirement, so a signed report still resolves', () => {
    const result = govRetireTemplate({
      template: approved(),
      retiredBy: 'ADM-1',
      retiredAt: T0 + 1000,
      justification: 'Substituido.',
    });
    expect(result.value.approval).toBeDefined();
  });

  it('refuses a retirement with no justification', () => {
    expect(
      govRetireTemplate({
        template: approved(),
        retiredBy: 'ADM-1',
        retiredAt: T0,
        justification: '',
      }).code
    ).toBe('missing-justification');
  });

  it('only treats an approved version as usable for a new report', () => {
    expect(govIsUsable(approved())).toBe(true);
    expect(govIsUsable(draft())).toBe(false);
    expect(govIsUsable(draft({ lifecycle: 'retired' }))).toBe(false);
  });
});

describe('CDE pack pinning', () => {
  it('retires a pack nothing references', () => {
    const result = govRetirePackVersion({
      pack: pack(),
      usage: { reportCount: 0, templateVersions: [] },
      retiredBy: 'ADM-1',
      retiredAt: T0,
    });
    expect(result.ok).toBe(true);
    expect(result.value.lifecycle).toBe('retired');
  });

  it('refuses while reports reference it, naming the meaning change', () => {
    const result = govRetirePackVersion({
      pack: pack(),
      usage: { reportCount: 812, templateVersions: [] },
      retiredBy: 'ADM-1',
      retiredAt: T0,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('pack-in-use');
    expect(result.reason).toContain('significar o valor de hoje');
  });

  it('refuses while a template version binds to it', () => {
    const result = govRetirePackVersion({
      pack: pack(),
      usage: { reportCount: 0, templateVersions: [{ templateId: 'TX', version: 3 }] },
      retiredBy: 'ADM-1',
      retiredAt: T0,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('pack-in-use');
  });

  it('refuses an unattributed retirement', () => {
    expect(
      govRetirePackVersion({
        pack: pack(),
        usage: { reportCount: 0, templateVersions: [] },
        retiredBy: '',
        retiredAt: T0,
      }).code
    ).toBe('unattributed');
  });

  it('uses the pinned version when there is one', () => {
    const result = govResolvePackForReport({
      pinnedVersion: '2019.1',
      currentVersion: '2022.1',
      reportExists: true,
    });
    expect(result.value).toBe('2019.1');
  });

  it('refuses to fall back to the current version for an existing report', () => {
    const result = govResolvePackForReport({ currentVersion: '2022.1', reportExists: true });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('version-not-pinned');
    expect(result.reason).toContain('significado de hoje');
  });

  it('uses the current version for a report being created', () => {
    const result = govResolvePackForReport({ currentVersion: '2022.1', reportExists: false });
    expect(result.value).toBe('2022.1');
  });

  it('refuses when there is no pack at all', () => {
    expect(govResolvePackForReport({ reportExists: false }).code).toBe('pack-not-found');
  });

  it('treats a pack as usable only when approved and clinically validated', () => {
    expect(govPackIsUsable(pack())).toBe(true);
    expect(govPackIsUsable(pack({ lifecycle: 'draft' }))).toBe(false);
    expect(govPackIsUsable(pack({ approval: undefined }))).toBe(false);
  });
});

describe('govResolveMacros shadowing', () => {
  it('lets the radiologist macro win over the institution one', () => {
    const result = govResolveMacros([
      macro({ macroId: 'INST', scope: 'institution' }),
      macro({ macroId: 'MINE', scope: 'radiologist', ownerId: 'CRM-1' }),
    ]);
    expect(result.ok).toBe(true);
    expect(result.value.effective.normaltorax.macroId).toBe('MINE');
  });

  it('reports the institutional macro as shadowed rather than leaving it mysterious', () => {
    const result = govResolveMacros([
      macro({ macroId: 'INST', scope: 'institution' }),
      macro({ macroId: 'MINE', scope: 'radiologist', ownerId: 'CRM-1' }),
    ]);
    expect(result.value.shadowed.length).toBe(1);
    expect(result.value.shadowed[0].shadowed[0].macroId).toBe('INST');
    expect(result.value.message).toContain('nunca disparar');
  });

  it('orders group between radiologist and institution', () => {
    const result = govResolveMacros([
      macro({ macroId: 'INST', scope: 'institution' }),
      macro({ macroId: 'GRP', scope: 'group', ownerId: 'G1' }),
    ]);
    expect(result.value.effective.normaltorax.macroId).toBe('GRP');
  });

  it('matches triggers case-insensitively', () => {
    const result = govResolveMacros([
      macro({ macroId: 'INST', trigger: 'NormalTorax', scope: 'institution' }),
      macro({ macroId: 'MINE', trigger: 'normaltorax', scope: 'radiologist', ownerId: 'C' }),
    ]);
    expect(result.value.shadowed.length).toBe(1);
  });

  it('reports nothing shadowed when triggers differ', () => {
    const result = govResolveMacros([
      macro({ macroId: 'A', trigger: 'a' }),
      macro({ macroId: 'B', trigger: 'b', scope: 'radiologist', ownerId: 'C' }),
    ]);
    expect(result.value.shadowed.length).toBe(0);
    expect(Object.keys(result.value.effective).length).toBe(2);
  });

  it('refuses two macros at the same scope with the same trigger', () => {
    const result = govResolveMacros([
      macro({ macroId: 'A', scope: 'institution' }),
      macro({ macroId: 'B', scope: 'institution' }),
    ]);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('duplicate-trigger');
    expect(result.reason).toContain('ordem de carregamento');
  });

  it('refuses an unknown scope', () => {
    expect(govResolveMacros([macro({ scope: 'regional' as never })]).code).toBe('unknown-scope');
  });

  it('ignores macros with no trigger', () => {
    const result = govResolveMacros([macro(), macro({ macroId: 'X', trigger: '  ' })]);
    expect(Object.keys(result.value.effective).length).toBe(1);
  });

  it('tolerates an empty list', () => {
    const result = govResolveMacros([]);
    expect(result.ok).toBe(true);
    expect(result.value.shadowed.length).toBe(0);
  });

  it('orders precedence most specific first', () => {
    expect(GOV_MACRO_SCOPE_PRECEDENCE).toEqual(['radiologist', 'group', 'institution']);
  });
});

describe('govChangeAiPolicy', () => {
  const base = {
    changedBy: 'ADM-1',
    changedAt: T0,
    justification: 'Decisao da diretoria clinica.',
  };

  it('enables the AI when the model identity is present', () => {
    const result = govChangeAiPolicy({
      ...base,
      policy: {
        tenantId: 'HOSP1',
        enabled: true,
        enabledForRoles: ['radiologist'],
        modelId: 'rt-laudo',
        modelVersion: '2026.07.1',
        providerId: 'prov-1',
      },
    });
    expect(result.ok).toBe(true);
    expect(result.value.warnings.length).toBe(0);
  });

  it('refuses to enable without a model and version', () => {
    const result = govChangeAiPolicy({
      ...base,
      policy: { tenantId: 'HOSP1', enabled: true, enabledForRoles: ['radiologist'] },
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('policy-incomplete');
    expect(result.reason).toContain('auditada');
  });

  it('warns when no provider is identified', () => {
    const result = govChangeAiPolicy({
      ...base,
      policy: {
        tenantId: 'HOSP1',
        enabled: true,
        enabledForRoles: ['radiologist'],
        modelId: 'm',
        modelVersion: 'v',
      },
    });
    expect(result.value.warnings.join(' ')).toContain('para onde o contexto foi enviado');
  });

  it('warns that an empty role list leaves the AI on and unavailable', () => {
    const result = govChangeAiPolicy({
      ...base,
      policy: {
        tenantId: 'HOSP1',
        enabled: true,
        enabledForRoles: [],
        modelId: 'm',
        modelVersion: 'v',
        providerId: 'p',
      },
    });
    expect(result.value.warnings.join(' ')).toContain('padrao seguro');
  });

  it('discards pending suggestions when the AI is switched off, by id', () => {
    const result = govChangeAiPolicy({
      ...base,
      policy: { tenantId: 'HOSP1', enabled: false },
      pendingSuggestionIds: ['S1', 'S2'],
    });
    expect(result.ok).toBe(true);
    expect(result.value.discardedSuggestionIds).toEqual(['S1', 'S2']);
    expect(result.value.warnings.join(' ')).toContain('bloquearia a assinatura');
  });

  it('does not discard pending suggestions when the AI stays on', () => {
    const result = govChangeAiPolicy({
      ...base,
      policy: {
        tenantId: 'HOSP1',
        enabled: true,
        enabledForRoles: ['radiologist'],
        modelId: 'm',
        modelVersion: 'v',
        providerId: 'p',
      },
      pendingSuggestionIds: ['S1'],
    });
    expect(result.value.discardedSuggestionIds).toEqual([]);
  });

  it('refuses a change with no justification', () => {
    const result = govChangeAiPolicy({
      ...base,
      justification: '',
      policy: { tenantId: 'HOSP1', enabled: false },
    });
    expect(result.code).toBe('missing-justification');
  });

  it('refuses a change with no tenant', () => {
    const result = govChangeAiPolicy({ ...base, policy: { tenantId: '', enabled: false } });
    expect(result.code).toBe('invalid-policy');
  });

  it('refuses an unattributed change', () => {
    const result = govChangeAiPolicy({
      ...base,
      changedBy: '',
      policy: { tenantId: 'HOSP1', enabled: false },
    });
    expect(result.code).toBe('unattributed');
  });

  it('refuses an invalid timestamp', () => {
    const result = govChangeAiPolicy({
      ...base,
      changedAt: 0,
      policy: { tenantId: 'HOSP1', enabled: false },
    });
    expect(result.code).toBe('invalid-timestamp');
  });
});

describe('govAuditEntry', () => {
  const base = {
    kind: 'template-edited' as const,
    tenantId: 'HOSP1',
    actorId: 'ADM-1',
    at: T0,
    subject: 'TX-TORAX v1',
    justification: 'Ajuste de redacao.',
  };

  it('records a complete governance event', () => {
    const result = govAuditEntry(base);
    expect(result.ok).toBe(true);
    expect(result.value.complete).toBe(true);
  });

  it('refuses a record with no justification, which is the question it answers', () => {
    const result = govAuditEntry({ ...base, justification: '' });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('quem decidiu');
  });

  it('requires a registration for a clinical approval', () => {
    const result = govAuditEntry({ ...base, kind: 'template-approved' });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('registro profissional');
  });

  it('accepts a clinical approval carrying a registration', () => {
    const result = govAuditEntry({
      ...base,
      kind: 'template-approved',
      registration: 'CRM-SP-123456',
    });
    expect(result.ok).toBe(true);
    expect(result.value.registration).toBe('CRM-SP-123456');
  });

  it('does not require a registration for other events', () => {
    expect(govAuditEntry({ ...base, kind: 'ai-policy-changed' }).ok).toBe(true);
  });

  it('refuses an unknown event kind', () => {
    expect(govAuditEntry({ ...base, kind: 'template-deleted' as never }).ok).toBe(false);
  });

  it('lists every gap at once', () => {
    const result = govAuditEntry({
      kind: 'template-approved',
      tenantId: '',
      actorId: '',
      at: 0,
      subject: '',
      justification: '',
    });
    expect(result.ok).toBe(false);
    expect(result.reason.split(',').length >= 5).toBe(true);
  });

  it('falls back to the subject as the detail', () => {
    expect(govAuditEntry(base).value.detail).toBe('TX-TORAX v1');
  });
});

describe('govDescribeTemplate', () => {
  it('names the version, lifecycle, origin and assertive count', () => {
    const text = govDescribeTemplate(approved());
    expect(text).toContain('v1');
    expect(text).toContain('aprovado');
    expect(text).toContain('2 campo(s) afirmativo(s)');
  });

  it('mentions the version it was forked from', () => {
    const forked = govEditTemplate({
      template: approved(),
      edit: { title: 'v2' },
      editedBy: 'ADM-1',
      editedAt: T0 + 1,
    });
    expect(govDescribeTemplate(forked.value.template)).toContain('derivado da v1');
  });

  it('is empty for no template', () => {
    expect(govDescribeTemplate(undefined as never)).toBe('');
  });
});
