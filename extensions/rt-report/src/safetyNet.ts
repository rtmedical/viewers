/**
 * Follow-up safety net: recommendations tracked to closure — pure core (RTV-229).
 *
 * The critical-findings module (RTV-202) handles the finding that has to reach somebody in
 * the next ten minutes. This handles the other failure, which is quieter and far more
 * common:
 *
 * > "Recomenda-se TC de controle em 6 meses."
 *
 * Written in a report, signed, distributed — and never done. Nobody notices, because
 * nothing in the system is watching. The lung nodule that was 6 mm is 19 mm when the
 * patient comes back for something else, two years later.
 *
 * ## A recommendation that nobody tracks is a sentence, not a plan
 *
 * The whole value here is that a recommendation becomes an object with a due date and a
 * closure state, rather than a phrase inside a PDF. Everything else in the module follows
 * from that.
 *
 * ## Closure needs evidence, not the passage of time
 *
 * The tempting implementation expires a recommendation once its window has passed. That
 * turns the safety net into a queue that empties itself, which is worse than no queue at
 * all — the numbers look healthy precisely because the recommendations nobody acted on
 * disappeared. {@link closeRecommendation} requires a reason, and expiry is not one of
 * them.
 *
 * ## An automatic match closes loops that were not closed
 *
 * A later CT of the chest probably satisfies "repeat chest CT in 6 months". Probably. It
 * might be a CT angiogram for a different question, reconstructed differently, read by
 * somebody who did not know to look. Auto-closing on a modality-and-region match produces a
 * closure rate that measures scheduling rather than care.
 *
 * So {@link proposeMatch} proposes and never closes, and it reports *why* it thinks the
 * study matches, so the human confirming it is confirming something specific.
 *
 * ## The closure rate is the metric, and it needs its denominator honest
 *
 * Recommendations still inside their window are not failures and not successes; counting
 * them either way is wrong. {@link closureStatistics} excludes them and says how many it
 * excluded.
 *
 * Time is injected. Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export type RecommendationKind = 'imaging' | 'clinical' | 'laboratory' | 'referral';

export type Urgency = 'routine' | 'priority' | 'urgent';

/** Grace period after the due date before it counts as overdue. */
export const GRACE_DAYS: Record<Urgency, number> = { urgent: 3, priority: 14, routine: 30 };

/**
 * Escalation thresholds, counted from the **end of the grace period** rather than from the
 * due date.
 *
 * Measuring them from the due date makes the grace meaningless for the urgency whose grace
 * happens to equal the first threshold: for `routine` both are 30 days, so a recommendation
 * would jump straight from "vencendo" to "cobrar o solicitante" and the plain `overdue`
 * state would be unreachable. The tests found exactly that.
 */
export const ESCALATE_REFERRER_DAYS = 30;
export const ESCALATE_INSTITUTION_DAYS = 90;

export const DAY_MS = 86_400_000;

export type ClosureReason =
  | 'followUpPerformed'
  | 'noLongerIndicated'
  | 'patientDeclined'
  | 'patientDeceased'
  | 'carryingOutElsewhere'
  | 'supersededByNewFinding';

export const CLOSURE_LABELS: Record<ClosureReason, string> = {
  followUpPerformed: 'seguimento realizado',
  noLongerIndicated: 'não mais indicado',
  patientDeclined: 'paciente recusou',
  patientDeceased: 'paciente falecido',
  carryingOutElsewhere: 'seguimento em outro serviço',
  supersededByNewFinding: 'superado por achado novo',
};

export interface Recommendation {
  id: string;
  patientId: string;
  /** Report that made it. */
  reportId: string;
  kind: RecommendationKind;
  urgency: Urgency;
  /** What was recommended, in the reader's words. */
  text: string;
  /** Modality expected to satisfy it, when it is imaging. */
  modality?: string;
  /** Body region, for matching. */
  bodyPart?: string;
  /** When the recommending report was issued. */
  issuedAt: number;
  /** Interval the reader asked for, in days. */
  intervalDays: number;
  closure?: Closure;
}

export interface Closure {
  reason: ClosureReason;
  at: number;
  by: string;
  note?: string;
  /** Study that satisfied it, when the reason is `followUpPerformed`. */
  studyInstanceUid?: string;
}

const text = (v: unknown): string => String(v ?? '').trim();

/** Due date, computed from the report that made the recommendation — never from now. */
export function dueAt(recommendation: Recommendation): number {
  const issued = Number(recommendation?.issuedAt);
  const days = Number(recommendation?.intervalDays);
  if (!Number.isFinite(issued) || !Number.isFinite(days)) {
    return NaN;
  }
  return issued + days * DAY_MS;
}

export type SafetyNetState =
  | 'scheduled'
  | 'due'
  | 'overdue'
  | 'escalatedToReferrer'
  | 'escalatedToInstitution'
  | 'closed';

