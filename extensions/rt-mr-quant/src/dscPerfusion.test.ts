import {
  analysePerfusion,
  CAVEAT_LABELS,
  describeCaveats,
  estimateBaseline,
  fitGammaVariate,
  gammaVariateArea,
  gammaVariateAt,
  gammaVariateFirstMoment,
  MIN_BASELINE_POINTS,
  signalToConcentration,
} from './dscPerfusion';

const TR = 1.5;
const times = (n: number) => Array.from({ length: n }, (_, i) => i * TR);

/** Ground-truth gamma-variate concentration curve. */
const gamma = (t: number, { k = 1, alpha = 3, beta = 2, t0 = 15 } = {}) => {
  const dt = t - t0;
  return dt > 0 ? k * Math.pow(dt, alpha) * Math.exp(-dt / beta) : 0;
};

/** Turns a concentration curve back into a DSC signal, so the pipeline can be inverted. */
const signalFrom = (
  concentration: number[],
  baseline = 1000,
  echoTimeMs = 1
): number[] => concentration.map(c => baseline * Math.exp(-c * echoTimeMs));

const CURVE = times(60).map(t => gamma(t));
const SIGNAL = signalFrom(CURVE);

describe('dscPerfusion — baseline', () => {
  it('averages the pre-bolus points and says how many it used', () => {
    const estimate = estimateBaseline(SIGNAL);
    expect(estimate.ok).toBe(true);
    expect(estimate.value).toBeCloseTo(1000, 6);
    expect(estimate.points).toBeGreaterThanOrEqual(MIN_BASELINE_POINTS);
  });

  it('stops at the bolus rather than averaging into the dip', () => {
    // t0 = 15 s at TR 1.5 s is index 10.
    expect(estimateBaseline(SIGNAL).points).toBeLessThanOrEqual(12);
  });

  // A baseline off by 5% moves every concentration value and therefore every voxel.
  it('REFUSES a series too short to have a baseline', () => {
    const estimate = estimateBaseline([1000, 990, 500]);
    expect(estimate.ok).toBe(false);
    expect(estimate.reason).toMatch(/curta demais/);
  });

  it('refuses a non-positive baseline', () => {
    expect(estimateBaseline(new Array(20).fill(0)).ok).toBe(false);
  });

  it('ignores non-finite samples', () => {
    const dirty = [...SIGNAL];
    dirty[2] = NaN;
    expect(estimateBaseline(dirty).ok).toBe(true);
  });
});

describe('dscPerfusion — signal is not concentration', () => {
  it('inverts the exponential exactly', () => {
    const recovered = signalToConcentration(SIGNAL, { baseline: 1000, echoTimeMs: 1 });
    recovered.forEach((c, i) => expect(c).toBeCloseTo(CURVE[i], 9));
  });

  // Integrating the raw drop under-weights the peak and over-weights the shoulders, and
  // the error is largest exactly where the bolus is concentrated, so it does not cancel.
  it('differs from the raw signal drop by more than a scale factor', () => {
    const drop = SIGNAL.map(s => 1000 - s);
    const concentration = signalToConcentration(SIGNAL, { baseline: 1000 });
    const peakIndex = concentration.indexOf(Math.max(...concentration));
    const shoulderIndex = peakIndex + 6;

    const ratioAtPeak = concentration[peakIndex] / drop[peakIndex];
    const ratioAtShoulder = concentration[shoulderIndex] / drop[shoulderIndex];
    expect(Math.abs(ratioAtPeak / ratioAtShoulder - 1)).toBeGreaterThan(0.1);
  });

  // Letting noise above the baseline go negative puts holes in the area under the curve.
  it('clamps at zero instead of producing negative concentration', () => {
    const noisy = signalToConcentration([1010, 1005, 990], { baseline: 1000 });
    expect(noisy.slice(0, 2)).toEqual([0, 0]);
    expect(noisy[2]).toBeGreaterThan(0);
  });

  it('is defensive about zero and non-finite samples', () => {
    expect(signalToConcentration([0, NaN, -5], { baseline: 1000 })).toEqual([0, 0, 0]);
  });
});

describe('dscPerfusion — gamma-variate fit', () => {
  it('recovers the parameters it was built from', () => {
    const fit = fitGammaVariate(CURVE, times(60));
    expect(fit.ok).toBe(true);
    expect(fit.alpha).toBeCloseTo(3, 4);
    expect(fit.beta).toBeCloseTo(2, 4);
    expect(fit.k).toBeCloseTo(1, 4);
  });

  it('evaluates back to the curve it fitted', () => {
    const fit = fitGammaVariate(CURVE, times(60));
    for (const t of [16, 18, 21, 25, 30]) {
      expect(gammaVariateAt(fit, t)).toBeCloseTo(gamma(t), 4);
    }
    expect(gammaVariateAt(fit, 5)).toBe(0);
  });

  // The reason the fit exists: the second pass inflates CBV if it is integrated too.
  it('EXCLUDES the recirculation hump', () => {
    const contaminated = times(80).map(t => gamma(t) + gamma(t, { k: 0.4, t0: 45 }));
    const fit = fitGammaVariate(contaminated, times(80));
    expect(fit.ok).toBe(true);
    // Within a few percent of the clean first pass, not inflated by the second.
    const clean = gammaVariateArea(fitGammaVariate(CURVE, times(60)));
    expect(gammaVariateArea(fit) / clean).toBeGreaterThan(0.9);
    expect(gammaVariateArea(fit) / clean).toBeLessThan(1.1);
  });

  it('and a naive integral of the same curve WOULD be inflated', () => {
    // Demonstrates the failure mode, so the guard above is not vacuous.
    const contaminated = times(80).map(t => gamma(t) + gamma(t, { k: 0.4, t0: 45 }));
    const naive = contaminated.reduce((a, b) => a + b, 0) * TR;
    const clean = CURVE.reduce((a, b) => a + b, 0) * TR;
    expect(naive / clean).toBeGreaterThan(1.3);
  });

  it('refuses a curve with no enhancement', () => {
    const fit = fitGammaVariate(new Array(40).fill(0), times(40));
    expect(fit.ok).toBe(false);
    expect(fit.reason).toMatch(/realce/);
  });

  it('refuses a series too short to fit', () => {
    expect(fitGammaVariate([0, 1, 2], [0, 1, 2]).ok).toBe(false);
  });

  it('refuses non-physical parameters rather than returning them', () => {
    // Monotonically rising: no decay, so beta cannot be positive.
    const rising = times(30).map((_, i) => i * i);
    const fit = fitGammaVariate(rising, times(30));
    expect(fit.ok).toBe(false);
  });
});

