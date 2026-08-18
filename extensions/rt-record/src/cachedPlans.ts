/**
 * cachedPlans.ts
 *
 * Pure core for the "Externally Cached Plans" viewer and the "Clear cache"
 * action (RTV-179), radiotherapy treatment-history area of the viewer fork.
 * Derived from the Varian Treatment Delivery IFU (P1065954-004-D, Oct 2025,
 * p. 109, "About Viewing and Clearing Externally Cached Plans"): plans that
 * arrived from an external planning system are cached locally, shown with a
 * stamp, opened read-only when locked (Plan ID + date of last treatment), and
 * evicted through a manage dialog with a warning, a selectable list, an audit
 * log, and graceful failure when a DICOM daemon still holds a plan.
 *
 * Framework-free by house rule: zero imports, no clock, no randomness, no
 * exceptions raised. "Now" is always an explicit epoch-ms parameter. Refusals
 * are returned as values so a caller cannot ignore one by forgetting a catch.
 *
 * Concrete clinical failure modes this module exists to prevent:
 *
 * FM-1  Treating a cached plan as the current plan. The cache holds a
 *       SNAPSHOT. If the planner revised the plan in ARIA after the snapshot
 *       was taken, delivering against the cached copy delivers the wrong dose
 *       distribution, and the delivered record looks perfectly normal - the
 *       beams ran, the MU matched the (stale) plan, no interlock fired. So
 *       currency is a returned verdict, never a UI decision, and absence of
 *       revision information classifies as unverified, never as current.
 *
 * FM-2  Clearing a plan that is in use. A DICOM daemon importing the plan, or
 *       an in-progress treatment session holding it, can be mid-course.
 *       Evicting it then aborts a fraction on a real patient. "Nobody is using
 *       it" and "I could not find out who is using it" are different facts and
 *       only the first permits eviction, so an unknown usage state refuses.
 *
 * FM-3  A partial clear reported as success. A physicist told "cache cleared"
 *       re-imports from ARIA and ends up with a mixture of freshly fetched
 *       plans and leftover stale snapshots, with nothing on screen telling the
 *       two apart. Every clear therefore reports per-plan outcomes and the
 *       overall verdict is "partial" - never "success" - if anything failed or
 *       is unaccounted for.
 *
 * FM-4  A warning that is not a decision. The confirmation must be bound to
 *       what was actually presented: confirming a dialog that listed 3 plans
 *       must not evict a 4th that the background importer added while the
 *       dialog sat open. The confirmation therefore carries a digest of the
 *       exact plan set and versions shown, and a mismatch refuses, exactly as
 *       a content digest guards a signature.
 *
 * FM-5  An audit log that cannot answer its own question. Months later someone
 *       asks: who cleared, when, which plans (ID + cache timestamp + source
 *       revision), why, and what happened to each one. A record without the
 *       per-plan outcome cannot separate "cleared" from "attempted and
 *       failed". Records are emitted for refusals and partials too, since the
 *       refusals are the interesting ones.
 *
 * FM-6  The locked plan's displayed facts. A missing last-treatment date must
 *       not render as "never treated": a reader who concludes the course never
 *       started may restart it from fraction 1 and double the delivered dose.
 *       Absent, never-treated and treated stay three distinct states, and an
 *       unattested never-treated claim degrades to absent.
 *
 * FM-7  Evicting something that is not a cached copy. The dialog's premise is
 *       that everything listed can be re-fetched from the source system. A
 *       locally authored plan routed into the same list would be destroyed
 *       permanently, not evicted, so non-cached entries refuse.
 *
 * FM-8  A stale confirmation replayed later. A confirmation captured, then
 *       submitted an hour later after the operator walked away, no longer
 *       reflects a human present at the console; it is bounded by a TTL.
 *
 * FM-9  An outcome reported for a plan that was never authorized. If the
 *       executor reports having cleared a plan outside the confirmed set,
 *       something bypassed the confirmation; the report is refused rather than
 *       summarized, because the summary would launder the anomaly.
 */

/* ------------------------------------------------------------------ */
/* Result envelope                                                     */
/* ------------------------------------------------------------------ */

/**
 * The optional `value?: undefined` / `reason?: undefined` members are
 * mandatory here: strictNullChecks is OFF in this repo, and without them a
 * boolean-literal union does not narrow, so `if (r.ok) r.value` would type as
 * `any` and a refusal could be read as a success at runtime.
 */
export type PlanCacheResult<T> =
  | { ok: true; value: T; code?: undefined; reason?: undefined }
  | { ok: false; code: PlanCacheRefusalCode; reason: string; value?: undefined };

export const PLAN_CACHE_REFUSAL_CODES = {
  INVALID_CLOCK: 'plan-cache/invalid-clock',
  INVALID_ENTRY: 'plan-cache/invalid-entry',
  EMPTY_SELECTION: 'plan-cache/empty-selection',
  DUPLICATE_SELECTION: 'plan-cache/duplicate-selection',
  MISSING_CONFIRMATION: 'plan-cache/missing-confirmation',
  MISSING_ACTOR: 'plan-cache/missing-actor',
  MISSING_REASON: 'plan-cache/missing-reason',
  CONFIRMATION_EXPIRED: 'plan-cache/confirmation-expired',
  FINGERPRINT_MISMATCH: 'plan-cache/fingerprint-mismatch',
  PLAN_IN_USE: 'plan-cache/plan-in-use',
  USAGE_UNKNOWN: 'plan-cache/usage-unknown',
  COURSE_IN_PROGRESS: 'plan-cache/course-in-progress',
  NOT_EXTERNALLY_CACHED: 'plan-cache/not-externally-cached',
  NOT_VERIFIED: 'plan-cache/not-verified',
  INVALID_OUTCOME: 'plan-cache/invalid-outcome',
  UNAUTHORIZED_OUTCOME: 'plan-cache/unauthorized-outcome',
  AMBIGUOUS_OUTCOME: 'plan-cache/ambiguous-outcome',
  UNKNOWN_AUDIT_KIND: 'plan-cache/unknown-audit-kind',
} as const;

export type PlanCacheRefusalCode =
  (typeof PLAN_CACHE_REFUSAL_CODES)[keyof typeof PLAN_CACHE_REFUSAL_CODES];

function planCacheOk<T>(value: T): PlanCacheResult<T> {
  return { ok: true, value };
}

function planCacheRefuse<T>(code: PlanCacheRefusalCode, reason: string): PlanCacheResult<T> {
  return { ok: false, code, reason };
}

/* ------------------------------------------------------------------ */
/* Vocabulary                                                          */
/* ------------------------------------------------------------------ */

export const PLAN_CACHE_CURRENCY_VERDICTS = {
  VERIFIABLE_CURRENT: 'verifiable-current',
  SNAPSHOT_UNVERIFIED: 'snapshot-unverified',
  KNOWN_STALE: 'known-stale',
} as const;

export type PlanCacheCurrencyVerdict =
  (typeof PLAN_CACHE_CURRENCY_VERDICTS)[keyof typeof PLAN_CACHE_CURRENCY_VERDICTS];

export const PLAN_CACHE_LOCK_STATES = {
  LOCKED: 'locked',
  UNLOCKED: 'unlocked',
  UNKNOWN: 'unknown',
} as const;

export type PlanCacheLockState =
  (typeof PLAN_CACHE_LOCK_STATES)[keyof typeof PLAN_CACHE_LOCK_STATES];

export const PLAN_CACHE_USAGE_KINDS = {
  FREE: 'free',
  IN_USE: 'in-use',
  UNKNOWN: 'unknown',
} as const;

export type PlanCacheUsageKind =
  (typeof PLAN_CACHE_USAGE_KINDS)[keyof typeof PLAN_CACHE_USAGE_KINDS];

export const PLAN_CACHE_LAST_TREATMENT_KINDS = {
  TREATED: 'treated',
  NEVER_TREATED: 'never-treated',
  UNKNOWN: 'unknown',
} as const;

export type PlanCacheLastTreatmentKind =
  (typeof PLAN_CACHE_LAST_TREATMENT_KINDS)[keyof typeof PLAN_CACHE_LAST_TREATMENT_KINDS];

export const PLAN_CACHE_COURSE_STATUSES = {
  IN_PROGRESS: 'in-progress',
  COMPLETED: 'completed',
  UNKNOWN: 'unknown',
} as const;

export type PlanCacheCourseStatus =
  (typeof PLAN_CACHE_COURSE_STATUSES)[keyof typeof PLAN_CACHE_COURSE_STATUSES];

export const PLAN_CACHE_CLEAR_VERDICTS = {
  SUCCESS: 'success',
  PARTIAL: 'partial',
  FAILED: 'failed',
} as const;

export type PlanCacheClearVerdict =
  (typeof PLAN_CACHE_CLEAR_VERDICTS)[keyof typeof PLAN_CACHE_CLEAR_VERDICTS];

export const PLAN_CACHE_PLAN_OUTCOMES = {
  CLEARED: 'cleared',
  RETAINED: 'retained',
  UNKNOWN: 'unknown',
} as const;

export type PlanCachePlanOutcomeKind =
  (typeof PLAN_CACHE_PLAN_OUTCOMES)[keyof typeof PLAN_CACHE_PLAN_OUTCOMES];

export const PLAN_CACHE_AUDIT_KINDS = {
  CLEAR_AUTHORIZED: 'plan-cache/clear-authorized',
  CLEAR_REFUSED: 'plan-cache/clear-refused',
  CLEAR_COMPLETED: 'plan-cache/clear-completed',
  CLEAR_PARTIAL: 'plan-cache/clear-partial',
  CLEAR_FAILED: 'plan-cache/clear-failed',
  CURRENCY_ASSESSED: 'plan-cache/currency-assessed',
  LOCKED_PLAN_VIEWED: 'plan-cache/locked-plan-viewed',
} as const;

export type PlanCacheAuditKind =
  (typeof PLAN_CACHE_AUDIT_KINDS)[keyof typeof PLAN_CACHE_AUDIT_KINDS];

/**
 * A confirmation older than this no longer evidences a human at the console
 * (FM-8). Five minutes is the dialog-interaction envelope: long enough for a
 * physicist to read a 20-plan list, short enough that a confirmation captured
 * before a shift handover cannot be replayed by the next operator.
 */
export const PLAN_CACHE_CONFIRMATION_TTL_MS = 5 * 60 * 1000;

/**
 * A revision check older than this proves nothing about now (FM-1). One day:
 * plan revisions in ARIA are same-day events during a replanning cycle, so a
 * check from yesterday cannot vouch for today's authoritative revision.
 */
export const PLAN_CACHE_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

/** Rendered wherever a fact is absent, so absence never renders as a value. */
export const PLAN_CACHE_UNKNOWN_LABEL = 'indisponível';

