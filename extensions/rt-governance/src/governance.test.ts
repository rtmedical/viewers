import {
  AccessStudy,
  AccessUser,
  canViewStudy,
  describeScope,
  filterVisibleStudies,
  isRestrictedRole,
} from './accessPolicy';
import {
  ALLOWED_DETAIL_KEYS,
  AUDIT_EVENT_TYPES,
  AuditEvent,
  createAuditEvent,
  createAuditQueue,
  describeEvent,
} from './auditLog';

const NOW = Date.parse('2026-08-15T10:00:00Z');

const user = (over: Partial<AccessUser> = {}): AccessUser => ({
  id: 'u1',
  role: 'radiologist',
  ...over,
});

const study = (over: Partial<AccessStudy> = {}): AccessStudy => ({
  studyInstanceUid: '1.2.3',
  institution: 'HGE',
  ...over,
});

describe('canViewStudy — defaults', () => {
  it('denies with a reason when there is no user or no study', () => {
    // Falling through to "allow" would make this not an access control.
    expect(canViewStudy(undefined as never, study())).toMatchObject({ allowed: false });
    expect(canViewStudy(user(), undefined as never).code).toBe('unknownStudy');
    expect(canViewStudy({ id: '', role: 'admin' }, study()).code).toBe('unknownUser');
  });

  it('denies a guest', () => {
    expect(canViewStudy(user({ role: 'guest' }), study()).allowed).toBe(false);
  });

  it('lets an administrator see everything', () => {
    expect(canViewStudy(user({ role: 'admin' }), study({ institution: 'other' }))).toMatchObject({
      allowed: true,
      code: 'admin',
    });
  });
});

describe('canViewStudy — referring physician (the point of RTV-193)', () => {
  const referrer = user({ id: 'dr-ana', role: 'referrer', institutions: ['HGE'] });

  it('sees their own referral', () => {
    expect(canViewStudy(referrer, study({ referrerId: 'dr-ana' }))).toMatchObject({
      allowed: true,
      code: 'referrer',
    });
  });

  it('does not see someone else referral, even in the same institution', () => {
    // Institution membership must NOT widen a referrer's scope.
    const decision = canViewStudy(referrer, study({ referrerId: 'dr-bob', institution: 'HGE' }));
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('notReferrer');
  });

  it('matches the id case-insensitively and ignores padding', () => {
    expect(canViewStudy(referrer, study({ referrerId: '  DR-ANA ' })).allowed).toBe(true);
  });

  it('still sees a study explicitly shared with them', () => {
    expect(
      canViewStudy(referrer, study({ referrerId: 'dr-bob', sharedWith: ['dr-ana'] })).code
    ).toBe('shared');
  });

  it('is reported as a restricted role, so the UI can explain a short list', () => {
    expect(isRestrictedRole('referrer')).toBe(true);
    expect(isRestrictedRole('radiologist')).toBe(false);
    expect(describeScope(referrer)).toMatch(/only studies you referred/i);
  });
});

describe('canViewStudy — institution scope', () => {
  it('lets a radiologist see their institution', () => {
    expect(
      canViewStudy(user({ institutions: ['HGE'] }), study({ institution: 'hge' })).code
    ).toBe('institution');
  });

  it('denies another institution', () => {
    expect(
      canViewStudy(user({ institutions: ['HGE'] }), study({ institution: 'other' })).code
    ).toBe('outsideInstitution');
  });

  it('treats no configured institution as the whole archive', () => {
    // A deliberate configuration, not an accident.
    expect(canViewStudy(user({ institutions: [] }), study({ institution: 'anywhere' })).allowed).toBe(
      true
    );
  });

  it('denies when the study has no institution but the user is scoped', () => {
    expect(
      canViewStudy(user({ institutions: ['HGE'] }), study({ institution: undefined })).allowed
    ).toBe(false);
  });
});