export const STATE_LABELS: Record<SafetyNetState, string> = {
  scheduled: 'Programado',
  due: 'Vencendo',
  overdue: 'Vencido',
  escalatedToReferrer: 'Escalado ao solicitante',
  escalatedToInstitution: 'Escalado à instituição',
  closed: 'Encerrado',
};

export interface StateAssessment {
  state: SafetyNetState;
  dueAt: number;
  /** Days past due; negative while still scheduled. */
  overdueDays: number;
  message: string;
}

/**
 * Where a recommendation stands.
 *
 * Derived from the clock, like the critical-findings escalation (RTV-202) and for the same
 * reason: a stored state is only as good as the job that updates it, and a safety net that
 * silently stops escalating is worse than none.
 */
export function assessState(recommendation: Recommendation, now: number): StateAssessment {
  const due = dueAt(recommendation);
  const at = Number(now);

  if (recommendation?.closure) {
    return {
      state: 'closed',
      dueAt: due,
      overdueDays: 0,
      message: `Encerrado: ${CLOSURE_LABELS[recommendation.closure.reason] ?? recommendation.closure.reason}.`,
    };
  }
  if (!Number.isFinite(due) || !Number.isFinite(at)) {
    return { state: 'scheduled', dueAt: due, overdueDays: 0, message: 'Sem prazo calculável.' };
  }

  const grace = GRACE_DAYS[recommendation.urgency] ?? GRACE_DAYS.routine;
  const overdueDays = (at - due) / DAY_MS;

  if (overdueDays < 0) {
    return {
      state: 'scheduled',
      dueAt: due,
      overdueDays,
      message: `Programado para daqui a ${Math.ceil(-overdueDays)} dia(s).`,
    };
  }
  if (overdueDays <= grace) {
    return {
      state: 'due',
      dueAt: due,
      overdueDays,
      message: `Vencendo — ${Math.floor(overdueDays)} dia(s) desde a data prevista (tolerância ${grace}).`,
    };
  }
  const lateDays = overdueDays - grace;
  if (lateDays >= ESCALATE_INSTITUTION_DAYS) {
    return {
      state: 'escalatedToInstitution',
      dueAt: due,
      overdueDays,
      message: `Vencido há ${Math.floor(overdueDays)} dias — fora do alcance do solicitante; responsabilidade institucional.`,
    };
  }
  if (lateDays >= ESCALATE_REFERRER_DAYS) {
    return {
      state: 'escalatedToReferrer',
      dueAt: due,
      overdueDays,
      message: `Vencido há ${Math.floor(overdueDays)} dias — cobrar o médico solicitante.`,
    };
  }
  return {
    state: 'overdue',
    dueAt: due,
    overdueDays,
    message: `Vencido há ${Math.floor(overdueDays)} dias.`,
  };
}

export interface CloseResult {
  recommendation: Recommendation | null;
  error?: string;
}

/**
 * Closes a recommendation.
 *
 * There is no `expired` reason and there is no automatic closure. A safety net that empties
 * itself reports healthy numbers precisely because the recommendations nobody acted on
 * disappeared.
 */
export function closeRecommendation(
  recommendation: Recommendation,
  closure: Closure
): CloseResult {
  if (recommendation?.closure) {
    return { recommendation: null, error: 'Recomendação já encerrada.' };
  }
  if (!CLOSURE_LABELS[closure?.reason]) {
    return {
      recommendation: null,
      error: 'Motivo de encerramento inválido — o tempo passar não é motivo.',
    };
  }
  if (!text(closure?.by)) {
    return { recommendation: null, error: 'Encerramento sem responsável.' };
  }
  if (!Number.isFinite(Number(closure?.at))) {
    return { recommendation: null, error: 'Encerramento sem horário.' };
  }
  if (closure.reason === 'followUpPerformed' && !text(closure.studyInstanceUid)) {
    // "Performed" without the study that performed it is an assertion, not a record.
    return {
      recommendation: null,
      error: 'Encerramento por seguimento realizado exige o estudo que o realizou.',
    };
  }

  return { recommendation: { ...recommendation, closure: { ...closure, by: text(closure.by) } } };
}

export interface CandidateStudy {
  studyInstanceUid: string;
  patientId: string;
  modality: string;
  bodyPart?: string;
  studyDate: number;
  description?: string;
}

export interface MatchProposal {
  studyInstanceUid: string;
  /** 0..1. Not a probability — a ranking, so the reader sees the best candidate first. */
  score: number;
  reasons: string[];
  concerns: string[];
}

/**
 * Proposes studies that might satisfy a recommendation. Never closes anything.
 *
 * A later chest CT *probably* satisfies "repeat chest CT in 6 months". Probably. It might be
 * an angiogram for a different question, reconstructed differently, read by somebody who did
 * not know to look. Auto-closing on modality-and-region produces a closure rate that
 * measures scheduling rather than care — so the reasons and the concerns both come back, and
 * a human confirms something specific.
 */