/** Audit actor placeholder: a record with no actor is still filed (FM-5). */
export const PLAN_CACHE_UNKNOWN_ACTOR = 'ator-nao-identificado';

/* ------------------------------------------------------------------ */
/* Inventory model                                                     */
/* ------------------------------------------------------------------ */

/** Identity of the plan revision as it exists in the source system. */
export type PlanCacheSourceRevision = {
  /** Source-system revision or version label of the plan that was cached. */
  revisionId?: string;
  /** DICOM SOP Instance UID of the cached RTPLAN, when known. */
  planInstanceUid?: string;
  /** APPROVED / UNAPPROVED / REJECTED / RETIRED / SUPERSEDED, source spelling. */
  approvalStatus?: string;
  approvedBy?: string;
  approvedAt?: number;
  /** Set when the source system already told us a newer revision replaced it. */
  supersededByRevisionId?: string;
};

/** Outcome of an actual round-trip to the source system, not an assumption. */
export type PlanCacheRevisionVerification = {
  /** Epoch ms at which the source system was queried. */
  verifiedAt?: number;
  /** Revision the source system reported as authoritative at that moment. */
  currentRevisionId?: string;
  verifiedAgainstSystem?: string;
};

/**
 * Three distinct states, never collapsed (FM-6). `never-treated` requires
 * `attestedBy`, the source that asserted zero delivered fractions; an
 * unattested claim degrades to `unknown`, because "the field was empty" and
 * "the record system says the course has not started" are not the same fact.
 */
export type PlanCacheLastTreatment =
  | { kind: 'treated'; at: number; attestedBy?: string }
  | { kind: 'never-treated'; attestedBy?: string; at?: undefined }
  | { kind: 'unknown'; at?: undefined; attestedBy?: undefined };

export type PlanCacheUsageState =
  | { kind: 'free'; holder?: undefined; detail?: string }
  | { kind: 'in-use'; holder?: string; detail?: string }
  | { kind: 'unknown'; holder?: undefined; detail?: string };

export type PlanCacheEntry = {
  /** Plan ID as displayed to the operator; shown for locked plans. */
  planId: string;
  planLabel?: string;
  patientRef: string;
  courseRef?: string;
  /** Epoch ms at which the snapshot was taken from the source system. */
  cachedAt: number;
  /** Source system the snapshot came from, e.g. an ARIA instance name. */
  sourceSystem: string;
  sourceRevision?: PlanCacheSourceRevision;
  revisionVerification?: PlanCacheRevisionVerification;
  lastTreatment?: PlanCacheLastTreatment;
  lockState?: PlanCacheLockState;
  usage?: PlanCacheUsageState;
  courseStatus?: PlanCacheCourseStatus;
  /**
   * True only for copies that can be re-fetched from `sourceSystem`. Anything
   * else must not reach the clear-cache dialog (FM-7). Absent reads as false:
   * a caller that forgot the flag does not get eviction rights by default.
   */
  externallyCached?: boolean;
  sizeBytes?: number;
};

export type PlanCacheUsageProbe = (entry: PlanCacheEntry) => PlanCacheUsageState;

/* ------------------------------------------------------------------ */
/* Pure date rendering (no Date, no locale, no timezone)               */
/* ------------------------------------------------------------------ */

function planCachePad(value: number, width: number): string {
  let text = String(value);
  while (text.length < width) {
    text = '0' + text;
  }
  return text;
}

/**
 * UTC calendar date from epoch ms, computed arithmetically. Deliberately not
 * `toLocaleDateString`: a treatment date that renders as 01/02 in one browser
 * and 02/01 in another is a dose-history misread waiting to happen, and the
 * audit log must be byte-identical wherever it is opened.
 */
export function planCacheFormatUtcDate(ms: number): string {
  if (typeof ms !== 'number' || !isFinite(ms)) {
    return PLAN_CACHE_UNKNOWN_LABEL;
  }
  const days = Math.floor(ms / 86400000);
  const shifted = days + 719468;
  const era = Math.floor(shifted / 146097);
  const dayOfEra = shifted - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365
  );
  let year = yearOfEra + era * 400;
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthPrime = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthPrime + 2) / 5) + 1;
  const month = monthPrime + (monthPrime < 10 ? 3 : -9);
  if (month <= 2) {
    year = year + 1;
  }
  return planCachePad(year, 4) + '-' + planCachePad(month, 2) + '-' + planCachePad(day, 2);
}

/** Full UTC instant, used for cache stamps and audit timestamps. */
export function planCacheFormatUtcInstant(ms: number): string {
  if (typeof ms !== 'number' || !isFinite(ms)) {
    return PLAN_CACHE_UNKNOWN_LABEL;
  }
  const dayMs = ((ms % 86400000) + 86400000) % 86400000;
  const seconds = Math.floor(dayMs / 1000);
  const hour = Math.floor(seconds / 3600);
  const minute = Math.floor((seconds % 3600) / 60);
  const second = seconds % 60;
  return (
    planCacheFormatUtcDate(ms) +
    ' ' +
    planCachePad(hour, 2) +
    ':' +
    planCachePad(minute, 2) +
    ':' +
    planCachePad(second, 2) +
    'Z'
  );
}

/* ------------------------------------------------------------------ */
/* Normalization helpers                                               */
/* ------------------------------------------------------------------ */

function planCacheIsFiniteNumber(value: unknown): boolean {
  return typeof value === 'number' && isFinite(value as number);
}

