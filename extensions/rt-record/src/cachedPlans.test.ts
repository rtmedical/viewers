import {
  PLAN_CACHE_AUDIT_KINDS,
  PLAN_CACHE_CLEAR_VERDICTS,
  PLAN_CACHE_CONFIRMATION_TTL_MS,
  PLAN_CACHE_CURRENCY_VERDICTS,
  PLAN_CACHE_LAST_TREATMENT_KINDS,
  PLAN_CACHE_LOCK_STATES,
  PLAN_CACHE_PLAN_OUTCOMES,
  PLAN_CACHE_REFUSAL_CODES,
  PLAN_CACHE_UNKNOWN_LABEL,
  PLAN_CACHE_VERIFICATION_TTL_MS,
  planCacheApplyClearResults,
  planCacheBuildInventory,
  planCacheClassifyCurrency,
  planCacheDescribeLockedPlan,
  planCacheEntryKey,
  planCacheEvaluateClearRequest,
  planCacheFingerprintSelection,
  planCacheGuardPlanForDelivery,
  planCacheNormalizeLastTreatment,
  planCachePlanClear,
  planCacheResolveUsage,
  type PlanCacheClearAttempt,
  type PlanCacheClearConfirmation,
  type PlanCacheEntry,
  type PlanCacheUsageProbe,
} from './cachedPlans';

const NOW = 1_760_000_000_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A plan that is verifiably the current one: every fact present and confirmed. */
function current(over: Partial<PlanCacheEntry> = {}): PlanCacheEntry {
  return {
    planId: 'PLANO-A',
    patientRef: 'PAC-1',
    courseRef: 'CURSO-1',
    cachedAt: NOW - 2 * HOUR,
    sourceSystem: 'ARIA-HOSP1',
    sourceRevision: {
      revisionId: 'rev-7',
      planInstanceUid: '1.2.840.1.7',
      approvalStatus: 'APPROVED',
      approvedBy: 'FIS-9',
      approvedAt: NOW - 3 * DAY,
    },
    revisionVerification: {
      verifiedAt: NOW - HOUR,
      currentRevisionId: 'rev-7',
      verifiedAgainstSystem: 'ARIA-HOSP1',
    },
    lastTreatment: { kind: 'treated', at: NOW - 5 * DAY, attestedBy: 'RTRECORD' },
    lockState: PLAN_CACHE_LOCK_STATES.LOCKED,
    usage: { kind: 'free' },
    courseStatus: 'completed',
    externallyCached: true,
    sizeBytes: 1_048_576,
    ...over,
  };
}

function confirmation(
  digest: string,
  over: Partial<PlanCacheClearConfirmation> = {}
): PlanCacheClearConfirmation {
  return {
    digest,
    confirmedByUserId: 'FIS-9',
    confirmedAt: NOW - 60_000,
    reason: 'Reimportacao apos replanejamento do curso.',
    acknowledgedIrreversible: true,
    ...over,
  };
}

function fingerprintOf(entries: PlanCacheEntry[]): string {
  const result = planCacheFingerprintSelection(entries);
  if (!result.ok) {
    throw new Error('fixture broken: ' + result.reason);
  }
  return result.value.digest;
}

const freeProbe: PlanCacheUsageProbe = () => ({ kind: 'free' });

/* ------------------------------------------------------------------ */

