/**
 * Study access policy — pure core (RTV-193).
 *
 * A referring physician must see their own patients' studies and nobody else's. That
 * is an LGPD requirement (Art. 6, finalidade e necessidade) before it is a product
 * feature, so the rule lives in a pure, exhaustively tested function rather than
 * scattered through query builders and UI guards.
 *
 * ## Two decisions worth stating
 *
 * **Deny is the default.** Every path that does not explicitly grant returns a denial
 * with a reason. A policy that falls through to "allow" fails open, and an access
 * control that fails open is not an access control.
 *
 * **This is the second line, not the first.** The datasource must also scope its query
 * server-side; a client-side filter alone is a UI convenience, not a security boundary,
 * because the rows already reached the browser. {@link filterVisibleStudies} exists to
 * keep the UI honest when the server sends more than it should — not to replace the
 * server doing its job.
 *
 * Framework-free. Zero-fork per RTV-114.
 */

export type UserRole =
  | 'admin'
  | 'radiologist'
  | 'physicist'
  | 'technologist'
  | 'referrer'
  | 'guest';

export interface AccessUser {
  id: string;
  role: UserRole;
  /** Institutions the user belongs to. Empty means "not scoped by institution". */
  institutions?: string[];
  /** Explicit study UIDs granted outside the role rules (a shared case). */
  grantedStudyUids?: string[];
  /**
   * Emergency override. Allowed, but every use is flagged for audit — see
   * {@link AccessDecision.breakGlass}.
   */
  breakGlass?: { active: boolean; justification?: string };
}

export interface AccessStudy {
  studyInstanceUid: string;
  /** Id of the referring physician, as the RIS knows them. */
  referrerId?: string;
  /** Id of the radiologist the study is assigned to. */
  assigneeId?: string;
  institution?: string;
  /** Ids explicitly allowed to view (a shared or second-opinion case). */
  sharedWith?: string[];
}

export interface AccessDecision {
  allowed: boolean;
  /** Machine-readable reason, for the audit trail. */
  code:
    | 'admin'
    | 'assigned'
    | 'referrer'
    | 'shared'
    | 'institution'
    | 'explicitGrant'
    | 'breakGlass'
    | 'notReferrer'
    | 'outsideInstitution'
    | 'noRole'
    | 'unknownUser'
    | 'unknownStudy';
  /** Human-readable reason. */
  reason: string;
  /** True when access was granted only by the emergency override. */
  breakGlass?: boolean;
}

const deny = (code: AccessDecision['code'], reason: string): AccessDecision => ({
  allowed: false,
  code,
  reason,
});

const allow = (code: AccessDecision['code'], reason: string): AccessDecision => ({
  allowed: true,
  code,
  reason,
});

const sameId = (a?: string, b?: string): boolean =>
  !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

function inInstitution(user: AccessUser, study: AccessStudy): boolean {
  const list = (user.institutions ?? []).map(i => String(i).trim().toLowerCase()).filter(Boolean);
  if (!list.length) {
    // No institution scope configured. For a radiologist that means the whole archive;
    // it is a deliberate configuration, not an accident, and the caller sets it.
    return true;
  }
  const studyInstitution = String(study.institution ?? '').trim().toLowerCase();
  return !!studyInstitution && list.includes(studyInstitution);
}

/**
 * Whether `user` may open `study`.
 *
 * Order matters: the explicit, narrow grants are checked before the broad role rules,
 * so the decision `code` names the *most specific* reason access was allowed. That is
 * what makes the audit trail useful — "assigned" and "institution" are very different
 * answers to "why could they see this?".
 *
 * Break-glass is checked **last**, so it is only ever recorded when nothing else would
 * have granted access. Recording it on a case the user could see anyway would flood the
 * review queue with noise and hide the real overrides.
 */
export function canViewStudy(user: AccessUser, study: AccessStudy): AccessDecision {
  if (!user?.id || !user?.role) {
    return deny('unknownUser', 'No authenticated user.');
  }
  if (!study?.studyInstanceUid) {
    return deny('unknownStudy', 'No study.');
  }

  if (user.role === 'admin') {
    return allow('admin', 'Administrator.');
  }

  if ((user.grantedStudyUids ?? []).includes(study.studyInstanceUid)) {
    return allow('explicitGrant', 'Explicitly granted for this study.');
  }
  if ((study.sharedWith ?? []).some(id => sameId(id, user.id))) {
    return allow('shared', 'Study shared with this user.');
  }
  if (sameId(study.assigneeId, user.id)) {
    return allow('assigned', 'Assigned to this user.');
  }

  switch (user.role) {
    case 'referrer': {
      // The whole point of RTV-193: a referring physician sees their own referrals and
      // nothing else. Institution membership does NOT widen this.
      if (sameId(study.referrerId, user.id)) {
        return allow('referrer', 'Referring physician for this study.');
      }
      return breakGlassOr(
        user,
        deny('notReferrer', 'Not the referring physician for this study.')
      );
    }

    case 'radiologist':
    case 'physicist':
    case 'technologist': {
      if (inInstitution(user, study)) {
        return allow('institution', 'Same institution.');
      }
      return breakGlassOr(user, deny('outsideInstitution', 'Study belongs to another institution.'));
    }

    default:
      return breakGlassOr(user, deny('noRole', 'Role has no viewing rights.'));
  }
}

/**
 * Applies the emergency override, if it is active *and* justified.
 *
 * A justification is mandatory. Break-glass without a stated reason is
 * indistinguishable from a policy hole at review time, so an unjustified override is
 * refused rather than silently granted.
 */
function breakGlassOr(user: AccessUser, denial: AccessDecision): AccessDecision {
  const glass = user.breakGlass;
  if (!glass?.active) {
    return denial;
  }
  if (!String(glass.justification ?? '').trim()) {
    return deny(denial.code, `${denial.reason} Emergency access needs a justification.`);
  }
  return {
    allowed: true,
    code: 'breakGlass',
    reason: `Emergency access: ${String(glass.justification).trim()}`,
    breakGlass: true,
  };
}

/**
 * The studies a user may see.
 *
 * A convenience over {@link canViewStudy}; see the module note on why this is the
 * second line of defence and not the first.
 */
export function filterVisibleStudies<T extends AccessStudy>(user: AccessUser, studies: T[]): T[] {
  return (studies ?? []).filter(s => canViewStudy(user, s).allowed);
}

/**
 * Whether the role is scoped to its own referrals.
 * Useful for the UI to explain *why* a list is short, instead of looking broken.
 */
export function isRestrictedRole(role?: UserRole): boolean {
  return role === 'referrer' || role === 'guest';
}

/** One-line explanation for an empty or short list. */
export function describeScope(user: AccessUser): string {
  if (!user?.role) {
    return 'Not signed in.';
  }
  switch (user.role) {
    case 'admin':
      return 'Full archive.';
    case 'referrer':
      return 'Only studies you referred.';
    case 'guest':
      return 'No viewing rights.';
    default: {
      const institutions = (user.institutions ?? []).filter(Boolean);
      return institutions.length
        ? `Studies from ${institutions.join(', ')}.`
        : 'Full archive for your role.';
    }
  }
}