function planCacheTrim(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Stable identity of a cache entry. Keyed on plan id AND cache timestamp
 * because the cache legitimately holds two snapshots of the same plan id taken
 * before and after a replan; keying on plan id alone would let a clear
 * authorized for the old snapshot evict the new one.
 */
export function planCacheEntryKey(entry: PlanCacheEntry): string {
  const planId = planCacheTrim(entry && entry.planId) || PLAN_CACHE_UNKNOWN_LABEL;
  const cachedAt = entry && planCacheIsFiniteNumber(entry.cachedAt) ? String(entry.cachedAt) : 'sem-timestamp';
  return planId + '@' + cachedAt;
}

/** Field-naming validation so a refusal tells the caller what to fix. */
function planCacheValidateEntry(entry: PlanCacheEntry, position: number): string {
  const where = 'entrada ' + String(position);
  if (!entry || typeof entry !== 'object') {
    return where + ': registro de cache ausente ou inválido.';
  }
  if (!planCacheTrim(entry.planId)) {
    return where + ': Plan ID ausente.';
  }
  if (!planCacheIsFiniteNumber(entry.cachedAt) || entry.cachedAt < 0) {
    // FM-1: without a cache timestamp there is no way to say how old the
    // snapshot is, and no way to record in the audit which snapshot was
    // evicted. An entry like this is unusable, not merely incomplete.
    return where + ' (' + planCacheTrim(entry.planId) + '): data de cache ausente ou inválida.';
  }
  if (!planCacheTrim(entry.sourceSystem)) {
    // FM-1/FM-7: "externally cached" is meaningless without naming the system
    // the copy can be re-fetched from.
    return where + ' (' + planCacheTrim(entry.planId) + '): sistema de origem ausente.';
  }
  if (!planCacheTrim(entry.patientRef)) {
    // FM-5: an audit record that cannot name the patient cannot be reconciled
    // against a delivery record months later.
    return where + ' (' + planCacheTrim(entry.planId) + '): referência do paciente ausente.';
  }
  return '';
}

function planCacheNormalizeLockState(entry: PlanCacheEntry): PlanCacheLockState {
  const raw = planCacheTrim(entry && (entry.lockState as string));
  if (raw === PLAN_CACHE_LOCK_STATES.LOCKED) {
    return PLAN_CACHE_LOCK_STATES.LOCKED;
  }
  if (raw === PLAN_CACHE_LOCK_STATES.UNLOCKED) {
    return PLAN_CACHE_LOCK_STATES.UNLOCKED;
  }
  return PLAN_CACHE_LOCK_STATES.UNKNOWN;
}

function planCacheNormalizeCourseStatus(entry: PlanCacheEntry): PlanCacheCourseStatus {
  const raw = planCacheTrim(entry && (entry.courseStatus as string));
  if (raw === PLAN_CACHE_COURSE_STATUSES.IN_PROGRESS) {
    return PLAN_CACHE_COURSE_STATUSES.IN_PROGRESS;
  }
  if (raw === PLAN_CACHE_COURSE_STATUSES.COMPLETED) {
    return PLAN_CACHE_COURSE_STATUSES.COMPLETED;
  }
  return PLAN_CACHE_COURSE_STATUSES.UNKNOWN;
}

/**
 * FM-6. Fails closed to `unknown`, and downgrades an unattested
 * `never-treated` to `unknown`: the harmful reading is "course has not
 * started", so only an attested assertion is allowed to produce it.
 */
export function planCacheNormalizeLastTreatment(entry: PlanCacheEntry): PlanCacheLastTreatment {
  const raw = entry && entry.lastTreatment;
  if (!raw || typeof raw !== 'object') {
    return { kind: PLAN_CACHE_LAST_TREATMENT_KINDS.UNKNOWN };
  }
  if (raw.kind === PLAN_CACHE_LAST_TREATMENT_KINDS.TREATED) {
    if (!planCacheIsFiniteNumber(raw.at)) {
      // A "treated" marker with no usable date is an absent date, not a date.
      return { kind: PLAN_CACHE_LAST_TREATMENT_KINDS.UNKNOWN };
    }
    return {
      kind: PLAN_CACHE_LAST_TREATMENT_KINDS.TREATED,
      at: raw.at as number,
      attestedBy: planCacheTrim(raw.attestedBy) || undefined,
    };
  }
  if (raw.kind === PLAN_CACHE_LAST_TREATMENT_KINDS.NEVER_TREATED) {
    const attestedBy = planCacheTrim(raw.attestedBy);
    if (!attestedBy) {
      return { kind: PLAN_CACHE_LAST_TREATMENT_KINDS.UNKNOWN };
    }
    return { kind: PLAN_CACHE_LAST_TREATMENT_KINDS.NEVER_TREATED, attestedBy };
  }
  return { kind: PLAN_CACHE_LAST_TREATMENT_KINDS.UNKNOWN };
}

/**
 * FM-2. Any shape that is not an explicit `free` or an explicit `in-use`
 * becomes `unknown`, including a probe that raised, returned null, or returned
 * a state this build does not recognise. A probe failure is exactly the case
 * where the daemon may be holding the plan and could not be reached.
 */
export function planCacheResolveUsage(entry: PlanCacheEntry, probe?: PlanCacheUsageProbe): PlanCacheUsageState {
  let raw: PlanCacheUsageState = entry && entry.usage;
  if (typeof probe === 'function') {
    let probed: PlanCacheUsageState = null;
    let probeFailed = false;
    try {
      probed = probe(entry);
    } catch (probeError) {
      probeFailed = true;
    }
    if (probeFailed) {
      return {
        kind: PLAN_CACHE_USAGE_KINDS.UNKNOWN,
        detail: 'a consulta de uso falhou; o estado de uso permanece desconhecido.',
      };
    }
    raw = probed;
  }
  if (!raw || typeof raw !== 'object') {
    return { kind: PLAN_CACHE_USAGE_KINDS.UNKNOWN, detail: 'nenhum estado de uso informado.' };
  }
  if (raw.kind === PLAN_CACHE_USAGE_KINDS.FREE) {
    return { kind: PLAN_CACHE_USAGE_KINDS.FREE, detail: planCacheTrim(raw.detail) || undefined };
  }
  if (raw.kind === PLAN_CACHE_USAGE_KINDS.IN_USE) {
    return {
      kind: PLAN_CACHE_USAGE_KINDS.IN_USE,
      holder: planCacheTrim(raw.holder) || undefined,
      detail: planCacheTrim(raw.detail) || undefined,
    };
  }
  return { kind: PLAN_CACHE_USAGE_KINDS.UNKNOWN, detail: planCacheTrim(raw.detail) || undefined };
}

function planCacheApprovalStatus(entry: PlanCacheEntry): string {
  const revision = entry && entry.sourceRevision;
  return planCacheTrim(revision && revision.approvalStatus).toUpperCase();
}

/* ------------------------------------------------------------------ */
/* FM-1: currency classification                                       */
/* ------------------------------------------------------------------ */

export type PlanCacheCurrencyAssessment = {
  planId: string;
  entryKey: string;
  verdict: PlanCacheCurrencyVerdict;
  /**
   * True only for `verifiable-current`. The single boolean the delivery path
   * is allowed to read, so no caller can assemble its own optimistic rule out
   * of the individual factors.
   */
  deliverable: boolean;
  reason: string;
  /** Human-readable facts behind the verdict, in the operator's language. */
  factors: string[];
  cacheAgeMs: number;
  verificationAgeMs: number;
  cachedAtLabel: string;
  sourceSystem: string;
  sourceRevisionId: string;
  approvalStatus: string;
  /** The stamp the IFU requires on externally cached plans. */
  stamp: string;
};

function planCacheCurrencyLabel(verdict: PlanCacheCurrencyVerdict): string {
  if (verdict === PLAN_CACHE_CURRENCY_VERDICTS.VERIFIABLE_CURRENT) {
    return 'atual verificado';
  }
  if (verdict === PLAN_CACHE_CURRENCY_VERDICTS.KNOWN_STALE) {
    return 'desatualizado';
  }
  return 'cópia em cache não verificada';
}

/**
 * FM-1. Three-way verdict, fail-closed.
 *
 * `known-stale` needs positive evidence that the cached copy is not the
 * authoritative one: the source system named a superseding revision, or a
 * verification came back with a different current revision, or the plan was
 * rejected/retired at the source. `verifiable-current` needs every one of a
 * named revision, a fresh matching verification and an APPROVED status.
 * Everything else - and in particular a plan with no revision information at
 * all - is `snapshot-unverified`, because "we have no evidence it changed" is
 * not evidence it did not change.
 */
export function planCacheClassifyCurrency(
  entry: PlanCacheEntry,
  now: number
): PlanCacheResult<PlanCacheCurrencyAssessment> {
  if (!planCacheIsFiniteNumber(now)) {
    return planCacheRefuse(
      PLAN_CACHE_REFUSAL_CODES.INVALID_CLOCK,
      'Instante de referência inválido: não é possível avaliar a idade do cache.'
    );
  }
  const invalid = planCacheValidateEntry(entry, 0);
  if (invalid) {
    return planCacheRefuse(PLAN_CACHE_REFUSAL_CODES.INVALID_ENTRY, invalid);
  }

  const revision = entry.sourceRevision || {};
  const verification = entry.revisionVerification || {};
  const revisionId = planCacheTrim(revision.revisionId);
  const supersededBy = planCacheTrim(revision.supersededByRevisionId);
  const approval = planCacheApprovalStatus(entry);
  const currentRevisionId = planCacheTrim(verification.currentRevisionId);
  const verifiedAt = verification.verifiedAt;
  const cacheAgeMs = now - entry.cachedAt;
  const verificationAgeMs = planCacheIsFiniteNumber(verifiedAt) ? now - (verifiedAt as number) : Number.NaN;
  const factors: string[] = [];

  let verdict: PlanCacheCurrencyVerdict = PLAN_CACHE_CURRENCY_VERDICTS.SNAPSHOT_UNVERIFIED;
  let reason = '';

  if (supersededBy) {
    verdict = PLAN_CACHE_CURRENCY_VERDICTS.KNOWN_STALE;
    reason = 'O sistema de origem informou que a revisão ' + (revisionId || PLAN_CACHE_UNKNOWN_LABEL) +
      ' foi substituída pela revisão ' + supersededBy + '.';
    factors.push('revisão substituída por ' + supersededBy);
  } else if (approval === 'REJECTED' || approval === 'RETIRED' || approval === 'SUPERSEDED') {
    // A rejected or retired plan at the source is authoritative evidence that
    // the cached copy must not be delivered, even if nothing newer exists yet.
    verdict = PLAN_CACHE_CURRENCY_VERDICTS.KNOWN_STALE;
    reason = 'O plano está com situação ' + approval + ' no sistema de origem.';
    factors.push('situação de aprovação na origem: ' + approval);
  } else if (revisionId && currentRevisionId && currentRevisionId !== revisionId) {
    verdict = PLAN_CACHE_CURRENCY_VERDICTS.KNOWN_STALE;
    reason = 'A revisão em cache (' + revisionId + ') difere da revisão vigente na origem (' + currentRevisionId + ').';
    factors.push('revisão vigente na origem: ' + currentRevisionId);
  } else if (!revisionId) {
    // FM-1 fail-closed core: no revision identity means the snapshot cannot be
    // compared with anything, so it can never be called current.
    verdict = PLAN_CACHE_CURRENCY_VERDICTS.SNAPSHOT_UNVERIFIED;
    reason = 'A cópia em cache não traz identificação de revisão na origem; não é possível confirmar que é a vigente.';
    factors.push('sem identificação de revisão');
  } else if (entry.cachedAt > now) {
    // Cache timestamp in the future means the clocks disagree; the age of the
    // snapshot is unknown, so its currency is unknown.
    verdict = PLAN_CACHE_CURRENCY_VERDICTS.SNAPSHOT_UNVERIFIED;
    reason = 'A data de cache é posterior ao instante de referência; relógios divergentes impedem a verificação.';
    factors.push('data de cache no futuro');
  } else if (!planCacheIsFiniteNumber(verifiedAt)) {
    verdict = PLAN_CACHE_CURRENCY_VERDICTS.SNAPSHOT_UNVERIFIED;
    reason = 'A revisão em cache nunca foi confrontada com o sistema de origem.';
    factors.push('sem verificação contra a origem');
  } else if ((verifiedAt as number) > now) {
    verdict = PLAN_CACHE_CURRENCY_VERDICTS.SNAPSHOT_UNVERIFIED;
    reason = 'A verificação registrada é posterior ao instante de referência e não pode ser aceita.';
    factors.push('verificação com data no futuro');
  } else if (!currentRevisionId) {
    verdict = PLAN_CACHE_CURRENCY_VERDICTS.SNAPSHOT_UNVERIFIED;
    reason = 'A verificação não registrou qual revisão está vigente na origem.';
    factors.push('verificação sem revisão vigente');
  } else if (verificationAgeMs > PLAN_CACHE_VERIFICATION_TTL_MS) {
    // FM-1: a check from last month says nothing about today. Treating an
    // expired check as a valid one is the exact optimism this guard removes.
    verdict = PLAN_CACHE_CURRENCY_VERDICTS.SNAPSHOT_UNVERIFIED;
    reason = 'A última verificação contra a origem expirou (' + planCacheFormatUtcInstant(verifiedAt as number) + ').';
    factors.push('verificação expirada');
  } else if (approval !== 'APPROVED') {
    verdict = PLAN_CACHE_CURRENCY_VERDICTS.SNAPSHOT_UNVERIFIED;
    reason = 'O plano não consta como APPROVED na origem (situação: ' + (approval || PLAN_CACHE_UNKNOWN_LABEL) + ').';
    factors.push('situação de aprovação não confirmada');
  } else {
    verdict = PLAN_CACHE_CURRENCY_VERDICTS.VERIFIABLE_CURRENT;
    reason = 'A revisão ' + revisionId + ' foi confirmada como vigente e aprovada em ' +
      planCacheFormatUtcInstant(verifiedAt as number) + '.';
    factors.push('revisão confirmada como vigente');
  }

  factors.push('capturado de ' + planCacheTrim(entry.sourceSystem) + ' em ' + planCacheFormatUtcInstant(entry.cachedAt));

  const stamp =
    'Plano em cache externo de ' +
    planCacheTrim(entry.sourceSystem) +
    ', capturado em ' +
    planCacheFormatUtcInstant(entry.cachedAt) +
    ' - ' +
    planCacheCurrencyLabel(verdict);

  return planCacheOk({
    planId: planCacheTrim(entry.planId),
    entryKey: planCacheEntryKey(entry),
    verdict,
    deliverable: verdict === PLAN_CACHE_CURRENCY_VERDICTS.VERIFIABLE_CURRENT,
    reason,
    factors,
    cacheAgeMs,
    verificationAgeMs,
    cachedAtLabel: planCacheFormatUtcInstant(entry.cachedAt),
    sourceSystem: planCacheTrim(entry.sourceSystem),
    sourceRevisionId: revisionId,
    approvalStatus: approval,
    stamp,
  });
}

/**
 * FM-1, made unavoidable. The stamp on screen is necessary and not sufficient,
 * so the delivery path calls this instead of reading the verdict and deciding
 * for itself. Anything short of `verifiable-current` refuses.
 */
export function planCacheGuardPlanForDelivery(
  entry: PlanCacheEntry,
  now: number
): PlanCacheResult<PlanCacheCurrencyAssessment> {
  const assessed = planCacheClassifyCurrency(entry, now);
  if (!assessed.ok) {
    return assessed;
  }
  if (!assessed.value.deliverable) {
    return planCacheRefuse(
      PLAN_CACHE_REFUSAL_CODES.NOT_VERIFIED,
      'O plano ' + assessed.value.planId + ' é uma cópia em cache que não pode ser tratada como o plano vigente. ' +
        assessed.value.reason
    );
  }
  return assessed;
}

/* ------------------------------------------------------------------ */
/* FM-6: what a locked plan may display                                */
/* ------------------------------------------------------------------ */

export type PlanCacheLockedPlanDescription = {
  planId: string;
  entryKey: string;
  planIdLabel: string;
  patientRef: string;
  courseRef: string;
  lockState: PlanCacheLockState;
  locked: boolean;
  /** True when the viewer must not offer editing; unknown lock reads as locked. */
  readOnly: boolean;
  lastTreatmentKind: PlanCacheLastTreatmentKind;
  lastTreatmentAt: number;
  lastTreatmentLabel: string;
  /** Distinguishes "we do not know" from "there was no treatment". */
  lastTreatmentIsAbsent: boolean;
  lastTreatmentIsNever: boolean;
  currency: PlanCacheCurrencyVerdict;
  currencyReason: string;
  stamp: string;
  warnings: string[];
  displayFields: Array<{ label: string; value: string }>;
};

/**
 * The read-only panel for a locked cached plan. Takes `now` because the stamp
 * and currency verdict belong on the same panel as the Plan ID: showing the ID
 * and last-treatment date without the currency verdict is what lets a reader
 * mistake the snapshot for the live plan (FM-1).
 */
export function planCacheDescribeLockedPlan(
  entry: PlanCacheEntry,
  now: number
): PlanCacheResult<PlanCacheLockedPlanDescription> {
  const assessed = planCacheClassifyCurrency(entry, now);
  if (!assessed.ok) {
    return planCacheRefuse(assessed.code, assessed.reason);
  }
  const lockState = planCacheNormalizeLockState(entry);
  const lastTreatment = planCacheNormalizeLastTreatment(entry);
  const warnings: string[] = [];

  let lastTreatmentLabel = '';
  let lastTreatmentAt = Number.NaN;
  if (lastTreatment.kind === PLAN_CACHE_LAST_TREATMENT_KINDS.TREATED) {
    lastTreatmentAt = lastTreatment.at;
    lastTreatmentLabel = 'Último tratamento em ' + planCacheFormatUtcDate(lastTreatment.at) + ' (UTC)';
    if (lastTreatment.at > now) {
      warnings.push('A data do último tratamento é posterior ao instante atual; verifique os relógios.');
    }
  } else if (lastTreatment.kind === PLAN_CACHE_LAST_TREATMENT_KINDS.NEVER_TREATED) {
    lastTreatmentLabel = 'Nunca tratado (atestado por ' + lastTreatment.attestedBy + ')';
  } else {
    // FM-6: the label must never read as "never treated". A reader who
    // concludes the course has not started may restart it from the first
    // fraction and double the delivered dose.
    lastTreatmentLabel = 'Data do último tratamento ' + PLAN_CACHE_UNKNOWN_LABEL;
    warnings.push('Data do último tratamento indisponível; isso não significa que o paciente nunca foi tratado.');
  }

  if (assessed.value.verdict !== PLAN_CACHE_CURRENCY_VERDICTS.VERIFIABLE_CURRENT) {
    warnings.push('Esta é uma cópia em cache e pode não corresponder ao plano vigente. ' + assessed.value.reason);
  }
  if (lockState === PLAN_CACHE_LOCK_STATES.UNKNOWN) {
    // Fail closed: an unknown lock state is treated as locked, because
    // offering an edit on a plan that is in fact locked to a running course
    // invites an edit that the source system will silently discard.
    warnings.push('Estado de bloqueio indisponível; o plano é exibido somente para leitura.');
  }

  const planIdLabel = 'Plan ID: ' + planCacheTrim(entry.planId);
  const displayFields = [
    { label: 'Plan ID', value: planCacheTrim(entry.planId) },
    { label: 'Paciente', value: planCacheTrim(entry.patientRef) },
    { label: 'Curso', value: planCacheTrim(entry.courseRef) || PLAN_CACHE_UNKNOWN_LABEL },
    { label: 'Último tratamento', value: lastTreatmentLabel },
    { label: 'Origem', value: assessed.value.sourceSystem },
    { label: 'Capturado em', value: assessed.value.cachedAtLabel },
    { label: 'Revisão na origem', value: assessed.value.sourceRevisionId || PLAN_CACHE_UNKNOWN_LABEL },
    { label: 'Situação da cópia', value: planCacheCurrencyLabel(assessed.value.verdict) },
  ];

  return planCacheOk({
    planId: planCacheTrim(entry.planId),
    entryKey: assessed.value.entryKey,
    planIdLabel,
    patientRef: planCacheTrim(entry.patientRef),
    courseRef: planCacheTrim(entry.courseRef),
    lockState,
    locked: lockState === PLAN_CACHE_LOCK_STATES.LOCKED,
    readOnly: lockState !== PLAN_CACHE_LOCK_STATES.UNLOCKED,
    lastTreatmentKind: lastTreatment.kind,
    lastTreatmentAt,
    lastTreatmentLabel,
    lastTreatmentIsAbsent: lastTreatment.kind === PLAN_CACHE_LAST_TREATMENT_KINDS.UNKNOWN,
    lastTreatmentIsNever: lastTreatment.kind === PLAN_CACHE_LAST_TREATMENT_KINDS.NEVER_TREATED,
    currency: assessed.value.verdict,
    currencyReason: assessed.value.reason,
    stamp: assessed.value.stamp,
    warnings,
    displayFields,
  });
}

/* ------------------------------------------------------------------ */
/* FM-4: fingerprint of the presented selection                        */
/* ------------------------------------------------------------------ */

export type PlanCacheSelectionFingerprint = {
  digest: string;
  planCount: number;
  /** Sorted entry keys, so the digest does not depend on selection ordering. */
  entryKeys: string[];
  planIds: string[];
};

function planCacheHash32(text: string, offset: number, prime: number): number {
  let hash = offset >>> 0;
  for (let index = 0; index < text.length; index = index + 1) {
    hash = (hash ^ text.charCodeAt(index)) >>> 0;
    hash = Math.imul(hash, prime) >>> 0;
  }
  return hash >>> 0;
}

function planCacheHex8(value: number): string {
  let text = (value >>> 0).toString(16);
  while (text.length < 8) {
    text = '0' + text;
  }
  return text;
}

/**
 * Canonical form of one entry for the digest. Everything a physicist read off
 * the row and everything that decides whether eviction is safe is included, so
 * a change to any of it invalidates the confirmation (FM-4).
 */
function planCacheCanonicalEntry(entry: PlanCacheEntry): string {
  const revision = entry.sourceRevision || {};
  const lastTreatment = planCacheNormalizeLastTreatment(entry);
  return [
    planCacheEntryKey(entry),
    planCacheTrim(entry.patientRef),
    planCacheTrim(entry.courseRef),
    planCacheTrim(entry.sourceSystem),
    planCacheTrim(revision.revisionId),
    planCacheTrim(revision.planInstanceUid),
    planCacheApprovalStatus(entry),
    planCacheTrim(revision.supersededByRevisionId),
    planCacheNormalizeLockState(entry),
    lastTreatment.kind,
    planCacheIsFiniteNumber(lastTreatment.at) ? String(lastTreatment.at) : '',
    entry.externallyCached === true ? 'cached' : 'not-cached',
  ].join('|');
}

/**
 * FM-4. Digest of the exact set and versions presented in the dialog. Entries
 * are sorted so that a repaint reordering the list does not invalidate a
 * confirmation, while adding, removing or revising any row does.
 *
 * Refuses an empty selection - there is nothing to confirm - and refuses a
 * selection listing the same entry twice, because the count shown to the
 * operator would not match the number of plans actually touched.
 */
export function planCacheFingerprintSelection(
  entries: PlanCacheEntry[]
): PlanCacheResult<PlanCacheSelectionFingerprint> {
  if (!entries || !Array.isArray(entries) || entries.length === 0) {
    return planCacheRefuse(
      PLAN_CACHE_REFUSAL_CODES.EMPTY_SELECTION,
      'Nenhum plano selecionado: não há nada para confirmar.'
    );
  }
  const canonical: string[] = [];
  const keys: string[] = [];
  const seen = new Map<string, boolean>();
  for (let index = 0; index < entries.length; index = index + 1) {
    const entry = entries[index];
    const invalid = planCacheValidateEntry(entry, index);
    if (invalid) {
      return planCacheRefuse(PLAN_CACHE_REFUSAL_CODES.INVALID_ENTRY, invalid);
    }
    const key = planCacheEntryKey(entry);
    if (seen.has(key)) {
      return planCacheRefuse(
        PLAN_CACHE_REFUSAL_CODES.DUPLICATE_SELECTION,
        'A seleção lista o mesmo item de cache duas vezes (' + key + '); a contagem exibida não corresponderia aos planos afetados.'
      );
    }
    seen.set(key, true);
    keys.push(key);
    canonical.push(planCacheCanonicalEntry(entry));
  }
  canonical.sort();
  const joined = canonical.join('\n');
  const primary = planCacheHash32(joined, 0x811c9dc5, 0x01000193);
  const secondary = planCacheHash32(joined, 0x1505ce27, 0x85ebca6b);
  const digest = 'pc1-' + String(canonical.length) + '-' + planCacheHex8(primary) + planCacheHex8(secondary);
  const planIds = entries.map(entry => planCacheTrim(entry.planId));
  planIds.sort();
  keys.sort();
  return planCacheOk({ digest, planCount: canonical.length, entryKeys: keys, planIds });
}

/* ------------------------------------------------------------------ */
/* Clear-cache decision                                               */
/* ------------------------------------------------------------------ */

export type PlanCacheClearConfirmation = {
  /** Digest returned by planCacheFingerprintSelection for what was shown. */
  digest: string;
  confirmedByUserId: string;
  confirmedAt: number;
  /** Free-text justification; required, and recorded verbatim in the audit. */
  reason: string;
  /** Explicit acknowledgement that the eviction is irreversible. */
  acknowledgedIrreversible?: boolean;
  /** Plan count the operator saw, cross-checked against the digest. */
  presentedPlanCount?: number;
};

export type PlanCacheClearBlocker = {
  entryKey: string;
  planId: string;
  code: PlanCacheRefusalCode;
  reason: string;
  holder: string;
};

export type PlanCacheClearTarget = {
  entryKey: string;
  planId: string;
  patientRef: string;
  courseRef: string;
  cachedAt: number;
  cachedAtLabel: string;
  sourceSystem: string;
  sourceRevisionId: string;
  currencyVerdict: PlanCacheCurrencyVerdict;
  lastTreatmentKind: PlanCacheLastTreatmentKind;
  lastTreatmentAt: number;
  lockState: PlanCacheLockState;
  sizeBytes: number;
};

export type PlanCacheClearPlan = {
  fingerprint: PlanCacheSelectionFingerprint;
  authorizedEntryKeys: string[];
  targets: PlanCacheClearTarget[];
  actorId: string;
  justification: string;
  confirmedAt: number;
  decidedAt: number;
};

export type PlanCacheClearDecision = {
  authorized: boolean;
  plan: PlanCacheClearPlan;
  refusalCode: PlanCacheRefusalCode;
  refusalReason: string;
  blockers: PlanCacheClearBlocker[];
  fingerprint: PlanCacheSelectionFingerprint;
  actorId: string;
  justification: string;
  /**
   * FM-5, structural: the audit record is part of the decision, so there is no
   * code path - refusal included - that produces a decision without one.
   */
  audit: PlanCacheAuditEntry;
};

export type PlanCacheClearRequest = {
  selection: PlanCacheEntry[];
  confirmation: PlanCacheClearConfirmation;
  usageProbe?: PlanCacheUsageProbe;
  now: number;
};

function planCacheBuildTarget(entry: PlanCacheEntry, now: number): PlanCacheClearTarget {
  const assessed = planCacheClassifyCurrency(entry, now);
  const lastTreatment = planCacheNormalizeLastTreatment(entry);
  const revision = entry.sourceRevision || {};
  return {
    entryKey: planCacheEntryKey(entry),
    planId: planCacheTrim(entry.planId),
    patientRef: planCacheTrim(entry.patientRef),
    courseRef: planCacheTrim(entry.courseRef),
    cachedAt: entry.cachedAt,
    cachedAtLabel: planCacheFormatUtcInstant(entry.cachedAt),
    sourceSystem: planCacheTrim(entry.sourceSystem),
    sourceRevisionId: planCacheTrim(revision.revisionId),
    currencyVerdict: assessed.ok ? assessed.value.verdict : PLAN_CACHE_CURRENCY_VERDICTS.SNAPSHOT_UNVERIFIED,
    lastTreatmentKind: lastTreatment.kind,
    lastTreatmentAt: planCacheIsFiniteNumber(lastTreatment.at) ? lastTreatment.at : Number.NaN,
    lockState: planCacheNormalizeLockState(entry),
    sizeBytes: planCacheIsFiniteNumber(entry.sizeBytes) ? entry.sizeBytes : Number.NaN,
  };
}

/** Most alarming blocker first, so the refusal names the worst finding. */
const PLAN_CACHE_BLOCKER_PRIORITY: PlanCacheRefusalCode[] = [
  PLAN_CACHE_REFUSAL_CODES.PLAN_IN_USE,
  PLAN_CACHE_REFUSAL_CODES.COURSE_IN_PROGRESS,
  PLAN_CACHE_REFUSAL_CODES.USAGE_UNKNOWN,
  PLAN_CACHE_REFUSAL_CODES.NOT_EXTERNALLY_CACHED,
];

function planCachePickBlocker(blockers: PlanCacheClearBlocker[]): PlanCacheClearBlocker {
  for (let priority = 0; priority < PLAN_CACHE_BLOCKER_PRIORITY.length; priority = priority + 1) {
    for (let index = 0; index < blockers.length; index = index + 1) {
      if (blockers[index].code === PLAN_CACHE_BLOCKER_PRIORITY[priority]) {
        return blockers[index];
      }
    }
  }
  return blockers[0];
}

/**
 * The whole decision, expressed as data and never as an exception. Always
 * returns a decision carrying an audit entry, so the refusal paths are as
 * auditable as the success path (FM-5).
 *
 * A blocked entry refuses the ENTIRE batch rather than quietly evicting the
 * rest: the confirmation was given for a specific set (FM-4), and silently
 * narrowing it to a subset is precisely the "partial reported as success"
 * shape that FM-3 forbids. The operator deselects and confirms again.
 */
export function planCacheEvaluateClearRequest(request: PlanCacheClearRequest): PlanCacheClearDecision {
  const safeRequest = request || ({} as PlanCacheClearRequest);
  const confirmation = safeRequest.confirmation || ({} as PlanCacheClearConfirmation);
  const now = safeRequest.now;
  const selection = safeRequest.selection;
  const actorId = planCacheTrim(confirmation.confirmedByUserId) || PLAN_CACHE_UNKNOWN_ACTOR;
  const justification = planCacheTrim(confirmation.reason);
  const blockers: PlanCacheClearBlocker[] = [];

  const refused = (
    code: PlanCacheRefusalCode,
    reason: string,
    fingerprint?: PlanCacheSelectionFingerprint
  ): PlanCacheClearDecision => {
    const audit = planCacheBuildAuditEntry({
      kind: PLAN_CACHE_AUDIT_KINDS.CLEAR_REFUSED,
      actorId,
      at: planCacheIsFiniteNumber(now) ? now : Number.NaN,
      justification,
      fingerprint,
      selection: Array.isArray(selection) ? selection : [],
      refusalCode: code,
      refusalReason: reason,
      blockers,
    });
    return {
      authorized: false,
      plan: null,
      refusalCode: code,
      refusalReason: reason,
      blockers,
      fingerprint: fingerprint || null,
      actorId,
      justification,
      audit,
    };
  };

  if (!planCacheIsFiniteNumber(now)) {
    // Without a reference instant neither the confirmation TTL nor the cache
    // age can be checked, so no eviction can be justified.
    return refused(
      PLAN_CACHE_REFUSAL_CODES.INVALID_CLOCK,
      'Instante de referência inválido: a limpeza do cache não pode ser autorizada.'
    );
  }
  if (!selection || !Array.isArray(selection) || selection.length === 0) {
    return refused(
      PLAN_CACHE_REFUSAL_CODES.EMPTY_SELECTION,
      'Nenhum plano selecionado: nada a limpar.'
    );
  }

  const fingerprinted = planCacheFingerprintSelection(selection);
  if (!fingerprinted.ok) {
    return refused(fingerprinted.code, fingerprinted.reason);
  }
  const fingerprint = fingerprinted.value;

  if (!confirmation || typeof confirmation !== 'object' || !planCacheTrim(confirmation.digest)) {
    // FM-4: a destructive action with no confirmation bound to a presented
    // list is the "warning that is not a decision".
    return refused(
      PLAN_CACHE_REFUSAL_CODES.MISSING_CONFIRMATION,
      'Confirmação ausente: a limpeza do cache exige confirmação explícita vinculada à lista exibida.',
      fingerprint
    );
  }
  if (confirmation.acknowledgedIrreversible !== true) {
    return refused(
      PLAN_CACHE_REFUSAL_CODES.MISSING_CONFIRMATION,
      'A confirmação não registra o reconhecimento de que a limpeza é irreversível.',
      fingerprint
    );
  }
  if (!planCacheTrim(confirmation.confirmedByUserId)) {
    // FM-5: "who cleared" is one of the five questions the log exists for; a
    // clear that cannot answer it must not happen.
    return refused(
      PLAN_CACHE_REFUSAL_CODES.MISSING_ACTOR,
      'Confirmação sem identificação do responsável: o registro de auditoria não poderia informar quem limpou o cache.',
      fingerprint
    );
  }
  if (!justification) {
    // FM-5: "why" is likewise part of the record, and a blank justification
    // makes a later review unable to separate routine housekeeping from an
    // incident response.
    return refused(
      PLAN_CACHE_REFUSAL_CODES.MISSING_REASON,
      'Justificativa ausente: informe o motivo da limpeza do cache.',
      fingerprint
    );
  }
  if (!planCacheIsFiniteNumber(confirmation.confirmedAt)) {
    return refused(
      PLAN_CACHE_REFUSAL_CODES.CONFIRMATION_EXPIRED,
      'Confirmação sem data e hora válidas.',
      fingerprint
    );
  }
  if (confirmation.confirmedAt > now) {
    return refused(
      PLAN_CACHE_REFUSAL_CODES.CONFIRMATION_EXPIRED,
      'A confirmação tem data posterior ao instante atual e não pode ser aceita.',
      fingerprint
    );
  }
  if (now - confirmation.confirmedAt > PLAN_CACHE_CONFIRMATION_TTL_MS) {
    // FM-8: a confirmation submitted long after it was given no longer
    // evidences an operator present at the console.
    return refused(
      PLAN_CACHE_REFUSAL_CODES.CONFIRMATION_EXPIRED,
      'A confirmação expirou (' + planCacheFormatUtcInstant(confirmation.confirmedAt) + '); confirme novamente.',
      fingerprint
    );
  }
  if (planCacheTrim(confirmation.digest) !== fingerprint.digest) {
    // FM-4: the presented list changed between the dialog opening and the
    // confirmation, so the confirmation does not cover what is here now.
    return refused(
      PLAN_CACHE_REFUSAL_CODES.FINGERPRINT_MISMATCH,
      'A lista de planos mudou desde a confirmação (' + planCacheTrim(confirmation.digest) + ' esperado ' +
        fingerprint.digest + '); revise a seleção e confirme novamente.',
      fingerprint
    );
  }
  if (
    planCacheIsFiniteNumber(confirmation.presentedPlanCount) &&
    confirmation.presentedPlanCount !== fingerprint.planCount
  ) {
    // Belt and braces on FM-4: the count the operator saw must match the set.
    return refused(
      PLAN_CACHE_REFUSAL_CODES.FINGERPRINT_MISMATCH,
      'A quantidade confirmada (' + String(confirmation.presentedPlanCount) + ') difere da quantidade selecionada (' +
        String(fingerprint.planCount) + ').',
      fingerprint
    );
  }

  const targets: PlanCacheClearTarget[] = [];
  for (let index = 0; index < selection.length; index = index + 1) {
    const entry = selection[index];
    const key = planCacheEntryKey(entry);
    const planId = planCacheTrim(entry.planId);

    if (entry.externallyCached !== true) {
      // FM-7: eviction is only safe because the copy can be re-fetched. A plan
      // that is not a cached copy would be destroyed, not evicted.
      blockers.push({
        entryKey: key,
        planId,
        code: PLAN_CACHE_REFUSAL_CODES.NOT_EXTERNALLY_CACHED,
        reason: 'O plano ' + planId + ' não está marcado como cópia em cache externo; removê-lo seria perda definitiva de dados.',
        holder: '',
      });
    }

    const usage = planCacheResolveUsage(entry, safeRequest.usageProbe);
    if (usage.kind === PLAN_CACHE_USAGE_KINDS.IN_USE) {
      // FM-2: a daemon or session holding the plan may be mid-course.
      const holder = usage.holder || PLAN_CACHE_UNKNOWN_LABEL;
      blockers.push({
        entryKey: key,
        planId,
        code: PLAN_CACHE_REFUSAL_CODES.PLAN_IN_USE,
        reason: 'O plano ' + planId + ' está em uso por ' + holder + '; a limpeza foi recusada.' +
          (usage.detail ? ' ' + usage.detail : ''),
        holder,
      });
    } else if (usage.kind === PLAN_CACHE_USAGE_KINDS.UNKNOWN) {
      // FM-2, the sharp half: "ninguém está usando" and "não foi possível
      // descobrir quem está usando" are different facts and only the first
      // permits eviction. Proceeding here would evict a plan that a daemon we
      // could not reach is holding open.
      blockers.push({
        entryKey: key,
        planId,
        code: PLAN_CACHE_REFUSAL_CODES.USAGE_UNKNOWN,
        reason: 'Não foi possível determinar se o plano ' + planId + ' está em uso; isso não equivale a estar livre, ' +
          'e a limpeza foi recusada.' + (usage.detail ? ' ' + usage.detail : ''),
        holder: '',
      });
    }

    if (planCacheNormalizeCourseStatus(entry) === PLAN_CACHE_COURSE_STATUSES.IN_PROGRESS) {
      // FM-2 variant: an open course will need this plan again at the next
      // fraction. Note that an UNKNOWN course status deliberately does NOT
      // block: the usage probe is the authoritative in-use guard, and blocking
      // on every unknown course status would make the cache unclearable,
      // pushing physicists to delete cache files outside the application where
      // no guard and no audit record exist at all.
      blockers.push({
        entryKey: key,
        planId,
        code: PLAN_CACHE_REFUSAL_CODES.COURSE_IN_PROGRESS,
        reason: 'O plano ' + planId + ' pertence a um curso em andamento; a limpeza foi recusada.',
        holder: planCacheTrim(entry.courseRef),
      });
    }

    targets.push(planCacheBuildTarget(entry, now));
  }

  if (blockers.length > 0) {
    const worst = planCachePickBlocker(blockers);
    return refused(worst.code, worst.reason, fingerprint);
  }

  const plan: PlanCacheClearPlan = {
    fingerprint,
    authorizedEntryKeys: targets.map(target => target.entryKey),
    targets,
    actorId,
    justification,
    confirmedAt: confirmation.confirmedAt,
    decidedAt: now,
  };

  const audit = planCacheBuildAuditEntry({
    kind: PLAN_CACHE_AUDIT_KINDS.CLEAR_AUTHORIZED,
    actorId,
    at: now,
    justification,
    fingerprint,
    selection,
    targets,
  });

  return {
    authorized: true,
    plan,
    refusalCode: undefined,
    refusalReason: '',
    blockers,
    fingerprint,
    actorId,
    justification,
    audit,
  };
}

/**
 * Result-shaped facade over planCacheEvaluateClearRequest, for callers that
 * only need go / no-go. The audit entry of the underlying decision is still
 * produced; use planCacheEvaluateClearRequest when the record is needed.
 */
export function planCachePlanClear(
  selection: PlanCacheEntry[],
  confirmation: PlanCacheClearConfirmation,
  usageProbe: PlanCacheUsageProbe,
  now: number
): PlanCacheResult<PlanCacheClearPlan> {
  const decision = planCacheEvaluateClearRequest({ selection, confirmation, usageProbe, now });
  if (!decision.authorized) {
    return planCacheRefuse(decision.refusalCode, decision.refusalReason);
  }
  return planCacheOk(decision.plan);
}

/* ------------------------------------------------------------------ */
/* FM-3: per-plan outcomes and the honest verdict                      */
/* ------------------------------------------------------------------ */

export type PlanCacheClearAttempt = {
  /** Preferred identity; use planCacheEntryKey to build it. */
  entryKey?: string;
  /** Accepted only when it resolves to exactly one authorized target. */
  planId?: string;
  succeeded?: boolean;
  failureCode?: string;
  failureReason?: string;
};

export type PlanCachePlanOutcome = {
  entryKey: string;
  planId: string;
  patientRef: string;
  outcome: PlanCachePlanOutcomeKind;
  cachedAt: number;
  cachedAtLabel: string;
  sourceSystem: string;
  sourceRevisionId: string;
  currencyVerdict: PlanCacheCurrencyVerdict;
  failureCode: string;
  failureReason: string;
};

export type PlanCacheClearReport = {
  verdict: PlanCacheClearVerdict;
  outcomes: PlanCachePlanOutcome[];
  clearedCount: number;
  retainedCount: number;
  unknownCount: number;
  /** True only when every authorized plan is confirmed removed. */
  cacheClean: boolean;
  /**
   * True when at least one plan may still be in the cache. The re-import
   * warning hangs off this, not off `verdict !== success`, so an unaccounted
   * plan warns exactly as loudly as a failed one.
   */
  stalePlansMayRemain: boolean;
  reason: string;
  fingerprintDigest: string;
  actorId: string;
  justification: string;
  reportedAt: number;
  audit: PlanCacheAuditEntry;
};

/**
 * FM-3. Folds the executor's per-plan results into a report whose verdict can
 * never overstate what happened: `success` requires every authorized plan to
 * be confirmed cleared, an unaccounted plan degrades the verdict to `partial`,
 * and `failed` is reserved for the case where every plan is confirmed retained.
 *
 * The harm being blocked: a physicist reads "cache cleared", re-imports from
 * ARIA, and works from a mixture of fresh plans and leftover snapshots with
 * nothing distinguishing them.
 */
export function planCacheApplyClearResults(
  plan: PlanCacheClearPlan,
  attempts: PlanCacheClearAttempt[],
  now: number
): PlanCacheResult<PlanCacheClearReport> {
  if (!planCacheIsFiniteNumber(now)) {
    return planCacheRefuse(
      PLAN_CACHE_REFUSAL_CODES.INVALID_CLOCK,
      'Instante de referência inválido: o resultado da limpeza não pode ser registrado.'
    );
  }
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.targets) || plan.targets.length === 0) {
    return planCacheRefuse(
      PLAN_CACHE_REFUSAL_CODES.INVALID_OUTCOME,
      'Autorização de limpeza ausente ou sem planos: não há resultado a consolidar.'
    );
  }
  if (!attempts || !Array.isArray(attempts)) {
    // Not degraded to "all unknown": an executor that reported nothing at all
    // is a broken integration, and a report built from it would look like a
    // legitimate partial rather than a defect.
    return planCacheRefuse(
      PLAN_CACHE_REFUSAL_CODES.INVALID_OUTCOME,
      'Nenhum resultado por plano informado: não é possível afirmar o que foi removido.'
    );
  }

  const byKey = new Map<string, PlanCacheClearTarget>();
  const planIdCounts = new Map<string, number>();
  for (let index = 0; index < plan.targets.length; index = index + 1) {
    const target = plan.targets[index];
    byKey.set(target.entryKey, target);
    planIdCounts.set(target.planId, (planIdCounts.get(target.planId) || 0) + 1);
  }

  const resolved = new Map<string, PlanCacheClearAttempt>();
  for (let index = 0; index < attempts.length; index = index + 1) {
    const attempt = attempts[index] || ({} as PlanCacheClearAttempt);
    let key = planCacheTrim(attempt.entryKey);
    const planId = planCacheTrim(attempt.planId);
    if (!key && planId) {
      const count = planIdCounts.get(planId) || 0;
      if (count > 1) {
        // Two snapshots of the same plan id were authorized; a result naming
        // only the plan id cannot say which one was removed, and guessing
        // would record the wrong snapshot as evicted.
        return planCacheRefuse(
          PLAN_CACHE_REFUSAL_CODES.AMBIGUOUS_OUTCOME,
          'O resultado informado para o plano ' + planId + ' é ambíguo: há ' + String(count) +
            ' cópias autorizadas com esse Plan ID. Informe entryKey.'
        );
      }
      for (const candidate of byKey.keys()) {
        if (byKey.get(candidate).planId === planId) {
          key = candidate;
        }
      }
    }
    if (!key || !byKey.has(key)) {
      // FM-9: the executor reported on something outside the confirmed set, so
      // the confirmation was bypassed somewhere. Summarizing would launder it.
      return planCacheRefuse(
        PLAN_CACHE_REFUSAL_CODES.UNAUTHORIZED_OUTCOME,
        'Resultado informado para um item que não foi autorizado (' +
          (planCacheTrim(attempt.entryKey) || planId || PLAN_CACHE_UNKNOWN_LABEL) + ').'
      );
    }
    if (resolved.has(key)) {
      // Two results for one plan cannot both be filed; the record would be
      // unusable in a later review even when they happen to agree.
      return planCacheRefuse(
        PLAN_CACHE_REFUSAL_CODES.INVALID_OUTCOME,
        'Dois resultados informados para o mesmo item de cache (' + key + ').'
      );
    }
    resolved.set(key, attempt);
  }

  const outcomes: PlanCachePlanOutcome[] = [];
  let clearedCount = 0;
  let retainedCount = 0;
  let unknownCount = 0;

  for (let index = 0; index < plan.targets.length; index = index + 1) {
    const target = plan.targets[index];
    const attempt = resolved.get(target.entryKey);
    let outcome: PlanCachePlanOutcomeKind = PLAN_CACHE_PLAN_OUTCOMES.UNKNOWN;
    let failureCode = '';
    let failureReason = '';

    if (!attempt) {
      // FM-3: silence about a plan is not success for that plan.
      outcome = PLAN_CACHE_PLAN_OUTCOMES.UNKNOWN;
      failureReason = 'O executor não informou resultado para este item; pode continuar em cache.';
    } else if (attempt.succeeded === true) {
      outcome = PLAN_CACHE_PLAN_OUTCOMES.CLEARED;
    } else if (attempt.succeeded === false) {
      outcome = PLAN_CACHE_PLAN_OUTCOMES.RETAINED;
      failureCode = planCacheTrim(attempt.failureCode);
      failureReason = planCacheTrim(attempt.failureReason) || 'Falha não detalhada pelo executor.';
    } else {
      // Neither true nor false: an indeterminate result stays indeterminate
      // rather than being rounded toward either claim.
      outcome = PLAN_CACHE_PLAN_OUTCOMES.UNKNOWN;
      failureCode = planCacheTrim(attempt.failureCode);
      failureReason =
        planCacheTrim(attempt.failureReason) || 'Resultado sem indicação de sucesso ou falha; estado indeterminado.';
    }

    if (outcome === PLAN_CACHE_PLAN_OUTCOMES.CLEARED) {
      clearedCount = clearedCount + 1;
    } else if (outcome === PLAN_CACHE_PLAN_OUTCOMES.RETAINED) {
      retainedCount = retainedCount + 1;
    } else {
      unknownCount = unknownCount + 1;
    }

    outcomes.push({
      entryKey: target.entryKey,
      planId: target.planId,
      patientRef: target.patientRef,
      outcome,
      cachedAt: target.cachedAt,
      cachedAtLabel: target.cachedAtLabel,
      sourceSystem: target.sourceSystem,
      sourceRevisionId: target.sourceRevisionId,
      currencyVerdict: target.currencyVerdict,
      failureCode,
      failureReason,
    });
  }

  const total = plan.targets.length;
  let verdict: PlanCacheClearVerdict = PLAN_CACHE_CLEAR_VERDICTS.PARTIAL;
  if (clearedCount === total) {
    verdict = PLAN_CACHE_CLEAR_VERDICTS.SUCCESS;
  } else if (retainedCount === total) {
    verdict = PLAN_CACHE_CLEAR_VERDICTS.FAILED;
  }

  const cacheClean = verdict === PLAN_CACHE_CLEAR_VERDICTS.SUCCESS;
  const stalePlansMayRemain = !cacheClean;

  let reason = '';
  if (verdict === PLAN_CACHE_CLEAR_VERDICTS.SUCCESS) {
    reason = 'Todos os ' + String(total) + ' itens autorizados foram removidos do cache.';
  } else if (verdict === PLAN_CACHE_CLEAR_VERDICTS.FAILED) {
    reason = 'Nenhum dos ' + String(total) + ' itens autorizados foi removido; o cache permanece como estava.';
  } else {
    reason =
      'Limpeza parcial: ' + String(clearedCount) + ' removidos, ' + String(retainedCount) + ' mantidos, ' +
      String(unknownCount) + ' indeterminados de ' + String(total) + '. Planos desatualizados podem permanecer em cache; ' +
      'não reimporte assumindo cache limpo.';
  }

  const auditKind =
    verdict === PLAN_CACHE_CLEAR_VERDICTS.SUCCESS
      ? PLAN_CACHE_AUDIT_KINDS.CLEAR_COMPLETED
      : verdict === PLAN_CACHE_CLEAR_VERDICTS.FAILED
        ? PLAN_CACHE_AUDIT_KINDS.CLEAR_FAILED
        : PLAN_CACHE_AUDIT_KINDS.CLEAR_PARTIAL;

  const audit = planCacheBuildAuditEntry({
    kind: auditKind,
    actorId: planCacheTrim(plan.actorId) || PLAN_CACHE_UNKNOWN_ACTOR,
    at: now,
    justification: planCacheTrim(plan.justification),
    fingerprint: plan.fingerprint,
    targets: plan.targets,
    outcomes,
    verdict,
  });

  return planCacheOk({
    verdict,
    outcomes,
    clearedCount,
    retainedCount,
    unknownCount,
    cacheClean,
    stalePlansMayRemain,
    reason,
    fingerprintDigest: plan.fingerprint ? plan.fingerprint.digest : '',
    actorId: planCacheTrim(plan.actorId) || PLAN_CACHE_UNKNOWN_ACTOR,
    justification: planCacheTrim(plan.justification),
    reportedAt: now,
    audit,
  });
}