describe('planCacheClassifyCurrency, FM-1 fail closed', () => {
  it('calls a fully verified plan current', () => {
    const result = planCacheClassifyCurrency(current(), NOW);
    expect(result.ok).toBe(true);
    expect(result.value.verdict).toBe(PLAN_CACHE_CURRENCY_VERDICTS.VERIFIABLE_CURRENT);
    expect(result.value.deliverable).toBe(true);
  });

  it('treats a missing revision id as unverified, never as current', () => {
    const result = planCacheClassifyCurrency(
      current({ sourceRevision: { approvalStatus: 'APPROVED' } }),
      NOW
    );
    expect(result.value.verdict).toBe(PLAN_CACHE_CURRENCY_VERDICTS.SNAPSHOT_UNVERIFIED);
    expect(result.value.deliverable).toBe(false);
  });

  it('treats a plan never checked against the source as unverified', () => {
    const result = planCacheClassifyCurrency(current({ revisionVerification: undefined }), NOW);
    expect(result.value.verdict).toBe(PLAN_CACHE_CURRENCY_VERDICTS.SNAPSHOT_UNVERIFIED);
    expect(result.value.reason).toContain('nunca foi confrontada');
  });

  it('calls a superseded revision known-stale', () => {
    const entry = current();
    entry.sourceRevision.supersededByRevisionId = 'rev-8';
    const result = planCacheClassifyCurrency(entry, NOW);
    expect(result.value.verdict).toBe(PLAN_CACHE_CURRENCY_VERDICTS.KNOWN_STALE);
    expect(result.value.reason).toContain('rev-8');
  });

  it('calls a plan known-stale when the source reports a different current revision', () => {
    const entry = current();
    entry.revisionVerification.currentRevisionId = 'rev-9';
    const result = planCacheClassifyCurrency(entry, NOW);
    expect(result.value.verdict).toBe(PLAN_CACHE_CURRENCY_VERDICTS.KNOWN_STALE);
    expect(result.value.reason).toContain('rev-9');
  });

  it('calls a rejected plan known-stale even with nothing newer', () => {
    const entry = current();
    entry.sourceRevision.approvalStatus = 'REJECTED';
    expect(planCacheClassifyCurrency(entry, NOW).value.verdict).toBe(
      PLAN_CACHE_CURRENCY_VERDICTS.KNOWN_STALE
    );
  });

  it('calls a retired plan known-stale', () => {
    const entry = current();
    entry.sourceRevision.approvalStatus = 'RETIRED';
    expect(planCacheClassifyCurrency(entry, NOW).value.verdict).toBe(
      PLAN_CACHE_CURRENCY_VERDICTS.KNOWN_STALE
    );
  });

  it('does not call an unapproved plan current', () => {
    const entry = current();
    entry.sourceRevision.approvalStatus = 'UNAPPROVED';
    const result = planCacheClassifyCurrency(entry, NOW);
    expect(result.value.verdict).toBe(PLAN_CACHE_CURRENCY_VERDICTS.SNAPSHOT_UNVERIFIED);
  });

  it('accepts a verification exactly at the ttl', () => {
    const entry = current();
    entry.revisionVerification.verifiedAt = NOW - PLAN_CACHE_VERIFICATION_TTL_MS;
    expect(planCacheClassifyCurrency(entry, NOW).value.verdict).toBe(
      PLAN_CACHE_CURRENCY_VERDICTS.VERIFIABLE_CURRENT
    );
  });

  it('refuses a verification one millisecond past the ttl', () => {
    const entry = current();
    entry.revisionVerification.verifiedAt = NOW - PLAN_CACHE_VERIFICATION_TTL_MS - 1;
    const result = planCacheClassifyCurrency(entry, NOW);
    expect(result.value.verdict).toBe(PLAN_CACHE_CURRENCY_VERDICTS.SNAPSHOT_UNVERIFIED);
    expect(result.value.reason).toContain('expirou');
  });

  it('treats a cache timestamp in the future as unverified rather than fresh', () => {
    const result = planCacheClassifyCurrency(current({ cachedAt: NOW + HOUR }), NOW);
    expect(result.value.verdict).toBe(PLAN_CACHE_CURRENCY_VERDICTS.SNAPSHOT_UNVERIFIED);
    expect(result.value.reason).toContain('relógios');
  });

  it('rejects a verification dated in the future', () => {
    const entry = current();
    entry.revisionVerification.verifiedAt = NOW + HOUR;
    const result = planCacheClassifyCurrency(entry, NOW);
    expect(result.value.verdict).toBe(PLAN_CACHE_CURRENCY_VERDICTS.SNAPSHOT_UNVERIFIED);
  });

  it('treats a verification that recorded no current revision as unverified', () => {
    const entry = current();
    entry.revisionVerification.currentRevisionId = undefined;
    expect(planCacheClassifyCurrency(entry, NOW).value.verdict).toBe(
      PLAN_CACHE_CURRENCY_VERDICTS.SNAPSHOT_UNVERIFIED
    );
  });

  it('refuses an invalid reference instant', () => {
    const result = planCacheClassifyCurrency(current(), Number.NaN);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(PLAN_CACHE_REFUSAL_CODES.INVALID_CLOCK);
  });

  it('refuses a malformed entry', () => {
    const result = planCacheClassifyCurrency({ planId: '' } as PlanCacheEntry, NOW);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(PLAN_CACHE_REFUSAL_CODES.INVALID_ENTRY);
  });

  it('always carries the stamp naming the source and capture instant', () => {
    const result = planCacheClassifyCurrency(current(), NOW);
    expect(result.value.stamp).toContain('ARIA-HOSP1');
    expect(result.value.stamp).toContain('cache externo');
  });
});

