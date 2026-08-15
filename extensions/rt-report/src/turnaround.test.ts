import {
  activeMinutes,
  DEFAULT_ALLOWANCE_MIN,
  describeTurnaround,
  MINUTE_MS,
  PAUSE_LABELS,
  pausedMsBetween,
  PRIORITY_LABELS,
  STATUS_LABELS,
  TurnaroundInput,
  turnaroundState,
  turnaroundStatistics,
  WARNING_FRACTION,
} from './turnaround';

const T0 = 1_700_000_000_000;
const min = (n: number) => T0 + n * MINUTE_MS;

const state = (over: Partial<TurnaroundInput> = {}) =>
  turnaroundState({ startedAt: T0, priority: 'urgent', now: min(60), ...over });

describe('turnaround — allowances by priority', () => {
  it('are the published bands', () => {
    expect(DEFAULT_ALLOWANCE_MIN.emergency).toBe(60);
    expect(DEFAULT_ALLOWANCE_MIN.urgent).toBe(240);
    expect(DEFAULT_ALLOWANCE_MIN.routine).toBe(1440);
  });

  it('labels every priority and status', () => {
    for (const key of Object.keys(PRIORITY_LABELS)) {
      expect(PRIORITY_LABELS[key as keyof typeof PRIORITY_LABELS].length).toBeGreaterThan(3);
    }
    for (const key of Object.keys(STATUS_LABELS)) {
      expect(STATUS_LABELS[key as keyof typeof STATUS_LABELS].length).toBeGreaterThan(5);
    }
  });

  it('accepts a site-specific allowance', () => {
    expect(state({ allowanceMin: { urgent: 30 } }).allowanceMin).toBe(30);
  });

  it('falls back to routine for an unknown priority', () => {
    expect(state({ priority: 'nonsense' as never }).priority).toBe('routine');
  });
});

describe('turnaround — the clock stops while the radiologist cannot act', () => {
  // Charging review time to the radiologist makes the metric a lie, and makes people avoid
  // asking for review.
  it('removes a closed pause from the elapsed time', () => {
    const paused = state({
      now: min(120),
      pauses: [{ reason: 'awaitingReview', from: min(30), to: min(90) }],
    });
    expect(paused.activeMin).toBeCloseTo(60, 6);
    expect(paused.pausedMin).toBeCloseTo(60, 6);
  });

  it('removes an open pause up to now', () => {
    const paused = state({ now: min(120), pauses: [{ reason: 'awaitingPrior', from: min(60) }] });
    expect(paused.activeMin).toBeCloseTo(60, 6);
    expect(paused.paused).toBe(true);
    expect(paused.pauseReasons).toEqual(['awaitingPrior']);
  });

  // Two reasons at once is one period of not being able to act.
  it('MERGES overlapping pauses instead of summing them', () => {
    const merged = pausedMsBetween(
      [
        { reason: 'awaitingReview', from: min(10), to: min(40) },
        { reason: 'awaitingPrior', from: min(20), to: min(50) },
      ],
      T0,
      min(60)
    );
    expect(merged / MINUTE_MS).toBeCloseTo(40, 6);
  });

  it('clips a pause to the window being measured', () => {
    const clipped = pausedMsBetween(
      [{ reason: 'systemOutage', from: min(-30), to: min(30) }],
      T0,
      min(60)
    );
    expect(clipped / MINUTE_MS).toBeCloseTo(30, 6);
  });

  it('ignores a pause that ends before it starts', () => {
    expect(pausedMsBetween([{ reason: 'awaitingPrior', from: min(40), to: min(20) }], T0, min(60))).toBe(0);
  });

  it('activeMinutes is zero for a backwards or missing interval', () => {
    expect(activeMinutes(min(60), T0)).toBe(0);
    expect(activeMinutes(NaN, min(60))).toBe(0);
  });

  it('a pause can rescue a report from breach', () => {
    const withoutPause = state({ now: min(300) });
    const withPause = state({
      now: min(300),
      pauses: [{ reason: 'awaitingReview', from: min(60), to: min(240) }],
    });
    expect(withoutPause.status).toBe('breached');
    expect(withPause.status).toBe('onTime');
  });

  it('labels every pause reason', () => {
    for (const key of Object.keys(PAUSE_LABELS)) {
      expect(PAUSE_LABELS[key as keyof typeof PAUSE_LABELS].length).toBeGreaterThan(5);
    }
  });

  it('names the open pause in the message', () => {
    const paused = state({ pauses: [{ reason: 'awaitingReview', from: min(10) }] });
    expect(describeTurnaround(paused)).toMatch(/Relógio parado: aguardando revisão por pares/);
  });
});

