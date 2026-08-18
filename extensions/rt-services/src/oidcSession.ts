/**
 * OIDC session, renewal, RBAC and logout — pure decision core (RTV-155).
 *
 * This module decides four things and nothing else: whether a session may be used right
 * now, when and whether to renew it, what the person holding it is allowed to do, and what
 * a logout is obliged to erase. There is no `UserManager` here, no React context, no
 * `fetch`, no `localStorage`. Those are thin glue written against this core, and they are
 * thin precisely because every judgement call lives here where it can be read and tested.
 *
 * Time is always injected as `now` (epoch ms). Nothing in this file reads a clock or a
 * random number generator, so every verdict below is reproducible from its arguments.
 *
 * ## Why renewal is decided against a margin and not against `expiresAt`
 *
 * The naive check is `expiresAt > now`. It is wrong in a way that only shows up under load:
 * a token with 800 ms of life left passes the check, the viewer then issues a WADO-RS
 * retrieve for a 900-image series, and the request fails partway through with a 401 — after
 * the radiologist scrolled. The user experiences it as "the viewer broke", not as "my
 * session ended", and the natural reaction is to retry, which fails again.
 *
 * So there are two margins, and they are different quantities:
 *
 * - {@link OIDC_RENEWAL_LEAD_MS} is when we start renewing in the background while the
 *   token is still perfectly good. Being early costs one extra token request.
 * - {@link OIDC_REQUEST_BUDGET_MS} is the point at which the token stops being usable for
 *   *new* work, because a request started now will probably outlive it. It is a floor and
 *   not a guarantee: a large series retrieve can exceed any fixed budget, which is why the
 *   real protection is the lead margin, and this one is only the last line.
 *
 * Both boundaries are inclusive in the safe direction: exactly at the margin we renew, and
 * exactly at the budget the token is already unusable. An off-by-one in that direction
 * costs one redundant token request; in the other direction it costs a failed request in
 * the middle of a study.
 *
 * ## Clock skew cuts both ways, and one direction is not recoverable
 *
 * The browser clock and the identity provider's clock disagree. If the browser is behind,
 * we think the token has more life than it does, and the margin absorbs it. If the browser
 * is ahead, we renew early, which is harmless. But a token whose `issuedAt` is in the
 * future by more than {@link OIDC_CLOCK_SKEW_TOLERANCE_MS} tells us the two clocks disagree
 * by more than any margin can absorb, and at that point we cannot compute a trustworthy
 * remaining lifetime at all. That is a **refusal**, not a value to accept quietly: a
 * workstation with a badly wrong clock must show an error a technician can act on, because
 * the alternative is a viewer that renews at random and logs people out mid-dictation.
 *
 * ## "Not signed in" is not "there are no studies"
 *
 * This is the failure mode that makes silent renewal dangerous. When renewal fails and the
 * app keeps rendering, the worklist query returns nothing and the screen shows an empty
 * list. A radiologist reads an empty worklist as a fact about the world — there is nothing
 * to report — and moves on. The study was there the whole time.
 *
 * {@link oidcPresentWorklist} exists so that no list-rendering path can collapse those
 * cases. It keeps four states apart: not loaded, loaded and genuinely empty, loaded with
 * results, and *unauthenticated, so the count means nothing*. The same distinction is drawn
 * elsewhere in this codebase between an empty result and an absent one, for the same reason.
 *
 * ## Renewal gives up, on purpose, and says why
 *
 * Retrying forever is how a viewer ends up showing a spinner over a session that died ten
 * minutes ago. {@link oidcPlanRenewal} bounds attempts ({@link OIDC_RENEWAL_MAX_ATTEMPTS}),
 * derives its delay from the attempt count alone, and refuses with a distinct code once it
 * is done. It also refuses early when the arithmetic says the retry is pointless — if the
 * refresh token expires before the next backoff window elapses, waiting is strictly worse
 * than telling the user now.
 *
 * Any jitter has to be injected, because this module has no randomness. Injected jitter is
 * clamped: a caller that passes a jitter larger than the lead margin would convert a
 * scheduled renewal into an expiry, which is the bug the schedule exists to prevent.
 *
 * ## RBAC fails closed, and "logged in" is not a permission
 *
 * A missing or unparseable roles claim maps to *no* permissions. Never to a default set,
 * and never to "well, they authenticated, so let them read". The outcome being avoided is
 * concrete: a newly provisioned account with no role yet assigned being able to sign a
 * radiology report, or to open a study belonging to another physician's patient.
 *
 * Roles become permissions through {@link OIDC_ROLE_PERMISSIONS}, an explicit table. An
 * unknown role grants nothing — it is reported in `unknownRoles` so a misconfigured IdP
 * mapper is visible to operations, but it never inherits a neighbouring role's rights.
 *
 * Two deliberate refusals of convenience:
 *
 * - This module never emits `'*'`. The RTV-154 consumer treats a `'*'` entry, and the bare
 *   `admin` role, as "holds everything". A wildcard synthesised out of an IdP claim would
 *   therefore hand an IT administrator the ability to sign a report. See
 *   {@link OIDC_NON_DELEGABLE_PERMISSIONS}: signing is a physician's act tied to a CRM, and
 *   no amount of administrative privilege substitutes for it.
 * - {@link oidcAuthorize} refuses actions it does not recognise. An action table that
 *   returns "allowed" for an unlisted action fails open on exactly the actions somebody
 *   forgot to register, which are the new ones.
 *
 * ## Logout has to assume the workstation is shared, and that the network is down
 *
 * Reading rooms share workstations. A logout that navigates away while cached study
 * metadata, a measurement collection or a worklist filter containing a patient name is
 * still in memory leaves the next user one back-button press from the previous patient's
 * imaging. So logout is not an action here, it is a **list**: {@link oidcPlanLogout}
 * enumerates every clearable, and {@link oidcVerifyLogout} treats anything the glue layer
 * did not explicitly confirm as *not cleared*. Silence is never success.
 *
 * Local clearing never depends on the identity provider being reachable. If the
 * end-session redirect fails, the plan still clears everything locally and reports
 * `serverSideRevocationPending`, because a session we cannot revoke remotely is a problem
 * for the IdP's session registry, whereas patient data left on the screen is a problem for
 * the patient.
 *
 * ## The one place two safety rules genuinely conflict
 *
 * A dictated report is open, unsaved, and the session ends. Confidentiality says wipe the
 * workstation; not losing clinical work says keep the draft. Both are real harms.
 *
 * The resolution encoded here depends on whether a human is present. A user-initiated
 * logout is *blocked* pending confirmation — the person is right there, ask them. A forced
 * end (expiry, failed renewal, remote sign-out) cannot block, because there is nobody to
 * answer, so confidentiality wins: the draft store is cleared. But it is never cleared
 * silently. The plan flags `requiresUnsavedWorkHandoff` so the UI must attempt to persist
 * first, and {@link oidcVerifyLogout} reports every item that was destroyed without being
 * saved in `unsavedWorkDiscarded`. Losing a dictation is bad; losing it and not knowing is
 * worse, because nobody re-dictates a report they think they filed.
 *
 * ## Multi-institution: the claim is never defaulted
 *
 * This deployment serves more than one hospital. A user info payload with no institution
 * claim, or with several and no active one designated, is refused. Defaulting would pick
 * *an* institution, and picking wrong means showing one hospital's patients to another
 * hospital's staff. There is no safe default, so there is no default.
 *
 * Zero imports, no `@ohif/*`, no `throw`. Refusals are returned as {@link OidcResult}
 * values, because every one of them is something a UI has to explain to a clinician, and an
 * exception would be caught and flattened into a string somewhere less careful.
 */

/* -------------------------------------------------------------------------------------- */
/* Result and refusal codes                                                                */
/* -------------------------------------------------------------------------------------- */

