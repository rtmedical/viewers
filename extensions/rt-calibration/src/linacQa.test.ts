import {
  assessTrend,
  AXIS_LABELS,
  Baseline,
  classifyResult,
  describeQaResult,
  fitSegment,
  qaCoverage,
  QaMeasurement,
  rebaseline,
  segmentAtService,
  STATE_LABELS,
  TG142_TESTS,
  winstonLutzComponents,
  WlReading,
} from './linacQa';

const T0 = new Date('2026-01-01T00:00:00Z').getTime();
const DAY = 86_400_000;

const output = TG142_TESTS['output-constancy'];
const wl = TG142_TESTS['winston-lutz'];

const series = (values: number[], everyDays = 7): QaMeasurement[] =>
  values.map((value, i) => ({ at: T0 + i * everyDays * DAY, value }));

describe('linacQa — pass and fail are three states', () => {
  it('calls a small deviation within tolerance', () => {
    const result = classifyResult(100.5, output, 100);
    expect(result.state).toBe('within-tolerance');
    expect(result.treatable).toBe(true);
  });

  // The band a QA programme exists to catch.
  it('names the middle band and keeps the machine treatable', () => {
    const result = classifyResult(102.5, output, 100);
    expect(result.state).toBe('investigate');
    expect(result.treatable).toBe(true);
    expect(result.message).toMatch(/Um passa\/falha booleano joga fora exatamente essa faixa/);
  });

  it('stops treatment beyond the action level', () => {
    const result = classifyResult(104, output, 100);
    expect(result.state).toBe('action');
    expect(result.treatable).toBe(false);
  });

  it('treats a missing result as untreatable rather than as a pass', () => {
    const result = classifyResult(NaN, output, 100);
    expect(result.treatable).toBe(false);
    expect(result.message).toMatch(/tratar sem resultado é tratar sem QA/);
  });

  // A relative test has nothing to compare against without one.
  it('refuses a relative test with no baseline', () => {
    const result = classifyResult(100.5, output);
    expect(result.state).toBe('action');
    expect(result.message).toMatch(/sem ela o número não tem contra o que ser comparado/);
  });

  it('compares an absolute test directly', () => {
    expect(classifyResult(0.6, TG142_TESTS['mlc-leaf-position']).state).toBe('within-tolerance');
    expect(classifyResult(1.2, TG142_TESTS['mlc-leaf-position']).state).toBe('investigate');
    expect(classifyResult(2, TG142_TESTS['mlc-leaf-position']).state).toBe('action');
  });
});

describe('linacQa — a service event is a discontinuity', () => {
  it('keeps one segment when nothing was serviced', () => {
    expect(segmentAtService(series([100, 100.2, 100.4]), [])).toHaveLength(1);
  });

  // Trending across a waveguide replacement averages two machines.
  it('splits the history at the service', () => {
    const measurements = series([100, 100.5, 101, 99.8, 99.9]);
    const segments = segmentAtService(measurements, [
      { at: measurements[3].at - DAY, description: 'Troca de guia de onda' },
    ]);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toHaveLength(3);
    expect(segments[1]).toHaveLength(2);
  });

  it('handles a service before any measurement', () => {
    const measurements = series([100, 100.2]);
    expect(segmentAtService(measurements, [{ at: T0 - DAY, description: 'x' }])).toHaveLength(1);
  });

  it('ignores measurements with no timestamp', () => {
    const bad = [...series([100, 101]), { at: NaN, value: 5 } as QaMeasurement];
    expect(segmentAtService(bad, [])[0]).toHaveLength(2);
  });
});

describe('linacQa — a drifting pass is not a stable pass', () => {
  it('recovers a known drift and no scatter', () => {
    const segment = fitSegment(series([100, 100.7, 101.4, 102.1], 7));
    expect(segment.driftPerDay).toBeCloseTo(0.1, 6);
    expect(segment.scatter).toBeCloseTo(0, 6);
  });

  // Symmetric about the midpoint, so the least-squares slope is exactly zero and only the
  // scatter is left. An asymmetric "noisy" series carries a slope whether you meant it or not.
  it('separates scatter from drift', () => {
    const segment = fitSegment(series([98.5, 101.5, 100, 101.5, 98.5], 7));
    expect(segment.driftPerDay).toBeCloseTo(0, 10);
    expect(segment.scatter).toBeGreaterThan(1);
  });

  // Two machines with the same value today are not in the same condition.
  it('projects when the fitted line will cross the tolerance', () => {
    const verdict = assessTrend(fitSegment(series([100, 100.4, 100.8, 101.2], 7)), output, 100);
    expect(verdict.daysToTolerance).not.toBeNull();
    expect(verdict.message).toMatch(/Duas máquinas com o mesmo valor de hoje não estão na mesma condição/);
  });

  it('does not project a machine that is stable', () => {
    expect(assessTrend(fitSegment(series([100, 100, 100, 100])), output, 100).daysToTolerance).toBeNull();
  });

  it('blames reproducibility when the scatter is large and the drift is not', () => {
    const verdict = assessTrend(fitSegment(series([98.5, 101.5, 100, 101.5, 98.5])), output, 100);
    expect(verdict.message).toMatch(/o problema é reprodutibilidade da medida, e não adianta ajustar a máquina/);
  });

  it('handles a single measurement without dividing by zero', () => {
    expect(fitSegment(series([100])).driftPerDay).toBe(0);
  });
});