/* ------------------------------------------------------------------ */
/* FM-5: the audit record                                             */
/* ------------------------------------------------------------------ */

export type PlanCacheAuditPlanRecord = {
  entryKey: string;
  planId: string;
  patientRef: string;
  courseRef: string;
  sourceSystem: string;
  cachedAt: number;
  cachedAtLabel: string;
  sourceRevisionId: string;
  currencyVerdict: PlanCacheCurrencyVerdict;
  lastTreatmentKind: PlanCacheLastTreatmentKind;
  outcome: PlanCachePlanOutcomeKind;
  failureCode: string;
  failureReason: string;
  blockedBy: PlanCacheRefusalCode;
  blockedReason: string;
};

export type PlanCacheAuditEntry = {
  kind: PlanCacheAuditKind;
  actorId: string;
  at: number;
  atLabel: string;
  justification: string;
  selectionDigest: string;
  planCount: number;
  plans: PlanCacheAuditPlanRecord[];
  verdict: PlanCacheClearVerdict;
  refusalCode: PlanCacheRefusalCode;
  refusalReason: string;
  /** True when the record answers who, when, which, why and per-plan outcome. */
  complete: boolean;
  /** Named gaps, so an incomplete record is visibly incomplete. */
  gaps: string[];
  summary: string;
};