describe('dscPerfusion — closed-form area and moment', () => {
  const fit = () => fitGammaVariate(CURVE, times(60));

  it('matches the analytic integral of the true curve', () => {
    // k·beta^(alpha+1)·Gamma(alpha+1) = 1 · 2^4 · 3! = 96
    expect(gammaVariateArea(fit())).toBeCloseTo(96, 2);
  });

  it('the first moment is (alpha+1)·beta', () => {
    expect(gammaVariateFirstMoment(fit())).toBeCloseTo(8, 3);
  });

  // Using the closed form rather than summing samples is what keeps two scanners with
  // different TRs comparable. It is not exact at a coarse TR, and the residual is the
  // arrival time being quantised to the sampling grid — not the quadrature.
  it('recovers the area within a few percent at three times the TR', () => {
    const coarse = fitGammaVariate(
      Array.from({ length: 20 }, (_, i) => gamma(i * 4.5)),
      Array.from({ length: 20 }, (_, i) => i * 4.5)
    );
    expect(coarse.ok).toBe(true);
    const ratio = gammaVariateArea(coarse) / 96;
    expect(ratio).toBeGreaterThan(0.95);
    expect(ratio).toBeLessThan(1.05);
  });

  it('is zero for a failed fit rather than NaN', () => {
    const bad = fitGammaVariate([0, 0, 0], [0, 1, 2]);
    expect(gammaVariateArea(bad)).toBe(0);
    expect(gammaVariateFirstMoment(bad)).toBe(0);
    expect(gammaVariateAt(bad, 10)).toBe(0);
  });
});

describe('dscPerfusion — the analysis, and what it refuses to claim', () => {
  const analyse = (over = {}) =>
    analysePerfusion({ signal: SIGNAL, timesSec: times(60), echoTimeMs: 1, ...over });

  it('produces the four parameters', () => {
    const result = analyse();
    expect(result.ok).toBe(true);
    expect(result.rCbv).toBeCloseTo(96, 1);
    expect(result.mtt).toBeCloseTo(8, 2);
    expect(result.rCbf).toBeCloseTo(12, 1);
    // TTP of a gamma-variate is alpha·beta = 6 s after arrival.
    expect(result.ttp).toBeCloseTo(6, 2);
  });

  it('normalises rCBV by the AIF area when one is given', () => {
    expect(analyse({ aifArea: 48 }).rCbv).toBeCloseTo(2, 3);
  });

  // A CBF map that does not say it skipped the deconvolution looks like the one from the
  // scanner console and disagrees with it by a bolus-dependent factor.
  it('ALWAYS declares that the deconvolution was skipped', () => {
    const result = analyse({ aifArea: 48 });
    expect(result.requiresDeconvolution).toBe(true);
    expect(result.caveats).toContain('noDeconvolution');
    expect(describeCaveats(result)).toMatch(/sem deconvolução pela AIF/);
  });

  it('always declares the units as relative', () => {
    expect(analyse().caveats).toContain('relativeUnits');
    expect(describeCaveats(analyse())).toMatch(/não mL\/100 g/);
  });

  it('adds a louder caveat when there is no AIF at all', () => {
    expect(analyse().caveats).toContain('noAif');
    expect(analyse({ aifArea: 48 }).caveats).not.toContain('noAif');
    expect(describeCaveats(analyse())).toMatch(/não são comparáveis entre exames/);
  });

  it('declares the missing leakage correction', () => {
    expect(analyse().caveats).toContain('noLeakageCorrection');
  });

  it('fails cleanly on an unusable time-course, with a reason and the caveats intact', () => {
    const result = analysePerfusion({ signal: [1000, 999], timesSec: [0, 1.5] });
    expect(result.ok).toBe(false);
    expect(result.rCbv).toBe(0);
    expect(result.caveats).toContain('fitFailed');
    expect(result.reason).toBeTruthy();
  });

  it('has a label for every caveat', () => {
    for (const key of Object.keys(CAVEAT_LABELS)) {
      expect(CAVEAT_LABELS[key as keyof typeof CAVEAT_LABELS].length).toBeGreaterThan(10);
    }
  });

  it('describeCaveats survives a nullish result', () => {
    expect(describeCaveats(undefined as never)).toBe('');
  });
});
