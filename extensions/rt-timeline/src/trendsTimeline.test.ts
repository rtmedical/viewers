import {
  assessSsd,
  assessWeight,
  describeTrends,
  findGaps,
  fitTrend,
  MAX_GAP_DAYS,
  replanSignal,
  SSD_DRIFT_MM,
  TrendSeries,
  WEIGHT_REPLAN_FRACTION,
} from './trendsTimeline';

const DAY = 86_400_000;
const T0 = 1_700_000_000_000;

/** Daily samples starting one day after the baseline. */
const series = (
  baseline: number,
  values: number[],
  { everyDays = 1, baselineAt = T0 } = {}
): TrendSeries => ({
  baseline,
  baselineAt,
  points: values.map((value, i) => ({
    at: baselineAt + (i + 1) * everyDays * DAY,
    value,
    fraction: i + 1,
  })),
});

describe('trendsTimeline — a gap is not a flat line', () => {
  it('finds nothing when the patient was measured regularly', () => {
    expect(findGaps(series(80, [80, 79.5, 79, 78.5]))).toEqual([]);
  });

  // The line reads as stability during exactly the period nobody was looking.
  it('marks a stretch with no measurement', () => {
    const gaps = findGaps(series(80, [80, 74], { everyDays: 14 }));
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps[0].days).toBeCloseTo(14, 6);
  });

  it('counts the stretch from the baseline, not from the first sample', () => {
    const withLateStart: TrendSeries = {
      baseline: 80,
      baselineAt: T0,
      points: [{ at: T0 + 20 * DAY, value: 76 }],
    };
    expect(findGaps(withLateStart)[0].days).toBeCloseTo(20, 6);
  });

  it('uses the configured limit', () => {
    expect(findGaps(series(80, [80, 79], { everyDays: 5 }), 3).length).toBeGreaterThan(0);
    expect(MAX_GAP_DAYS).toBe(7);
  });
});

describe('trendsTimeline — the fit', () => {
  it('recovers a known slope in units per day', () => {
    const fit = fitTrend(series(80, [79, 78, 77, 76]).points, T0);
    expect(fit.slopePerDay).toBeCloseTo(-1, 10);
    expect(fit.residualRms).toBeCloseTo(0, 10);
  });

  it('separates scatter from slope', () => {
    const fit = fitTrend(series(100, [100, 102, 98, 100]).points, T0);
    expect(Math.abs(fit.slopePerDay)).toBeLessThan(0.5);
    expect(fit.residualRms).toBeGreaterThan(1);
  });

  it('handles a single point without dividing by zero', () => {
    expect(fitTrend(series(80, [79]).points, T0).slopePerDay).toBe(0);
  });
});

describe('trendsTimeline — weight is a replan trigger', () => {
  it('measures the loss from the planning weight', () => {
    const result = assessWeight(series(80, [79, 78, 77]));
    expect(result.changeKg).toBeCloseTo(-3, 6);
    expect(result.changeFraction).toBeCloseTo(-0.0375, 6);
    expect(result.replanIndicated).toBe(false);
  });

  // The delivered distribution stops being the one that was approved.
  it('flags a loss past the threshold and says what it means', () => {
    const result = assessWeight(series(80, [79, 77, 75.5]));
    expect(result.verdict).toBe('threshold-crossed');
    expect(result.replanIndicated).toBe(true);
    expect(result.message).toMatch(/deixou de ser a que foi planejada e aprovada/);
    expect(WEIGHT_REPLAN_FRACTION).toBe(0.05);
  });

  // The useful moment is before the fraction where the threshold is crossed.
  it('projects to the end of the course and raises it early', () => {
    const result = assessWeight(series(80, [79.5, 79, 78.5]), {
      courseEndAt: T0 + 35 * DAY,
    });
    expect(result.projectedFraction!).toBeLessThan(-WEIGHT_REPLAN_FRACTION);
    expect(result.replanIndicated).toBe(true);
    expect(result.message).toMatch(/não na fração em que o limiar for cruzado/);
  });

  it('does not project when no course end was given', () => {
    expect(assessWeight(series(80, [79.5, 79])).projectedFraction).toBeNull();
  });

  // The loss measured from a late first record is the loss after the loss started.
  it('refuses without a planning weight', () => {
    const result = assessWeight({ baseline: NaN, baselineAt: T0, points: series(80, [76]).points });
    expect(result.verdict).toBe('insufficient');
    expect(result.message).toMatch(/depois que a perda começou/);
  });

  it('says so when nothing was recorded', () => {
    expect(assessWeight({ baseline: 80, baselineAt: T0, points: [] }).message).toMatch(
      /Nenhum peso registrado/
    );
  });

  it('carries the gap warning into the assessment', () => {
    const result = assessWeight(series(80, [80, 79], { everyDays: 14 }));
    expect(result.message).toMatch(/se lê como estabilidade justamente no período em que ninguém olhou/);
  });

  it('honours a custom threshold', () => {
    expect(assessWeight(series(80, [78]), { threshold: 0.02 }).replanIndicated).toBe(true);
  });
});