export type PlanCacheAuditInput = {
  kind: PlanCacheAuditKind;
  actorId?: string;
  at?: number;
  justification?: string;
  fingerprint?: PlanCacheSelectionFingerprint;
  selection?: PlanCacheEntry[];
  targets?: PlanCacheClearTarget[];
  outcomes?: PlanCachePlanOutcome[];
  blockers?: PlanCacheClearBlocker[];
  verdict?: PlanCacheClearVerdict;
  refusalCode?: PlanCacheRefusalCode;
  refusalReason?: string;
};

function planCacheIsAuditKind(kind: unknown): boolean {
  const table = PLAN_CACHE_AUDIT_KINDS as Record<string, string>;
  const keys = Object.keys(table);
  for (let index = 0; index < keys.length; index = index + 1) {
    if (table[keys[index]] === kind) {
      return true;
    }
  }
  return false;
}

/**
 * Internal builder that never refuses. FM-5 requires a record even when the
 * inputs are poor, so missing facts become explicit gaps rather than a missing
 * record: a refusal with no log entry is exactly the event a later review most
 * needs to see.
 */
function planCacheBuildAuditEntry(input: PlanCacheAuditInput): PlanCacheAuditEntry {
  const safeInput = input || ({} as PlanCacheAuditInput);
  const gaps: string[] = [];
  const actorId = planCacheTrim(safeInput.actorId) || PLAN_CACHE_UNKNOWN_ACTOR;
  if (actorId === PLAN_CACHE_UNKNOWN_ACTOR) {
    gaps.push('responsável não identificado');
  }
  const at = planCacheIsFiniteNumber(safeInput.at) ? safeInput.at : Number.NaN;
  if (!planCacheIsFiniteNumber(at)) {
    gaps.push('data e hora ausentes');
  }
  const justification = planCacheTrim(safeInput.justification);
  if (!justification) {
    gaps.push('justificativa ausente');
  }

  const outcomeByKey = new Map<string, PlanCachePlanOutcome>();
  const outcomes = Array.isArray(safeInput.outcomes) ? safeInput.outcomes : [];
  for (let index = 0; index < outcomes.length; index = index + 1) {
    outcomeByKey.set(outcomes[index].entryKey, outcomes[index]);
  }
  const blockerByKey = new Map<string, PlanCacheClearBlocker>();
  const blockers = Array.isArray(safeInput.blockers) ? safeInput.blockers : [];
  for (let index = 0; index < blockers.length; index = index + 1) {
    if (!blockerByKey.has(blockers[index].entryKey)) {
      blockerByKey.set(blockers[index].entryKey, blockers[index]);
    }
  }

  const plans: PlanCacheAuditPlanRecord[] = [];
  const targets = Array.isArray(safeInput.targets) ? safeInput.targets : [];
  const selection = Array.isArray(safeInput.selection) ? safeInput.selection : [];

  const pushRecord = (
    entryKey: string,
    planId: string,
    patientRef: string,
    courseRef: string,
    sourceSystem: string,
    cachedAt: number,
    sourceRevisionId: string,
    currencyVerdict: PlanCacheCurrencyVerdict,
    lastTreatmentKind: PlanCacheLastTreatmentKind
  ) => {
    const outcome = outcomeByKey.get(entryKey);
    const blocker = blockerByKey.get(entryKey);
    plans.push({
      entryKey,
      planId,
      patientRef,
      courseRef,
      sourceSystem,
      cachedAt,
      cachedAtLabel: planCacheFormatUtcInstant(cachedAt),
      sourceRevisionId,
      currencyVerdict,
      lastTreatmentKind,
      outcome: outcome ? outcome.outcome : PLAN_CACHE_PLAN_OUTCOMES.RETAINED,
      failureCode: outcome ? outcome.failureCode : '',
      failureReason: outcome ? outcome.failureReason : blocker ? blocker.reason : '',
      blockedBy: blocker ? blocker.code : undefined,
      blockedReason: blocker ? blocker.reason : '',
    });
  };

  if (targets.length > 0) {
    for (let index = 0; index < targets.length; index = index + 1) {
      const target = targets[index];
      pushRecord(
        target.entryKey,
        target.planId,
        target.patientRef,
        target.courseRef,
        target.sourceSystem,
        target.cachedAt,
        target.sourceRevisionId,
        target.currencyVerdict,
        target.lastTreatmentKind
      );
    }
  } else if (selection.length > 0) {
    for (let index = 0; index < selection.length; index = index + 1) {
      const entry = selection[index] || ({} as PlanCacheEntry);
      const revision = entry.sourceRevision || {};
      const lastTreatment = planCacheNormalizeLastTreatment(entry);
      pushRecord(
        planCacheEntryKey(entry),
        planCacheTrim(entry.planId) || PLAN_CACHE_UNKNOWN_LABEL,
        planCacheTrim(entry.patientRef),
        planCacheTrim(entry.courseRef),
        planCacheTrim(entry.sourceSystem),
        planCacheIsFiniteNumber(entry.cachedAt) ? entry.cachedAt : Number.NaN,
        planCacheTrim(revision.revisionId),
        PLAN_CACHE_CURRENCY_VERDICTS.SNAPSHOT_UNVERIFIED,
        lastTreatment.kind
      );
    }
  } else {
    gaps.push('nenhum plano identificado no registro');
  }

  for (let index = 0; index < plans.length; index = index + 1) {
    if (!planCacheIsFiniteNumber(plans[index].cachedAt)) {
      gaps.push('data de cache ausente para ' + plans[index].planId);
    }
    if (!plans[index].sourceRevisionId) {
      gaps.push('revisão de origem ausente para ' + plans[index].planId);
    }
  }

  const fingerprint = safeInput.fingerprint;
  const selectionDigest = fingerprint ? planCacheTrim(fingerprint.digest) : '';
  if (!selectionDigest) {
    gaps.push('impressão digital da seleção ausente');
  }

  const refusalCode = safeInput.refusalCode;
  const refusalReason = planCacheTrim(safeInput.refusalReason);
  const verdict = safeInput.verdict;

  let summary = '';
  if (refusalCode) {
    summary =
      'Limpeza de cache recusada para ' + String(plans.length) + ' item(ns) por ' + actorId + ' em ' +
      planCacheFormatUtcInstant(at) + ': ' + refusalReason;
  } else if (verdict) {
    summary =
      'Limpeza de cache (' + verdict + ') de ' + String(plans.length) + ' item(ns) por ' + actorId + ' em ' +
      planCacheFormatUtcInstant(at) + '. Justificativa: ' + (justification || PLAN_CACHE_UNKNOWN_LABEL);
  } else {
    summary =
      'Evento ' + String(safeInput.kind) + ' sobre ' + String(plans.length) + ' item(ns) por ' + actorId + ' em ' +
      planCacheFormatUtcInstant(at) + '.';
  }

  // A record is complete only if it can answer all five audit questions. A
  // clear whose per-plan outcomes are missing cannot separate "cleared" from
  // "attempted and failed", so an authorized-but-unreported clear is not
  // complete either.
  const hasPerPlanOutcome = outcomes.length > 0 || blockers.length > 0 || Boolean(refusalCode);
  const complete =
    gaps.length === 0 && plans.length > 0 && hasPerPlanOutcome && planCacheIsFiniteNumber(at) && Boolean(justification);

  return {
    kind: safeInput.kind,
    actorId,
    at,
    atLabel: planCacheFormatUtcInstant(at),
    justification,
    selectionDigest,
    planCount: plans.length,
    plans,
    verdict,
    refusalCode,
    refusalReason,
    complete,
    gaps,
    summary,
  };
}