describe('planCacheGuardPlanForDelivery', () => {
  it('lets a verified current plan through', () => {
    expect(planCacheGuardPlanForDelivery(current(), NOW).ok).toBe(true);
  });

  it('refuses an unverified snapshot so the caller cannot be optimistic', () => {
    const result = planCacheGuardPlanForDelivery(current({ revisionVerification: {} }), NOW);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(PLAN_CACHE_REFUSAL_CODES.NOT_VERIFIED);
  });

  it('refuses a known-stale plan', () => {
    const entry = current();
    entry.sourceRevision.supersededByRevisionId = 'rev-8';
    expect(planCacheGuardPlanForDelivery(entry, NOW).ok).toBe(false);
  });
});

describe('planCacheNormalizeLastTreatment, FM-6', () => {
  it('keeps a real last-treatment date', () => {
    const value = planCacheNormalizeLastTreatment(current());
    expect(value.kind).toBe(PLAN_CACHE_LAST_TREATMENT_KINDS.TREATED);
    expect(value.at).toBe(NOW - 5 * DAY);
  });

  it('reports unknown when the field is absent', () => {
    expect(planCacheNormalizeLastTreatment(current({ lastTreatment: undefined })).kind).toBe(
      PLAN_CACHE_LAST_TREATMENT_KINDS.UNKNOWN
    );
  });

  it('accepts never-treated only when something attested it', () => {
    const attested = planCacheNormalizeLastTreatment(
      current({ lastTreatment: { kind: 'never-treated', attestedBy: 'RTRECORD' } })
    );
    expect(attested.kind).toBe(PLAN_CACHE_LAST_TREATMENT_KINDS.NEVER_TREATED);
  });

  it('degrades an unattested never-treated claim to unknown', () => {
    const bare = planCacheNormalizeLastTreatment(
      current({ lastTreatment: { kind: 'never-treated' } })
    );
    expect(bare.kind).toBe(PLAN_CACHE_LAST_TREATMENT_KINDS.UNKNOWN);
  });

  it('degrades a treated claim with no date to unknown', () => {
    const bare = planCacheNormalizeLastTreatment(
      current({ lastTreatment: { kind: 'treated' } as never })
    );
    expect(bare.kind).toBe(PLAN_CACHE_LAST_TREATMENT_KINDS.UNKNOWN);
  });
});

describe('planCacheDescribeLockedPlan', () => {
  it('shows Plan ID and the last treatment date', () => {
    const result = planCacheDescribeLockedPlan(current(), NOW);
    expect(result.ok).toBe(true);
    expect(result.value.planIdLabel).toContain('PLANO-A');
    expect(result.value.lastTreatmentLabel).toContain('Último tratamento em');
  });

  it('never renders an absent date as never treated', () => {
    const result = planCacheDescribeLockedPlan(current({ lastTreatment: undefined }), NOW);
    expect(result.value.lastTreatmentIsAbsent).toBe(true);
    expect(result.value.lastTreatmentIsNever).toBe(false);
    expect(result.value.lastTreatmentLabel).toContain(PLAN_CACHE_UNKNOWN_LABEL);
    expect(result.value.lastTreatmentLabel).not.toContain('Nunca tratado');
  });

  it('warns that an absent date does not mean untreated', () => {
    const result = planCacheDescribeLockedPlan(current({ lastTreatment: undefined }), NOW);
    expect(result.value.warnings.join(' ')).toContain('nunca foi tratado');
  });

  it('keeps a genuine never-treated distinct from unknown', () => {
    const result = planCacheDescribeLockedPlan(
      current({ lastTreatment: { kind: 'never-treated', attestedBy: 'RTRECORD' } }),
      NOW
    );
    expect(result.value.lastTreatmentIsNever).toBe(true);
    expect(result.value.lastTreatmentIsAbsent).toBe(false);
  });

  it('treats an unknown lock state as read only', () => {
    const result = planCacheDescribeLockedPlan(
      current({ lockState: PLAN_CACHE_LOCK_STATES.UNKNOWN }),
      NOW
    );
    expect(result.value.readOnly).toBe(true);
    expect(result.value.locked).toBe(false);
  });

  it('allows editing only for an explicitly unlocked plan', () => {
    const result = planCacheDescribeLockedPlan(
      current({ lockState: PLAN_CACHE_LOCK_STATES.UNLOCKED }),
      NOW
    );
    expect(result.value.readOnly).toBe(false);
  });

  it('puts the currency verdict on the same panel as the Plan ID', () => {
    const result = planCacheDescribeLockedPlan(current({ revisionVerification: {} }), NOW);
    const labels = result.value.displayFields.map(f => f.label);
    expect(labels.indexOf('Plan ID') >= 0).toBe(true);
    expect(labels.indexOf('Situação da cópia') >= 0).toBe(true);
    expect(result.value.warnings.join(' ')).toContain('cópia em cache');
  });

  it('warns about a last-treatment date in the future', () => {
    const result = planCacheDescribeLockedPlan(
      current({ lastTreatment: { kind: 'treated', at: NOW + DAY } }),
      NOW
    );
    expect(result.value.warnings.join(' ')).toContain('relógios');
  });

  it('renders an absent course as unavailable rather than blank', () => {
    const result = planCacheDescribeLockedPlan(current({ courseRef: undefined }), NOW);
    const course = result.value.displayFields.filter(f => f.label === 'Curso')[0];
    expect(course.value).toBe(PLAN_CACHE_UNKNOWN_LABEL);
  });
});

