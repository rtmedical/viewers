/**
 * Peer review: comments, agreement scoring and the discrepancy KPI — pure core (RTV-108).
 *
 * The workflow states live in `reportWorkflow.ts`; this is what the reviewer produces and
 * what the department measures.
 *
 * ## The KPI is a measurement, and a biased sample is not one
 *
 * "Rate of significant discrepancy" is the number a peer review programme reports upward,
 * and it is worth almost nothing unless the reviewed cases were **selected without
 * reference to their content**. A programme where reviewers pick interesting cases, or
 * where a radiologist submits the ones they are unsure about, measures the selection and
 * not the reading.
 *
 * So {@link discrepancyRate} takes the sampling method as a required field and
 * **refuses to report a rate** for a non-random sample — it returns the counts, which are
 * still useful, without the denominator that would make them look like a quality metric.
 * This is the one thing in the module that will be argued about, and it is the reason the
 * module is worth having.
 *
 * ## Small denominators
 *
 * A 3% discrepancy rate from 30 cases has a confidence interval running from roughly 0.6%
 * to 15%. Reporting the point estimate to a quality committee, next to another
 * radiologist's 6% from 400 cases, invites a conclusion the data does not support.
 * {@link discrepancyRate} returns a Wilson interval and
 * {@link compareRates} refuses to call two rates different when their intervals overlap.
 *
 * ## Agreement is a scale, not a boolean
 *
 * RADPEER-style scoring separates "I would have said the same" from "I disagree and it
 * matters clinically". Collapsing them loses the only distinction the programme exists to
 * find: a disagreement that would not have changed management is a teaching point, and one
 * that would is an incident.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

/** RADPEER-style agreement scale. */
export type AgreementScore = 1 | 2 | 3;

export const AGREEMENT_LABELS: Record<AgreementScore, string> = {
  1: 'Concordo com a interpretação',
  2: 'Discordância que não altera conduta',
  3: 'Discordância que altera conduta',
};

/** Scores at or above this are counted as significant discrepancies. */
export const SIGNIFICANT_DISCREPANCY_SCORE: AgreementScore = 3;

export type SamplingMethod = 'random' | 'consecutive' | 'selected' | 'unknown';

export const SAMPLING_LABELS: Record<SamplingMethod, string> = {
  random: 'amostra aleatória',
  consecutive: 'casos consecutivos',
  selected: 'casos selecionados',
  unknown: 'método de amostragem não registrado',
};

/** Only these support a rate that means anything about the reading. */
export const UNBIASED_SAMPLING: SamplingMethod[] = ['random', 'consecutive'];

export interface ReviewComment {
  id: string;
  /** Report section the comment is anchored to. */
  section: string;
  text: string;
  /** Optional image evidence. */
  sopInstanceUid?: string;
  frameNumber?: number;
  authorId: string;
  at: number;
}

export interface PeerReview {
  reportId: string;
  reviewerId: string;
  authorId: string;
  score: AgreementScore;
  comments: ReviewComment[];
  submittedAt: number;
}

export interface ReviewValidation {
  ok: boolean;
  review: PeerReview | null;
  error?: string;
}

const text = (v: unknown): string => String(v ?? '').trim();

/**
 * Builds a submitted review.
 *
 * Refuses a self-review, and refuses a disagreement with no comment: a score of 2 or 3
 * with nothing written down is a mark on a dashboard that the author cannot learn from and
 * cannot contest.
 */
export function submitReview(input: {
  reportId: string;
  reviewerId: string;
  authorId: string;
  score: AgreementScore;
  comments?: ReviewComment[];
  submittedAt: number;
}): ReviewValidation {
  const reviewerId = text(input?.reviewerId);
  const authorId = text(input?.authorId);
  const score = Number(input?.score) as AgreementScore;
  const comments = (input?.comments ?? []).filter(c => c && text(c.text));

  if (!text(input?.reportId)) {
    return { ok: false, review: null, error: 'Revisão sem laudo identificado.' };
  }
  if (!reviewerId || !authorId) {
    return { ok: false, review: null, error: 'Revisão sem revisor ou autor identificado.' };
  }
  if (reviewerId.toLowerCase() === authorId.toLowerCase()) {
    return { ok: false, review: null, error: 'O revisor não pode ser o autor do laudo.' };
  }
  if (![1, 2, 3].includes(score)) {
    return { ok: false, review: null, error: 'Pontuação de concordância inválida.' };
  }
  if (!Number.isFinite(Number(input?.submittedAt))) {
    return { ok: false, review: null, error: 'Revisão sem horário.' };
  }
  if (score > 1 && !comments.length) {
    return {
      ok: false,
      review: null,
      error:
        'Discordância exige comentário — uma marca no painel que o autor não pode aprender nem contestar não é revisão.',
    };
  }

  return {
    ok: true,
    review: {
      reportId: text(input.reportId),
      reviewerId,
      authorId,
      score,
      comments,
      submittedAt: Number(input.submittedAt),
    },
  };
}

