import {
  OIDC_CLEARABLES,
  OIDC_CLOCK_SKEW_TOLERANCE_MS,
  OIDC_NON_DELEGABLE_PERMISSIONS,
  OIDC_PATIENT_DATA_CLEARABLES,
  OIDC_PERMISSIONS,
  OIDC_RENEWAL_BACKOFF_CAP_MS,
  OIDC_RENEWAL_JITTER_CAP_MS,
  OIDC_RENEWAL_LEAD_MS,
  OIDC_RENEWAL_MAX_ATTEMPTS,
  OIDC_REQUEST_BUDGET_MS,
  OIDC_ROLE_PERMISSIONS,
  OIDC_WILDCARD_PERMISSION,
  oidcAfterRenewalFailure,
  oidcAfterRenewalSuccess,
  oidcAnonymousSession,
  oidcAuthorize,
  oidcAuthorizeInstitution,
  oidcClampJitterMs,
  oidcEvaluateSession,
  oidcGrantFromSession,
  oidcLogoutBlocker,
  oidcParseRolesClaim,
  oidcParseUserInfo,
  oidcPermissionsForRoles,
  oidcPlanLogout,
  oidcPlanRenewal,
  oidcPresentWorklist,
  oidcRenewalBackoffMs,
  oidcResolveInstitution,
  oidcVerifyLogout,
  type OidcSessionSnapshot,
} from './oidcSession';

const NOW = 1_760_000_000_000;
const MIN = 60_000;

function live(over: Partial<OidcSessionSnapshot> = {}): OidcSessionSnapshot {
  return {
    status: 'authenticated',
    accessTokenIssuedAt: NOW - 5 * MIN,
    accessTokenExpiresAt: NOW + 10 * MIN,
    refreshTokenExpiresAt: NOW + 8 * 60 * MIN,
    canRenew: true,
    renewAttempts: 0,
    unsavedWork: [],
    ...over,
  };
}

const CLAIMS = {
  sub: 'idp|1234',
  name: 'Dra. Ana Souza',
  email: 'ana@hosp1.br',
  crm: 'CRM-SP-123456',
  institutions: ['HOSP1', 'HOSP2'],
  active_institution: 'HOSP1',
  roles: ['Radiologist'],
};

/* ------------------------------------------------------------------ */