export type OidcRefusalCode =
  /** `now` or a timestamp was not a finite number. */
  | 'oidc.invalidClock'
  /** Browser and IdP clocks disagree by more than any margin can absorb. */
  | 'oidc.clockSkew'
  /** The session object itself is not shaped like a session. */
  | 'oidc.malformedSession'
  /** No session at all, or an explicitly terminated one. */
  | 'oidc.noSession'
  /** Session is over and cannot be recovered without a fresh login. */
  | 'oidc.expired'
  /** Renewal is impossible: no refresh capability, or the refresh token itself is done. */
  | 'oidc.notRenewable'
  /** Renewal attempts are used up. */
  | 'oidc.renewExhausted'
  /** The user info payload is not an object / not parseable at all. */
  | 'oidc.malformedUserInfo'
  /** No usable subject identifier. */
  | 'oidc.missingSubject'
  /** Roles claim absent, or present in a shape we refuse to guess at. */
  | 'oidc.unparseableRoles'
  /** No institution claim, or several with no active one designated. */
  | 'oidc.missingInstitution'
  /** The resource belongs to a different institution than the user. */
  | 'oidc.institutionMismatch'
  /** Authenticated is not authorized; and unauthenticated is not either. */
  | 'oidc.notAuthenticated'
  /** The action is not in the requirements table. Fail closed. */
  | 'oidc.unknownAction'
  /** Authenticated, known action, missing permissions. */
  | 'oidc.forbidden'
  /** Unsaved clinical content blocks a user-initiated session end. */
  | 'oidc.unsavedWork'
  /** A logout plan or clearance report was not shaped correctly. */
  | 'oidc.malformedLogout'
  /** Something the logout was obliged to clear was not confirmed clear. */
  | 'oidc.logoutIncomplete';

/**
 * Success or a refusal with a machine-readable code and a clinician-readable reason.
 *
 * The `value?: undefined` / `reason?: undefined` members are not decoration. This repo has
 * `strictNullChecks` off, and without them a union discriminated by a boolean literal does
 * not narrow, so `if (r.ok) { r.value }` fails to compile for every downstream caller.
 */
export type OidcResult<T> =
  | { ok: true; value: T; code?: undefined; reason?: undefined }
  | { ok: false; code: OidcRefusalCode; reason: string; value?: undefined };

const ok = <T>(value: T): OidcResult<T> => ({ ok: true, value });

const refuse = <T>(code: OidcRefusalCode, reason: string): OidcResult<T> => ({
  ok: false,
  code,
  reason,
});

/** Trimmed string, tolerant of null/undefined/numbers coming out of a JWT claim set. */
const text = (value: unknown): string => (value === null || value === undefined ? '' : String(value).trim());

const finite = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value);

const isObject = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const uniq = (values: string[]): string[] => {
  const seen: string[] = [];
  for (const value of values) {
    if (!seen.includes(value)) {
      seen.push(value);
    }
  }
  return seen;
};

/* -------------------------------------------------------------------------------------- */
/* Margins and bounds                                                                      */
/* -------------------------------------------------------------------------------------- */

/**
 * How long before expiry a background renewal should start.
 *
 * Sized to comfortably cover a token endpoint round trip plus one retry on a congested
 * hospital network. Being early is free; being late strands the user mid-study.
 */
export const OIDC_RENEWAL_LEAD_MS = 60_000;

/**
 * Remaining lifetime below which the access token must not be attached to new work.
 *
 * This is the FM-1 guard. Without it a request that takes three seconds runs against a
 * token with one second left and fails *after* the clinician acted, which reads as a broken
 * viewer rather than an ended session. A floor, not a promise: a multi-hundred-image series
 * retrieve outlives any fixed budget, so the lead margin above is the real protection.
 */
export const OIDC_REQUEST_BUDGET_MS = 10_000;

/**
 * How far into the future an `issuedAt` may sit before we stop trusting our own arithmetic.
 *
 * Small on purpose. A token issued "in the future" by seconds is ordinary clock drift; by
 * minutes it means the workstation clock is wrong, and every lifetime we compute from it is
 * fiction. A wrong clock is a technician's problem and must surface as one.
 */
export const OIDC_CLOCK_SKEW_TOLERANCE_MS = 30_000;

/** Total silent-renew attempts before the session is declared over. */
export const OIDC_RENEWAL_MAX_ATTEMPTS = 5;

/** First retry delay; doubles per attempt. */
export const OIDC_RENEWAL_BACKOFF_BASE_MS = 2_000;

/** Ceiling on the doubling, so the last attempts are not absurdly far apart. */
export const OIDC_RENEWAL_BACKOFF_CAP_MS = 30_000;

/**
 * Largest injected jitter accepted.
 *
 * Jitter is injected because this module has no randomness. It is clamped because a caller
 * passing, say, 120_000 would push a renewal scheduled inside the lead margin past the
 * token's expiry, turning the mechanism that prevents expiry into the cause of one.
 */
export const OIDC_RENEWAL_JITTER_CAP_MS = 5_000;

/* -------------------------------------------------------------------------------------- */
/* Session shape                                                                           */
/* -------------------------------------------------------------------------------------- */

export type OidcSessionStatus = 'anonymous' | 'authenticated' | 'renewing' | 'terminated';

export interface OidcUnsavedWork {
  /** What kind of clinical content is at risk. */
  kind: 'draftReport' | 'measurement' | 'segmentation' | 'annotation' | 'keyImage';
  id: string;
  studyInstanceUID?: string;
  /** Shown to the user when we have to ask whether to discard it. */
  description?: string;
}

export interface OidcSessionSnapshot {
  status: OidcSessionStatus;
  /** Epoch ms the access token stops being accepted by the resource server. */
  accessTokenExpiresAt?: number;
  /** Epoch ms the IdP says it minted the token. Used only to detect clock skew. */
  accessTokenIssuedAt?: number;
  /**
   * Epoch ms the refresh token / IdP session itself expires. After this, no amount of
   * silent renewal helps and the user must log in again.
   */
  refreshTokenExpiresAt?: number;
  /** Whether a silent renew is even possible (refresh token held, or IdP session alive). */
  canRenew?: boolean;
  /** Consecutive failed renewal attempts. Absent means zero. */
  renewAttempts?: number;
  /** Why a terminated session terminated, carried so the UI can say so. */
  terminatedReason?: string;
  userInfo?: OidcUserInfo;
  /** Clinical content that would be lost if this session ended right now. */
  unsavedWork?: OidcUnsavedWork[];
}

/** A session that is not a session. Explicit, so callers never model "no user" as `null`. */
export function oidcAnonymousSession(): OidcSessionSnapshot {
  return { status: 'anonymous', canRenew: false, renewAttempts: 0, unsavedWork: [] };
}

/* -------------------------------------------------------------------------------------- */
/* Session evaluation                                                                      */
/* -------------------------------------------------------------------------------------- */

export type OidcSessionVerdictKind =
  /** Token good, nothing to do. */
  | 'usable'
  /** Token still good for in-flight work, renewal should start now. */
  | 'renewSoon'
  /** Token technically unexpired but inside the request budget: no new work. */
  | 'renewNow'
  /** Access token gone. Recoverable only if renewal is still possible. */
  | 'expired'
  /** No session, or the session was terminated. */
  | 'unauthenticated';

export interface OidcSessionVerdict {
  kind: OidcSessionVerdictKind;
  /** May the access token be attached to a new request right now. */
  usable: boolean;
  /**
   * Is the holder authenticated at all. Distinct from {@link usable}: a token inside the
   * request budget is not usable but the user is still very much logged in, and the UI must
   * not react by clearing the screen.
   */
  authenticated: boolean;
  /**
   * FM-2. False means any "no results" the app is holding is meaningless and must not be
   * drawn as an empty worklist. See {@link oidcPresentWorklist}.
   */
  dataMayBeRendered: boolean;
  /** Whether a silent renew is worth attempting. */
  renewable: boolean;
  /** Milliseconds of access token life left; negative once expired. */
  msRemaining: number;
  /** Milliseconds until a background renewal is due; 0 when it is already due. */
  msUntilRenewDue: number;
  /** Clinician-readable, Brazilian Portuguese. */
  reason: string;
  /** Set when the verdict is a bad one, so callers can branch on a code not a string. */
  code?: OidcRefusalCode;
  /** FM-6. True when ending this session now would destroy clinical work. */
  unsavedWorkAtRisk: boolean;
}

/**
 * Decides whether a session may be used, needs renewing, or is over.
 *
 * The distinction between this returning `ok: false` and returning a bad verdict matters.
 * A refusal means *we cannot reason about this session* — the clock is wrong, the object is
 * malformed. A verdict of `expired` means we reasoned successfully and the answer is bad.
 * Collapsing the two would let a malformed session be treated as a normal logout, which
 * hides the workstation misconfiguration that caused it.
 */
