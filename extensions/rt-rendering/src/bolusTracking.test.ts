import {
  BASELINE_SD_LIMIT,
  BLOOD_POOL_HU,
  DEFAULT_TRIGGER,
  describeTrigger,
  evaluateTrigger,
  MonitorFrame,
  monitoringDose,
  TriggerConfig,
  validateRoiBaseline,
} from './bolusTracking';

/** Baseline frames then a linear rise of `slope` HU/s starting at `startSec`. */
const run = ({
  baseline = 45,
  slope = 40,
  startSec = 6,
  untilSec = 20,
  everySec = 1,
  sdHu = 8,
}: Partial<{
  baseline: number;
  slope: number;
  startSec: number;
  untilSec: number;
  everySec: number;
  sdHu: number;
}> = {}): MonitorFrame[] => {
  const frames: MonitorFrame[] = [];
  for (let t = 0; t <= untilSec + 1e-9; t += everySec) {
    const rise = t >= startSec ? slope * (t - startSec) : 0;
    frames.push({ timeSec: Number(t.toFixed(3)), meanHu: baseline + rise, sdHu });
  }
  return frames;
};

describe('bolusTracking — the ROI is placed before there is anything to see', () => {
  it('accepts an ROI sitting in unenhanced blood', () => {
    const check = validateRoiBaseline(run());
    expect(check.ok).toBe(true);
    expect(check.baselineHu).toBeCloseTo(45, 6);
  });

  // The scan runs, the images come out, and it reads as a poor injection.
  it('rejects a baseline that is not blood pool, and says how the failure presents', () => {
    const check = validateRoiBaseline(run({ baseline: 180 }));
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/parede, cálcio, stent ou um canto de pulmão/);
    expect(check.reason).toMatch(/o que se lê como injeção ruim/);
  });

  it('rejects a baseline in lung as well as one in calcium', () => {
    expect(validateRoiBaseline(run({ baseline: -400 })).ok).toBe(false);
    expect(BLOOD_POOL_HU).toEqual({ min: 20, max: 90 });
  });

  it('warns on a heterogeneous ROI without rejecting it', () => {
    const check = validateRoiBaseline(run({ sdHu: BASELINE_SD_LIMIT + 10 }));
    expect(check.ok).toBe(true);
    expect(check.warnings.join(' ')).toMatch(/cálcio na ROI dispara antes de o contraste chegar/);
  });

  it('refuses with no pre-contrast frames at all', () => {
    expect(validateRoiBaseline([]).ok).toBe(false);
  });
});

describe('bolusTracking — trigger and scan are not the same moment', () => {
  // The rise crosses 100 HU at t=9 (120 HU), but two consecutive frames are required, so
  // the trigger fires on the SECOND one at t=10. The one-frame case below fires at t=9.
  it('fires once the rise is sustained', () => {
    const result = evaluateTrigger(run());
    expect(result.triggered).toBe(true);
    expect(result.triggerAtSec).toBeCloseTo(10, 6);
    expect(result.enhancementHu).toBeCloseTo(160, 6);
  });

  // Between the two there is table movement and a breath-hold instruction.
  it('reports the enhancement predicted at the first slice, not at the trigger', () => {
    const result = evaluateTrigger(run());
    expect(result.scanStartsAtSec).toBeCloseTo(15, 6);
    expect(result.predictedAtScanHu).toBeCloseTo(160 + 40 * 5, 6);
    expect(result.predictedAtScanHu!).toBeGreaterThan(result.enhancementHu!);
  });

  it('carries the delay from the config', () => {
    const config: TriggerConfig = { ...DEFAULT_TRIGGER, diagnosticDelaySec: 8 };
    expect(evaluateTrigger(run(), config).scanStartsAtSec).toBeCloseTo(18, 6);
  });

  // In a fast circulation the peak passes inside the gap.
  it('warns when the enhancement was already falling at the trigger', () => {
    const frames: MonitorFrame[] = [
      { timeSec: 0, meanHu: 45, sdHu: 5 },
      { timeSec: 1, meanHu: 45, sdHu: 5 },
      { timeSec: 2, meanHu: 260, sdHu: 5 },
      { timeSec: 3, meanHu: 200, sdHu: 5 },
    ];
    const result = evaluateTrigger(frames, { ...DEFAULT_TRIGGER, consecutiveFrames: 2 });
    expect(result.triggered).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/o pico passou dentro do intervalo de monitoramento/);
  });
});