describe('planCacheResolveUsage, FM-2', () => {
  it('uses the recorded state when there is one', () => {
    expect(planCacheResolveUsage(current(), undefined).kind).toBe('free');
  });

  it('reports unknown, not free, when nothing is recorded and there is no probe', () => {
    expect(planCacheResolveUsage(current({ usage: undefined }), undefined).kind).toBe('unknown');
  });

  it('lets a probe answer when the entry does not', () => {
    const probe: PlanCacheUsageProbe = () => ({ kind: 'in-use', holder: 'DICOM Daemon' });
    const state = planCacheResolveUsage(current({ usage: undefined }), probe);
    expect(state.kind).toBe('in-use');
    expect(state.holder).toBe('DICOM Daemon');
  });
});

describe('planCacheFingerprintSelection, FM-4', () => {
  it('is stable under reordering, because a repaint must not invalidate a confirmation', () => {
    const a = current({ planId: 'PLANO-A' });
    const b = current({ planId: 'PLANO-B' });
    expect(fingerprintOf([a, b])).toBe(fingerprintOf([b, a]));
  });

  it('changes when a plan is added', () => {
    const a = current({ planId: 'PLANO-A' });
    const b = current({ planId: 'PLANO-B' });
    expect(fingerprintOf([a])).not.toBe(fingerprintOf([a, b]));
  });

  it('changes when a plan is removed', () => {
    const a = current({ planId: 'PLANO-A' });
    const b = current({ planId: 'PLANO-B' });
    expect(fingerprintOf([a, b])).not.toBe(fingerprintOf([b]));
  });

  it('changes when a revision is revised under the operator', () => {
    const a = current();
    const revised = current();
    revised.sourceRevision.revisionId = 'rev-8';
    expect(fingerprintOf([a])).not.toBe(fingerprintOf([revised]));
  });

  it('changes when the approval status changes', () => {
    const a = current();
    const rejected = current();
    rejected.sourceRevision.approvalStatus = 'REJECTED';
    expect(fingerprintOf([a])).not.toBe(fingerprintOf([rejected]));
  });

  it('changes when the lock state changes', () => {
    expect(fingerprintOf([current()])).not.toBe(
      fingerprintOf([current({ lockState: PLAN_CACHE_LOCK_STATES.UNLOCKED })])
    );
  });

  it('changes when the last treatment date changes', () => {
    expect(fingerprintOf([current()])).not.toBe(
      fingerprintOf([current({ lastTreatment: { kind: 'treated', at: NOW - DAY } })])
    );
  });

  it('refuses an empty selection', () => {
    const result = planCacheFingerprintSelection([]);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(PLAN_CACHE_REFUSAL_CODES.EMPTY_SELECTION);
  });

  it('refuses a selection listing the same entry twice', () => {
    const result = planCacheFingerprintSelection([current(), current()]);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(PLAN_CACHE_REFUSAL_CODES.DUPLICATE_SELECTION);
    expect(result.reason).toContain('contagem exibida');
  });

  it('reports the plan count and sorted keys', () => {
    const result = planCacheFingerprintSelection([
      current({ planId: 'PLANO-B' }),
      current({ planId: 'PLANO-A' }),
    ]);
    expect(result.value.planCount).toBe(2);
    expect(result.value.planIds).toEqual(['PLANO-A', 'PLANO-B']);
  });
});