export function oidcEvaluateSession(
  session: OidcSessionSnapshot,
  now: number
): OidcResult<OidcSessionVerdict> {
  // A caller reading `now` from a service that has not initialised yet passes `undefined`.
  // Every comparison against NaN is false, so an if/else chain over the margins falls
  // through to its last branch -- and the last branch of a session check is "usable". That
  // is a token check that says yes to an expired token, so it is refused here instead.
  if (!finite(now)) {
    return refuse('oidc.invalidClock', 'Relógio da estação indisponível: não é possível avaliar a sessão.');
  }
  if (!isObject(session)) {
    return refuse('oidc.malformedSession', 'Sessão inválida: faça login novamente.');
  }

  const status = (session as OidcSessionSnapshot).status;
  const atRisk = oidcUnsavedWorkOf(session).length > 0;

  if (status === 'anonymous' || !status) {
    return ok(unauthenticatedVerdict('Você não está autenticado.', 'oidc.noSession', atRisk));
  }
  if (status === 'terminated') {
    const why = text(session.terminatedReason) || 'Sessão encerrada.';
    return ok(unauthenticatedVerdict(why, 'oidc.noSession', atRisk));
  }
  if (status !== 'authenticated' && status !== 'renewing') {
    return refuse('oidc.malformedSession', 'Estado de sessão desconhecido: faça login novamente.');
  }

  const expiresAt = session.accessTokenExpiresAt;
  const issuedAt = session.accessTokenIssuedAt;

  // An authenticated session with no expiry is not "a token that never expires", it is a
  // token whose expiry we failed to read. Treating it as eternal means the viewer keeps
  // using a dead token and never renews, and the radiologist collects 401s all afternoon.
  if (!finite(expiresAt)) {
    return refuse('oidc.malformedSession', 'Token sem data de expiração: faça login novamente.');
  }

  if (issuedAt !== undefined && issuedAt !== null) {
    if (!finite(issuedAt)) {
      return refuse('oidc.malformedSession', 'Token com data de emissão inválida: faça login novamente.');
    }
    // FM-1, the direction that cannot be absorbed by a margin. A token issued in the future
    // means this workstation's clock disagrees with the identity provider by more than the
    // margins are sized for, so every remaining-lifetime figure below would be fiction.
    // A viewer that renews at arbitrary moments logs people out mid-dictation.
    if (issuedAt - now > OIDC_CLOCK_SKEW_TOLERANCE_MS) {
      return refuse(
        'oidc.clockSkew',
        'Relógio da estação divergente do servidor de autenticação: ajuste a hora da estação.'
      );
    }
    // An expiry at or before issuance is not skew, it is a broken token. Computing a
    // negative lifetime and calling it "expired" would send the user to a login page that
    // mints another broken token, forever.
    if (expiresAt <= issuedAt) {
      return refuse('oidc.malformedSession', 'Token com validade inconsistente: faça login novamente.');
    }
  }

  const msRemaining = expiresAt - now;
  const renewable = oidcRenewalIsPossible(session, now);

  if (msRemaining <= 0) {
    return ok({
      kind: 'expired',
      usable: false,
      // Still "authenticated" only if a renewal can plausibly recover it; otherwise the
      // user is out. This is what keeps a renewable blip from clearing the screen.
      authenticated: renewable,
      // FM-2: whether or not renewal succeeds, nothing loaded under a dead token may be
      // presented as a complete result set.
      dataMayBeRendered: false,
      renewable,
      msRemaining,
      msUntilRenewDue: 0,
      reason: renewable
        ? 'Sessão expirada: renovando o acesso.'
        : 'Sessão expirada: faça login novamente.',
      code: 'oidc.expired',
      unsavedWorkAtRisk: atRisk,
    });
  }

  // Inclusive on purpose: at exactly the budget the token is already treated as unusable.
  // Being wrong here by a millisecond in this direction costs one extra renewal; in the
  // other direction it costs a request that dies halfway through a series retrieve.
  if (msRemaining <= OIDC_REQUEST_BUDGET_MS) {
    return ok({
      kind: 'renewNow',
      usable: false,
      authenticated: true,
      // The user is authenticated and the data already on screen is legitimate; we simply
      // must not start new requests with this token.
      dataMayBeRendered: true,
      renewable,
      msRemaining,
      msUntilRenewDue: 0,
      reason: 'Sessão prestes a expirar: aguarde a renovação antes de novas consultas.',
      unsavedWorkAtRisk: atRisk,
    });
  }

  // Also inclusive: exactly at the lead margin we renew.
  if (msRemaining <= OIDC_RENEWAL_LEAD_MS) {
    return ok({
      kind: 'renewSoon',
      usable: true,
      authenticated: true,
      dataMayBeRendered: true,
      renewable,
      msRemaining,
      msUntilRenewDue: 0,
      reason: 'Renovando a sessão em segundo plano.',
      unsavedWorkAtRisk: atRisk,
    });
  }

  return ok({
    kind: 'usable',
    usable: true,
    authenticated: true,
    dataMayBeRendered: true,
    renewable,
    msRemaining,
    msUntilRenewDue: msRemaining - OIDC_RENEWAL_LEAD_MS,
    reason: 'Sessão ativa.',
    unsavedWorkAtRisk: atRisk,
  });
}

function unauthenticatedVerdict(
  reason: string,
  code: OidcRefusalCode,
  unsavedWorkAtRisk: boolean
): OidcSessionVerdict {
  return {
    kind: 'unauthenticated',
    usable: false,
    authenticated: false,
    dataMayBeRendered: false,
    renewable: false,
    msRemaining: 0,
    msUntilRenewDue: 0,
    reason,
    code,
    unsavedWorkAtRisk,
  };
}

/** Whether a silent renew could plausibly succeed. Absent flags mean no. */
export function oidcRenewalIsPossible(session: OidcSessionSnapshot, now: number): boolean {
  if (!isObject(session) || !finite(now)) {
    return false;
  }
  if (session.status !== 'authenticated' && session.status !== 'renewing') {
    return false;
  }
  if (session.canRenew !== true) {
    return false;
  }
  // A refresh token past its own expiry cannot mint anything. Retrying against it produces
  // a loop of failures that reads to the user as a hung viewer.
  if (finite(session.refreshTokenExpiresAt) && session.refreshTokenExpiresAt <= now) {
    return false;
  }
  return true;
}

/** One line for a status bar. Kept here so the wording is not reinvented per panel. */
export function oidcDescribeVerdict(verdict: OidcSessionVerdict): string {
  if (!isObject(verdict)) {
    return '';
  }
  return text(verdict.reason);
}

/* -------------------------------------------------------------------------------------- */
/* FM-2: an empty list is not an unauthenticated one                                       */
/* -------------------------------------------------------------------------------------- */

export type OidcWorklistPresentation =
  /** Results exist; draw them. */
  | 'studies'
  /** Authenticated, query completed, genuinely nothing. "Nenhum estudo encontrado." */
  | 'empty'
  /** Query has not completed. Draw a loading state, never an empty one. */
  | 'loading'
  /**
   * The count is meaningless because the session is not usable. The UI is obliged to say
   * so instead of rendering an empty list.
   */
  | 'sessionEnded';

/**
 * Classifies what a study list should actually show.
 *
 * The failure this prevents: renewal fails, the worklist query 401s and yields zero rows,
 * and the panel renders "no studies found". The radiologist believes there is no work,
 * closes the viewer, and the studies sit unreported. The empty state and the signed-out
 * state look identical on screen and mean opposite things, so they cannot share a branch.
 */
export function oidcPresentWorklist(
  verdict: OidcSessionVerdict,
  loaded: boolean,
  studyCount: number
): OidcResult<OidcWorklistPresentation> {
  if (!isObject(verdict)) {
    return refuse('oidc.malformedSession', 'Não foi possível determinar o estado da sessão.');
  }

  // Session state dominates. It is checked before `loaded` deliberately: a stale "loaded"
  // flag from before the session died would otherwise let a zero count through as `empty`.
  if (!verdict.dataMayBeRendered || !verdict.authenticated) {
    return ok('sessionEnded');
  }

  if (loaded !== true) {
    return ok('loading');
  }

  // `results?.length` where `results` is undefined yields `undefined`, and `undefined === 0`
  // is false, so a naive implementation reports "studies" and draws an empty table with no
  // explanation -- the same wrong screen as the one above, arrived at from the other side.
  if (!finite(studyCount) || studyCount < 0) {
    return refuse('oidc.malformedSession', 'Resultado da busca indisponível: recarregue a lista.');
  }

  return ok(studyCount === 0 ? 'empty' : 'studies');
}

/* -------------------------------------------------------------------------------------- */
/* Renewal planning                                                                        */
/* -------------------------------------------------------------------------------------- */

export type OidcRenewalAction =
  /** Not due yet. Schedule a wake-up in `delayMs`. */
  | 'wait'
  /** Renew immediately. */
  | 'renewNow'
  /** A previous attempt failed; try again after `delayMs`. */
  | 'retry';