describe('bolusTracking — one frame over the line is not an arrival', () => {
  // A non-diagnostic study, repeated with a second contrast load and a second dose.
  it('does not fire on a single noisy frame', () => {
    const frames: MonitorFrame[] = [
      { timeSec: 0, meanHu: 45, sdHu: 5 },
      { timeSec: 1, meanHu: 45, sdHu: 5 },
      { timeSec: 2, meanHu: 200, sdHu: 5 },
      { timeSec: 3, meanHu: 48, sdHu: 5 },
      { timeSec: 4, meanHu: 47, sdHu: 5 },
    ];
    expect(evaluateTrigger(frames, { ...DEFAULT_TRIGGER, maxMonitoringSec: 4 }).triggered).toBe(false);
  });

  it('restarts the run after a frame drops back', () => {
    const frames: MonitorFrame[] = [
      { timeSec: 0, meanHu: 45 },
      { timeSec: 1, meanHu: 45 },
      { timeSec: 2, meanHu: 200 },
      { timeSec: 3, meanHu: 50 },
      { timeSec: 4, meanHu: 200 },
      { timeSec: 5, meanHu: 210 },
    ];
    expect(evaluateTrigger(frames, { ...DEFAULT_TRIGGER, consecutiveFrames: 2 }).triggerAtSec).toBe(5);
  });

  it('fires on the first frame when only one is required', () => {
    expect(evaluateTrigger(run(), { ...DEFAULT_TRIGGER, consecutiveFrames: 1 }).triggerAtSec).toBeCloseTo(9, 6);
  });
});

describe('bolusTracking — delta and absolute are different protocols', () => {
  it('measures the rise above the measured baseline in delta mode', () => {
    const low = evaluateTrigger(run({ baseline: 30 }), { ...DEFAULT_TRIGGER, mode: 'delta' });
    const high = evaluateTrigger(run({ baseline: 60 }), { ...DEFAULT_TRIGGER, mode: 'delta' });
    expect(low.triggerAtSec).toBe(high.triggerAtSec);
  });

  // The two conventions give different answers on the same patient.
  it('fires earlier in absolute mode when the baseline is high', () => {
    const low = evaluateTrigger(run({ baseline: 30 }), { ...DEFAULT_TRIGGER, mode: 'absolute' });
    const high = evaluateTrigger(run({ baseline: 60 }), { ...DEFAULT_TRIGGER, mode: 'absolute' });
    expect(high.triggerAtSec!).toBeLessThan(low.triggerAtSec!);
  });
});

describe('bolusTracking — not triggering also costs', () => {
  it('separates a bolus that never arrived from one still rising at the timeout', () => {
    const flat = evaluateTrigger(run({ slope: 0 }), { ...DEFAULT_TRIGGER, maxMonitoringSec: 20 });
    expect(flat.outcome).toBe('never-arrived');
    expect(flat.message).toMatch(/Verifique o acesso venoso/);

    const slow = evaluateTrigger(run({ slope: 3, untilSec: 20 }), {
      ...DEFAULT_TRIGGER,
      maxMonitoringSec: 20,
    });
    expect(slow.outcome).toBe('timeout');
    expect(slow.message).toMatch(/Abortar é a direção segura e não é de graça/);
    expect(slow.message).toMatch(/função renal costuma ser o motivo/);
  });

  it('stops at the monitoring limit even if a later frame would have fired', () => {
    const result = evaluateTrigger(run({ startSec: 30, untilSec: 40 }), {
      ...DEFAULT_TRIGGER,
      maxMonitoringSec: 20,
    });
    expect(result.triggered).toBe(false);
  });

  it('reports an invalid ROI as its own outcome rather than a failed trigger', () => {
    expect(evaluateTrigger(run({ baseline: 300 })).outcome).toBe('invalid-roi');
  });
});

describe('bolusTracking — the monitoring itself is dose', () => {
  // The obvious way to make triggering reliable is paid for in dose, invisibly.
  it('counts the exposures', () => {
    const note = monitoringDose(run({ untilSec: 10 }));
    expect(note.frames).toBe(11);
    expect(note.message).toMatch(/cada um é uma exposição/);
  });

  it('handles an empty run', () => {
    expect(monitoringDose([]).frames).toBe(0);
  });
});

describe('bolusTracking — the readout', () => {
  it('states trigger, enhancement and predicted enhancement at scan start', () => {
    expect(describeTrigger(evaluateTrigger(run()))).toBe(
      'Disparo em 10.0s com 160 HU de realce; varredura começa em 15.0s com 360 HU previstos.'
    );
  });

  it('appends the warnings', () => {
    const line = describeTrigger(evaluateTrigger(run({ sdHu: 40 })));
    expect(line).toMatch(/heterogênea demais/);
  });
});