describe('canViewStudy — the most specific reason wins', () => {
  it('reports "assigned" rather than "institution"', () => {
    // The audit trail needs to know WHY, and those are very different answers.
    const decision = canViewStudy(
      user({ id: 'u1', institutions: ['HGE'] }),
      study({ assigneeId: 'u1', institution: 'HGE' })
    );
    expect(decision.code).toBe('assigned');
  });

  it('reports an explicit grant over anything else', () => {
    expect(
      canViewStudy(
        user({ role: 'referrer', grantedStudyUids: ['1.2.3'] }),
        study({ referrerId: 'someone-else' })
      ).code
    ).toBe('explicitGrant');
  });
});

describe('canViewStudy — break-glass', () => {
  const denied = study({ referrerId: 'dr-bob' });
  const base = user({ id: 'dr-ana', role: 'referrer' });

  it('refuses an override with no justification', () => {
    // Unjustified break-glass is indistinguishable from a policy hole at review time.
    const decision = canViewStudy(
      { ...base, breakGlass: { active: true, justification: '  ' } },
      denied
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/needs a justification/i);
  });

  it('grants a justified override and flags it', () => {
    const decision = canViewStudy(
      { ...base, breakGlass: { active: true, justification: 'Atendimento de emergência' } },
      denied
    );
    expect(decision).toMatchObject({ allowed: true, code: 'breakGlass', breakGlass: true });
    expect(decision.reason).toContain('emergência');
  });

  it('is not recorded when access was granted anyway', () => {
    // Flagging a case the user could see would flood the review queue and hide the
    // real overrides.
    const decision = canViewStudy(
      { ...base, breakGlass: { active: true, justification: 'x' } },
      study({ referrerId: 'dr-ana' })
    );
    expect(decision.code).toBe('referrer');
    expect(decision.breakGlass).toBeUndefined();
  });
});

describe('filterVisibleStudies', () => {
  it('keeps only what the policy allows', () => {
    const referrer = user({ id: 'dr-ana', role: 'referrer' });
    const rows = [
      study({ studyInstanceUid: 'a', referrerId: 'dr-ana' }),
      study({ studyInstanceUid: 'b', referrerId: 'dr-bob' }),
      study({ studyInstanceUid: 'c', sharedWith: ['dr-ana'] }),
    ];
    expect(filterVisibleStudies(referrer, rows).map(s => s.studyInstanceUid)).toEqual(['a', 'c']);
  });

  it('handles empty input', () => {
    expect(filterVisibleStudies(user(), [])).toEqual([]);
    expect(filterVisibleStudies(user(), undefined as never)).toEqual([]);
  });
});

describe('createAuditEvent — structured only, no free text', () => {
  const base = { type: 'study.opened' as const, userId: 'u1', timestamp: NOW };

  it('builds an event with an ISO time', () => {
    const event = createAuditEvent({ ...base, studyInstanceUid: '1.2.3' })!;
    expect(event.isoTime).toBe('2026-08-15T10:00:00.000Z');
    expect(event.studyInstanceUid).toBe('1.2.3');
  });

  it('drops any key that is not on the allowlist, and says which', () => {
    // Refusing free text means there is nothing to scrub. A regex-based PHI scrubber
    // catches the shapes you thought of and fails silently on the rest.
    const event = createAuditEvent({
      ...base,
      detail: {
        modality: 'CT',
        description: 'paciente Joao com massa hepatica',
        notes: 'anything',
      } as never,
    })!;
    expect(event.detail).toEqual({ modality: 'CT' });
    expect(event.droppedKeys.sort()).toEqual(['description', 'notes']);
  });

  it('drops a non-scalar value even on an allowed key', () => {
    const event = createAuditEvent({
      ...base,
      detail: { modality: { nested: true }, exportFormat: 'png' } as never,
    })!;
    expect(event.detail).toEqual({ exportFormat: 'png' });
    expect(event.droppedKeys).toEqual(['modality']);
  });

  it('truncates a long scalar rather than rejecting it', () => {
    const event = createAuditEvent({ ...base, detail: { reasonCode: 'x'.repeat(500) } })!;
    expect(String(event.detail.reasonCode)).toHaveLength(128);
  });

  it('refuses an event that cannot say who did what', () => {
    expect(createAuditEvent({ ...base, userId: '  ' })).toBeNull();
    expect(createAuditEvent({ ...base, type: 'nope' as never })).toBeNull();
  });

  it('keeps every declared event type usable', () => {
    for (const type of AUDIT_EVENT_TYPES) {
      expect(createAuditEvent({ type, userId: 'u1', timestamp: NOW })).not.toBeNull();
    }
    expect(ALLOWED_DETAIL_KEYS.length).toBeGreaterThan(0);
  });
});