describe('trendsTimeline — SSD separates drift from setup scatter', () => {
  // Only one of the two needs a new plan.
  it('calls a sustained drift an anatomical change', () => {
    const result = assessSsd(series(1000, [998, 996, 993, 990, 988]));
    expect(result.anatomicalChange).toBe(true);
    expect(result.driftMm).toBeLessThan(-SSD_DRIFT_MM + 1);
    expect(result.message).toMatch(/mudança de contorno, não erro de posicionamento/);
  });

  it('calls pure scatter a setup problem instead', () => {
    const result = assessSsd(series(1000, [1012, 988, 1011, 989, 1010, 990]));
    expect(result.anatomicalChange).toBe(false);
    expect(result.setupScatterMm).toBeGreaterThan(SSD_DRIFT_MM);
    expect(result.message).toMatch(/margem ou replanejamento não o resolvem/);
  });

  // The sample carries that day's setup error; the fit does not.
  it('takes the drift from the fit, not from the last sample', () => {
    const clean = assessSsd(series(1000, [998, 996, 994, 992]));
    const withOutlier = assessSsd(series(1000, [998, 996, 994, 1010]));
    expect(Math.abs(withOutlier.driftMm! - clean.driftMm!)).toBeLessThan(20);
    expect(withOutlier.driftMm).toBeLessThan(10);
  });

  it('refuses a trend from a single reading', () => {
    const result = assessSsd(series(1000, [990]));
    expect(result.verdict).toBe('insufficient');
    expect(result.message).toMatch(/Uma leitura isolada é variação de setup/);
  });

  it('honours a custom drift limit', () => {
    expect(assessSsd(series(1000, [998, 996, 994]), { driftLimitMm: 3 }).anatomicalChange).toBe(true);
  });
});

describe('trendsTimeline — the two read together', () => {
  it('raises the signal when either crosses', () => {
    const weight = assessWeight(series(80, [79, 77, 75.5]));
    const ssd = assessSsd(series(1000, [1000, 1000, 1000]));
    expect(replanSignal(weight, ssd).indicated).toBe(true);
  });

  // The disagreement is informative rather than a problem to resolve.
  it('reads falling weight with steady SSD as loss elsewhere', () => {
    const weight = assessWeight(series(80, [79, 78, 77.5]));
    const ssd = assessSsd(series(1000, [1000, 1001, 1000]));
    const signal = replanSignal(weight, ssd);
    expect(signal.indicated).toBe(false);
    expect(signal.message).toMatch(/a perda está em outro lugar/);
  });

  it('is quiet when nothing moved', () => {
    const weight = assessWeight(series(80, [80, 80, 80]));
    const ssd = assessSsd(series(1000, [1000, 1000, 1000]));
    expect(replanSignal(weight, ssd).message).toMatch(/Sem sinal de replanejamento/);
  });

  it('states both trends on one line', () => {
    const line = describeTrends(
      assessWeight(series(80, [79, 78])),
      assessSsd(series(1000, [999, 998]))
    );
    expect(line).toMatch(/^Peso: .*DFS: /);
  });
});