describe('turnaround — warning before the breach', () => {
  it('is on time early', () => {
    expect(state({ now: min(60) }).status).toBe('onTime');
  });

  it('warns at the fraction of the allowance', () => {
    expect(WARNING_FRACTION).toBe(0.75);
    expect(state({ now: min(180) }).status).toBe('warning');
    expect(state({ now: min(179) }).status).toBe('onTime');
  });

  // 15 minutes' notice is generous on a 24-hour routine report and useless on a 60-minute
  // emergency one.
  it('scales the warning with the allowance rather than using fixed minutes', () => {
    const emergency = turnaroundState({ startedAt: T0, priority: 'emergency', now: min(45) });
    const routine = turnaroundState({ startedAt: T0, priority: 'routine', now: min(45) });
    expect(emergency.status).toBe('warning');
    expect(routine.status).toBe('onTime');
  });

  it('breaches past the allowance and says by how much', () => {
    const breached = state({ now: min(300) });
    expect(breached.status).toBe('breached');
    expect(breached.remainingMin).toBeCloseTo(-60, 6);
    expect(describeTurnaround(breached)).toMatch(/prazo estourado há 60 min/);
  });

  it('accepts a custom warning fraction', () => {
    expect(state({ now: min(130), warningFraction: 0.5 }).status).toBe('warning');
  });
});

describe('turnaround — the endpoint is the first actionable report', () => {
  // A preliminary at 20 minutes and a signature at four hours is a stroke protocol working
  // correctly.
  it('stops the clock at the preliminary, not at the signature', () => {
    const result = state({
      priority: 'emergency',
      firstActionableAt: min(20),
      signedAt: min(240),
      now: min(300),
    });
    expect(result.status).toBe('metOnTime');
    expect(result.timeToFirstMin).toBeCloseTo(20, 6);
    expect(result.timeToFinalMin).toBeCloseTo(240, 6);
  });

  it('and measuring only to the signature would have called that a breach', () => {
    const onlySigned = state({ priority: 'emergency', firstActionableAt: min(240), now: min(300) });
    expect(onlySigned.status).toBe('metLate');
  });

  it('is terminal once the first report exists, however late the signature', () => {
    const result = state({ firstActionableAt: min(30), now: min(10_000) });
    expect(result.status).toBe('metOnTime');
  });

  it('reports how far past the deadline a late one was', () => {
    const late = state({ firstActionableAt: min(300), now: min(320) });
    expect(late.status).toBe('metLate');
    expect(describeTurnaround(late)).toMatch(/60 min além do prazo/);
  });

  it('leaves both times null while nothing has been issued', () => {
    const open = state();
    expect(open.timeToFirstMin).toBeNull();
    expect(open.timeToFinalMin).toBeNull();
  });

  it('says so plainly with no start time', () => {
    expect(describeTurnaround(state({ startedAt: NaN }))).toMatch(/prazo não avaliável/);
  });
});

describe('turnaround — statistics', () => {
  const completed = (minutes: number[], allowance = 240) =>
    minutes.map(m =>
      turnaroundState({
        startedAt: T0,
        priority: 'urgent',
        firstActionableAt: min(m),
        now: min(m + 1),
        allowanceMin: { urgent: allowance },
      })
    );

  it('reports median and p90', () => {
    const stats = turnaroundStatistics(completed([10, 20, 30, 40, 50, 60, 70, 80, 90, 600]));
    expect(stats.medianMin).toBeCloseTo(50, 6);
    expect(stats.p90Min).toBeCloseTo(90, 6);
    expect(stats.count).toBe(10);
  });

  // The mean sits between the typical case and the tail while describing neither.
  it('the p90 is the number a service-level conversation is about', () => {
    const times = [10, 20, 30, 40, 50, 60, 70, 80, 90, 600];
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    const stats = turnaroundStatistics(completed(times));
    expect(mean).toBeGreaterThan(stats.medianMin);
    expect(mean).toBeLessThan(600);
    expect(stats.p90Min).toBeGreaterThan(stats.medianMin);
  });

  it('computes compliance against the allowance', () => {
    const stats = turnaroundStatistics(completed([100, 100, 100, 500]));
    expect(stats.compliance).toBeCloseTo(0.75, 6);
  });

  // Including open reports at their current elapsed time makes a backlog look like fast
  // service, because the longest-running ones have not finished yet.
  it('EXCLUDES open reports from the percentiles and counts them separately', () => {
    const stats = turnaroundStatistics([
      ...completed([10, 20]),
      turnaroundState({ startedAt: T0, priority: 'urgent', now: min(5000) }),
    ]);
    expect(stats.count).toBe(2);
    expect(stats.open).toBe(1);
    expect(stats.p90Min).toBeLessThan(100);
  });

  it('handles an empty set', () => {
    expect(turnaroundStatistics([])).toEqual({
      count: 0, medianMin: 0, p90Min: 0, compliance: 0, open: 0,
    });
  });
});