describe('planCacheEvaluateClearRequest', () => {
  it('authorises a free, externally cached, completed plan', () => {
    const selection = [current()];
    const decision = planCacheEvaluateClearRequest({
      selection,
      confirmation: confirmation(fingerprintOf(selection)),
      usageProbe: freeProbe,
      now: NOW,
    });
    expect(decision.authorized).toBe(true);
    expect(decision.plan.targets.length).toBe(1);
    expect(decision.audit.kind).toBe(PLAN_CACHE_AUDIT_KINDS.CLEAR_AUTHORIZED);
  });

  it('refuses a plan a daemon is holding, naming the holder', () => {
    const selection = [current({ usage: { kind: 'in-use', holder: 'DICOM Daemon' } })];
    const decision = planCacheEvaluateClearRequest({
      selection,
      confirmation: confirmation(fingerprintOf(selection)),
      now: NOW,
    });
    expect(decision.authorized).toBe(false);
    expect(decision.refusalCode).toBe(PLAN_CACHE_REFUSAL_CODES.PLAN_IN_USE);
    expect(decision.refusalReason).toContain('DICOM Daemon');
  });

  it('refuses when the usage state is unknown, because that is not the same as free', () => {
    const selection = [current({ usage: undefined })];
    const decision = planCacheEvaluateClearRequest({
      selection,
      confirmation: confirmation(fingerprintOf(selection)),
      now: NOW,
    });
    expect(decision.authorized).toBe(false);
    expect(decision.refusalCode).toBe(PLAN_CACHE_REFUSAL_CODES.USAGE_UNKNOWN);
  });

  it('refuses a plan whose course is still in progress', () => {
    const selection = [current({ courseStatus: 'in-progress' })];
    const decision = planCacheEvaluateClearRequest({
      selection,
      confirmation: confirmation(fingerprintOf(selection)),
      usageProbe: freeProbe,
      now: NOW,
    });
    expect(decision.authorized).toBe(false);
    expect(decision.refusalCode).toBe(PLAN_CACHE_REFUSAL_CODES.COURSE_IN_PROGRESS);
  });

  it('refuses a plan that is not an external cache copy', () => {
    const selection = [current({ externallyCached: false })];
    const decision = planCacheEvaluateClearRequest({
      selection,
      confirmation: confirmation(fingerprintOf(selection)),
      usageProbe: freeProbe,
      now: NOW,
    });
    expect(decision.authorized).toBe(false);
    expect(decision.refusalCode).toBe(PLAN_CACHE_REFUSAL_CODES.NOT_EXTERNALLY_CACHED);
  });

  it('treats a missing externallyCached flag as not cached rather than granting eviction', () => {
    const selection = [current({ externallyCached: undefined })];
    const decision = planCacheEvaluateClearRequest({
      selection,
      confirmation: confirmation(fingerprintOf(selection)),
      usageProbe: freeProbe,
      now: NOW,
    });
    expect(decision.authorized).toBe(false);
    expect(decision.refusalCode).toBe(PLAN_CACHE_REFUSAL_CODES.NOT_EXTERNALLY_CACHED);
  });

  it('names the worst blocker when several apply', () => {
    const selection = [
      current({ planId: 'P1', usage: { kind: 'unknown' } }),
      current({ planId: 'P2', usage: { kind: 'in-use', holder: 'Sessao em curso' } }),
    ];
    const decision = planCacheEvaluateClearRequest({
      selection,
      confirmation: confirmation(fingerprintOf(selection)),
      now: NOW,
    });
    expect(decision.refusalCode).toBe(PLAN_CACHE_REFUSAL_CODES.PLAN_IN_USE);
    expect(decision.blockers.length).toBe(2);
  });

  it('refuses when the list changed since the operator confirmed', () => {
    const shown = [current({ planId: 'PLANO-A' })];
    const digest = fingerprintOf(shown);
    const nowFour = [current({ planId: 'PLANO-A' }), current({ planId: 'PLANO-D' })];
    const decision = planCacheEvaluateClearRequest({
      selection: nowFour,
      confirmation: confirmation(digest),
      usageProbe: freeProbe,
      now: NOW,
    });
    expect(decision.authorized).toBe(false);
    expect(decision.refusalCode).toBe(PLAN_CACHE_REFUSAL_CODES.FINGERPRINT_MISMATCH);
  });

  it('refuses a confirmation older than the interaction window', () => {
    const selection = [current()];
    const decision = planCacheEvaluateClearRequest({
      selection,
      confirmation: confirmation(fingerprintOf(selection), {
        confirmedAt: NOW - PLAN_CACHE_CONFIRMATION_TTL_MS - 1,
      }),
      usageProbe: freeProbe,
      now: NOW,
    });
    expect(decision.authorized).toBe(false);
    expect(decision.refusalCode).toBe(PLAN_CACHE_REFUSAL_CODES.CONFIRMATION_EXPIRED);
  });

  it('accepts a confirmation exactly at the window edge', () => {
    const selection = [current()];
    const decision = planCacheEvaluateClearRequest({
      selection,
      confirmation: confirmation(fingerprintOf(selection), {
        confirmedAt: NOW - PLAN_CACHE_CONFIRMATION_TTL_MS,
      }),
      usageProbe: freeProbe,
      now: NOW,
    });
    expect(decision.authorized).toBe(true);
  });

  it('refuses a clear with no justification', () => {
    const selection = [current()];
    const decision = planCacheEvaluateClearRequest({
      selection,
      confirmation: confirmation(fingerprintOf(selection), { reason: '  ' }),
      usageProbe: freeProbe,
      now: NOW,
    });
    expect(decision.authorized).toBe(false);
    expect(decision.refusalCode).toBe(PLAN_CACHE_REFUSAL_CODES.MISSING_REASON);
  });

  it('refuses a clear with no actor', () => {
    const selection = [current()];
    const decision = planCacheEvaluateClearRequest({
      selection,
      confirmation: confirmation(fingerprintOf(selection), { confirmedByUserId: '' }),
      usageProbe: freeProbe,
      now: NOW,
    });
    expect(decision.authorized).toBe(false);
    expect(decision.refusalCode).toBe(PLAN_CACHE_REFUSAL_CODES.MISSING_ACTOR);
  });

  it('refuses when the irreversibility was not acknowledged', () => {
    const selection = [current()];
    const decision = planCacheEvaluateClearRequest({
      selection,
      confirmation: confirmation(fingerprintOf(selection), {
        acknowledgedIrreversible: false,
      }),
      usageProbe: freeProbe,
      now: NOW,
    });
    expect(decision.authorized).toBe(false);
  });

  it('refuses when the count the operator saw disagrees with the selection', () => {
    const selection = [current()];
    const decision = planCacheEvaluateClearRequest({
      selection,
      confirmation: confirmation(fingerprintOf(selection), { presentedPlanCount: 3 }),
      usageProbe: freeProbe,
      now: NOW,
    });
    expect(decision.authorized).toBe(false);
  });

  it('files an audit record for a refusal, which are the interesting ones', () => {
    const selection = [current({ usage: { kind: 'in-use', holder: 'Daemon' } })];
    const decision = planCacheEvaluateClearRequest({
      selection,
      confirmation: confirmation(fingerprintOf(selection)),
      now: NOW,
    });
    expect(decision.authorized).toBe(false);
    expect(decision.audit.kind).toBe(PLAN_CACHE_AUDIT_KINDS.CLEAR_REFUSED);
    expect(decision.audit.refusalCode).toBe(PLAN_CACHE_REFUSAL_CODES.PLAN_IN_USE);
    expect(decision.audit.actorId).toBe('FIS-9');
    expect(decision.audit.justification).toContain('Reimportacao');
  });

  it('files an audit record even for an empty selection', () => {
    const decision = planCacheEvaluateClearRequest({
      selection: [],
      confirmation: confirmation('pc1-0-00000000'),
      now: NOW,
    });
    expect(decision.authorized).toBe(false);
    expect(decision.audit).toBeDefined();
    expect(decision.audit.kind).toBe(PLAN_CACHE_AUDIT_KINDS.CLEAR_REFUSED);
  });

  it('planCachePlanClear surfaces the decision as a result', () => {
    const selection = [current()];
    const ok = planCachePlanClear(
      selection,
      confirmation(fingerprintOf(selection)),
      freeProbe,
      NOW
    );
    expect(ok.ok).toBe(true);
    const blocked = planCachePlanClear(
      [current({ usage: { kind: 'in-use', holder: 'D' } })],
      confirmation(fingerprintOf([current({ usage: { kind: 'in-use', holder: 'D' } })])),
      undefined as never,
      NOW
    );
    expect(blocked.ok).toBe(false);
  });
});

