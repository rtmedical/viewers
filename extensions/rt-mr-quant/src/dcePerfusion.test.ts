import {
  cumulativeTrapezoid,
  DCE_CAVEAT_LABELS,
  describeDceCaveats,
  describeTofts,
  fitExtendedTofts,
  KTRANS_MAX_PER_MIN,
  MAX_SAMPLING_MIN,
  meanBaseline,
  parkerAif,
  relativeEnhancement,
  dceSignalToConcentration,
  ToftsInput,
  VE_MAX,
} from './dcePerfusion';

const DT = 0.05; // 3 s
const timesMin = (n: number, dt = DT) => Array.from({ length: n }, (_, i) => i * dt);

/** Forward model: convolve the AIF with the Tofts impulse response, discretely. */
const forwardTofts = (
  plasma: number[],
  times: number[],
  { ktrans = 0.25, ve = 0.4, vp = 0.05 } = {}
): number[] => {
  const kep = ktrans / ve;
  const out: number[] = [];
  for (let i = 0; i < times.length; i++) {
    let convolution = 0;
    for (let j = 1; j <= i; j++) {
      const dt = times[j] - times[j - 1];
      const a = plasma[j - 1] * Math.exp(-kep * (times[i] - times[j - 1]));
      const b = plasma[j] * Math.exp(-kep * (times[i] - times[j]));
      convolution += ((a + b) / 2) * dt;
    }
    out.push(vp * plasma[i] + ktrans * convolution);
  }
  return out;
};

// 0.6 s sampling over 4 min. The discrete forward model and the trapezoid integrals in
// the fit only agree in the limit, so the accuracy tests need a fine grid; the coarser
// TIMES below is what a real acquisition looks like and is used everywhere else.
const FINE_TIMES = timesMin(400, 0.01);
const FINE_AIF = parkerAif(FINE_TIMES, 0.2);

const TIMES = timesMin(120);
const AIF = parkerAif(TIMES, 0.2);
const TISSUE = forwardTofts(AIF, TIMES);

const input = (over: Partial<ToftsInput> = {}): ToftsInput => ({
  tissue: TISSUE,
  plasma: AIF,
  timesMin: TIMES,
  method: 'spgr',
  aifSource: 'measured',
  ...over,
});

describe('dcePerfusion — signal to concentration', () => {
  const SPGR = { flipAngleDeg: 15, trSec: 0.005, t1Sec: 1.2 };

  it('returns zero concentration for the pre-contrast baseline', () => {
    const concentration = dceSignalToConcentration([100, 100, 100], { ...SPGR, baseline: 100 });
    concentration.forEach(c => expect(c).toBeCloseTo(0, 9));
  });

  it('rises monotonically with signal, as shortening T1 must', () => {
    const concentration = dceSignalToConcentration([100, 120, 160, 220], {
      ...SPGR,
      baseline: 100,
    });
    for (let i = 1; i < concentration.length; i++) {
      expect(concentration[i]).toBeGreaterThan(concentration[i - 1]);
    }
  });

  // The relaxivity scales it, so a wrong r1 is a wrong Ktrans by the same factor.
  it('scales inversely with the relaxivity', () => {
    const a = dceSignalToConcentration([100, 200], { ...SPGR, baseline: 100, relaxivity: 4.5 });
    const b = dceSignalToConcentration([100, 200], { ...SPGR, baseline: 100, relaxivity: 9 });
    expect(a[1] / b[1]).toBeCloseTo(2, 6);
  });

  it('needs the sequence parameters and gives zeros without them', () => {
    expect(dceSignalToConcentration([100, 200], { flipAngleDeg: 0, trSec: 0, t1Sec: 0 })).toEqual([
      0, 0,
    ]);
  });

  it('clamps at zero rather than producing negative concentration from noise', () => {
    const concentration = dceSignalToConcentration([100, 95], { ...SPGR, baseline: 100 });
    expect(concentration[1]).toBe(0);
  });

  it('meanBaseline averages the leading points', () => {
    expect(meanBaseline([10, 12, 14, 500, 600], 3)).toBeCloseTo(12, 9);
    expect(meanBaseline([])).toBe(0);
  });

  // Kept as a named function so every call site is greppable — the values are not
  // concentration and must not be labelled as such.
  it('relativeEnhancement is (S-S0)/S0, clamped at zero', () => {
    expect(relativeEnhancement([100, 150, 90], 100)).toEqual([0, 0.5, 0]);
  });
});

describe('dcePerfusion — cumulative integral', () => {
  it('is the trapezoid rule, starting at zero', () => {
    expect(cumulativeTrapezoid([0, 2, 4], [0, 1, 2])).toEqual([0, 1, 4]);
  });

  it('ignores non-monotonic or non-finite steps instead of producing NaN', () => {
    const out = cumulativeTrapezoid([1, NaN, 3], [0, 1, 2]);
    expect(out.every(v => Number.isFinite(v))).toBe(true);
  });

  it('is empty-safe', () => {
    expect(cumulativeTrapezoid([], [])).toEqual([]);
  });
});