/**
 * FM-5. Public audit constructor. Refuses only an unrecognised event kind: a
 * record nobody can classify cannot be filed or retrieved, whereas every other
 * missing fact is recorded as a gap so the entry still exists.
 */
export function planCacheAuditEntry(input: PlanCacheAuditInput): PlanCacheResult<PlanCacheAuditEntry> {
  if (!input || typeof input !== 'object' || !planCacheIsAuditKind(input.kind)) {
    return planCacheRefuse(
      PLAN_CACHE_REFUSAL_CODES.UNKNOWN_AUDIT_KIND,
      'Tipo de evento de auditoria desconhecido: o registro não poderia ser classificado nem recuperado.'
    );
  }
  return planCacheOk(planCacheBuildAuditEntry(input));
}

/* ------------------------------------------------------------------ */
/* Viewer inventory                                                    */
/* ------------------------------------------------------------------ */

export type PlanCacheInventoryRow = {
  entryKey: string;
  planId: string;
  patientRef: string;
  courseRef: string;
  sourceSystem: string;
  cachedAt: number;
  cachedAtLabel: string;
  sizeBytes: number;
  currency: PlanCacheCurrencyAssessment;
  locked: PlanCacheLockedPlanDescription;
  usage: PlanCacheUsageState;
  /** False whenever any blocker applies; the checkbox follows this. */
  clearable: boolean;
  blockers: PlanCacheClearBlocker[];
  /** Another snapshot of the same Plan ID is present in the cache. */
  hasSiblingSnapshot: boolean;
  warnings: string[];
};

