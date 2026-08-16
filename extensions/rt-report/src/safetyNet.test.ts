import {
  assessState,
  CLOSURE_LABELS,
  closeRecommendation,
  closureStatistics,
  DAY_MS,
  describeRecommendation,
  dueAt,
  ESCALATE_INSTITUTION_DAYS,
  ESCALATE_REFERRER_DAYS,
  GRACE_DAYS,
  proposeMatch,
  Recommendation,
  SAFETY_STATE_LABELS,
  triage,
} from './safetyNet';

const T0 = 1_700_000_000_000;
const day = (n: number) => T0 + n * DAY_MS;

const rec = (over: Partial<Recommendation> = {}): Recommendation => ({
  id: 'r1',
  patientId: 'p1',
  reportId: 'rep1',
  kind: 'imaging',
  urgency: 'routine',
  text: 'TC de tórax de controle em 6 meses.',
  modality: 'CT',
  bodyPart: 'CHEST',
  issuedAt: T0,
  intervalDays: 180,
  ...over,
});

describe('safetyNet — the due date comes from the report', () => {
  it('is the issue date plus the interval, never now', () => {
    expect(dueAt(rec())).toBe(day(180));
  });

  it('is NaN without an issue date or an interval', () => {
    expect(Number.isNaN(dueAt(rec({ issuedAt: NaN })))).toBe(true);
    expect(Number.isNaN(dueAt(rec({ intervalDays: NaN })))).toBe(true);
  });

  it('is scheduled while the window is open', () => {
    const state = assessState(rec(), day(100));
    expect(state.state).toBe('scheduled');
    expect(state.message).toMatch(/daqui a 80 dia\(s\)/);
  });
});

describe('safetyNet — the escalation ladder', () => {
  it('is due inside the grace period', () => {
    expect(assessState(rec(), day(185)).state).toBe('due');
    expect(GRACE_DAYS.routine).toBe(30);
  });

  it('a shorter grace for an urgent recommendation', () => {
    expect(assessState(rec({ urgency: 'urgent' }), day(185)).state).toBe('overdue');
    expect(GRACE_DAYS.urgent).toBeLessThan(GRACE_DAYS.routine);
  });

  it('is overdue past the grace', () => {
    expect(assessState(rec(), day(180 + GRACE_DAYS.routine + 5)).state).toBe('overdue');
  });

  // The thresholds count from the END of the grace. Counting them from the due date makes
  // `overdue` unreachable for routine, whose grace happens to equal the first threshold.
  it('the plain overdue state is reachable for every urgency', () => {
    for (const urgency of ['urgent', 'priority', 'routine'] as const) {
      const state = assessState(
        rec({ urgency }),
        day(180 + GRACE_DAYS[urgency] + ESCALATE_REFERRER_DAYS / 2)
      );
      expect(state.state).toBe('overdue');
    }
  });

  it('chases the referring physician a month after the grace runs out', () => {
    const state = assessState(rec(), day(180 + GRACE_DAYS.routine + ESCALATE_REFERRER_DAYS + 1));
    expect(state.state).toBe('escalatedToReferrer');
    expect(state.message).toMatch(/cobrar o médico solicitante/);
  });

  it('becomes institutional three months after that', () => {
    const state = assessState(rec(), day(180 + GRACE_DAYS.routine + ESCALATE_INSTITUTION_DAYS + 1));
    expect(state.state).toBe('escalatedToInstitution');
    expect(state.message).toMatch(/responsabilidade institucional/);
  });

  it('labels every state', () => {
    for (const key of Object.keys(SAFETY_STATE_LABELS)) {
      expect(SAFETY_STATE_LABELS[key as keyof typeof SAFETY_STATE_LABELS].length).toBeGreaterThan(3);
    }
  });
});

describe('safetyNet — closure needs evidence, not the passage of time', () => {
  const closure = { reason: 'followUpPerformed' as const, at: day(190), by: 'ana', studyInstanceUid: '1.2.3' };

  it('closes with a reason and a responsible person', () => {
    const result = closeRecommendation(rec(), closure);
    expect(result.recommendation!.closure!.reason).toBe('followUpPerformed');
    expect(assessState(result.recommendation!, day(999)).state).toBe('closed');
  });

  // A safety net that empties itself reports healthy numbers precisely because the
  // recommendations nobody acted on disappeared.
  it('has NO expiry reason', () => {
    expect(Object.keys(CLOSURE_LABELS)).not.toContain('expired');
    const result = closeRecommendation(rec(), { ...closure, reason: 'expired' as never });
    expect(result.error).toMatch(/o tempo passar não é motivo/);
  });

  // "Performed" without the study that performed it is an assertion, not a record.
  it('REQUIRES the study when the reason is that the follow-up happened', () => {
    const result = closeRecommendation(rec(), { ...closure, studyInstanceUid: '' });
    expect(result.error).toMatch(/exige o estudo que o realizou/);
  });

  it('does not require one for the other reasons', () => {
    expect(
      closeRecommendation(rec(), { reason: 'patientDeceased', at: day(190), by: 'ana' }).recommendation
    ).not.toBeNull();
  });

  it('refuses without a person or a time, and refuses to double-close', () => {
    expect(closeRecommendation(rec(), { ...closure, by: ' ' }).error).toMatch(/responsável/);
    expect(closeRecommendation(rec(), { ...closure, at: NaN }).error).toMatch(/horário/);
    const closed = closeRecommendation(rec(), closure).recommendation!;
    expect(closeRecommendation(closed, closure).error).toMatch(/já encerrada/);
  });
});