export interface OidcRenewalPlan {
  action: OidcRenewalAction;
  /** Failures so far. 0 on a first, unforced renewal. */
  attempt: number;
  /** Attempts left after this one. */
  attemptsRemaining: number;
  /** Milliseconds to wait before acting. Derived from `attempt` alone, plus clamped jitter. */
  delayMs: number;
  /** Epoch ms the renewal should run. */
  dueAt: number;
  reason: string;
}

/**
 * Backoff for a given failure count. Deterministic: doubling, capped, plus injected jitter.
 *
 * Jitter is a parameter and not a `Math.random()` call, both because this module has no
 * randomness and because a test that cannot pin the delay cannot test the bound.
 */
export function oidcRenewalBackoffMs(attempt: number, jitterMs?: number): number {
  const failures = finite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
  if (failures <= 0) {
    return 0;
  }
  const doubled = OIDC_RENEWAL_BACKOFF_BASE_MS * Math.pow(2, failures - 1);
  const capped = Math.min(doubled, OIDC_RENEWAL_BACKOFF_CAP_MS);
  return capped + oidcClampJitterMs(jitterMs);
}

/**
 * Clamps injected jitter into [0, {@link OIDC_RENEWAL_JITTER_CAP_MS}].
 *
 * Negative jitter would pull a retry earlier than the backoff that exists to stop a
 * hammering loop against the token endpoint; oversized jitter would push a renewal
 * scheduled inside the lead margin past the token's expiry, which is precisely the expiry
 * the schedule exists to avoid.
 */
export function oidcClampJitterMs(jitterMs?: number): number {
  if (!finite(jitterMs) || jitterMs <= 0) {
    return 0;
  }
  return Math.min(jitterMs, OIDC_RENEWAL_JITTER_CAP_MS);
}

/**
 * Decides when, and whether, to attempt a silent renew.
 *
 * Refuses -- rather than returning a plan -- whenever renewal is over. The refusal code is
 * the terminal state, and it says which terminal state it is: exhausted attempts, an
 * unrenewable session, a wrong clock. FM-2 depends on the caller being unable to mistake
 * "give up" for "wait a bit longer", because waiting forever is how a dead session ends up
 * rendering an empty worklist behind a spinner.
 */
export function oidcPlanRenewal(
  session: OidcSessionSnapshot,
  now: number,
  jitterMs?: number
): OidcResult<OidcRenewalPlan> {
  if (!finite(now)) {
    return refuse('oidc.invalidClock', 'Relógio da estação indisponível: não é possível renovar a sessão.');
  }

  const verdictResult = oidcEvaluateSession(session, now);
  if (!verdictResult.ok) {
    // Propagate the underlying refusal verbatim: a clock-skew problem must not be reported
    // to the user as "session expired", because the fix is a technician, not a login.
    return refuse(verdictResult.code, verdictResult.reason);
  }
  const verdict = verdictResult.value;

  if (verdict.kind === 'unauthenticated') {
    return refuse('oidc.noSession', 'Não há sessão para renovar: faça login novamente.');
  }

  const attempt = finite(session.renewAttempts) && session.renewAttempts > 0
    ? Math.floor(session.renewAttempts)
    : 0;

  // At the max, not past it: with a max of 5 the attempts numbered 0..4 run, and the fifth
  // recorded failure ends it. Bounded retries are the point -- an unbounded silent renew is
  // what keeps a viewer showing stale chrome over a session that ended.
  if (attempt >= OIDC_RENEWAL_MAX_ATTEMPTS) {
    return refuse(
      'oidc.renewExhausted',
      `Não foi possível renovar a sessão após ${OIDC_RENEWAL_MAX_ATTEMPTS} tentativas: faça login novamente.`
    );
  }

  if (!oidcRenewalIsPossible(session, now)) {
    return refuse('oidc.notRenewable', 'Sessão não pode ser renovada: faça login novamente.');
  }

  const delayMs = oidcRenewalBackoffMs(attempt, jitterMs);
  const dueAt = now + delayMs;

  // Bounded in time as well as in count. If the refresh token dies before the backoff
  // window elapses, waiting is strictly worse than telling the user now: they would watch a
  // spinner for the whole delay and then be logged out anyway, having lost that time in
  // front of a study they could have been reading.
  if (finite(session.refreshTokenExpiresAt) && dueAt >= session.refreshTokenExpiresAt) {
    return refuse(
      'oidc.notRenewable',
      'A sessão expira antes da próxima tentativa de renovação: faça login novamente.'
    );
  }

  if (attempt > 0) {
    return ok({
      action: 'retry',
      attempt,
      attemptsRemaining: OIDC_RENEWAL_MAX_ATTEMPTS - attempt,
      delayMs,
      dueAt,
      reason: `Nova tentativa de renovação em ${Math.round(delayMs / 1000)}s (tentativa ${attempt + 1} de ${OIDC_RENEWAL_MAX_ATTEMPTS}).`,
    });
  }

  if (verdict.msUntilRenewDue > 0) {
    return ok({
      action: 'wait',
      attempt: 0,
      attemptsRemaining: OIDC_RENEWAL_MAX_ATTEMPTS,
      delayMs: verdict.msUntilRenewDue,
      dueAt: now + verdict.msUntilRenewDue,
      reason: 'Renovação agendada.',
    });
  }

  return ok({
    action: 'renewNow',
    attempt: 0,
    attemptsRemaining: OIDC_RENEWAL_MAX_ATTEMPTS,
    delayMs: 0,
    dueAt: now,
    reason: 'Renovando a sessão.',
  });
}

/**
 * The session after a failed renewal: attempt count up by one, status `renewing`.
 *
 * A pure reducer rather than a mutation in the glue layer, because the attempt count is the
 * only thing bounding the retry loop. A counter that a callback forgets to increment on one
 * error path produces exactly the unbounded retry this module exists to prevent.
 */
export function oidcAfterRenewalFailure(
  session: OidcSessionSnapshot,
  now: number,
  error?: string
): OidcSessionSnapshot {
  const base = isObject(session) ? session : oidcAnonymousSession();
  const attempt = finite(base.renewAttempts) && base.renewAttempts > 0 ? Math.floor(base.renewAttempts) : 0;
  const next = attempt + 1;
  if (next >= OIDC_RENEWAL_MAX_ATTEMPTS) {
    return {
      ...base,
      status: 'terminated',
      renewAttempts: next,
      canRenew: false,
      terminatedReason:
        text(error) ||
        `Não foi possível renovar a sessão após ${OIDC_RENEWAL_MAX_ATTEMPTS} tentativas: faça login novamente.`,
    };
  }
  return { ...base, status: 'renewing', renewAttempts: next };
}

/** The session after a successful renewal: counters reset, fresh token window. */
export function oidcAfterRenewalSuccess(
  session: OidcSessionSnapshot,
  issuedAt: number,
  expiresAt: number
): OidcResult<OidcSessionSnapshot> {
  if (!finite(issuedAt) || !finite(expiresAt)) {
    return refuse('oidc.malformedSession', 'Token renovado sem datas válidas: faça login novamente.');
  }
  // A "successful" renewal that returned a token already inside the request budget is not a
  // success. Accepting it resets the attempt counter and schedules another renewal
  // immediately, which is a hot loop against the token endpoint disguised as normal
  // operation. Refusing keeps the failure counted and bounded.
  if (expiresAt - issuedAt <= OIDC_REQUEST_BUDGET_MS) {
    return refuse('oidc.malformedSession', 'Token renovado com validade insuficiente: faça login novamente.');
  }
  const base = isObject(session) ? session : oidcAnonymousSession();
  return ok({
    ...base,
    status: 'authenticated',
    accessTokenIssuedAt: issuedAt,
    accessTokenExpiresAt: expiresAt,
    renewAttempts: 0,
    terminatedReason: undefined,
  });
}

/* -------------------------------------------------------------------------------------- */
/* User info                                                                               */
/* -------------------------------------------------------------------------------------- */

export interface OidcUserInfo {
  /** Stable IdP subject. The thing an audit entry is attributed to. */
  subject: string;
  name: string;
  email?: string;
  /** Professional registration (CRM/CREFITO). Required to sign; absent is not an error here. */
  registration?: string;
  /** The single institution this session is scoped to. Never defaulted. */
  institutionId: string;
  /** Every institution the account may switch to, including the active one. */
  availableInstitutionIds: string[];
  /** Normalised, lowercased role names as supplied by the IdP. */
  roles: string[];
  /** Roles present in the claim that {@link OIDC_ROLE_PERMISSIONS} does not know. */
  unknownRoles: string[];
  /** Derived permission keys. Never contains `'*'`. */
  permissions: string[];
}