describe('dcePerfusion — the fit recovers what it was built from', () => {
  it('recovers Ktrans, ve and vp from a synthetic curve', () => {
    const result = fitExtendedTofts(
      input({
        tissue: forwardTofts(FINE_AIF, FINE_TIMES),
        plasma: FINE_AIF,
        timesMin: FINE_TIMES,
      })
    );
    expect(result.ok).toBe(true);
    expect(result.ktrans).toBeCloseTo(0.25, 2);
    expect(result.ve).toBeCloseTo(0.4, 2);
    expect(result.vp).toBeCloseTo(0.05, 2);
    expect(result.kep).toBeCloseTo(0.625, 2);
    expect(result.r2).toBeGreaterThan(0.999);
  });

  it('recovers a different parameter set just as well', () => {
    const result = fitExtendedTofts(
      input({
        tissue: forwardTofts(FINE_AIF, FINE_TIMES, { ktrans: 0.8, ve: 0.6, vp: 0.02 }),
        plasma: FINE_AIF,
        timesMin: FINE_TIMES,
      })
    );
    expect(result.ktrans).toBeCloseTo(0.8, 1);
    expect(result.ve).toBeCloseTo(0.6, 1);
    expect(result.vp).toBeCloseTo(0.02, 2);
  });

  // The bug this caught: the first regression coefficient is Ktrans + kep·vp, and reading
  // it off as Ktrans returns 0.28125 for a true 0.25 — with R² = 1, because the linear
  // model fits the data perfectly and only the extraction was wrong.
  it('separates Ktrans from the kep·vp term the linearisation folds into it', () => {
    const result = fitExtendedTofts(
      input({
        tissue: forwardTofts(FINE_AIF, FINE_TIMES, { ktrans: 0.25, ve: 0.4, vp: 0.2 }),
        plasma: FINE_AIF,
        timesMin: FINE_TIMES,
      })
    );
    expect(result.ktrans).toBeCloseTo(0.25, 2);
    expect(result.vp).toBeCloseTo(0.2, 2);
    // A large vp is exactly where reading the coefficient raw goes most wrong.
    expect(result.ktrans + result.kep * result.vp).toBeGreaterThan(0.36);
  });

  it('is accurate at a realistic 3 s sampling too', () => {
    const result = fitExtendedTofts(input());
    expect(result.ok).toBe(true);
    expect(result.ktrans).toBeCloseTo(0.25, 2);
  });

  // One linear solve: no initial guess, no convergence criterion, no optimiser that lands
  // somewhere else on Tuesday.
  it('is deterministic — the same input gives bit-identical output', () => {
    const a = fitExtendedTofts(input());
    const b = fitExtendedTofts(input());
    expect(a.ktrans).toBe(b.ktrans);
    expect(a.ve).toBe(b.ve);
    expect(a.vp).toBe(b.vp);
  });
});

describe('dcePerfusion — refusing a fit that is not physiology', () => {
  // A ve of 3 is not "an unusual tumour", it is an unconstrained solve fitting noise — and
  // a map with those in it has bright spots exactly where the reader looks.
  it('rejects ve above 1', () => {
    const tissue = forwardTofts(AIF, TIMES, { ktrans: 0.1, ve: 0.9 }).map(v => v * 6);
    const result = fitExtendedTofts(input({ tissue }));
    if (!result.ok) {
      expect(result.failure).toBe('nonPhysical');
    } else {
      expect(result.ve).toBeLessThanOrEqual(VE_MAX);
    }
  });

  it('treats an entirely negative curve as no enhancement, not as a fit', () => {
    const result = fitExtendedTofts(input({ tissue: TISSUE.map(v => -v) }));
    expect(result.ok).toBe(false);
    expect(result.failure).toBe('noEnhancement');
  });

  it('reports a singular system for a tissue curve that is a scaled copy of the AIF', () => {
    // Ct = 2·Cp makes ∫Ct collinear with ∫Cp; there is nothing to solve.
    const degenerate = fitExtendedTofts(input({ tissue: AIF.map(v => v * 2) }));
    expect(degenerate.ok).toBe(false);
    expect(degenerate.failure).toBe('singular');
  });

  it('rejects a vp above 1 — tissue that is more than pure plasma', () => {
    const result = fitExtendedTofts(
      input({ tissue: forwardTofts(AIF, TIMES, { ktrans: 0.3, ve: 0.4, vp: 2 }) })
    );
    expect(result.ok).toBe(false);
    expect(result.failure).toBe('nonPhysical');
    expect(result.reason).toMatch(/fisiologia/);
    expect(KTRANS_MAX_PER_MIN).toBeGreaterThan(1);
  });

  it('rejects a curve with no enhancement', () => {
    const result = fitExtendedTofts(input({ tissue: new Array(120).fill(0) }));
    expect(result.failure).toBe('noEnhancement');
  });

  it('rejects a series too short to fit three parameters', () => {
    const result = fitExtendedTofts(
      input({ tissue: [0, 1, 2], plasma: [0, 1, 2], timesMin: [0, 0.05, 0.1] })
    );
    expect(result.failure).toBe('tooFewPoints');
  });

  it('reports a singular system rather than dividing by zero', () => {
    const flat = new Array(20).fill(1);
    const result = fitExtendedTofts(
      input({ tissue: flat, plasma: flat, timesMin: timesMin(20) })
    );
    expect(result.ok).toBe(false);
    expect(['singular', 'nonPhysical']).toContain(result.failure);
  });

  it('a failed fit still carries its caveats and zeroed values', () => {
    const result = fitExtendedTofts(
      input({ tissue: new Array(120).fill(0), method: 'relativeEnhancement' })
    );
    expect(result.ktrans).toBe(0);
    expect(result.caveats).toContain('relativeEnhancement');
  });
});