describe('planCacheApplyClearResults, FM-3', () => {
  function authorized(count: number) {
    const selection: PlanCacheEntry[] = [];
    for (let k = 0; k < count; k += 1) {
      selection.push(current({ planId: 'PLANO-' + k }));
    }
    const decision = planCacheEvaluateClearRequest({
      selection,
      confirmation: confirmation(fingerprintOf(selection)),
      usageProbe: freeProbe,
      now: NOW,
    });
    if (!decision.authorized) {
      throw new Error('fixture broken: ' + decision.refusalReason);
    }
    return { plan: decision.plan, selection };
  }

  it('reports success only when every plan is confirmed cleared', () => {
    const { plan, selection } = authorized(3);
    const attempts: PlanCacheClearAttempt[] = selection.map(e => ({
      entryKey: planCacheEntryKey(e),
      succeeded: true,
    }));
    const report = planCacheApplyClearResults(plan, attempts, NOW);
    expect(report.value.verdict).toBe(PLAN_CACHE_CLEAR_VERDICTS.SUCCESS);
    expect(report.value.cacheClean).toBe(true);
    expect(report.value.stalePlansMayRemain).toBe(false);
    expect(report.value.clearedCount).toBe(3);
  });

  it('reports partial, never success, when one plan failed', () => {
    const { plan, selection } = authorized(3);
    const attempts: PlanCacheClearAttempt[] = [
      { entryKey: planCacheEntryKey(selection[0]), succeeded: true },
      { entryKey: planCacheEntryKey(selection[1]), succeeded: false, failureCode: 'locked' },
      { entryKey: planCacheEntryKey(selection[2]), succeeded: true },
    ];
    const report = planCacheApplyClearResults(plan, attempts, NOW);
    expect(report.value.verdict).toBe(PLAN_CACHE_CLEAR_VERDICTS.PARTIAL);
    expect(report.value.cacheClean).toBe(false);
    expect(report.value.stalePlansMayRemain).toBe(true);
    expect(report.value.retainedCount).toBe(1);
  });

  it('degrades to partial when a plan is unaccounted for', () => {
    const { plan, selection } = authorized(3);
    const attempts: PlanCacheClearAttempt[] = [
      { entryKey: planCacheEntryKey(selection[0]), succeeded: true },
      { entryKey: planCacheEntryKey(selection[1]), succeeded: true },
    ];
    const report = planCacheApplyClearResults(plan, attempts, NOW);
    expect(report.value.verdict).toBe(PLAN_CACHE_CLEAR_VERDICTS.PARTIAL);
    expect(report.value.unknownCount).toBe(1);
    expect(report.value.stalePlansMayRemain).toBe(true);
  });

  it('warns as loudly for an unaccounted plan as for a failed one', () => {
    const { plan, selection } = authorized(2);
    const unaccounted = planCacheApplyClearResults(
      plan,
      [{ entryKey: planCacheEntryKey(selection[0]), succeeded: true }],
      NOW
    );
    const failed = planCacheApplyClearResults(
      plan,
      [
        { entryKey: planCacheEntryKey(selection[0]), succeeded: true },
        { entryKey: planCacheEntryKey(selection[1]), succeeded: false },
      ],
      NOW
    );
    expect(unaccounted.value.stalePlansMayRemain).toBe(failed.value.stalePlansMayRemain);
  });

  it('reports failed only when every plan is confirmed retained', () => {
    const { plan, selection } = authorized(2);
    const attempts: PlanCacheClearAttempt[] = selection.map(e => ({
      entryKey: planCacheEntryKey(e),
      succeeded: false,
      failureCode: 'busy',
    }));
    const report = planCacheApplyClearResults(plan, attempts, NOW);
    expect(report.value.verdict).toBe(PLAN_CACHE_CLEAR_VERDICTS.FAILED);
  });

  it('carries a per-plan outcome for every authorized plan', () => {
    const { plan, selection } = authorized(3);
    const report = planCacheApplyClearResults(
      plan,
      [{ entryKey: planCacheEntryKey(selection[0]), succeeded: true }],
      NOW
    );
    expect(report.value.outcomes.length).toBe(3);
    const kinds = report.value.outcomes.map(o => o.outcome);
    expect(kinds.filter(k => k === PLAN_CACHE_PLAN_OUTCOMES.CLEARED).length).toBe(1);
    expect(kinds.filter(k => k === PLAN_CACHE_PLAN_OUTCOMES.UNKNOWN).length).toBe(2);
  });

  it('refuses a report with no attempts array at all, which is a broken integration', () => {
    const { plan } = authorized(1);
    const report = planCacheApplyClearResults(plan, undefined as never, NOW);
    expect(report.ok).toBe(false);
    expect(report.code).toBe(PLAN_CACHE_REFUSAL_CODES.INVALID_OUTCOME);
  });

  it('refuses an authorisation with no plans', () => {
    const report = planCacheApplyClearResults({ targets: [] } as never, [], NOW);
    expect(report.ok).toBe(false);
    expect(report.code).toBe(PLAN_CACHE_REFUSAL_CODES.INVALID_OUTCOME);
  });

  it('refuses an invalid reporting instant', () => {
    const { plan } = authorized(1);
    expect(planCacheApplyClearResults(plan, [], Number.NaN).code).toBe(
      PLAN_CACHE_REFUSAL_CODES.INVALID_CLOCK
    );
  });

  it('refuses an outcome for a plan that was never authorized', () => {
    const { plan } = authorized(1);
    const report = planCacheApplyClearResults(
      plan,
      [{ entryKey: 'nao-autorizado|x', succeeded: true }],
      NOW
    );
    expect(report.ok).toBe(false);
    expect(report.code).toBe(PLAN_CACHE_REFUSAL_CODES.UNAUTHORIZED_OUTCOME);
  });

  it('carries an audit record on the report', () => {
    const { plan, selection } = authorized(1);
    const report = planCacheApplyClearResults(
      plan,
      [{ entryKey: planCacheEntryKey(selection[0]), succeeded: true }],
      NOW
    );
    expect(report.value.audit.kind).toBe(PLAN_CACHE_AUDIT_KINDS.CLEAR_COMPLETED);
    expect(report.value.audit.plans.length).toBe(1);
    expect(report.value.audit.complete).toBe(true);
  });

  it('files a partial audit kind for a partial clear', () => {
    const { plan, selection } = authorized(2);
    const report = planCacheApplyClearResults(
      plan,
      [
        { entryKey: planCacheEntryKey(selection[0]), succeeded: true },
        { entryKey: planCacheEntryKey(selection[1]), succeeded: false },
      ],
      NOW
    );
    expect(report.value.audit.kind).toBe(PLAN_CACHE_AUDIT_KINDS.CLEAR_PARTIAL);
  });

  it('names the re-import hazard in the reason for a partial clear', () => {
    const { plan, selection } = authorized(2);
    const report = planCacheApplyClearResults(
      plan,
      [{ entryKey: planCacheEntryKey(selection[0]), succeeded: true }],
      NOW
    );
    expect(report.value.reason.length > 0).toBe(true);
    expect(report.value.stalePlansMayRemain).toBe(true);
  });
});