/**
 * Parses an IdP user info / ID token claim set, or refuses.
 *
 * Every refusal here is a deliberate choice not to guess. The claim sets that reach this
 * function come from an IdP mapper somebody configured by hand, and a mapper that is one
 * field short is far more likely than a hostile payload -- which is exactly why guessing is
 * dangerous: the guess succeeds, nobody notices, and the wrong thing happens quietly for
 * months.
 */
export function oidcParseUserInfo(claims: unknown): OidcResult<OidcUserInfo> {
  if (!isObject(claims)) {
    return refuse('oidc.malformedUserInfo', 'Dados do usuário inválidos: faça login novamente.');
  }
  const raw = claims as Record<string, unknown>;

  const subject = text(raw.sub ?? raw.subject);
  // Without a subject there is nothing to attribute an action to. Two consequences, both
  // concrete: a signed report whose audit trail names nobody, and -- if a fallback like
  // `email` were used instead -- two accounts sharing a mailbox collapsing into one
  // identity, so one physician's sign-off is recorded against the other.
  if (!subject) {
    return refuse('oidc.missingSubject', 'Usuário sem identificador: faça login novamente.');
  }

  const name = text(raw.name ?? raw.preferred_username ?? raw.given_name);
  // A blank display name is not merely cosmetic. It goes into the signature block and the
  // audit log, and "assinado por" followed by nothing is not a valid clinical attribution.
  if (!name) {
    return refuse('oidc.malformedUserInfo', 'Usuário sem nome: verifique o cadastro no provedor de identidade.');
  }

  const institution = oidcResolveInstitution(raw);
  if (!institution.ok) {
    return refuse(institution.code, institution.reason);
  }

  const roles = oidcParseRolesClaim(raw);
  if (!roles.ok) {
    return refuse(roles.code, roles.reason);
  }

  const grant = oidcPermissionsForRoles(roles.value);

  return ok({
    subject,
    name,
    email: text(raw.email) || undefined,
    registration: text(raw.crm ?? raw.registration ?? raw.professional_registration) || undefined,
    institutionId: institution.value.institutionId,
    availableInstitutionIds: institution.value.availableInstitutionIds,
    roles: roles.value,
    unknownRoles: grant.unknownRoles,
    permissions: grant.permissions,
  });
}

export interface OidcInstitutionScope {
  institutionId: string;
  availableInstitutionIds: string[];
}

/**
 * Resolves which institution this session is scoped to. FM-5.
 *
 * There is no default and there is no "first one wins". This deployment serves several
 * hospitals out of one viewer; defaulting picks *an* institution, and picking wrong shows
 * one hospital's patients to another hospital's staff. For a user who genuinely works at
 * two sites, an ambiguous payload is refused so the UI has to ask which one -- an extra
 * click is cheaper than a confidentiality incident.
 */
export function oidcResolveInstitution(claims: unknown): OidcResult<OidcInstitutionScope> {
  if (!isObject(claims)) {
    return refuse('oidc.malformedUserInfo', 'Dados do usuário inválidos: faça login novamente.');
  }
  const raw = claims as Record<string, unknown>;

  const available = uniq(
    (Array.isArray(raw.institutions) ? raw.institutions : [])
      .map(value => text(value))
      .filter(value => value.length > 0)
  );

  const active = text(raw.active_institution ?? raw.institution ?? raw.institution_id ?? raw.tenant);

  if (!active && available.length === 0) {
    return refuse(
      'oidc.missingInstitution',
      'Usuário sem instituição definida: solicite a configuração do acesso ao administrador.'
    );
  }

  if (!active) {
    if (available.length === 1) {
      return ok({ institutionId: available[0], availableInstitutionIds: available });
    }
    // Several institutions and none designated active. Choosing here would be choosing at
    // random which hospital's worklist this radiologist opens.
    return refuse(
      'oidc.missingInstitution',
      'Usuário vinculado a mais de uma instituição sem instituição ativa definida: selecione a instituição.'
    );
  }

  // An active institution the account is not a member of is a mapper bug, and the failure
  // it would cause is the whole point of FM-5: a session scoped to a hospital this user has
  // no relationship with.
  if (available.length > 0 && !available.includes(active)) {
    return refuse(
      'oidc.missingInstitution',
      'Instituição ativa não corresponde às instituições do usuário: verifique o cadastro.'
    );
  }

  return ok({
    institutionId: active,
    availableInstitutionIds: available.length > 0 ? available : [active],
  });
}

/**
 * Extracts the roles claim, or refuses. FM-3.
 *
 * Note the distinction the tests lean on: an **absent** roles claim is refused, an **empty
 * array** is accepted and yields zero permissions. Both end with the user unable to do
 * anything, which is the fail-closed outcome either way -- but only one of them is a silent
 * IdP misconfiguration, and that one has to be loud. An empty array is a deliberate
 * statement ("this account has no role yet"); a missing claim means the mapper is broken and
 * an administrator needs to hear about it rather than fielding a confused radiologist.
 *
 * An array with a non-string element is refused rather than filtered. Filtering is
 * tempting and it is the fail-open choice in disguise: the element that got dropped may be
 * the role that granted signing, and the physician then hits a denial they cannot explain.
 */
export function oidcParseRolesClaim(claims: unknown): OidcResult<string[]> {
  if (!isObject(claims)) {
    return refuse('oidc.malformedUserInfo', 'Dados do usuário inválidos: faça login novamente.');
  }
  const raw = claims as Record<string, unknown>;

  const nested = isObject(raw.realm_access) ? (raw.realm_access as Record<string, unknown>).roles : undefined;
  const candidate = raw.roles !== undefined ? raw.roles : nested;

  if (candidate === undefined || candidate === null) {
    return refuse(
      'oidc.unparseableRoles',
      'Usuário sem perfis de acesso: solicite a configuração do acesso ao administrador.'
    );
  }

  if (Array.isArray(candidate)) {
    const normalised: string[] = [];
    for (const entry of candidate) {
      if (typeof entry !== 'string') {
        return refuse(
          'oidc.unparseableRoles',
          'Perfis de acesso em formato inválido: solicite a correção ao administrador.'
        );
      }
      const value = entry.trim().toLowerCase();
      if (value) {
        normalised.push(value);
      }
    }
    return ok(uniq(normalised));
  }

  // Some providers send roles as a space- or comma-delimited string. Accepted here, in one
  // audited place, rather than left to a glue layer that would do the same split with no
  // guard and no test.
  if (typeof candidate === 'string') {
    const parts = candidate
      .split(/[,\s]+/)
      .map(part => part.trim().toLowerCase())
      .filter(part => part.length > 0);
    if (parts.length === 0 && candidate.trim().length > 0) {
      return refuse(
        'oidc.unparseableRoles',
        'Perfis de acesso em formato inválido: solicite a correção ao administrador.'
      );
    }
    return ok(uniq(parts));
  }

  return refuse(
    'oidc.unparseableRoles',
    'Perfis de acesso em formato inválido: solicite a correção ao administrador.'
  );
}

/* -------------------------------------------------------------------------------------- */
/* Permissions                                                                             */
/* -------------------------------------------------------------------------------------- */

/**
 * The permission keys this core can grant.
 *
 * The `report.*` names deliberately match the capability names the RTV-107 report workflow
 * already checks, so the two modules agree without an adapter in between -- an adapter that
 * renames permissions is a place where one can silently become another.
 */
export const OIDC_PERMISSIONS = {
  studyView: 'study.view',
  studyViewAllInstitutions: 'study.view.allInstitutions',
  studyExport: 'study.export',
  studyDelete: 'study.delete',
  reportRead: 'report.read',
  reportEdit: 'report.edit',
  reportIssuePreliminary: 'report.issuePreliminary',
  reportRequestReview: 'report.requestReview',
  reportReview: 'report.review',
  reportSign: 'report.sign',
  reportRetract: 'report.retract',
  measurementEdit: 'measurement.edit',
  segmentationEdit: 'segmentation.edit',
  userAdmin: 'user.admin',
  sessionRead: 'session.read',
} as const;

export type OidcPermission = (typeof OIDC_PERMISSIONS)[keyof typeof OIDC_PERMISSIONS];

/**
 * Permissions no role inherits by being powerful, and no wildcard confers.
 *
 * Signing a radiology report is a physician's act bound to a professional registration.
 * An IT administrator holding `user.admin` is not a radiologist, and a system that lets the
 * administrator account sign produces a legally signed report attributed to somebody who
 * never read the images. The RTV-154 consumer short-circuits `admin` and `'*'` to "allowed"
 * for everything, so the protection has to live on this side: these keys are only ever
 * granted by a role that explicitly lists them in {@link OIDC_ROLE_PERMISSIONS}.
 */
