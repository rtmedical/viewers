import {
  ACTION_CAPABILITIES,
  ActionCapability,
  ActionContext,
  ActionStudy,
  clipboardValue,
  contextMenu,
  hoverActions,
  isAuditableCopy,
  isPriorityDowngrade,
  overflowActions,
  priorityOptions,
  resolveActions,
} from './worklistActions';

const STUDY: ActionStudy = {
  studyInstanceUid: '1.2.3',
  accessionNumber: 'ACC-9',
  patientId: 'MRN-42',
  priority: 'urgent',
};

const allow = (...caps: ActionCapability[]) => (c: ActionCapability) => caps.includes(c);
const allowAll = () => true;

const ctx = (over: Partial<ActionContext> = {}): ActionContext => ({
  study: STUDY,
  can: allowAll,
  dicomPeers: ['WORKSTATION_2'],
  assignees: [{ id: 'ana', label: 'Dra. Ana Lima' }],
  ...over,
});

const byId = (actions: ReturnType<typeof resolveActions>, id: string) =>
  actions.find(a => a.id === id);

describe('worklistActions — capability gating', () => {
  it('offers the full set to a user who can do everything', () => {
    const ids = resolveActions(ctx()).map(a => a.id);
    expect(ids).toContain('open');
    expect(ids).toContain('assign');
    expect(ids).toContain('cancelStudy');
  });

  // Hidden, not greyed: a permanently forbidden control teaches nothing and generates
  // support tickets asking why it does not work.
  it('OMITS what the user may never do, rather than disabling it', () => {
    const actions = resolveActions(ctx({ can: allow('study.open') }));
    expect(byId(actions, 'cancelStudy')).toBeUndefined();
    expect(byId(actions, 'assign')).toBeUndefined();
    expect(byId(actions, 'open')).toBeDefined();
  });

  it('fails closed when no checker is supplied', () => {
    expect(resolveActions({ study: STUDY } as ActionContext)).toEqual([]);
  });

  it('returns nothing for a study with no UID', () => {
    expect(resolveActions(ctx({ study: {} as ActionStudy }))).toEqual([]);
  });

  it('exports every capability name it asks about', () => {
    const asked = new Set<string>();
    resolveActions(
      ctx({
        can: cap => {
          asked.add(cap);
          return true;
        },
      })
    );
    for (const cap of asked) {
      expect(ACTION_CAPABILITIES).toContain(cap as ActionCapability);
    }
    expect(asked.size).toBeGreaterThan(0);
  });
});

describe('worklistActions — disabled always says why', () => {
  it('never greys anything out silently', () => {
    const actions = resolveActions(
      ctx({ dicomPeers: [], assignees: [], study: { ...STUDY, accessionNumber: '' } })
    );
    const disabled = actions.filter(a => !a.enabled);
    expect(disabled.length).toBeGreaterThan(0);
    expect(disabled.every(a => !!a.disabledReason)).toBe(true);
  });

  it('disables C-MOVE with no peers, rather than hiding a feature that exists', () => {
    const action = byId(resolveActions(ctx({ dicomPeers: [] })), 'sendDicom');
    expect(action!.enabled).toBe(false);
    expect(action!.disabledReason).toMatch(/destino DICOM/);
  });

  it('disables assign when nobody is available', () => {
    const action = byId(resolveActions(ctx({ assignees: [] })), 'assign');
    expect(action!.enabled).toBe(false);
    expect(action!.disabledReason).toMatch(/radiologista/);
  });

  it('disables copy when the field is empty, so nothing overwrites the clipboard', () => {
    const actions = resolveActions(ctx({ study: { ...STUDY, patientId: '   ' } }));
    expect(byId(actions, 'copyPatientId')!.enabled).toBe(false);
    expect(byId(actions, 'copyAccession')!.enabled).toBe(true);
  });

  it('holds write actions offline but leaves reads alone', () => {
    const actions = resolveActions(ctx({ online: false }));
    expect(byId(actions, 'assign')!.enabled).toBe(false);
    expect(byId(actions, 'assign')!.disabledReason).toMatch(/RIS/);
    expect(byId(actions, 'setPriority')!.enabled).toBe(false);
    expect(byId(actions, 'open')!.enabled).toBe(true);
    expect(byId(actions, 'copyAccession')!.enabled).toBe(true);
  });

  it('a cancelled study can still be opened and re-sent, but not re-prioritised', () => {
    const actions = resolveActions(ctx({ study: { ...STUDY, cancelled: true } }));
    expect(byId(actions, 'open')!.enabled).toBe(true);
    expect(byId(actions, 'sendDicom')!.enabled).toBe(true);
    expect(byId(actions, 'accessHistory')!.enabled).toBe(true);
    expect(byId(actions, 'setPriority')!.enabled).toBe(false);
    expect(byId(actions, 'setPriority')!.disabledReason).toBe('Estudo cancelado.');
    expect(byId(actions, 'cancelStudy')!.enabled).toBe(false);
  });
});