describe('planCacheBuildInventory', () => {
  it('builds a row per entry with counts', () => {
    const result = planCacheBuildInventory(
      [current({ planId: 'A' }), current({ planId: 'B', revisionVerification: {} })],
      NOW,
      freeProbe
    );
    expect(result.ok).toBe(true);
    expect(result.value.rows.length).toBe(2);
    expect(result.value.counts.total).toBe(2);
    expect(result.value.counts.verifiableCurrent).toBe(1);
    expect(result.value.counts.snapshotUnverified).toBe(1);
  });

  it('reports invalid entries instead of dropping them', () => {
    const result = planCacheBuildInventory(
      [current(), { planId: '', patientRef: '', cachedAt: 0, sourceSystem: '' } as PlanCacheEntry],
      NOW,
      freeProbe
    );
    expect(result.value.rows.length).toBe(1);
    expect(result.value.invalidEntries.length).toBe(1);
  });

  it('flags two snapshots of the same plan id rather than refusing', () => {
    const result = planCacheBuildInventory(
      [current({ cachedAt: NOW - 2 * HOUR }), current({ cachedAt: NOW - 5 * HOUR })],
      NOW,
      freeProbe
    );
    expect(result.value.rows.length).toBe(2);
    expect(result.value.rows.filter(r => r.hasSiblingSnapshot).length).toBe(2);
  });

  it('marks a plan in use as not clearable', () => {
    const result = planCacheBuildInventory(
      [current({ usage: { kind: 'in-use', holder: 'Daemon' } })],
      NOW
    );
    expect(result.value.rows[0].clearable).toBe(false);
    expect(result.value.rows[0].blockers.length > 0).toBe(true);
    expect(result.value.counts.inUse).toBe(1);
  });

  it('marks a plan with unknown usage as not clearable', () => {
    const result = planCacheBuildInventory([current({ usage: undefined })], NOW);
    expect(result.value.rows[0].clearable).toBe(false);
    expect(result.value.counts.unknownUsage).toBe(1);
  });

  it('counts plans whose last treatment date is absent', () => {
    const result = planCacheBuildInventory([current({ lastTreatment: undefined })], NOW, freeProbe);
    expect(result.value.counts.lastTreatmentAbsent).toBe(1);
    expect(result.value.counts.neverTreated).toBe(0);
  });

  it('refuses a non-list inventory', () => {
    expect(planCacheBuildInventory(undefined as never, NOW).code).toBe(
      PLAN_CACHE_REFUSAL_CODES.INVALID_ENTRY
    );
  });

  it('refuses an invalid instant', () => {
    expect(planCacheBuildInventory([current()], Number.NaN).code).toBe(
      PLAN_CACHE_REFUSAL_CODES.INVALID_CLOCK
    );
  });

  it('accumulates the total cache size', () => {
    const result = planCacheBuildInventory(
      [current({ planId: 'A', sizeBytes: 1000 }), current({ planId: 'B', sizeBytes: 2000 })],
      NOW,
      freeProbe
    );
    expect(result.value.totalSizeBytes).toBe(3000);
  });
});