export const OIDC_NON_DELEGABLE_PERMISSIONS: readonly string[] = [
  OIDC_PERMISSIONS.reportSign,
  OIDC_PERMISSIONS.reportRetract,
  OIDC_PERMISSIONS.studyDelete,
];

/**
 * The wildcard the downstream RTV-154 helper reads as "holds everything".
 *
 * Exported so it can be asserted against: nothing in this module may ever emit it, because
 * a wildcard derived from an IdP claim would hand whoever configured that claim the ability
 * to sign reports.
 */
export const OIDC_WILDCARD_PERMISSION = '*';

/**
 * Role to permission table. The only place a role acquires meaning.
 *
 * Keys are lowercase; role names are lowercased before lookup so `Radiologist` and
 * `radiologist` cannot produce two different permission sets depending on which IdP mapper
 * wrote the claim.
 */
export const OIDC_ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  radiologist: [
    OIDC_PERMISSIONS.sessionRead,
    OIDC_PERMISSIONS.studyView,
    OIDC_PERMISSIONS.studyExport,
    OIDC_PERMISSIONS.reportRead,
    OIDC_PERMISSIONS.reportEdit,
    OIDC_PERMISSIONS.reportIssuePreliminary,
    OIDC_PERMISSIONS.reportRequestReview,
    OIDC_PERMISSIONS.reportReview,
    OIDC_PERMISSIONS.reportSign,
    OIDC_PERMISSIONS.reportRetract,
    OIDC_PERMISSIONS.measurementEdit,
    OIDC_PERMISSIONS.segmentationEdit,
  ],
  // A resident writes and may issue a preliminary read, which is a real clinical
  // communication, but cannot sign a final report. That boundary is the entire reason the
  // preliminary state exists in RTV-107, and granting `report.sign` here would erase it.
  resident: [
    OIDC_PERMISSIONS.sessionRead,
    OIDC_PERMISSIONS.studyView,
    OIDC_PERMISSIONS.reportRead,
    OIDC_PERMISSIONS.reportEdit,
    OIDC_PERMISSIONS.reportIssuePreliminary,
    OIDC_PERMISSIONS.reportRequestReview,
    OIDC_PERMISSIONS.measurementEdit,
    OIDC_PERMISSIONS.segmentationEdit,
  ],
  technologist: [
    OIDC_PERMISSIONS.sessionRead,
    OIDC_PERMISSIONS.studyView,
    OIDC_PERMISSIONS.measurementEdit,
  ],
  // The requesting clinician reads finished reports. No editing, no measurement, and
  // notably no export: a referring physician bulk-exporting studies is the shape of a data
  // exfiltration incident, not of clinical work.
  referring: [
    OIDC_PERMISSIONS.sessionRead,
    OIDC_PERMISSIONS.studyView,
    OIDC_PERMISSIONS.reportRead,
  ],
  physicist: [
    OIDC_PERMISSIONS.sessionRead,
    OIDC_PERMISSIONS.studyView,
    OIDC_PERMISSIONS.measurementEdit,
    OIDC_PERMISSIONS.segmentationEdit,
  ],
  // Read-only across institutions, for quality and compliance review. Deliberately holds
  // no write permission at all: an auditor who can edit is no longer an auditor.
  auditor: [
    OIDC_PERMISSIONS.sessionRead,
    OIDC_PERMISSIONS.studyView,
    OIDC_PERMISSIONS.studyViewAllInstitutions,
    OIDC_PERMISSIONS.reportRead,
  ],
  // Administers accounts. Note what is absent: no clinical write, no signing, no export.
  admin: [OIDC_PERMISSIONS.sessionRead, OIDC_PERMISSIONS.userAdmin],
};

export interface OidcPermissionGrant {
  permissions: string[];
  /** Roles the table does not know. Granted nothing, but surfaced so ops can see them. */
  unknownRoles: string[];
  /** Which role produced each permission, for a "why can I not do X" explanation. */
  grantedBy: Record<string, string[]>;
}

/**
 * Maps roles to permissions. Fail-closed on every input that is not a known role.
 *
 * Absent roles, an empty array, a role nobody configured: all of them produce an empty
 * permission set. The outcome being prevented is a user with no assigned role signing a
 * report, or opening a study belonging to a patient of another physician, because some
 * branch decided a logged-in user must at least be allowed to read.
 */
export function oidcPermissionsForRoles(roles?: string[]): OidcPermissionGrant {
  const permissions: string[] = [];
  const unknownRoles: string[] = [];
  const grantedBy: Record<string, string[]> = {};

  if (!Array.isArray(roles)) {
    return { permissions, unknownRoles, grantedBy };
  }

  for (const entry of roles) {
    if (typeof entry !== 'string') {
      continue;
    }
    const role = entry.trim().toLowerCase();
    if (!role) {
      continue;
    }
    const granted = OIDC_ROLE_PERMISSIONS[role];
    if (!granted) {
      // Unknown means nothing granted. Recorded rather than dropped: a role that looks
      // plausible to a human ("radiologista") and grants nothing is an operational bug,
      // and it should be visible as one instead of appearing as a mysterious denial.
      if (!unknownRoles.includes(role)) {
        unknownRoles.push(role);
      }
      continue;
    }
    for (const permission of granted) {
      // Belt and braces: the table is checked in as literals, but a wildcard that ever
      // reached this list would be read downstream as "holds everything", including the
      // signing authority above.
      if (permission === OIDC_WILDCARD_PERMISSION) {
        continue;
      }
      if (!permissions.includes(permission)) {
        permissions.push(permission);
      }
      grantedBy[permission] = uniq([...(grantedBy[permission] ?? []), role]);
    }
  }

  return { permissions, unknownRoles, grantedBy };
}

/* -------------------------------------------------------------------------------------- */
/* Authorization                                                                           */
/* -------------------------------------------------------------------------------------- */

/**
 * What each action requires. An empty array means "authentication and nothing more", and it
 * means it *explicitly* -- it is a row in the table, not the absence of one.
 *
 * The RTV-154 helper returns "allowed" when an action declares no required permissions,
 * which fails open on precisely the actions somebody forgot to configure. Here an unlisted
 * action is refused.
 */
export const OIDC_ACTION_REQUIREMENTS: Record<string, readonly string[]> = {
  'session.read': [],
  'worklist.view': [OIDC_PERMISSIONS.studyView],
  'study.open': [OIDC_PERMISSIONS.studyView],
  'study.export': [OIDC_PERMISSIONS.studyExport],
  'study.delete': [OIDC_PERMISSIONS.studyDelete],
  'study.viewOtherInstitution': [
    OIDC_PERMISSIONS.studyView,
    OIDC_PERMISSIONS.studyViewAllInstitutions,
  ],
  'report.read': [OIDC_PERMISSIONS.reportRead],
  'report.edit': [OIDC_PERMISSIONS.reportEdit],
  'report.issuePreliminary': [OIDC_PERMISSIONS.reportIssuePreliminary],
  'report.requestReview': [OIDC_PERMISSIONS.reportRequestReview],
  'report.review': [OIDC_PERMISSIONS.reportReview],
  'report.sign': [OIDC_PERMISSIONS.reportSign],
  'report.retract': [OIDC_PERMISSIONS.reportRetract],
  'measurement.edit': [OIDC_PERMISSIONS.measurementEdit],
  'segmentation.edit': [OIDC_PERMISSIONS.segmentationEdit],
  'user.admin': [OIDC_PERMISSIONS.userAdmin],
};

export interface OidcGrant {
  /** Derived from a session verdict, never hand-set. See {@link oidcGrantFromSession}. */
  authenticated: boolean;
  permissions?: string[];
  institutionId?: string;
}

/**
 * Builds an authorization grant from a session, so `authenticated` cannot be asserted by
 * hand at a call site.
 *
 * The failure mode: a component that has a `user` object writes `{ authenticated: true }`
 * because a user object exists, and the check then passes for a session whose token expired
 * twenty minutes ago. Deriving the flag from {@link oidcEvaluateSession} means there is one
 * definition of authenticated and it is the one that looks at the clock.
 */
export function oidcGrantFromSession(
  session: OidcSessionSnapshot,
  now: number
): OidcResult<OidcGrant> {
  const verdictResult = oidcEvaluateSession(session, now);
  if (!verdictResult.ok) {
    return refuse(verdictResult.code, verdictResult.reason);
  }
  const verdict = verdictResult.value;
  const info = isObject(session) ? session.userInfo : undefined;
  return ok({
    authenticated: verdict.authenticated,
    permissions: isObject(info) ? info.permissions ?? [] : [],
    institutionId: isObject(info) ? info.institutionId : undefined,
  });
}

