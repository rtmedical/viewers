import {
  ADC_MAX_MM2_S,
  adcToDisplayUnits,
  B_VALUE_MAX,
  computeAdcMap,
  describeAdcFit,
  fitAdc,
  groupByBValue,
  isDwi,
  isFittable,
  parseBValue,
} from './adc';

/** Signal from the monoexponential model, for building exact fixtures. */
const signal = (s0: number, b: number, adc: number) => s0 * Math.exp(-b * adc);
const TRUE_ADC = 0.0008; // 800 x10^-6 mm2/s, typical brain white matter

describe('parseBValue', () => {
  it('reads the standard attribute', () => {
    expect(parseBValue({ DiffusionBValue: 1000 })).toBe(1000);
    expect(parseBValue({ DiffusionBValue: '750' })).toBe(750);
  });

  it('falls back to the vendor private tags', () => {
    // A viewer that reads only the standard tag silently treats a multi-b series as a
    // single acquisition.
    expect(parseBValue({ SiemensDiffusionBValue: 500 })).toBe(500);
    expect(parseBValue({ PhilipsDiffusionBValue: '1400' })).toBe(1400);
  });

  it('decodes the GE offset encoding', () => {
    // GE writes b = 750 as 1000000750.
    expect(parseBValue({ GEDiffusionBValue: [1000000750, 0, 0, 0] })).toBe(750);
  });

  it('takes the first element of an array', () => {
    expect(parseBValue({ DiffusionBValue: ['0', '0'] })).toBe(0);
  });

  it('returns null rather than guessing', () => {
    // A wrong b scales the whole ADC.
    expect(parseBValue({})).toBeNull();
    expect(parseBValue({ DiffusionBValue: 'high' })).toBeNull();
    expect(parseBValue({ DiffusionBValue: -5 })).toBeNull();
    expect(parseBValue({ DiffusionBValue: B_VALUE_MAX + 1 })).toBeNull();
  });
});

describe('isDwi', () => {
  it('accepts anything carrying a b-value', () => {
    expect(isDwi({ Modality: 'MR', DiffusionBValue: 1000 })).toBe(true);
  });

  it('accepts a described DWI series with no b-value tag', () => {
    expect(isDwi({ Modality: 'MR', SeriesDescription: 'AX DWI b1000' })).toBe(true);
    expect(isDwi({ SeriesDescription: 'Difusao' })).toBe(true);
  });

  it('rejects another modality', () => {
    expect(isDwi({ Modality: 'CT', DiffusionBValue: 1000 })).toBe(false);
  });

  it('rejects an ordinary MR series', () => {
    expect(isDwi({ Modality: 'MR', SeriesDescription: 'AX T2 TSE' })).toBe(false);
  });
});

describe('groupByBValue', () => {
  const s = (b: number, uid: string) => ({ Modality: 'MR', DiffusionBValue: b, uid });

  it('groups and sorts ascending', () => {
    const groups = groupByBValue([s(1000, 'c'), s(0, 'a'), s(500, 'b'), s(0, 'a2')]);
    expect(groups.map(g => g.bValue)).toEqual([0, 500, 1000]);
    expect(groups[0].instances).toHaveLength(2);
  });

  it('excludes a series with no readable b-value rather than calling it b=0', () => {
    // Treating an unknown as zero would make it the reference for every other point.
    const groups = groupByBValue([s(0, 'a'), { Modality: 'MR', SeriesDescription: 'DWI' } as never]);
    expect(groups).toHaveLength(1);
    expect(groups[0].bValue).toBe(0);
  });

  it('handles empty input', () => {
    expect(groupByBValue([])).toEqual([]);
    expect(groupByBValue(undefined as never)).toEqual([]);
  });

  it('knows when a set is fittable', () => {
    expect(isFittable([0, 1000])).toBe(true);
    expect(isFittable([1000, 1000])).toBe(false);
    expect(isFittable([1000])).toBe(false);
    expect(isFittable([])).toBe(false);
  });
});