export function proposeMatch(
  recommendation: Recommendation,
  candidates: CandidateStudy[],
  now: number
): MatchProposal[] {
  const due = dueAt(recommendation);
  const proposals: MatchProposal[] = [];

  for (const candidate of candidates ?? []) {
    if (text(candidate?.patientId) !== text(recommendation?.patientId)) {
      continue;
    }
    const studyDate = Number(candidate?.studyDate);
    if (!Number.isFinite(studyDate) || studyDate <= Number(recommendation?.issuedAt)) {
      continue;
    }

    const reasons: string[] = [];
    const concerns: string[] = [];
    let score = 0.2;

    const wantedModality = text(recommendation?.modality).toUpperCase();
    const gotModality = text(candidate?.modality).toUpperCase();
    if (wantedModality && gotModality === wantedModality) {
      reasons.push(`modalidade ${gotModality} confere`);
      score += 0.35;
    } else if (wantedModality) {
      concerns.push(`recomendado ${wantedModality}, encontrado ${gotModality || 'sem modalidade'}`);
    }

    const wantedPart = text(recommendation?.bodyPart).toUpperCase();
    const gotPart = text(candidate?.bodyPart).toUpperCase();
    if (wantedPart && gotPart === wantedPart) {
      reasons.push(`região ${gotPart} confere`);
      score += 0.25;
    } else if (wantedPart) {
      concerns.push(`recomendada região ${wantedPart}, encontrada ${gotPart || 'não informada'}`);
    }

    if (Number.isFinite(due)) {
      const offsetDays = Math.abs(studyDate - due) / DAY_MS;
      if (offsetDays <= 30) {
        reasons.push(`realizado a ${Math.round(offsetDays)} dia(s) da data prevista`);
        score += 0.2;
      } else {
        concerns.push(`realizado a ${Math.round(offsetDays)} dias da data prevista`);
      }
    }

    // Always present, because it is always true and the reader should see it every time.
    concerns.push(
      'um exame na mesma região não prova que a pergunta do seguimento foi respondida — confirme antes de encerrar'
    );

    proposals.push({
      studyInstanceUid: text(candidate.studyInstanceUid),
      score: Math.min(1, score),
      reasons,
      concerns,
    });
  }

  return proposals.sort((a, b) => b.score - a.score);
}

export interface ClosureStatistics {
  /** Recommendations whose window has passed, i.e. the honest denominator. */
  actionable: number;
  closed: number;
  /** Closed because the follow-up actually happened. */
  closedByFollowUp: number;
  /** Fraction of actionable recommendations that were closed at all. */
  closureRate: number;
  /** Still inside their window — neither a success nor a failure. */
  stillScheduled: number;
  overdue: number;
  message: string;
}

/**
 * Loop-closure statistics.
 *
 * Recommendations still inside their window are excluded from the denominator and counted
 * separately. Counting them as failures makes a healthy service look negligent; counting
 * them as successes makes a negligent one look healthy. Neither is a measurement.
 */
export function closureStatistics(
  recommendations: Recommendation[],
  now: number
): ClosureStatistics {
  let actionable = 0;
  let closed = 0;
  let closedByFollowUp = 0;
  let stillScheduled = 0;
  let overdue = 0;

  for (const recommendation of recommendations ?? []) {
    const state = assessState(recommendation, now);
    if (state.state === 'closed') {
      actionable += 1;
      closed += 1;
      if (recommendation.closure?.reason === 'followUpPerformed') {
        closedByFollowUp += 1;
      }
      continue;
    }
    if (state.state === 'scheduled') {
      stillScheduled += 1;
      continue;
    }
    actionable += 1;
    overdue += 1;
  }

  const closureRate = actionable ? closed / actionable : 0;
  return {
    actionable,
    closed,
    closedByFollowUp,
    closureRate,
    stillScheduled,
    overdue,
    message: actionable
      ? `${(closureRate * 100).toFixed(0)}% de ${actionable} recomendação(ões) vencida(s) encerrada(s); ${overdue} em aberto. ${stillScheduled} ainda dentro do prazo, fora da conta.`
      : `Nenhuma recomendação vencida. ${stillScheduled} ainda dentro do prazo.`,
  };
}

/** The queue, worst first. */
export function triage(recommendations: Recommendation[], now: number): Recommendation[] {
  const rank: Record<SafetyNetState, number> = {
    escalatedToInstitution: 0,
    escalatedToReferrer: 1,
    overdue: 2,
    due: 3,
    scheduled: 4,
    closed: 5,
  };
  return [...(recommendations ?? [])].sort((a, b) => {
    const sa = assessState(a, now);
    const sb = assessState(b, now);
    const byState = rank[sa.state] - rank[sb.state];
    return byState !== 0 ? byState : sb.overdueDays - sa.overdueDays;
  });
}

/** One line for the safety-net queue. */
export function describeRecommendation(
  recommendation: Recommendation,
  now: number
): string {
  if (!recommendation) {
    return '';
  }
  const state = assessState(recommendation, now);
  return `${STATE_LABELS[state.state]} · ${text(recommendation.text)} · ${state.message}`;
}