/**
 * Whether an action is permitted. Refuses with a reason a UI can show.
 *
 * Authentication and authorization are separate answers to separate questions, and
 * conflating them is the most common way RBAC fails open: "they got past the login page" is
 * not a permission. The refusal codes stay distinct so the UI can react differently -- a
 * login prompt for `oidc.notAuthenticated`, an explanation for `oidc.forbidden`.
 */
export function oidcAuthorize(action: string, grant: OidcGrant): OidcResult<true> {
  const name = text(action);
  if (!name) {
    return refuse('oidc.unknownAction', 'Ação não informada.');
  }
  if (!isObject(grant) || grant.authenticated !== true) {
    return refuse('oidc.notAuthenticated', 'Você não está autenticado: faça login novamente.');
  }

  // Fail closed on an unregistered action. An action nobody added to the table is a new
  // action, and new actions are exactly the ones that should not default to "allowed".
  const required = OIDC_ACTION_REQUIREMENTS[name];
  if (!required) {
    return refuse('oidc.unknownAction', 'Ação não reconhecida: acesso negado.');
  }

  const held = Array.isArray(grant.permissions)
    ? grant.permissions.filter(value => typeof value === 'string')
    : [];

  // Membership only. A `'*'` entry is not accepted as a substitute for anything, and least
  // of all for the non-delegable keys: honouring it here would reintroduce, on the
  // authorization side, the administrator-can-sign hole OIDC_NON_DELEGABLE_PERMISSIONS
  // documents. So the wildcard is simply a permission name nothing requires.
  const missing = required.filter(permission => !held.includes(permission));

  if (missing.length > 0) {
    return refuse(
      'oidc.forbidden',
      `Você não tem permissão para esta ação (${missing.join(', ')}).`
    );
  }

  return ok(true);
}

/**
 * Whether this user may open a resource belonging to a given institution. FM-5.
 *
 * Both refusals matter. A mismatch is the cross-tenant leak itself. A resource with **no**
 * institution recorded is refused too, because the alternative -- treating it as "belongs to
 * everyone" -- makes every unlabelled study visible to every hospital's staff, and
 * unlabelled is the normal state of data that came in through a misconfigured import.
 */
export function oidcAuthorizeInstitution(
  userInfo: OidcUserInfo,
  resourceInstitutionId: string,
  grant?: OidcGrant
): OidcResult<true> {
  if (!isObject(userInfo) || !text(userInfo.institutionId)) {
    return refuse('oidc.missingInstitution', 'Sessão sem instituição definida: faça login novamente.');
  }
  const resource = text(resourceInstitutionId);
  if (!resource) {
    return refuse(
      'oidc.institutionMismatch',
      'Estudo sem instituição identificada: acesso negado por segurança.'
    );
  }
  if (resource === text(userInfo.institutionId)) {
    return ok(true);
  }

  // A cross-institution reader (audit, quality) is a real role, but it is a permission and
  // not an inference from the account happening to list several institutions.
  const permissions = Array.isArray(grant?.permissions)
    ? grant.permissions
    : Array.isArray(userInfo.permissions)
      ? userInfo.permissions
      : [];
  if (permissions.includes(OIDC_PERMISSIONS.studyViewAllInstitutions)) {
    return ok(true);
  }

  return refuse(
    'oidc.institutionMismatch',
    'Este estudo pertence a outra instituição: acesso negado.'
  );
}

/* -------------------------------------------------------------------------------------- */
/* Logout                                                                                  */
/* -------------------------------------------------------------------------------------- */

/**
 * Everything a logout is obliged to clear, as an enumerable list.
 *
 * Written as a list rather than as a function body because the failure mode is *omission*.
 * A logout implemented as a sequence of statements is one forgotten line away from leaving
 * a study cache behind, and nobody reviewing it can tell which line is missing. A list can
 * be diffed against what the glue layer confirmed.
 *
 * The last entries are the ones real implementations forget: OHIF caches pixel data in
 * IndexedDB and behind a service worker, and a logout that clears `localStorage` and
 * navigates leaves a complete copy of the previous patient's imaging on a shared machine.
 */
export const OIDC_CLEARABLES = [
  'oidc.accessToken',
  'oidc.refreshToken',
  'oidc.idToken',
  'oidc.userInfo',
  'oidc.permissions',
  'oidc.studyMetadataCache',
  'oidc.seriesMetadataCache',
  'oidc.imageCache',
  'oidc.measurements',
  'oidc.segmentations',
  'oidc.draftReports',
  'oidc.hangingProtocolState',
  'oidc.viewportState',
  // Filters and recent searches carry patient names and MRNs typed by the previous user.
  // Leaving them is a disclosure even though no image is on screen.
  'oidc.worklistFilters',
  'oidc.recentSearches',
  'oidc.sessionStorage',
  'oidc.localStorage',
  'oidc.indexedDb',
  'oidc.serviceWorkerCaches',
] as const;

export type OidcClearable = (typeof OIDC_CLEARABLES)[number];

/**
 * The subset whose survival is a patient-confidentiality problem, as opposed to a merely
 * untidy one.
 *
 * The distinction drives severity. A leftover hanging protocol preference means the next
 * user sees an odd layout. A leftover series metadata cache means the next user sees the
 * previous patient's name, and one back-button press reaches their images.
 */
export const OIDC_PATIENT_DATA_CLEARABLES: readonly OidcClearable[] = [
  'oidc.userInfo',
  'oidc.studyMetadataCache',
  'oidc.seriesMetadataCache',
  'oidc.imageCache',
  'oidc.measurements',
  'oidc.segmentations',
  'oidc.draftReports',
  'oidc.worklistFilters',
  'oidc.recentSearches',
  'oidc.sessionStorage',
  'oidc.localStorage',
  'oidc.indexedDb',
  'oidc.serviceWorkerCaches',
];

export type OidcLogoutCause =
  /** The user clicked "sair". A human is present and can answer a question. */
  | 'user'
  /** Access token gone and unrenewable. */
  | 'expired'
  /** Silent renew gave up. */
  | 'renewFailed'
  /** Inactivity timer on a shared workstation. */
  | 'idle'
  /** IdP front-channel logout: another app in the SSO session signed out. */
  | 'remoteSignOut';

export interface OidcLogoutOptions {
  cause: OidcLogoutCause;
  /** End-session endpoint, when one is configured. */
  endSessionEndpoint?: string;
  /** Whether the IdP is believed reachable. Never gates local clearing. */
  idpReachable?: boolean;
  /** Set once the user has answered the unsaved-work question. */
  unsavedWorkConfirmedDiscardable?: boolean;
}

export interface OidcLogoutPlan {
  cause: OidcLogoutCause;
  /** Everything that must be confirmed cleared, local first. */
  clearables: OidcClearable[];
  /** Attempt this redirect, but never wait on it before clearing. */
  endSessionRedirect?: string;
  /** Always false. Local clearing is unconditional; see the doc comment. */
  endSessionRedirectRequired: boolean;
  /** True when the IdP could not be reached and the session lives on server-side. */
  serverSideRevocationPending: boolean;
  /** FM-6. Clinical content that this logout will destroy if it is not saved first. */
  unsavedWork: OidcUnsavedWork[];
  /** FM-6. The UI must persist `unsavedWork` before confirming clearance. */
  requiresUnsavedWorkHandoff: boolean;
  reason: string;
}

/** Normalised unsaved-work list; tolerates a missing or dirty array. */
export function oidcUnsavedWorkOf(session: OidcSessionSnapshot): OidcUnsavedWork[] {
  if (!isObject(session) || !Array.isArray(session.unsavedWork)) {
    return [];
  }
  return session.unsavedWork.filter(item => isObject(item) && text(item.id).length > 0);
}

/**
 * Produces the list of things a logout has to erase, or refuses to proceed.
 *
 * The single refusal is FM-6 with a human in the room: a user-initiated logout with an
 * unsaved dictation open stops and asks, because discarding a report somebody just spoke is
 * a real harm and the person who can prevent it is standing there.
 *
 * A *forced* end never refuses. There is nobody to ask, and on a shared workstation
 * confidentiality has to win, so the draft store is cleared -- but `requiresUnsavedWorkHandoff`
 * obliges the caller to try to persist first, and {@link oidcVerifyLogout} records anything
 * that was destroyed unsaved. The loss is acceptable only because it is reported; a
 * radiologist who is told will re-dictate, and one who is not told will never know the
 * report was never filed.
 *
 * Note that this is deliberately idempotent over an already-terminated session. Refusing a
 * second logout attempt would strand whatever the first attempt failed to clear, which is
 * the exact residue FM-4 is about.
 */