describe('safetyNet — matching proposes and never closes', () => {
  const study = (over = {}) => ({
    studyInstanceUid: '9.9.9',
    patientId: 'p1',
    modality: 'CT',
    bodyPart: 'CHEST',
    studyDate: day(185),
    ...over,
  });

  it('ranks a well-matching study first', () => {
    const proposals = proposeMatch(rec(), [study({ studyInstanceUid: 'a', modality: 'MR' }), study({ studyInstanceUid: 'b' })], day(200));
    expect(proposals[0].studyInstanceUid).toBe('b');
    expect(proposals[0].reasons.join(' ')).toMatch(/modalidade CT confere/);
  });

  it('ignores another patient and anything before the recommendation', () => {
    expect(proposeMatch(rec(), [study({ patientId: 'p2' })], day(200))).toEqual([]);
    expect(proposeMatch(rec(), [study({ studyDate: day(-5) })], day(200))).toEqual([]);
  });

  it('names the mismatches as concerns', () => {
    const proposal = proposeMatch(rec(), [study({ modality: 'MR', bodyPart: 'ABDOMEN' })], day(200))[0];
    expect(proposal.concerns.join(' ')).toMatch(/recomendado CT, encontrado MR/);
    expect(proposal.concerns.join(' ')).toMatch(/recomendada região CHEST/);
  });

  it('flags a study far from the due date', () => {
    const proposal = proposeMatch(rec(), [study({ studyDate: day(400) })], day(450))[0];
    expect(proposal.concerns.join(' ')).toMatch(/dias da data prevista/);
  });

  // Auto-closing on modality-and-region produces a closure rate that measures scheduling
  // rather than care.
  it('ALWAYS warns that a matching study does not prove the question was answered', () => {
    const proposal = proposeMatch(rec(), [study()], day(200))[0];
    expect(proposal.concerns.join(' ')).toMatch(/não prova que a pergunta do seguimento foi respondida/);
  });

  it('returns proposals, never a closure', () => {
    const proposals = proposeMatch(rec(), [study()], day(200));
    expect(proposals[0]).not.toHaveProperty('closure');
    expect(rec().closure).toBeUndefined();
  });
});

describe('safetyNet — the closure rate needs an honest denominator', () => {
  const closed = (over = {}) =>
    closeRecommendation(rec(over), {
      reason: 'followUpPerformed', at: day(190), by: 'ana', studyInstanceUid: '1.2.3',
    }).recommendation as Recommendation;

  it('counts closed over actionable', () => {
    const stats = closureStatistics([closed({ id: 'a' }), rec({ id: 'b' })], day(300));
    expect(stats.actionable).toBe(2);
    expect(stats.closed).toBe(1);
    expect(stats.closureRate).toBeCloseTo(0.5, 9);
  });

  // Counting them as failures makes a healthy service look negligent; counting them as
  // successes makes a negligent one look healthy.
  it('EXCLUDES recommendations still inside their window, and says how many', () => {
    const stats = closureStatistics([closed({ id: 'a' }), rec({ id: 'b' })], day(10));
    expect(stats.actionable).toBe(1);
    expect(stats.stillScheduled).toBe(1);
    expect(stats.closureRate).toBe(1);
    expect(stats.message).toMatch(/1 ainda dentro do prazo, fora da conta/);
  });

  it('separates closures that were an actual follow-up from the rest', () => {
    const declined = closeRecommendation(rec({ id: 'c' }), {
      reason: 'patientDeclined', at: day(190), by: 'ana',
    }).recommendation as Recommendation;
    const stats = closureStatistics([closed({ id: 'a' }), declined], day(300));
    expect(stats.closed).toBe(2);
    expect(stats.closedByFollowUp).toBe(1);
  });

  it('handles an empty set', () => {
    expect(closureStatistics([], day(1)).message).toMatch(/Nenhuma recomendação vencida/);
  });
});

describe('safetyNet — the queue', () => {
  it('puts the institutional escalations first and the closed last', () => {
    const items = [
      rec({ id: 'scheduled', intervalDays: 900 }),
      rec({ id: 'overdue', intervalDays: 10 }),
      rec({ id: 'ancient', intervalDays: 1 }),
      closeRecommendation(rec({ id: 'done' }), {
        reason: 'noLongerIndicated', at: day(50), by: 'ana',
      }).recommendation as Recommendation,
    ];
    expect(triage(items, day(200)).map(r => r.id)).toEqual([
      'ancient', 'overdue', 'scheduled', 'done',
    ]);
  });

  it('renders a queue line', () => {
    expect(describeRecommendation(rec(), day(220))).toBe(
      'Vencido · TC de tórax de controle em 6 meses. · Vencido há 40 dias.'
    );
    expect(describeRecommendation(undefined as never, T0)).toBe('');
  });
});
