import {
  allowedEvents,
  applyEvent,
  emptyReport,
  isEditable,
  ReportAuthor,
  ReportCapability,
  ReportDocument,
  ReportEventType,
  STATE_LABELS,
} from './reportWorkflow';

const T0 = 1_700_000_000_000;
const MIN = 60_000;

const ANA: ReportAuthor = { id: 'ana', name: 'Dra. Ana Lima' };
const BRUNO: ReportAuthor = { id: 'bruno', name: 'Dr. Bruno Reis' };
const all = () => true;

const run = (
  document: ReportDocument,
  steps: Array<{ type: ReportEventType; at: number; author?: ReportAuthor; body?: string; reason?: string }>
): ReportDocument => {
  let doc = document;
  steps.forEach((step, i) => {
    const result = applyEvent(doc, {
      type: step.type,
      at: step.at,
      author: step.author ?? ANA,
      can: all,
      body: step.body,
      reason: step.reason,
    });
    if (!result.ok) {
      throw new Error(`step ${i} (${step.type}) refused: ${result.error}`);
    }
    doc = result.document;
  });
  return doc;
};

const awaitingReview = () =>
  run(emptyReport(), [
    { type: 'edit', at: T0, body: 'Tórax sem alterações.' },
    { type: 'requestReview', at: T0 + MIN },
  ]);

describe('reportWorkflow — peer review sits before the signature', () => {
  // RTV-108 is explicit: A writes, B reviews, THEN it is signed.
  it('has NO sign transition out of awaitingReview', () => {
    expect(allowedEvents('awaitingReview')).not.toContain('sign');
    expect(allowedEvents('awaitingReview').sort()).toEqual(['approveReview', 'rejectReview']);
  });

  it('refuses a signature while review is pending, and says why', () => {
    const result = applyEvent(awaitingReview(), {
      type: 'sign', at: T0 + 2 * MIN, author: ANA, can: all,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/o revisor precisa aprovar ou rejeitar primeiro/);
  });

  it('refuses an edit while review is pending — the reviewer is reading it', () => {
    const result = applyEvent(awaitingReview(), {
      type: 'edit', at: T0 + 2 * MIN, author: ANA, can: all, body: 'outro texto',
    });
    expect(result.ok).toBe(false);
    expect(isEditable(awaitingReview())).toBe(false);
  });

  it('refuses to send an empty report for review', () => {
    const result = applyEvent(emptyReport(), {
      type: 'requestReview', at: T0, author: ANA, can: all,
    });
    expect(result.ok).toBe(false);
  });

  it('records who asked and when', () => {
    const doc = awaitingReview();
    expect(doc.state).toBe('awaitingReview');
    expect(doc.reviewRequestedBy!.id).toBe('ana');
    expect(doc.reviewRequestedAt).toBe(T0 + MIN);
  });
});

describe('reportWorkflow — the reviewer may not be the author', () => {
  // The single most likely shortcut in an implementation.
  it('REFUSES a self-approval', () => {
    const result = applyEvent(awaitingReview(), {
      type: 'approveReview', at: T0 + 2 * MIN, author: ANA, can: all,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/não pode ser o autor/);
  });

  it('refuses a self-rejection too', () => {
    const result = applyEvent(awaitingReview(), {
      type: 'rejectReview', at: T0 + 2 * MIN, author: ANA, can: all, reason: 'x',
    });
    expect(result.ok).toBe(false);
  });

  it('accepts a colleague', () => {
    const doc = run(awaitingReview(), [
      { type: 'approveReview', at: T0 + 2 * MIN, author: BRUNO },
    ]);
    expect(doc.state).toBe('draft');
    expect(doc.reviewApprovedBy!.id).toBe('bruno');
  });
});

describe('reportWorkflow — approval, rejection and what invalidates them', () => {
  it('an approved report goes back to draft, ready to sign', () => {
    const doc = run(awaitingReview(), [
      { type: 'approveReview', at: T0 + 2 * MIN, author: BRUNO },
      { type: 'sign', at: T0 + 3 * MIN },
    ]);
    expect(doc.state).toBe('signed');
    expect(doc.versions).toHaveLength(1);
  });

  it('a rejection needs a reason, and the reason reaches the author', () => {
    const noReason = applyEvent(awaitingReview(), {
      type: 'rejectReview', at: T0 + 2 * MIN, author: BRUNO, can: all,
    });
    expect(noReason.ok).toBe(false);
    expect(noReason.error).toMatch(/o autor precisa saber o que mudar/);

    const doc = run(awaitingReview(), [
      { type: 'rejectReview', at: T0 + 2 * MIN, author: BRUNO, reason: 'Nódulo no LSD não descrito.' },
    ]);
    expect(doc.state).toBe('draft');
    expect(doc.history[doc.history.length - 1].note).toBe('Nódulo no LSD não descrito.');
    expect(doc.reviewApprovedBy).toBeUndefined();
  });

  // The reviewer approved a different text; carrying the approval forward would let any
  // change slip past review.
  it('ANY edit clears the approval', () => {
    const approved = run(awaitingReview(), [
      { type: 'approveReview', at: T0 + 2 * MIN, author: BRUNO },
    ]);
    expect(approved.reviewApprovedBy).toBeDefined();

    const edited = run(approved, [{ type: 'edit', at: T0 + 3 * MIN, body: 'texto alterado' }]);
    expect(edited.reviewApprovedBy).toBeUndefined();
    expect(edited.reviewApprovedAt).toBeUndefined();
  });

  it('a fresh review request clears a previous approval', () => {
    const again = run(awaitingReview(), [
      { type: 'approveReview', at: T0 + 2 * MIN, author: BRUNO },
      { type: 'edit', at: T0 + 3 * MIN, body: 'texto alterado' },
      { type: 'requestReview', at: T0 + 4 * MIN },
    ]);
    expect(again.state).toBe('awaitingReview');
    expect(again.reviewApprovedBy).toBeUndefined();
  });

  it('every review transition is in the history', () => {
    const doc = run(awaitingReview(), [
      { type: 'rejectReview', at: T0 + 2 * MIN, author: BRUNO, reason: 'faltou o LSD' },
      { type: 'edit', at: T0 + 3 * MIN, body: 'com o LSD' },
      { type: 'requestReview', at: T0 + 4 * MIN },
      { type: 'approveReview', at: T0 + 5 * MIN, author: BRUNO },
    ]);
    expect(doc.history.map(h => h.event)).toEqual([
      'edit', 'requestReview', 'rejectReview', 'edit', 'requestReview', 'approveReview',
    ]);
  });
});

describe('reportWorkflow — authority and labels', () => {
  it('review is its own capability, separate from signing', () => {
    const canReviewOnly = (c: ReportCapability) => c === 'report.review';
    const result = applyEvent(awaitingReview(), {
      type: 'approveReview', at: T0 + 2 * MIN, author: BRUNO, can: canReviewOnly,
    });
    expect(result.ok).toBe(true);
  });

  it('a user without the review capability cannot approve', () => {
    const result = applyEvent(awaitingReview(), {
      type: 'approveReview', at: T0 + 2 * MIN, author: BRUNO, can: c => c === 'report.sign',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/permissão/);
  });

  it('labels the new state', () => {
    expect(STATE_LABELS.awaitingReview).toBe('Aguardando revisão');
  });
});