describe('fitAdc — the arithmetic', () => {
  it('recovers ADC exactly from two clean points', () => {
    const fit = fitAdc([
      { bValue: 0, signal: 1000 },
      { bValue: 1000, signal: signal(1000, 1000, TRUE_ADC) },
    ]);
    expect(fit.method).toBe('exact');
    expect(fit.adc).toBeCloseTo(TRUE_ADC, 12);
    expect(fit.s0).toBeCloseTo(1000, 6);
  });

  it('recovers ADC from a multi-b fit and reports R squared', () => {
    const fit = fitAdc(
      [0, 500, 1000, 1500].map(b => ({ bValue: b, signal: signal(1000, b, TRUE_ADC) }))
    );
    expect(fit.method).toBe('fit');
    expect(fit.adc).toBeCloseTo(TRUE_ADC, 12);
    expect(fit.r2).toBeCloseTo(1, 9);
    expect(fit.used).toBe(4);
  });

  it('does not report R squared for a two-point solve', () => {
    // Two points define the line exactly; there is no residual to check it against.
    const fit = fitAdc([
      { bValue: 0, signal: 1000 },
      { bValue: 1000, signal: 500 },
    ]);
    expect(fit.r2).toBeNaN();
    expect(fit.method).toBe('exact');
  });

  it('works without a b=0 point', () => {
    const fit = fitAdc(
      [200, 800].map(b => ({ bValue: b, signal: signal(1000, b, TRUE_ADC) }))
    );
    expect(fit.adc).toBeCloseTo(TRUE_ADC, 12);
    // S0 is extrapolated, not measured.
    expect(fit.s0).toBeCloseTo(1000, 6);
  });
});

describe('fitAdc — the noise floor, which is what biases ADC', () => {
  it('UNDERESTIMATES ADC when a floored high-b sample is kept', () => {
    // The whole reason the noise floor matters. Rician noise does not average to zero:
    // it RAISES the measured signal at high b, where the true signal has decayed below
    // it. The log flattens, the slope goes shallow, and ADC comes out too low -- exactly
    // in the restricted-diffusion lesion the reader is looking at.
    //
    // At b = 5000 the true signal is 1000 * exp(-4) = 18.3, but the scanner cannot
    // measure below its noise floor and reports ~40.
    const clean = fitAdc([
      { bValue: 0, signal: 1000 },
      { bValue: 1000, signal: signal(1000, 1000, TRUE_ADC) },
      { bValue: 5000, signal: signal(1000, 5000, TRUE_ADC) },
    ]);
    const floored = fitAdc([
      { bValue: 0, signal: 1000 },
      { bValue: 1000, signal: signal(1000, 1000, TRUE_ADC) },
      { bValue: 5000, signal: 40 },
    ]);

    expect(clean.adc).toBeCloseTo(TRUE_ADC, 9);
    // Too LOW, not merely different -- the direction of the bias is the point.
    expect(floored.adc).toBeLessThan(TRUE_ADC);
    expect(floored.adc).toBeCloseTo(0.000633, 5);
  });

  it('recovers the true ADC once the floored sample is excluded', () => {
    const fit = fitAdc(
      [
        { bValue: 0, signal: 1000 },
        { bValue: 1000, signal: signal(1000, 1000, TRUE_ADC) },
        { bValue: 5000, signal: 40 },
      ],
      50
    );
    expect(fit.droppedToNoise).toBe(1);
    expect(fit.adc).toBeCloseTo(TRUE_ADC, 9);
  });

  it('drops samples at or below the floor, and counts them', () => {
    const fit = fitAdc(
      [
        { bValue: 0, signal: 1000 },
        { bValue: 1000, signal: signal(1000, 1000, TRUE_ADC) },
        { bValue: 3000, signal: 25 },
      ],
      40
    );
    expect(fit.droppedToNoise).toBe(1);
    expect(fit.used).toBe(2);
    expect(fit.adc).toBeCloseTo(TRUE_ADC, 9);
  });

  it('fails cleanly when the floor leaves too few samples', () => {
    const fit = fitAdc(
      [
        { bValue: 0, signal: 10 },
        { bValue: 1000, signal: 5 },
      ],
      100
    );
    expect(fit.method).toBe('failed');
    expect(fit.droppedToNoise).toBe(2);
    expect(fit.adc).toBeNaN();
  });

  it('discards non-positive signal, which has no logarithm', () => {
    const fit = fitAdc([
      { bValue: 0, signal: 1000 },
      { bValue: 1000, signal: 0 },
      { bValue: 2000, signal: -5 },
    ]);
    expect(fit.method).toBe('failed');
  });
});

