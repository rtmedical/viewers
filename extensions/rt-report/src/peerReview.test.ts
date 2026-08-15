import {
  AGREEMENT_LABELS,
  AgreementScore,
  compareRates,
  countReviews,
  describeRate,
  describeReview,
  discrepancyRate,
  PeerReview,
  SAMPLING_LABELS,
  submitReview,
  UNBIASED_SAMPLING,
  wilsonInterval,
} from './peerReview';

const T0 = 1_700_000_000_000;

const comment = (text = 'Nódulo no LSD não descrito.') => ({
  id: 'c1',
  section: 'Achados',
  text,
  authorId: 'bruno',
  at: T0,
});

const review = (score: AgreementScore, over: Partial<PeerReview> = {}): PeerReview => ({
  reportId: 'r1',
  reviewerId: 'bruno',
  authorId: 'ana',
  score,
  comments: score > 1 ? [comment()] : [],
  submittedAt: T0,
  ...over,
});

const many = (agree: number, minor: number, significant: number): PeerReview[] => [
  ...Array.from({ length: agree }, () => review(1)),
  ...Array.from({ length: minor }, () => review(2)),
  ...Array.from({ length: significant }, () => review(3)),
];

describe('peerReview — submitting one', () => {
  it('accepts an agreement with no comment', () => {
    const result = submitReview({
      reportId: 'r1', reviewerId: 'bruno', authorId: 'ana', score: 1, submittedAt: T0,
    });
    expect(result.ok).toBe(true);
    expect(result.review!.score).toBe(1);
  });

  // Self-review defeats the purpose and is the single most likely shortcut.
  it('REFUSES a self-review', () => {
    const result = submitReview({
      reportId: 'r1', reviewerId: 'ana', authorId: 'ANA', score: 1, submittedAt: T0,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/não pode ser o autor/);
  });

  // A mark on a dashboard the author cannot learn from and cannot contest is not review.
  it('REFUSES a disagreement with no comment', () => {
    const result = submitReview({
      reportId: 'r1', reviewerId: 'bruno', authorId: 'ana', score: 3, submittedAt: T0,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/não pode aprender nem contestar/);
  });

  it('accepts a disagreement with one', () => {
    const result = submitReview({
      reportId: 'r1', reviewerId: 'bruno', authorId: 'ana', score: 3,
      comments: [comment()], submittedAt: T0,
    });
    expect(result.ok).toBe(true);
    expect(result.review!.comments).toHaveLength(1);
  });

  it('drops empty comments before deciding', () => {
    const result = submitReview({
      reportId: 'r1', reviewerId: 'bruno', authorId: 'ana', score: 2,
      comments: [comment('   ')], submittedAt: T0,
    });
    expect(result.ok).toBe(false);
  });

  it('refuses malformed input', () => {
    const base = { reportId: 'r1', reviewerId: 'bruno', authorId: 'ana', submittedAt: T0 };
    expect(submitReview({ ...base, score: 9 as never }).error).toMatch(/Pontuação/);
    expect(submitReview({ ...base, score: 1, reportId: '' }).error).toMatch(/laudo/);
    expect(submitReview({ ...base, score: 1, submittedAt: NaN }).error).toMatch(/horário/);
  });

  it('labels the three levels distinctly', () => {
    expect(AGREEMENT_LABELS[1]).toMatch(/Concordo/);
    expect(AGREEMENT_LABELS[2]).toMatch(/não altera conduta/);
    expect(AGREEMENT_LABELS[3]).toMatch(/altera conduta/);
  });

  it('renders one line for the queue', () => {
    expect(describeReview(review(3))).toMatch(/^3 — Discordância que altera conduta · 1 comentário/);
    expect(describeReview(undefined as never)).toBe('');
  });
});

describe('peerReview — counting', () => {
  it('separates agreement, minor and significant', () => {
    expect(countReviews(many(10, 3, 2))).toEqual({
      reviewed: 15,
      agreements: 10,
      minorDiscrepancies: 3,
      significantDiscrepancies: 2,
    });
  });

  // Collapsing them loses the only distinction the programme exists to find.
  it('does not lump a minor disagreement in with a significant one', () => {
    const counts = countReviews(many(0, 5, 0));
    expect(counts.minorDiscrepancies).toBe(5);
    expect(counts.significantDiscrepancies).toBe(0);
  });

  it('handles an empty set', () => {
    expect(countReviews([]).reviewed).toBe(0);
  });
});

describe('peerReview — a biased sample is not a measurement', () => {
  // A programme where reviewers pick interesting cases measures the selection, not the
  // reading.
  it('REFUSES to state a rate for a selected sample', () => {
    const result = discrepancyRate(many(50, 5, 5), 'selected');
    expect(result.rate).toBeNull();
    expect(result.reportable).toBe(false);
    expect(result.message).toMatch(/mede a seleção, não a leitura/);
  });

  it('still returns the counts, because they are useful for teaching', () => {
    const result = discrepancyRate(many(50, 5, 5), 'selected');
    expect(result.counts.significantDiscrepancies).toBe(5);
    expect(result.message).toMatch(/5 discordância\(s\) significativa\(s\) em 60 revisões/);
  });

  it('refuses for an unrecorded sampling method too', () => {
    expect(discrepancyRate(many(10, 0, 1), 'unknown').reportable).toBe(false);
    expect(discrepancyRate(many(10, 0, 1), 'nonsense' as never).sampling).toBe('unknown');
  });

  it('reports a rate for random and for consecutive', () => {
    expect(UNBIASED_SAMPLING).toEqual(['random', 'consecutive']);
    expect(discrepancyRate(many(90, 5, 5), 'random').reportable).toBe(true);
    expect(discrepancyRate(many(90, 5, 5), 'consecutive').reportable).toBe(true);
  });

  it('labels every sampling method', () => {
    for (const key of Object.keys(SAMPLING_LABELS)) {
      expect(SAMPLING_LABELS[key as keyof typeof SAMPLING_LABELS].length).toBeGreaterThan(5);
    }
  });

  it('says so plainly with no reviews at all', () => {
    expect(discrepancyRate([], 'random').message).toBe('Nenhuma revisão no período.');
  });
});

describe('peerReview — small denominators', () => {
  it('computes the rate and a Wilson interval', () => {
    const result = discrepancyRate(many(97, 0, 3), 'random');
    expect(result.rate).toBeCloseTo(0.03, 9);
    expect(result.lower!).toBeGreaterThan(0);
    expect(result.upper!).toBeLessThan(0.1);
  });

  // The normal interval on 1/30 runs below zero, which makes a committee stop trusting the
  // whole report.
  it('never produces a negative lower bound', () => {
    const interval = wilsonInterval(1, 30);
    expect(interval.lower).toBeGreaterThan(0);
    expect(interval.upper).toBeLessThan(0.2);
  });

  it('is wide at n = 30 and narrow at n = 400', () => {
    const small = wilsonInterval(1, 30);
    const large = wilsonInterval(13, 400);
    expect(small.upper - small.lower).toBeGreaterThan((large.upper - large.lower) * 2);
  });

  it('handles zero events without collapsing to a point', () => {
    const interval = wilsonInterval(0, 40);
    expect(interval.lower).toBe(0);
    expect(interval.upper).toBeGreaterThan(0.05);
  });

  it('is empty-safe', () => {
    expect(wilsonInterval(0, 0)).toEqual({ lower: 0, upper: 0 });
  });

  it('prints the interval next to the rate, never the rate alone', () => {
    expect(describeRate(discrepancyRate(many(97, 0, 3), 'random'))).toMatch(
      /3\.0% \(IC95% \d+\.\d+–\d+\.\d+%\) em 100 revisões, amostra aleatória\./
    );
  });
});

describe('peerReview — comparing two radiologists', () => {
  // 3% from 30 next to 6% from 400 looks like a two-fold difference and is not
  // distinguishable from chance — and the person being compared is a colleague.
  it('REFUSES to call overlapping intervals different', () => {
    const small = discrepancyRate(many(29, 0, 1), 'random');
    const large = discrepancyRate(many(376, 0, 24), 'random');
    const comparison = compareRates(small, large);
    expect(comparison.different).toBe(false);
    expect(comparison.message).toMatch(/não se distingue do acaso/);
  });

  it('does call clearly separated rates different', () => {
    const low = discrepancyRate(many(1000, 0, 5), 'random');
    const high = discrepancyRate(many(700, 0, 300), 'random');
    expect(compareRates(low, high).different).toBe(true);
  });

  it('refuses when either side is not reportable', () => {
    const selected = discrepancyRate(many(50, 0, 5), 'selected');
    const random = discrepancyRate(many(95, 0, 5), 'random');
    expect(compareRates(selected, random).different).toBe(false);
    expect(compareRates(selected, random).message).toMatch(/não é reportável/);
  });
});