describe('createAuditQueue', () => {
  const event = (n: number): AuditEvent =>
    createAuditEvent({ type: 'study.opened', userId: `u${n}`, timestamp: NOW + n })!;

  it('flushes in batches, in order', async () => {
    const sent: string[][] = [];
    const queue = createAuditQueue({
      sink: batch => {
        sent.push(batch.map(e => e.userId));
        return true;
      },
      batchSize: 2,
    });
    [1, 2, 3].forEach(n => queue.enqueue(event(n)));

    const result = await queue.flushAll();
    expect(result).toMatchObject({ sent: 3, remaining: 0, failed: false });
    expect(sent).toEqual([['u1', 'u2'], ['u3']]);
  });

  it('puts a failed batch back at the front, preserving order', async () => {
    let fail = true;
    const seen: string[][] = [];
    const queue = createAuditQueue({
      sink: batch => {
        seen.push(batch.map(e => e.userId));
        return !fail;
      },
      batchSize: 2,
    });
    [1, 2, 3].forEach(n => queue.enqueue(event(n)));

    expect(await queue.flush()).toMatchObject({ sent: 0, failed: true, remaining: 3 });
    fail = false;
    await queue.flushAll();
    expect(seen[0]).toEqual(['u1', 'u2']);
    expect(seen[1]).toEqual(['u1', 'u2']);
  });

  it('treats a throwing sink as a failure, not a crash', async () => {
    const queue = createAuditQueue({
      sink: () => {
        throw new Error('offline');
      },
    });
    queue.enqueue(event(1));
    expect(await queue.flush()).toMatchObject({ failed: true, remaining: 1 });
  });

  it('stops retrying a dead endpoint until something new arrives', async () => {
    let calls = 0;
    const queue = createAuditQueue({
      sink: () => {
        calls += 1;
        return false;
      },
      maxAttempts: 2,
    });
    queue.enqueue(event(1));
    await queue.flush();
    await queue.flush();
    await queue.flush();
    expect(calls).toBe(2);

    // A new event resets the attempt counter.
    queue.enqueue(event(2));
    await queue.flush();
    expect(calls).toBe(3);
  });

  it('drops the NEWEST event when full, never the oldest', async () => {
    // A reviewer reconstructing a timeline needs the beginning; a gap at the start is
    // worse than a gap at the end.
    const sent: string[] = [];
    const queue = createAuditQueue({
      sink: batch => {
        sent.push(...batch.map(e => e.userId));
        return true;
      },
      capacity: 2,
    });
    expect(queue.enqueue(event(1))).toBe(true);
    expect(queue.enqueue(event(2))).toBe(true);
    expect(queue.enqueue(event(3))).toBe(false);
    expect(queue.droppedCount()).toBe(1);

    await queue.flushAll();
    expect(sent).toEqual(['u1', 'u2']);
  });

  it('ignores a null event', () => {
    const queue = createAuditQueue({ sink: () => true });
    expect(queue.enqueue(null)).toBe(false);
    expect(queue.size()).toBe(0);
  });

  it('flushing an empty queue is a no-op', async () => {
    const queue = createAuditQueue({ sink: () => true });
    expect(await queue.flush()).toMatchObject({ sent: 0, remaining: 0, failed: false });
  });
});

describe('describeEvent', () => {
  it('renders one line with the detail', () => {
    const event = createAuditEvent({
      type: 'study.exported',
      userId: 'u1',
      timestamp: NOW,
      studyInstanceUid: '1.2.3',
      detail: { exportFormat: 'png' },
    })!;
    expect(describeEvent(event)).toBe(
      '2026-08-15T10:00:00.000Z · u1 · study.exported · study 1.2.3 · exportFormat=png'
    );
  });

  it('handles a missing event', () => {
    expect(describeEvent(undefined as never)).toBe('');
  });
});