export function oidcPlanLogout(
  session: OidcSessionSnapshot,
  options: OidcLogoutOptions,
  now: number
): OidcResult<OidcLogoutPlan> {
  if (!finite(now)) {
    return refuse('oidc.invalidClock', 'Relógio da estação indisponível: não é possível encerrar a sessão.');
  }
  if (!isObject(options) || !text(options.cause)) {
    return refuse('oidc.malformedLogout', 'Motivo do encerramento não informado.');
  }
  const cause = options.cause;
  if (!['user', 'expired', 'renewFailed', 'idle', 'remoteSignOut'].includes(cause)) {
    return refuse('oidc.malformedLogout', 'Motivo do encerramento desconhecido.');
  }

  const unsavedWork = oidcUnsavedWorkOf(session);
  const userPresent = cause === 'user';

  if (userPresent && unsavedWork.length > 0 && options.unsavedWorkConfirmedDiscardable !== true) {
    return refuse(
      'oidc.unsavedWork',
      `Há ${unsavedWork.length} item(ns) de conteúdo clínico não salvo: salve ou descarte antes de sair.`
    );
  }

  const idpReachable = options.idpReachable !== false;
  const endSession = text(options.endSessionEndpoint) || undefined;

  return ok({
    cause,
    // The full list every time. A cause-dependent subset is how "the idle timer clears less
    // than the logout button" happens, and the idle timer is the one that fires when the
    // radiologist has already walked away from the workstation.
    clearables: [...OIDC_CLEARABLES],
    endSessionRedirect: idpReachable ? endSession : undefined,
    // Never required. An unreachable IdP is the IdP's session registry problem; patient
    // data left on a shared screen is the patient's problem, and it is the larger one.
    endSessionRedirectRequired: false,
    serverSideRevocationPending: !idpReachable || !endSession,
    unsavedWork,
    requiresUnsavedWorkHandoff: !userPresent && unsavedWork.length > 0,
    reason: oidcLogoutCauseReason(cause),
  });
}

function oidcLogoutCauseReason(cause: OidcLogoutCause): string {
  switch (cause) {
    case 'user':
      return 'Sessão encerrada pelo usuário.';
    case 'expired':
      return 'Sessão expirada: faça login novamente.';
    case 'renewFailed':
      return 'Não foi possível renovar a sessão: faça login novamente.';
    case 'idle':
      return 'Sessão encerrada por inatividade.';
    case 'remoteSignOut':
      return 'Sessão encerrada no provedor de identidade.';
    default:
      return 'Sessão encerrada.';
  }
}

export interface OidcClearanceReport {
  /** Items the glue layer confirms it erased. */
  cleared?: string[];
  /** Items it tried and failed to erase. */
  failed?: Array<{ item: string; error?: string }>;
  /** Ids from `plan.unsavedWork` that were successfully persisted before clearing. */
  persistedUnsavedWork?: string[];
  /** Whether the end-session redirect actually happened. Never gates completeness. */
  endSessionRedirectPerformed?: boolean;
}

export interface OidcLogoutOutcome {
  complete: boolean;
  cleared: string[];
  /** Required, and neither confirmed cleared nor reported failed. Silence counts as this. */
  missing: string[];
  failed: string[];
  /** Anything unresolved that belongs to {@link OIDC_PATIENT_DATA_CLEARABLES}. */
  residualPatientData: boolean;
  /** The only flag a "you may walk away" UI should read. */
  safeToReleaseWorkstation: boolean;
  /** FM-6. Ids destroyed without being saved. Never empty silently. */
  unsavedWorkDiscarded: string[];
  serverSideRevocationPending: boolean;
  reason: string;
}

/**
 * Compares a clearance report against the plan and says whether the workstation is clean.
 *
 * The load-bearing rule is that **an item nobody reported on counts as not cleared**. A
 * glue layer that adds a cache and forgets to report it gets "incomplete", not a clean
 * bill, and a typo in an item name lands in `missing` rather than quietly matching nothing
 * and passing. Silence is the normal shape of a bug here, so silence cannot mean success.
 *
 * Completeness deliberately ignores the end-session redirect. FM-4's second half: the
 * identity provider being unreachable must not stop a workstation from being cleared, so a
 * logout with every local item erased and a failed redirect is complete, with
 * `serverSideRevocationPending` set for the caller to retry later.
 */
export function oidcVerifyLogout(
  plan: OidcLogoutPlan,
  report: OidcClearanceReport
): OidcResult<OidcLogoutOutcome> {
  if (!isObject(plan) || !Array.isArray(plan.clearables)) {
    return refuse('oidc.malformedLogout', 'Plano de encerramento inválido.');
  }
  if (!isObject(report)) {
    return refuse('oidc.malformedLogout', 'Relatório de limpeza inválido.');
  }

  const required = plan.clearables.filter(item => typeof item === 'string');
  const claimedCleared = (Array.isArray(report.cleared) ? report.cleared : []).filter(
    item => typeof item === 'string'
  );
  const failedEntries = (Array.isArray(report.failed) ? report.failed : []).filter(entry =>
    isObject(entry)
  );
  const failedItems = failedEntries.map(entry => text(entry.item)).filter(item => item.length > 0);

  // Reported both cleared and failed: counted as failed. Two subsystems disagreeing about
  // one cache is not evidence that it is gone, and the safe reading of a contradiction on a
  // shared workstation is the pessimistic one.
  const cleared = required.filter(item => claimedCleared.includes(item) && !failedItems.includes(item));
  const failed = required.filter(item => failedItems.includes(item));
  const missing = required.filter(item => !cleared.includes(item) && !failed.includes(item));

  const unresolved = [...missing, ...failed];
  const residualPatientData = unresolved.some(item =>
    (OIDC_PATIENT_DATA_CLEARABLES as readonly string[]).includes(item)
  );
  const complete = unresolved.length === 0;

  const planUnsaved = Array.isArray(plan.unsavedWork) ? plan.unsavedWork : [];
  const persisted = (Array.isArray(report.persistedUnsavedWork) ? report.persistedUnsavedWork : [])
    .filter(id => typeof id === 'string')
    .map(id => id.trim());
  // Destroyed unsaved: everything the plan listed that the report did not confirm saved,
  // and only when the draft store was in fact cleared. Reported, never inferred away.
  const draftsCleared = cleared.includes('oidc.draftReports') || cleared.includes('oidc.measurements');
  const unsavedWorkDiscarded = draftsCleared
    ? planUnsaved.map(item => text(item.id)).filter(id => id.length > 0 && !persisted.includes(id))
    : [];

  // Pending unless the redirect was configured, attempted and confirmed. An unconfirmed
  // redirect is assumed not to have happened, for the same reason an unconfirmed cache is
  // assumed not to have been cleared.
  const serverSideRevocationPending =
    plan.serverSideRevocationPending === true || report.endSessionRedirectPerformed !== true;

  return ok({
    complete,
    cleared,
    missing,
    failed,
    residualPatientData,
    // The redirect is intentionally not part of this. See the doc comment.
    safeToReleaseWorkstation: complete,
    unsavedWorkDiscarded,
    serverSideRevocationPending,
    reason: oidcLogoutOutcomeReason(complete, residualPatientData, unresolved, unsavedWorkDiscarded),
  });
}

function oidcLogoutOutcomeReason(
  complete: boolean,
  residualPatientData: boolean,
  unresolved: string[],
  unsavedWorkDiscarded: string[]
): string {
  if (complete) {
    return unsavedWorkDiscarded.length > 0
      ? `Sessão encerrada. Atenção: ${unsavedWorkDiscarded.length} item(ns) de conteúdo clínico não salvo foram descartados.`
      : 'Sessão encerrada e dados locais removidos.';
  }
  if (residualPatientData) {
    return `Encerramento incompleto: dados de paciente permanecem nesta estação (${unresolved.join(', ')}). Não libere a estação.`;
  }
  return `Encerramento incompleto: ${unresolved.join(', ')}.`;
}

/**
 * Guard form of {@link oidcVerifyLogout}, for callers whose next statement navigates away.
 *
 * The reason string enumerates what is still there, because the person reading it is either
 * a technician who has to clear it by hand or the user who must be told not to walk away
 * from the workstation yet.
 */
export function oidcLogoutBlocker(outcome: OidcLogoutOutcome): OidcResult<true> {
  if (!isObject(outcome)) {
    return refuse('oidc.malformedLogout', 'Resultado de encerramento inválido.');
  }
  if (outcome.safeToReleaseWorkstation !== true) {
    return refuse('oidc.logoutIncomplete', text(outcome.reason) || 'Encerramento incompleto.');
  }
  return ok(true);
}