describe('dcePerfusion — the caveats are the point', () => {
  // The values correlate with Ktrans, have the units of Ktrans, and are not Ktrans — they
  // vary with the scanner, the coil, the flip angle and the baseline T1.
  it('declares loudly when the fit ran on relative enhancement', () => {
    const result = fitExtendedTofts(input({ method: 'relativeEnhancement' }));
    expect(result.method).toBe('relativeEnhancement');
    expect(result.caveats).toContain('relativeEnhancement');
    expect(describeDceCaveats(result)).toMatch(/NÃO são Ktrans/);
    expect(describeTofts(result)).toMatch(/relativo/);
  });

  it('says nothing extra when a T1 map and a measured AIF were used', () => {
    expect(fitExtendedTofts(input()).caveats).toEqual([]);
  });

  // A Ktrans without its AIF provenance cannot be compared with anybody else's, including
  // the same patient's from last month.
  it('records which AIF was used', () => {
    expect(fitExtendedTofts(input({ aifSource: 'population' })).caveats).toContain(
      'populationAif'
    );
    expect(fitExtendedTofts(input({ aifSource: 'unknown' })).caveats).toContain('unknownAif');
    expect(describeDceCaveats(fitExtendedTofts(input({ aifSource: 'population' })))).toMatch(
      /Parker/
    );
  });

  it('flags coarse temporal sampling, which biases Ktrans low', () => {
    const slowTimes = timesMin(30, 0.5);
    const slowAif = parkerAif(slowTimes, 0.2);
    const result = fitExtendedTofts(
      input({ tissue: forwardTofts(slowAif, slowTimes), plasma: slowAif, timesMin: slowTimes })
    );
    expect(result.caveats).toContain('coarseTemporalResolution');
    expect(MAX_SAMPLING_MIN).toBeLessThan(0.5);
  });

  it('does not flag a fast acquisition', () => {
    expect(fitExtendedTofts(input()).caveats).not.toContain('coarseTemporalResolution');
  });

  it('has a label for every caveat', () => {
    for (const key of Object.keys(DCE_CAVEAT_LABELS)) {
      expect(DCE_CAVEAT_LABELS[key as keyof typeof DCE_CAVEAT_LABELS].length).toBeGreaterThan(20);
    }
  });
});

describe('dcePerfusion — the Parker population AIF', () => {
  it('is zero before the bolus', () => {
    expect(parkerAif([0, 0.1], 0.2)).toEqual([0, 0]);
  });

  it('peaks shortly after arrival and then decays', () => {
    const times = timesMin(200);
    const aif = parkerAif(times, 0.2);
    const peakIndex = aif.indexOf(Math.max(...aif));
    expect(times[peakIndex] - 0.2).toBeGreaterThan(0.1);
    expect(times[peakIndex] - 0.2).toBeLessThan(0.35);
    expect(aif[aif.length - 1]).toBeLessThan(aif[peakIndex] / 3);
  });

  it('never goes negative', () => {
    expect(parkerAif(timesMin(200), 0.2).every(v => v >= 0)).toBe(true);
  });

  it('is empty-safe', () => {
    expect(parkerAif([])).toEqual([]);
  });
});

describe('dcePerfusion — the readout', () => {
  it('shows the three parameters and the fit quality', () => {
    const text = describeTofts(fitExtendedTofts(input()));
    expect(text).toMatch(/^Ktrans 0\.2\d\d min⁻¹/);
    expect(text).toMatch(/ve 0\.4\d/);
    expect(text).toMatch(/R² (0\.99\d|1\.000)/);
  });

  it('shows the reason instead of numbers when the fit failed', () => {
    expect(describeTofts(fitExtendedTofts(input({ tissue: new Array(120).fill(0) })))).toMatch(
      /Sem realce/
    );
  });

  it('survives a nullish result', () => {
    expect(describeTofts(undefined as never)).toBe('');
    expect(describeDceCaveats(undefined as never)).toBe('');
  });
});