describe('worklistActions — hover row', () => {
  // A destructive action a pixel away from "Abrir" under a moving pointer, on rows that
  // shift as the list refreshes, is a cancelled exam waiting to happen.
  it('never puts a destructive action on hover', () => {
    const actions = resolveActions(ctx());
    expect(byId(actions, 'cancelStudy')!.hover).toBe(false);
    expect(hoverActions(actions).some(a => a.destructive)).toBe(false);
  });

  it('keeps the destructive action reachable through the overflow', () => {
    const actions = resolveActions(ctx());
    expect(overflowActions(actions).map(a => a.id)).toContain('cancelStudy');
  });

  it('shows every action exactly once across hover and overflow', () => {
    const actions = resolveActions(ctx());
    const ids = [...hoverActions(actions), ...overflowActions(actions)].map(a => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(actions.map(a => a.id).sort());
  });

  it('respects the limit', () => {
    expect(hoverActions(resolveActions(ctx()), 2)).toHaveLength(2);
    expect(hoverActions(resolveActions(ctx()), 0)).toEqual([]);
  });

  // A row of greyed icons repeated 400 times is noise, not information.
  it('pushes disabled actions out of the row before enabled ones', () => {
    const actions = resolveActions(ctx({ dicomPeers: [], assignees: [] }));
    const shown = hoverActions(actions, 3);
    expect(shown.every(a => a.enabled)).toBe(true);
    expect(overflowActions(actions, 3).map(a => a.id)).toEqual(
      expect.arrayContaining(['assign', 'sendDicom'])
    );
  });
});

describe('worklistActions — context menu', () => {
  it('groups the actions and puts danger last, alone', () => {
    const groups = contextMenu(resolveActions(ctx()));
    expect(groups.map(g => g.id)).toEqual(['open', 'clipboard', 'workflow', 'transfer', 'danger']);
    const danger = groups[groups.length - 1];
    expect(danger.actions.map(a => a.id)).toEqual(['cancelStudy']);
  });

  it('drops empty groups instead of leaving stray separators', () => {
    const groups = contextMenu(resolveActions(ctx({ can: allow('study.open') })));
    expect(groups.map(g => g.id)).toEqual(['open', 'clipboard']);
  });

  it('marks the destructive action as needing confirmation', () => {
    const cancel = byId(resolveActions(ctx()), 'cancelStudy')!;
    expect(cancel.destructive).toBe(true);
    expect(cancel.confirm).toBe(true);
  });

  it('flags the submenu actions so the caller knows not to fire them directly', () => {
    const actions = resolveActions(ctx());
    expect(byId(actions, 'assign')!.submenu).toBe('assignees');
    expect(byId(actions, 'setPriority')!.submenu).toBe('priorities');
    expect(byId(actions, 'sendDicom')!.submenu).toBe('peers');
    expect(byId(actions, 'open')!.submenu).toBeUndefined();
  });
});

describe('worklistActions — clipboard', () => {
  it('copies the raw value', () => {
    expect(clipboardValue(STUDY, 'copyAccession')).toBe('ACC-9');
    expect(clipboardValue(STUDY, 'copyPatientId')).toBe('MRN-42');
  });

  // An empty string on the clipboard silently destroys whatever the user had there.
  it('returns null rather than blanking the clipboard', () => {
    expect(clipboardValue({ ...STUDY, patientId: '  ' }, 'copyPatientId')).toBeNull();
    expect(clipboardValue(STUDY, 'open')).toBeNull();
  });

  it('marks the Patient ID copy as auditable PHI', () => {
    expect(isAuditableCopy('copyPatientId')).toBe(true);
    expect(isAuditableCopy('copyAccession')).toBe(false);
  });
});

describe('worklistActions — priority submenu', () => {
  it('offers every level and marks the current one', () => {
    const options = priorityOptions(STUDY);
    expect(options.map(o => o.value)).toEqual(['normal', 'urgent', 'emergency']);
    expect(options.find(o => o.current)!.value).toBe('urgent');
  });

  // Lowering an escalated study is a clinical decision someone should own.
  it('requires a justification only for a downgrade', () => {
    const options = priorityOptions({ ...STUDY, priority: 'emergency' });
    expect(options.find(o => o.value === 'normal')!.requiresJustification).toBe(true);
    expect(options.find(o => o.value === 'urgent')!.requiresJustification).toBe(true);
    expect(options.find(o => o.value === 'emergency')!.requiresJustification).toBe(false);
  });

  it('never asks for a justification to escalate', () => {
    const options = priorityOptions({ ...STUDY, priority: 'normal' });
    expect(options.every(o => !o.requiresJustification)).toBe(true);
  });

  it('treats an unknown priority as normal rather than guessing', () => {
    const options = priorityOptions({ ...STUDY, priority: 'ROTINA?' });
    expect(options.find(o => o.current)!.value).toBe('normal');
  });

  it('names a downgrade for the confirmation copy', () => {
    expect(isPriorityDowngrade('emergency', 'normal')).toBe(true);
    expect(isPriorityDowngrade('normal', 'emergency')).toBe(false);
    expect(isPriorityDowngrade('urgent', 'urgent')).toBe(false);
  });
});