describe('fitAdc — guards', () => {
  it('needs at least two b-values', () => {
    expect(fitAdc([{ bValue: 0, signal: 1000 }]).method).toBe('failed');
    expect(fitAdc([]).reason).toMatch(/two b-values/i);
    expect(fitAdc(undefined as never).method).toBe('failed');
  });

  it('needs the b-values to span a range', () => {
    const fit = fitAdc([
      { bValue: 1000, signal: 500 },
      { bValue: 1000, signal: 400 },
    ]);
    expect(fit.method).toBe('failed');
    expect(fit.reason).toMatch(/one b-value/i);
  });

  it('rejects a non-physical ADC', () => {
    // Signal rising with b: not diffusion, so a negative ADC comes out.
    const fit = fitAdc([
      { bValue: 0, signal: 100 },
      { bValue: 1000, signal: 900 },
    ]);
    expect(fit.method).toBe('failed');
    expect(fit.reason).toMatch(/physical range/i);
  });

  it('rejects an implausibly fast ADC', () => {
    const fit = fitAdc([
      { bValue: 0, signal: 1000 },
      { bValue: 1000, signal: 1e-9 },
    ]);
    expect(fit.adc).toBeNaN();
    expect(ADC_MAX_MM2_S).toBe(0.01);
  });

  it('ignores malformed samples', () => {
    const fit = fitAdc([
      { bValue: 0, signal: 1000 },
      { bValue: NaN, signal: 100 } as never,
      { bValue: 1000, signal: signal(1000, 1000, TRUE_ADC) },
    ]);
    expect(fit.adc).toBeCloseTo(TRUE_ADC, 9);
  });
});

describe('units and description', () => {
  it('converts to the display unit the parametric panel uses', () => {
    // RTV-82 shows ADC in x10^-6 mm2/s.
    expect(adcToDisplayUnits(0.0008)).toBeCloseTo(800, 9);
    expect(adcToDisplayUnits(NaN)).toBeNaN();
  });

  it('describes a good fit', () => {
    const fit = fitAdc([0, 500, 1000].map(b => ({ bValue: b, signal: signal(1000, b, TRUE_ADC) })));
    const text = describeAdcFit(fit);
    expect(text).toContain('800');
    expect(text).toContain('3 b-values');
    expect(text).toMatch(/R²/);
  });

  it('warns that a two-point fit has no residual', () => {
    const fit = fitAdc([
      { bValue: 0, signal: 1000 },
      { bValue: 1000, signal: 500 },
    ]);
    expect(describeAdcFit(fit)).toMatch(/no residual/i);
  });

  it('mentions dropped samples', () => {
    const fit = fitAdc(
      [
        { bValue: 0, signal: 1000 },
        { bValue: 1000, signal: 450 },
        { bValue: 3000, signal: 5 },
      ],
      50
    );
    expect(describeAdcFit(fit)).toMatch(/dropped at the noise floor/);
  });

  it('explains a failure', () => {
    expect(describeAdcFit(fitAdc([]))).toMatch(/two b-values/i);
    expect(describeAdcFit(undefined as never)).toMatch(/could not be fitted/i);
  });
});

describe('computeAdcMap', () => {
  const s0 = Float32Array.from([1000, 800, 600]);
  const b1000 = Float32Array.from([0, 1000, 2000].map((_u, i) => signal(s0[i], 1000, TRUE_ADC)));

  it('fits every voxel and returns the display unit', () => {
    const map = computeAdcMap([0, 1000], [s0, b1000]);
    expect(map).toHaveLength(3);
    for (const value of map) {
      expect(value).toBeCloseTo(800, 3);
    }
  });

  it('writes 0 where the fit fails, not NaN', () => {
    // A NaN voxel makes every downstream statistic special-case it.
    const bad = Float32Array.from([0, 0, 0]);
    const map = computeAdcMap([0, 1000], [s0, bad]);
    expect([...map]).toEqual([0, 0, 0]);
  });

  it('refuses mismatched inputs', () => {
    expect(() => computeAdcMap([0], [s0, b1000])).toThrow(/b-values against/);
    expect(() => computeAdcMap([0, 0], [s0, b1000])).toThrow(/two distinct b-values/);
    expect(() => computeAdcMap([0, 1000], [s0, Float32Array.from([1])])).toThrow(/differ in size/);
    expect(() => computeAdcMap([0, 1000], [new Float32Array(0), new Float32Array(0)])).toThrow(
      /empty/
    );
  });
});