describe('linacQa — re-baselining erases the drift from the record', () => {
  const current: Baseline = {
    testId: 'output-constancy',
    value: 100,
    establishedAt: T0,
    establishedBy: 'fis.costa',
    reason: 'Comissionamento',
  };

  it('keeps the previous baseline and says how much drift the change absorbs', () => {
    const result = rebaseline({
      testId: 'output-constancy',
      value: 101.8,
      establishedAt: T0 + 200 * DAY,
      establishedBy: 'fis.costa',
      reason: 'Após troca de câmara monitora',
      current,
    });
    expect(result.ok).toBe(true);
    expect(result.baseline!.previous!.value).toBe(100);
    expect(result.absorbedDrift).toBeCloseTo(1.8, 6);
    expect(result.message).toMatch(/para a deriva não sumir do histórico/);
  });

  // Not marked, gone.
  it('refuses a re-baseline with no reason and names what would disappear', () => {
    const result = rebaseline({
      testId: 'output-constancy',
      value: 101.8,
      establishedAt: T0,
      establishedBy: 'fis.costa',
      reason: '',
      current,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/não marcada, desaparecida/);
  });

  it('refuses without an author or a value', () => {
    expect(rebaseline({ testId: 'x', value: 1, establishedAt: T0, establishedBy: '', reason: 'y' }).ok).toBe(false);
    expect(rebaseline({ testId: 'x', value: NaN, establishedAt: T0, establishedBy: 'a', reason: 'y' }).ok).toBe(false);
  });

  it('accepts a first baseline with nothing to replace', () => {
    const result = rebaseline({
      testId: 'output-constancy',
      value: 100,
      establishedAt: T0,
      establishedBy: 'fis.costa',
      reason: 'Comissionamento',
    });
    expect(result.baseline!.previous).toBeUndefined();
    expect(result.message).toMatch(/Primeira linha de base/);
  });
});

describe('linacQa — a single Winston-Lutz number blames the linac for the phantom', () => {
  const readings: WlReading[] = [
    { axis: 'gantry', angleDeg: 0, offsetMm: [0.3, 0.2] },
    { axis: 'gantry', angleDeg: 90, offsetMm: [0.9, 0.2] },
    { axis: 'gantry', angleDeg: 180, offsetMm: [0.3, 0.2] },
    { axis: 'gantry', angleDeg: 270, offsetMm: [-0.3, 0.2] },
    { axis: 'collimator', angleDeg: 0, offsetMm: [0.3, 0.2] },
    { axis: 'collimator', angleDeg: 90, offsetMm: [0.35, 0.25] },
    { axis: 'couch', angleDeg: 0, offsetMm: [0.3, 0.2] },
    { axis: 'couch', angleDeg: 90, offsetMm: [0.32, 0.22] },
  ];

  it('separates the walkout of each axis', () => {
    const result = winstonLutzComponents(readings);
    const byAxis = Object.fromEntries(result.components.map(c => [c.axis, c.walkoutMm]));
    expect(byAxis.gantry).toBeGreaterThan(byAxis.collimator);
    expect(byAxis.gantry).toBeGreaterThan(byAxis.couch);
  });

  // Sends a physicist to adjust something that was never out.
  it('says the mean offset is not correctable by adjusting the machine', () => {
    const result = winstonLutzComponents(readings);
    expect(result.warnings.join(' ')).toMatch(/ONDE A ESFERA FOI COLOCADA/);
    expect(result.warnings.join(' ')).toMatch(/manda o físico ajustar algo que nunca esteve fora/);
  });

  it('reports the mean and the max separately', () => {
    const result = winstonLutzComponents(readings);
    expect(result.maxOffsetMm).toBeGreaterThan(result.meanOffsetMm);
  });

  it('says which axis could not be separated', () => {
    const partial = readings.filter(r => r.axis !== 'couch');
    expect(winstonLutzComponents(partial).warnings.join(' ')).toMatch(
      new RegExp(`variando o ${AXIS_LABELS.couch}`)
    );
  });

  it('handles no readings', () => {
    expect(winstonLutzComponents([]).message).toMatch(/Sem leituras/);
  });
});

describe('linacQa — an energy nobody measured is not an energy that passed', () => {
  it('is complete when every per-energy test was done on every energy', () => {
    const report = qaCoverage(
      [
        { testId: 'output-constancy', energy: '6MV' },
        { testId: 'output-constancy', energy: '10MV' },
        { testId: 'winston-lutz' },
      ],
      ['output-constancy', 'winston-lutz'],
      ['6MV', '10MV']
    );
    expect(report.complete).toBe(true);
  });

  it('lists the energy that was skipped', () => {
    const report = qaCoverage(
      [{ testId: 'output-constancy', energy: '6MV' }, { testId: 'winston-lutz' }],
      ['output-constancy', 'winston-lutz'],
      ['6MV', '10MV']
    );
    expect(report.complete).toBe(false);
    expect(report.missing).toEqual([{ testId: 'output-constancy', energy: '10MV' }]);
    expect(report.message).toMatch(/Energia que ninguém mediu não é energia que passou/);
  });

  it('does not demand an energy for a test that does not need one', () => {
    expect(TG142_TESTS['winston-lutz'].perEnergy).toBe(false);
    const report = qaCoverage([{ testId: 'winston-lutz' }], ['winston-lutz'], ['6MV', '10MV']);
    expect(report.complete).toBe(true);
  });
});

describe('linacQa — the QA board line', () => {
  it('states the band and the trend together', () => {
    const classification = classifyResult(102.5, output, 100);
    const trend = assessTrend(fitSegment(series([100, 100.8, 101.6, 102.4], 7)), output, 100);
    const line = describeQaResult(classification, trend);
    expect(line).toMatch(new RegExp(`^${STATE_LABELS.investigate}:`));
    expect(line).toMatch(/Deriva de/);
  });

  it('works without a trend', () => {
    expect(describeQaResult(classifyResult(100.2, output, 100))).toMatch(
      new RegExp(`^${STATE_LABELS['within-tolerance']}:`)
    );
  });
});