export interface DiscrepancyCounts {
  reviewed: number;
  agreements: number;
  minorDiscrepancies: number;
  significantDiscrepancies: number;
}

export function countReviews(reviews: PeerReview[]): DiscrepancyCounts {
  const list = (reviews ?? []).filter(Boolean);
  return {
    reviewed: list.length,
    agreements: list.filter(r => r.score === 1).length,
    minorDiscrepancies: list.filter(r => r.score === 2).length,
    significantDiscrepancies: list.filter(r => r.score >= SIGNIFICANT_DISCREPANCY_SCORE).length,
  };
}

export interface RateResult {
  counts: DiscrepancyCounts;
  /** Significant discrepancies over reviewed. Null when the sample cannot support a rate. */
  rate: number | null;
  /** Wilson 95% interval. Null alongside a null rate. */
  lower: number | null;
  upper: number | null;
  sampling: SamplingMethod;
  reportable: boolean;
  message: string;
}

/**
 * Wilson score interval, which behaves at small n and near zero where the normal
 * approximation does not.
 *
 * The normal interval on 1/30 runs below zero, which is the kind of output that makes a
 * quality committee stop trusting the whole report.
 */
export function wilsonInterval(
  successes: number,
  total: number,
  z = 1.96
): { lower: number; upper: number } {
  const n = Math.max(0, Math.floor(Number(total) || 0));
  const k = Math.min(n, Math.max(0, Math.floor(Number(successes) || 0)));
  if (n === 0) {
    return { lower: 0, upper: 0 };
  }
  const p = k / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return {
    lower: Math.max(0, (centre - spread) / denominator),
    upper: Math.min(1, (centre + spread) / denominator),
  };
}

/**
 * The discrepancy rate, or a refusal to state one.
 *
 * A rate is only reported for an unbiased sample. For a selected sample the counts come
 * back with `rate: null` — the numbers are still useful for teaching, and the denominator
 * that would turn them into a quality metric is withheld, because a programme where
 * reviewers pick interesting cases measures the selection and not the reading.
 */
export function discrepancyRate(
  reviews: PeerReview[],
  sampling: SamplingMethod
): RateResult {
  const counts = countReviews(reviews);
  const method: SamplingMethod = SAMPLING_LABELS[sampling] ? sampling : 'unknown';

  if (!UNBIASED_SAMPLING.includes(method)) {
    return {
      counts,
      rate: null,
      lower: null,
      upper: null,
      sampling: method,
      reportable: false,
      message:
        `${counts.significantDiscrepancies} discordância(s) significativa(s) em ${counts.reviewed} revisões ` +
        `(${SAMPLING_LABELS[method]}). Sem taxa: uma amostra escolhida mede a seleção, não a leitura.`,
    };
  }

  if (!counts.reviewed) {
    return {
      counts,
      rate: null,
      lower: null,
      upper: null,
      sampling: method,
      reportable: false,
      message: 'Nenhuma revisão no período.',
    };
  }

  const rate = counts.significantDiscrepancies / counts.reviewed;
  const { lower, upper } = wilsonInterval(counts.significantDiscrepancies, counts.reviewed);

  return {
    counts,
    rate,
    lower,
    upper,
    sampling: method,
    reportable: true,
    message:
      `${(rate * 100).toFixed(1)}% (IC95% ${(lower * 100).toFixed(1)}–${(upper * 100).toFixed(1)}%) ` +
      `em ${counts.reviewed} revisões, ${SAMPLING_LABELS[method]}.`,
  };
}

export interface RateComparison {
  different: boolean;
  message: string;
}

/**
 * Whether two discrepancy rates differ.
 *
 * Refuses to call them different when the intervals overlap. A 3% from 30 cases next to a
 * 6% from 400 looks like a two-fold difference and is not distinguishable from chance —
 * and the person being compared is a colleague.
 */
export function compareRates(a: RateResult, b: RateResult): RateComparison {
  if (!a?.reportable || !b?.reportable) {
    return {
      different: false,
      message: 'Ao menos uma das taxas não é reportável — comparação não faz sentido.',
    };
  }
  const overlap = (a.lower as number) <= (b.upper as number) && (b.lower as number) <= (a.upper as number);
  if (overlap) {
    return {
      different: false,
      message:
        `${(a.rate! * 100).toFixed(1)}% e ${(b.rate! * 100).toFixed(1)}% têm intervalos de confiança ` +
        'sobrepostos — a diferença não se distingue do acaso.',
    };
  }
  return {
    different: true,
    message: `${(a.rate! * 100).toFixed(1)}% e ${(b.rate! * 100).toFixed(1)}% diferem além do acaso.`,
  };
}

/** Readout for the peer-review dashboard. */
export function describeRate(result: RateResult): string {
  return result?.message ?? '';
}

/** One line per review for the reviewer's queue. */
export function describeReview(review: PeerReview): string {
  if (!review) {
    return '';
  }
  const label = AGREEMENT_LABELS[review.score] ?? '';
  const comments = review.comments.length ? ` · ${review.comments.length} comentário(s)` : '';
  return `${review.score} — ${label}${comments}`;
}