export type PlanCacheInventory = {
  rows: PlanCacheInventoryRow[];
  counts: {
    total: number;
    verifiableCurrent: number;
    snapshotUnverified: number;
    knownStale: number;
    locked: number;
    inUse: number;
    unknownUsage: number
    clearable: number;
    blocked: number;
    lastTreatmentAbsent: number;
    neverTreated: number;
  };
  totalSizeBytes: number;
  invalidEntries: string[];
  warnings: string[];
};

/**
 * The list the manage dialog renders. Invalid rows are reported rather than
 * dropped: a cache entry too malformed to describe is itself a finding, and
 * silently omitting it would leave a stale plan on disk that the operator
 * never saw and therefore never cleared.
 *
 * Unlike the clear path, duplicate Plan IDs do not refuse here - two snapshots
 * of one plan is a real and important cache state, and the row flags it.
 */
export function planCacheBuildInventory(
  entries: PlanCacheEntry[],
  now: number,
  usageProbe?: PlanCacheUsageProbe
): PlanCacheResult<PlanCacheInventory> {
  if (!planCacheIsFiniteNumber(now)) {
    return planCacheRefuse(
      PLAN_CACHE_REFUSAL_CODES.INVALID_CLOCK,
      'Instante de referência inválido: o inventário do cache não pode ser montado.'
    );
  }
  if (!entries || !Array.isArray(entries)) {
    return planCacheRefuse(
      PLAN_CACHE_REFUSAL_CODES.INVALID_ENTRY,
      'Inventário de cache inválido: era esperada uma lista de itens.'
    );
  }

  const planIdCounts = new Map<string, number>();
  for (let index = 0; index < entries.length; index = index + 1) {
    const planId = planCacheTrim(entries[index] && entries[index].planId);
    if (planId) {
      planIdCounts.set(planId, (planIdCounts.get(planId) || 0) + 1);
    }
  }

  const rows: PlanCacheInventoryRow[] = [];
  const invalidEntries: string[] = [];
  const warnings: string[] = [];
  const counts = {
    total: 0,
    verifiableCurrent: 0,
    snapshotUnverified: 0,
    knownStale: 0,
    locked: 0,
    inUse: 0,
    unknownUsage: 0,
    clearable: 0,
    blocked: 0,
    lastTreatmentAbsent: 0,
    neverTreated: 0,
  };
  let totalSizeBytes = 0;

  for (let index = 0; index < entries.length; index = index + 1) {
    const entry = entries[index];
    const invalid = planCacheValidateEntry(entry, index);
    if (invalid) {
      invalidEntries.push(invalid);
      continue;
    }
    const assessed = planCacheClassifyCurrency(entry, now);
    const described = planCacheDescribeLockedPlan(entry, now);
    if (!assessed.ok || !described.ok) {
      invalidEntries.push('entrada ' + String(index) + ': ' + (assessed.ok ? described.reason : assessed.reason));
      continue;
    }
    const usage = planCacheResolveUsage(entry, usageProbe);
    const key = planCacheEntryKey(entry);
    const planId = planCacheTrim(entry.planId);
    const blockers: PlanCacheClearBlocker[] = [];

    if (entry.externallyCached !== true) {
      blockers.push({
        entryKey: key,
        planId,
        code: PLAN_CACHE_REFUSAL_CODES.NOT_EXTERNALLY_CACHED,
        reason: 'Não é uma cópia em cache externo; não pode ser removido por esta caixa de diálogo.',
        holder: '',
      });
    }
    if (usage.kind === PLAN_CACHE_USAGE_KINDS.IN_USE) {
      blockers.push({
        entryKey: key,
        planId,
        code: PLAN_CACHE_REFUSAL_CODES.PLAN_IN_USE,
        reason: 'Em uso por ' + (usage.holder || PLAN_CACHE_UNKNOWN_LABEL) + '.',
        holder: usage.holder || PLAN_CACHE_UNKNOWN_LABEL,
      });
      counts.inUse = counts.inUse + 1;
    } else if (usage.kind === PLAN_CACHE_USAGE_KINDS.UNKNOWN) {
      blockers.push({
        entryKey: key,
        planId,
        code: PLAN_CACHE_REFUSAL_CODES.USAGE_UNKNOWN,
        reason: 'Estado de uso desconhecido; desconhecido não é o mesmo que livre.',
        holder: '',
      });
      counts.unknownUsage = counts.unknownUsage + 1;
    }
    if (planCacheNormalizeCourseStatus(entry) === PLAN_CACHE_COURSE_STATUSES.IN_PROGRESS) {
      blockers.push({
        entryKey: key,
        planId,
        code: PLAN_CACHE_REFUSAL_CODES.COURSE_IN_PROGRESS,
        reason: 'Curso em andamento.',
        holder: planCacheTrim(entry.courseRef),
      });
    }

    counts.total = counts.total + 1;
    if (assessed.value.verdict === PLAN_CACHE_CURRENCY_VERDICTS.VERIFIABLE_CURRENT) {
      counts.verifiableCurrent = counts.verifiableCurrent + 1;
    } else if (assessed.value.verdict === PLAN_CACHE_CURRENCY_VERDICTS.KNOWN_STALE) {
      counts.knownStale = counts.knownStale + 1;
    } else {
      counts.snapshotUnverified = counts.snapshotUnverified + 1;
    }
    if (described.value.locked) {
      counts.locked = counts.locked + 1;
    }
    if (described.value.lastTreatmentIsAbsent) {
      counts.lastTreatmentAbsent = counts.lastTreatmentAbsent + 1;
    }
    if (described.value.lastTreatmentIsNever) {
      counts.neverTreated = counts.neverTreated + 1;
    }
    if (blockers.length === 0) {
      counts.clearable = counts.clearable + 1;
    } else {
      counts.blocked = counts.blocked + 1;
    }
    if (planCacheIsFiniteNumber(entry.sizeBytes)) {
      totalSizeBytes = totalSizeBytes + entry.sizeBytes;
    }

    const hasSiblingSnapshot = (planIdCounts.get(planId) || 0) > 1;
    const rowWarnings = described.value.warnings.slice(0);
    if (hasSiblingSnapshot) {
      rowWarnings.push(
        'Existe mais de uma cópia em cache com este Plan ID; confira a data de captura antes de remover.'
      );
    }

    rows.push({
      entryKey: key,
      planId,
      patientRef: planCacheTrim(entry.patientRef),
      courseRef: planCacheTrim(entry.courseRef),
      sourceSystem: assessed.value.sourceSystem,
      cachedAt: entry.cachedAt,
      cachedAtLabel: assessed.value.cachedAtLabel,
      sizeBytes: planCacheIsFiniteNumber(entry.sizeBytes) ? entry.sizeBytes : Number.NaN,
      currency: assessed.value,
      locked: described.value,
      usage,
      clearable: blockers.length === 0,
      blockers,
      hasSiblingSnapshot,
      warnings: rowWarnings,
    });
  }

  if (invalidEntries.length > 0) {
    warnings.push(
      String(invalidEntries.length) + ' item(ns) do cache não puderam ser descritos e continuam armazenados; ' +
        'trate-os antes de assumir que o cache está limpo.'
    );
  }
  if (counts.knownStale > 0) {
    warnings.push(
      String(counts.knownStale) + ' plano(s) em cache estão desatualizados em relação à origem e não devem ser tratados ' +
        'como o plano vigente.'
    );
  }
  if (counts.snapshotUnverified > 0) {
    warnings.push(
      String(counts.snapshotUnverified) + ' plano(s) em cache não foram verificados contra a origem; ausência de ' +
        'informação de revisão não significa que estão atuais.'
    );
  }

  rows.sort((left, right) => {
    if (left.planId < right.planId) {
      return -1;
    }
    if (left.planId > right.planId) {
      return 1;
    }
    return left.cachedAt - right.cachedAt;
  });

  return planCacheOk({ rows, counts, totalSizeBytes, invalidEntries, warnings });
}