describe('oidcEvaluateSession, FM-1', () => {
  it('calls a fresh token usable', () => {
    const result = oidcEvaluateSession(live(), NOW);
    expect(result.ok).toBe(true);
    expect(result.value.kind).toBe('usable');
    expect(result.value.usable).toBe(true);
    expect(result.value.dataMayBeRendered).toBe(true);
  });

  it('asks for renewal once inside the lead margin, while still usable', () => {
    const result = oidcEvaluateSession(
      live({ accessTokenExpiresAt: NOW + OIDC_RENEWAL_LEAD_MS - 1 }),
      NOW
    );
    expect(result.value.kind).toBe('renewSoon');
    expect(result.value.usable).toBe(true);
    expect(result.value.msUntilRenewDue).toBe(0);
  });

  it('stops issuing new work once inside the request budget, but stays authenticated', () => {
    const result = oidcEvaluateSession(
      live({ accessTokenExpiresAt: NOW + OIDC_REQUEST_BUDGET_MS - 1 }),
      NOW
    );
    expect(result.value.kind).toBe('renewNow');
    expect(result.value.usable).toBe(false);
    expect(result.value.authenticated).toBe(true);
    expect(result.value.dataMayBeRendered).toBe(true);
  });

  it('reports expired once the token is gone', () => {
    const result = oidcEvaluateSession(live({ accessTokenExpiresAt: NOW - 1 }), NOW);
    expect(result.value.kind).toBe('expired');
    expect(result.value.usable).toBe(false);
    expect(result.value.msRemaining < 0).toBe(true);
  });

  it('reports an expired token as renewable while the refresh token lives', () => {
    const result = oidcEvaluateSession(live({ accessTokenExpiresAt: NOW - 1 }), NOW);
    expect(result.value.renewable).toBe(true);
  });

  it('reports an expired token as unrenewable once the refresh token is gone', () => {
    const result = oidcEvaluateSession(
      live({ accessTokenExpiresAt: NOW - 1, refreshTokenExpiresAt: NOW - 1 }),
      NOW
    );
    expect(result.value.renewable).toBe(false);
  });

  it('treats an anonymous session as unauthenticated', () => {
    const result = oidcEvaluateSession(oidcAnonymousSession(), NOW);
    expect(result.value.kind).toBe('unauthenticated');
    expect(result.value.dataMayBeRendered).toBe(false);
  });

  it('carries the termination reason so the UI can say why', () => {
    const result = oidcEvaluateSession(
      { status: 'terminated', terminatedReason: 'Inatividade na estacao.' },
      NOW
    );
    expect(result.value.kind).toBe('unauthenticated');
    expect(result.value.reason).toContain('Inatividade');
  });

  it('refuses when now is not a number, rather than falling through to usable', () => {
    const result = oidcEvaluateSession(live(), undefined as never);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('oidc.invalidClock');
  });

  it('refuses a malformed session', () => {
    expect(oidcEvaluateSession('sessao' as never, NOW).code).toBe('oidc.malformedSession');
  });

  it('refuses an unknown status', () => {
    expect(oidcEvaluateSession({ status: 'pending' as never }, NOW).code).toBe(
      'oidc.malformedSession'
    );
  });

  it('refuses an authenticated session with no expiry instead of treating it as eternal', () => {
    const result = oidcEvaluateSession(live({ accessTokenExpiresAt: undefined }), NOW);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('oidc.malformedSession');
  });

  it('refuses a token issued in the future beyond the skew tolerance', () => {
    const result = oidcEvaluateSession(
      live({ accessTokenIssuedAt: NOW + OIDC_CLOCK_SKEW_TOLERANCE_MS + 1 }),
      NOW
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe('oidc.clockSkew');
    expect(result.reason).toContain('ajuste a hora');
  });

  it('tolerates a small forward skew, which is ordinary', () => {
    const result = oidcEvaluateSession(
      live({ accessTokenIssuedAt: NOW + OIDC_CLOCK_SKEW_TOLERANCE_MS }),
      NOW
    );
    expect(result.ok).toBe(true);
  });

  it('refuses a token whose expiry is not after its issuance', () => {
    const result = oidcEvaluateSession(
      live({ accessTokenIssuedAt: NOW, accessTokenExpiresAt: NOW }),
      NOW
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe('oidc.malformedSession');
  });

  it('refuses a non-finite issued-at', () => {
    expect(oidcEvaluateSession(live({ accessTokenIssuedAt: Number.NaN }), NOW).ok).toBe(false);
  });

  it('flags unsaved clinical work on the verdict', () => {
    const result = oidcEvaluateSession(
      live({ unsavedWork: [{ kind: 'draftReport', id: 'LAU-1' }] }),
      NOW
    );
    expect(result.value.unsavedWorkAtRisk).toBe(true);
  });
});

describe('oidcPresentWorklist, FM-2', () => {
  const usable = oidcEvaluateSession(live(), NOW).value;
  const dead = oidcEvaluateSession(oidcAnonymousSession(), NOW).value;

  it('draws studies when there are results', () => {
    expect(oidcPresentWorklist(usable, true, 7).value).toBe('studies');
  });

  it('draws a genuine empty state when the query completed with nothing', () => {
    expect(oidcPresentWorklist(usable, true, 0).value).toBe('empty');
  });

  it('draws loading, never empty, before the query completes', () => {
    expect(oidcPresentWorklist(usable, false, 0).value).toBe('loading');
  });

  it('never draws an empty worklist for an ended session', () => {
    const presentation = oidcPresentWorklist(dead, true, 0).value;
    expect(presentation).toBe('sessionEnded');
    expect(presentation).not.toBe('empty');
  });

  it('lets session state dominate a stale loaded flag', () => {
    expect(oidcPresentWorklist(dead, true, 12).value).toBe('sessionEnded');
  });

  it('refuses an undefined count instead of reporting studies', () => {
    const result = oidcPresentWorklist(usable, true, undefined as never);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('oidc.malformedSession');
  });

  it('refuses a negative count', () => {
    expect(oidcPresentWorklist(usable, true, -1).ok).toBe(false);
  });

  it('refuses a malformed verdict', () => {
    expect(oidcPresentWorklist(undefined as never, true, 0).ok).toBe(false);
  });
});

describe('renewal backoff and planning', () => {
  // Attempt 0 is the first, unforced try: it happens immediately, so there is nothing to
  // back off from yet. Doubling starts at the first recorded failure.
  it('is immediate on the first attempt, before any failure', () => {
    expect(oidcRenewalBackoffMs(0)).toBe(0);
  });

  it('doubles with each recorded failure', () => {
    expect(oidcRenewalBackoffMs(2)).toBe(oidcRenewalBackoffMs(1) * 2);
    expect(oidcRenewalBackoffMs(3)).toBe(oidcRenewalBackoffMs(1) * 4);
  });

  it('caps the delay', () => {
    expect(oidcRenewalBackoffMs(50)).toBe(OIDC_RENEWAL_BACKOFF_CAP_MS);
  });

  it('adds injected jitter rather than generating any', () => {
    expect(oidcRenewalBackoffMs(1, 500)).toBe(oidcRenewalBackoffMs(1) + 500);
  });

  it('does not jitter an immediate first attempt', () => {
    expect(oidcRenewalBackoffMs(0, 500)).toBe(0);
  });

  it('clamps jitter to the cap', () => {
    expect(oidcClampJitterMs(999_999)).toBe(OIDC_RENEWAL_JITTER_CAP_MS);
  });

  it('clamps negative jitter to zero', () => {
    expect(oidcClampJitterMs(-5)).toBe(0);
  });

  it('treats absent jitter as zero', () => {
    expect(oidcClampJitterMs(undefined)).toBe(0);
  });

  it('waits when renewal is not due yet', () => {
    const plan = oidcPlanRenewal(live(), NOW);
    expect(plan.ok).toBe(true);
    expect(plan.value.action).toBe('wait');
    expect(plan.value.delayMs > 0).toBe(true);
  });

  it('renews now once inside the lead margin', () => {
    const plan = oidcPlanRenewal(live({ accessTokenExpiresAt: NOW + 1000 }), NOW);
    expect(plan.value.action).toBe('renewNow');
    expect(plan.value.delayMs).toBe(0);
  });

  it('retries with backoff after a failure', () => {
    const plan = oidcPlanRenewal(live({ status: 'renewing', renewAttempts: 2 }), NOW);
    expect(plan.value.action).toBe('retry');
    expect(plan.value.attempt).toBe(2);
    expect(plan.value.delayMs).toBe(oidcRenewalBackoffMs(2));
  });

  it('reports the attempts remaining', () => {
    const plan = oidcPlanRenewal(live({ status: 'renewing', renewAttempts: 1 }), NOW);
    expect(plan.value.attemptsRemaining).toBe(OIDC_RENEWAL_MAX_ATTEMPTS - 1);
  });

  it('refuses once the attempts are used up', () => {
    const plan = oidcPlanRenewal(
      live({ status: 'renewing', renewAttempts: OIDC_RENEWAL_MAX_ATTEMPTS }),
      NOW
    );
    expect(plan.ok).toBe(false);
    expect(plan.code).toBe('oidc.renewExhausted');
  });

  it('refuses when there is no session to renew', () => {
    expect(oidcPlanRenewal(oidcAnonymousSession(), NOW).code).toBe('oidc.noSession');
  });

  it('refuses when renewal is not possible at all', () => {
    const plan = oidcPlanRenewal(
      live({ canRenew: false, refreshTokenExpiresAt: NOW - 1, accessTokenExpiresAt: NOW - 1 }),
      NOW
    );
    expect(plan.ok).toBe(false);
    expect(plan.code).toBe('oidc.notRenewable');
  });

  it('propagates a clock-skew refusal instead of reporting an expired session', () => {
    const plan = oidcPlanRenewal(
      live({ accessTokenIssuedAt: NOW + OIDC_CLOCK_SKEW_TOLERANCE_MS + 1 }),
      NOW
    );
    expect(plan.ok).toBe(false);
    expect(plan.code).toBe('oidc.clockSkew');
  });

  it('refuses an invalid clock', () => {
    expect(oidcPlanRenewal(live(), Number.NaN).code).toBe('oidc.invalidClock');
  });
});

describe('renewal outcome transitions', () => {
  it('counts a failure and keeps renewing below the max', () => {
    const next = oidcAfterRenewalFailure(live(), NOW);
    expect(next.status).toBe('renewing');
    expect(next.renewAttempts).toBe(1);
  });

  it('terminates at the max with a reason the user can act on', () => {
    const next = oidcAfterRenewalFailure(
      live({ renewAttempts: OIDC_RENEWAL_MAX_ATTEMPTS - 1 }),
      NOW
    );
    expect(next.status).toBe('terminated');
    expect(next.canRenew).toBe(false);
    expect(next.terminatedReason).toContain('login');
  });

  it('keeps a supplied error as the termination reason', () => {
    const next = oidcAfterRenewalFailure(
      live({ renewAttempts: OIDC_RENEWAL_MAX_ATTEMPTS - 1 }),
      NOW,
      'IdP indisponivel.'
    );
    expect(next.terminatedReason).toBe('IdP indisponivel.');
  });

  it('resets the counter on success', () => {
    const result = oidcAfterRenewalSuccess(
      live({ status: 'renewing', renewAttempts: 3 }),
      NOW,
      NOW + 30 * MIN
    );
    expect(result.ok).toBe(true);
    expect(result.value.status).toBe('authenticated');
    expect(result.value.renewAttempts).toBe(0);
  });

  it('refuses a renewed token that is already inside the request budget', () => {
    const result = oidcAfterRenewalSuccess(live(), NOW, NOW + OIDC_REQUEST_BUDGET_MS);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('validade insuficiente');
  });

  it('refuses a renewed token with invalid dates', () => {
    expect(oidcAfterRenewalSuccess(live(), Number.NaN, NOW).ok).toBe(false);
  });
});

describe('oidcParseUserInfo and institution scope, FM-5', () => {
  it('parses a complete claim set', () => {
    const result = oidcParseUserInfo(CLAIMS);
    expect(result.ok).toBe(true);
    expect(result.value.subject).toBe('idp|1234');
    expect(result.value.institutionId).toBe('HOSP1');
    expect(result.value.roles).toEqual(['radiologist']);
    expect(result.value.permissions.indexOf(OIDC_PERMISSIONS.reportSign) >= 0).toBe(true);
  });

  it('lowercases roles so two IdP mappers cannot disagree', () => {
    const upper = oidcParseUserInfo({ ...CLAIMS, roles: ['RADIOLOGIST'] });
    expect(upper.value.permissions).toEqual(oidcParseUserInfo(CLAIMS).value.permissions);
  });

  it('never emits the wildcard permission', () => {
    for (const role of Object.keys(OIDC_ROLE_PERMISSIONS)) {
      const parsed = oidcParseUserInfo({ ...CLAIMS, roles: [role] });
      expect(parsed.value.permissions.indexOf(OIDC_WILDCARD_PERMISSION)).toBe(-1);
    }
  });

  it('refuses a claim set with no subject', () => {
    const result = oidcParseUserInfo({ ...CLAIMS, sub: '' });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('oidc.missingSubject');
  });

  it('refuses a non-object claim set', () => {
    expect(oidcParseUserInfo('token').code).toBe('oidc.malformedUserInfo');
  });

  it('refuses a claim set with no institution rather than defaulting to one', () => {
    const result = oidcParseUserInfo({ ...CLAIMS, active_institution: undefined, institutions: [] });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('oidc.missingInstitution');
  });

  it('refuses two institutions with none designated active', () => {
    const result = oidcResolveInstitution({
      institutions: ['HOSP1', 'HOSP2'],
      active_institution: undefined,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('oidc.missingInstitution');
  });

  it('accepts a single institution as the active one', () => {
    const result = oidcResolveInstitution({ institutions: ['HOSP1'] });
    expect(result.ok).toBe(true);
    expect(result.value.institutionId).toBe('HOSP1');
  });

  it('refuses an active institution the account does not belong to', () => {
    const result = oidcResolveInstitution({
      institutions: ['HOSP1'],
      active_institution: 'HOSP9',
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('oidc.missingInstitution');
  });

  it('accepts the tenant claim as an alias', () => {
    expect(oidcResolveInstitution({ tenant: 'HOSP7' }).value.institutionId).toBe('HOSP7');
  });

  it('keeps the professional registration when present', () => {
    expect(oidcParseUserInfo(CLAIMS).value.registration).toBe('CRM-SP-123456');
  });

  it('does not treat a missing registration as an error here', () => {
    const result = oidcParseUserInfo({ ...CLAIMS, crm: undefined });
    expect(result.ok).toBe(true);
    expect(result.value.registration).toBe(undefined);
  });

  it('surfaces unknown roles without granting them anything', () => {
    const result = oidcParseUserInfo({ ...CLAIMS, roles: ['radiologist', 'chefe_de_setor'] });
    expect(result.value.unknownRoles).toEqual(['chefe_de_setor']);
    expect(result.value.permissions).toEqual(oidcParseUserInfo(CLAIMS).value.permissions);
  });
});

describe('oidcParseRolesClaim', () => {
  it('accepts an array of strings', () => {
    expect(oidcParseRolesClaim({ roles: ['a', 'b'] }).value).toEqual(['a', 'b']);
  });

  // A comma- or space-delimited string is a shape real providers send, and it is handled in
  // one audited place here rather than being left to a glue layer that would do the same
  // split with no guard and no test.
  it('accepts a delimited string, which is a real provider shape', () => {
    expect(oidcParseRolesClaim({ roles: 'Radiologist, admin' }).value).toEqual([
      'radiologist',
      'admin',
    ]);
  });

  it('reads the Keycloak realm_access nesting', () => {
    expect(oidcParseRolesClaim({ realm_access: { roles: ['physicist'] } }).value).toEqual([
      'physicist',
    ]);
  });

  it('refuses a shape it will not guess at', () => {
    const result = oidcParseRolesClaim({ roles: { radiologist: true } });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('oidc.unparseableRoles');
  });

  it('refuses an array containing a non-string', () => {
    expect(oidcParseRolesClaim({ roles: ['radiologist', 7] }).ok).toBe(false);
  });

  it('refuses an absent roles claim', () => {
    expect(oidcParseRolesClaim({}).code).toBe('oidc.unparseableRoles');
  });

  it('accepts a present but empty array, which means no roles', () => {
    const result = oidcParseRolesClaim({ roles: [] });
    expect(result.ok).toBe(true);
    expect(result.value).toEqual([]);
  });
});

describe('oidcPermissionsForRoles, FM-3 fail closed', () => {
  it('grants nothing for absent roles', () => {
    expect(oidcPermissionsForRoles(undefined).permissions).toEqual([]);
  });

  it('grants nothing for an empty role array', () => {
    expect(oidcPermissionsForRoles([]).permissions).toEqual([]);
  });

  it('grants nothing for a role nobody configured', () => {
    const grant = oidcPermissionsForRoles(['chefe_de_setor']);
    expect(grant.permissions).toEqual([]);
    expect(grant.unknownRoles).toEqual(['chefe_de_setor']);
  });

  it('grants a radiologist the right to sign', () => {
    expect(
      oidcPermissionsForRoles(['radiologist']).permissions.indexOf(OIDC_PERMISSIONS.reportSign) >= 0
    ).toBe(true);
  });

  it('does not grant a resident the right to sign', () => {
    expect(
      oidcPermissionsForRoles(['resident']).permissions.indexOf(OIDC_PERMISSIONS.reportSign)
    ).toBe(-1);
  });

  it('does not grant an administrator the right to sign', () => {
    const grant = oidcPermissionsForRoles(['admin']);
    for (const permission of OIDC_NON_DELEGABLE_PERMISSIONS) {
      expect(grant.permissions.indexOf(permission)).toBe(-1);
    }
  });

  it('does not grant a technologist report editing', () => {
    expect(
      oidcPermissionsForRoles(['technologist']).permissions.indexOf(OIDC_PERMISSIONS.reportEdit)
    ).toBe(-1);
  });

  it('unions permissions across roles', () => {
    const both = oidcPermissionsForRoles(['technologist', 'referring']).permissions;
    expect(both.indexOf(OIDC_PERMISSIONS.reportRead) >= 0).toBe(true);
    expect(both.indexOf(OIDC_PERMISSIONS.measurementEdit) >= 0).toBe(true);
  });

  it('records which role granted each permission', () => {
    const grant = oidcPermissionsForRoles(['radiologist']);
    expect(grant.grantedBy[OIDC_PERMISSIONS.reportSign]).toEqual(['radiologist']);
  });

  it('does not let a wildcard role name confer anything', () => {
    expect(oidcPermissionsForRoles([OIDC_WILDCARD_PERMISSION]).permissions).toEqual([]);
  });

  it('grants an auditor cross-institution viewing but not signing', () => {
    const grant = oidcPermissionsForRoles(['auditor']);
    expect(grant.permissions.indexOf(OIDC_PERMISSIONS.studyViewAllInstitutions) >= 0).toBe(true);
    expect(grant.permissions.indexOf(OIDC_PERMISSIONS.reportSign)).toBe(-1);
  });
});

describe('oidcAuthorize and oidcGrantFromSession', () => {
  function grantFor(roles: string[]) {
    const session = live({ userInfo: oidcParseUserInfo({ ...CLAIMS, roles }).value });
    return oidcGrantFromSession(session, NOW).value;
  }

  it('allows an action the role covers', () => {
    expect(oidcAuthorize('report.sign', grantFor(['radiologist'])).ok).toBe(true);
  });

  it('forbids an action the role does not cover', () => {
    const result = oidcAuthorize('report.sign', grantFor(['resident']));
    expect(result.ok).toBe(false);
    expect(result.code).toBe('oidc.forbidden');
  });

  it('separates being logged in from being allowed', () => {
    const result = oidcAuthorize('report.sign', grantFor([]));
    expect(result.ok).toBe(false);
    expect(result.code).toBe('oidc.forbidden');
  });

  it('refuses every action for an unauthenticated grant', () => {
    const result = oidcAuthorize('worklist.view', { authenticated: false });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('oidc.notAuthenticated');
  });

  it('fails closed on an action nobody registered', () => {
    const result = oidcAuthorize('report.publishToInstagram', grantFor(['radiologist']));
    expect(result.ok).toBe(false);
    expect(result.code).toBe('oidc.unknownAction');
  });

  it('refuses an unnamed action', () => {
    expect(oidcAuthorize('  ', grantFor(['radiologist'])).code).toBe('oidc.unknownAction');
  });

  it('allows an action with no requirements to any authenticated user', () => {
    expect(oidcAuthorize('session.read', grantFor([])).ok).toBe(true);
  });

  it('derives authenticated from the clock, not from a user object existing', () => {
    const expired = live({ accessTokenExpiresAt: NOW - 1, canRenew: false, refreshTokenExpiresAt: NOW - 1 });
    expired.userInfo = oidcParseUserInfo(CLAIMS).value;
    const grant = oidcGrantFromSession(expired, NOW);
    expect(grant.value.authenticated).toBe(false);
    expect(oidcAuthorize('worklist.view', grant.value).code).toBe('oidc.notAuthenticated');
  });

  it('propagates a refusal from session evaluation', () => {
    expect(oidcGrantFromSession(live({ accessTokenExpiresAt: undefined }), NOW).ok).toBe(false);
  });

  function infoFor(roles: string[]) {
    return oidcParseUserInfo({ ...CLAIMS, roles }).value;
  }

  it('allows same-institution access', () => {
    expect(
      oidcAuthorizeInstitution(infoFor(['radiologist']), 'HOSP1', grantFor(['radiologist'])).ok
    ).toBe(true);
  });

  it('refuses another institution without the cross-institution permission', () => {
    const result = oidcAuthorizeInstitution(
      infoFor(['radiologist']),
      'HOSP2',
      grantFor(['radiologist'])
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe('oidc.institutionMismatch');
  });

  // The account lists HOSP2 among its institutions, and that on its own must not grant
  // access to HOSP2's studies while HOSP1 is the active scope.
  it('does not infer cross-institution access from the account listing both', () => {
    expect(
      oidcAuthorizeInstitution(infoFor(['radiologist']), 'HOSP2', grantFor(['radiologist'])).code
    ).toBe('oidc.institutionMismatch');
  });

  it('allows another institution to an auditor, by permission', () => {
    expect(oidcAuthorizeInstitution(infoFor(['auditor']), 'HOSP2', grantFor(['auditor'])).ok).toBe(
      true
    );
  });

  it('refuses a resource with no institution at all', () => {
    const result = oidcAuthorizeInstitution(infoFor(['auditor']), '  ', grantFor(['auditor']));
    expect(result.ok).toBe(false);
    expect(result.code).toBe('oidc.institutionMismatch');
  });

  it('refuses when the session has no institution', () => {
    expect(oidcAuthorizeInstitution({ institutionId: '' } as never, 'HOSP1').code).toBe(
      'oidc.missingInstitution'
    );
  });
});

describe('oidcPlanLogout and oidcVerifyLogout, FM-4', () => {
  it('enumerates everything that has to be cleared', () => {
    const plan = oidcPlanLogout(live(), { cause: 'user' }, NOW);
    expect(plan.ok).toBe(true);
    expect(plan.value.clearables.length).toBe(OIDC_CLEARABLES.length);
  });

  it('never makes local clearing wait on the identity provider', () => {
    const plan = oidcPlanLogout(
      live(),
      { cause: 'user', endSessionEndpoint: 'https://idp/logout', idpReachable: false },
      NOW
    );
    expect(plan.value.endSessionRedirectRequired).toBe(false);
    expect(plan.value.serverSideRevocationPending).toBe(true);
  });

  it('refuses an unknown cause', () => {
    expect(oidcPlanLogout(live(), { cause: 'porque' as never }, NOW).code).toBe(
      'oidc.malformedLogout'
    );
  });

  it('refuses a plan with no cause', () => {
    expect(oidcPlanLogout(live(), {} as never, NOW).code).toBe('oidc.malformedLogout');
  });

  it('refuses an invalid clock', () => {
    expect(oidcPlanLogout(live(), { cause: 'user' }, Number.NaN).code).toBe('oidc.invalidClock');
  });

  it('blocks a user-initiated logout that would destroy a draft report', () => {
    const plan = oidcPlanLogout(
      live({ unsavedWork: [{ kind: 'draftReport', id: 'LAU-1' }] }),
      { cause: 'user' },
      NOW
    );
    expect(plan.ok).toBe(false);
    expect(plan.code).toBe('oidc.unsavedWork');
  });

  it('proceeds once the user has confirmed the discard', () => {
    const plan = oidcPlanLogout(
      live({ unsavedWork: [{ kind: 'draftReport', id: 'LAU-1' }] }),
      { cause: 'user', unsavedWorkConfirmedDiscardable: true },
      NOW
    );
    expect(plan.ok).toBe(true);
  });

  it('does not block an involuntary logout, but reports the work at risk', () => {
    const plan = oidcPlanLogout(
      live({ unsavedWork: [{ kind: 'draftReport', id: 'LAU-1' }] }),
      { cause: 'idle' },
      NOW
    );
    expect(plan.ok).toBe(true);
    expect(plan.value.unsavedWork.length).toBe(1);
    expect(plan.value.requiresUnsavedWorkHandoff).toBe(true);
  });

  function planFor(cause: 'user' | 'idle' = 'user') {
    const plan = oidcPlanLogout(live(), { cause }, NOW);
    if (!plan.ok) {
      throw new Error('fixture broken');
    }
    return plan.value;
  }

  it('confirms a workstation clean when everything was cleared', () => {
    const plan = planFor();
    const outcome = oidcVerifyLogout(plan, { cleared: plan.clearables.slice() });
    expect(outcome.ok).toBe(true);
    expect(outcome.value.complete).toBe(true);
    expect(outcome.value.safeToReleaseWorkstation).toBe(true);
    expect(outcome.value.residualPatientData).toBe(false);
  });

  it('treats an item nobody reported on as not cleared', () => {
    const plan = planFor();
    const outcome = oidcVerifyLogout(plan, {
      cleared: plan.clearables.filter(item => item !== 'oidc.imageCache'),
    });
    expect(outcome.value.complete).toBe(false);
    expect(outcome.value.missing).toEqual(['oidc.imageCache']);
    expect(outcome.value.safeToReleaseWorkstation).toBe(false);
  });

  it('flags residual patient data when the missing item carries it', () => {
    const plan = planFor();
    const outcome = oidcVerifyLogout(plan, {
      cleared: plan.clearables.filter(item => item !== 'oidc.seriesMetadataCache'),
    });
    expect(outcome.value.residualPatientData).toBe(true);
  });

  it('does not flag residual patient data for a merely untidy leftover', () => {
    const plan = planFor();
    const outcome = oidcVerifyLogout(plan, {
      cleared: plan.clearables.filter(item => item !== 'oidc.hangingProtocolState'),
    });
    expect(outcome.value.complete).toBe(false);
    expect(outcome.value.residualPatientData).toBe(false);
  });

  it('lands a typo in missing rather than quietly matching nothing', () => {
    const plan = planFor();
    const cleared = plan.clearables.filter(item => item !== 'oidc.measurements');
    cleared.push('oidc.measurement');
    const outcome = oidcVerifyLogout(plan, { cleared });
    expect(outcome.value.missing.indexOf('oidc.measurements') >= 0).toBe(true);
  });

  it('counts an item reported both cleared and failed as failed', () => {
    const plan = planFor();
    const outcome = oidcVerifyLogout(plan, {
      cleared: plan.clearables.slice(),
      failed: [{ item: 'oidc.indexedDb', error: 'blocked' }],
    });
    expect(outcome.value.complete).toBe(false);
    expect(outcome.value.failed.indexOf('oidc.indexedDb') >= 0).toBe(true);
  });

  it('is complete even when the identity-provider redirect failed', () => {
    const plan = oidcPlanLogout(
      live(),
      { cause: 'user', endSessionEndpoint: 'https://idp/logout', idpReachable: true },
      NOW
    ).value;
    const outcome = oidcVerifyLogout(plan, {
      cleared: plan.clearables.slice(),
      endSessionRedirectPerformed: false,
    });
    expect(outcome.value.complete).toBe(true);
    expect(outcome.value.serverSideRevocationPending).toBe(true);
  });

  it('reports unsaved work that was destroyed without being saved', () => {
    const plan = oidcPlanLogout(
      live({ unsavedWork: [{ kind: 'draftReport', id: 'LAU-1' }] }),
      { cause: 'idle' },
      NOW
    ).value;
    const outcome = oidcVerifyLogout(plan, { cleared: plan.clearables.slice() });
    expect(outcome.value.unsavedWorkDiscarded).toEqual(['LAU-1']);
  });

  it('reports nothing discarded once the work was persisted', () => {
    const plan = oidcPlanLogout(
      live({ unsavedWork: [{ kind: 'draftReport', id: 'LAU-1' }] }),
      { cause: 'idle' },
      NOW
    ).value;
    const outcome = oidcVerifyLogout(plan, {
      cleared: plan.clearables.slice(),
      persistedUnsavedWork: ['LAU-1'],
    });
    expect(outcome.value.unsavedWorkDiscarded).toEqual([]);
  });

  it('refuses a malformed plan', () => {
    expect(oidcVerifyLogout(undefined as never, { cleared: [] }).code).toBe('oidc.malformedLogout');
  });

  it('refuses a malformed report', () => {
    expect(oidcVerifyLogout(planFor(), undefined as never).code).toBe('oidc.malformedLogout');
  });

  it('treats a report with nothing in it as everything missing', () => {
    const outcome = oidcVerifyLogout(planFor(), {});
    expect(outcome.value.complete).toBe(false);
    expect(outcome.value.missing.length).toBe(OIDC_CLEARABLES.length);
  });

  it('oidcLogoutBlocker refuses while the workstation is not safe', () => {
    const plan = planFor();
    const dirty = oidcVerifyLogout(plan, { cleared: [] }).value;
    const clean = oidcVerifyLogout(plan, { cleared: plan.clearables.slice() }).value;
    expect(oidcLogoutBlocker(dirty).ok).toBe(false);
    expect(oidcLogoutBlocker(clean).ok).toBe(true);
  });

  it('lists every patient-data clearable inside the full clearable list', () => {
    for (const item of OIDC_PATIENT_DATA_CLEARABLES) {
      expect((OIDC_CLEARABLES as readonly string[]).indexOf(item) >= 0).toBe(true);
    }
  });
});
