import {
  BASIS_80_140,
  basisConditionNumber,
  conditionNumber2x2,
  decompose,
  describeVmi,
  huToMu,
  iodineMassAttenuation,
  MAX_CONDITION_NUMBER,
  MIN_KVP_SEPARATION,
  muToHu,
  optimalContrastToNoiseKev,
  virtualMonochromatic,
  vmiNoiseAmplification,
  waterMassAttenuation,
} from './dectDecomposition';

const WATER = BASIS_80_140.water;
const IODINE = BASIS_80_140.iodine;

/** Forward model: what HU a mixture of the two basis materials would measure. */
const mix = (water: number, iodine: number) => ({
  huLow: muToHu(water * WATER.muLow + iodine * IODINE.muLow),
  huHigh: muToHu(water * WATER.muHigh + iodine * IODINE.muHigh),
});

describe('dectDecomposition — HU and mu', () => {
  it('round-trips', () => {
    expect(muToHu(huToMu(-1000))).toBeCloseTo(-1000, 9);
    expect(huToMu(0)).toBe(1);
    expect(muToHu(1)).toBe(0);
  });

  it('air is mu = 0', () => {
    expect(huToMu(-1000)).toBeCloseTo(0, 12);
  });
});

describe('dectDecomposition — the 2x2 solve', () => {
  it('recovers the mixture it was built from', () => {
    const result = decompose({ ...mix(1, 0.02), basisA: WATER, basisB: IODINE });
    expect(result.ok).toBe(true);
    expect(result.densityA).toBeCloseTo(1, 9);
    expect(result.densityB).toBeCloseTo(0.02, 9);
  });

  it('gives pure water a zero iodine density', () => {
    const result = decompose({ ...mix(1, 0), basisA: WATER, basisB: IODINE });
    expect(result.densityB).toBeCloseTo(0, 9);
  });

  it('is linear in the mixture', () => {
    const a = decompose({ ...mix(1, 0.01), basisA: WATER, basisB: IODINE });
    const b = decompose({ ...mix(1, 0.02), basisA: WATER, basisB: IODINE });
    expect(b.densityB / a.densityB).toBeCloseTo(2, 6);
  });

  it('refuses malformed inputs rather than returning zeros silently', () => {
    const result = decompose({ huLow: NaN, huHigh: 0, basisA: WATER, basisB: IODINE });
    expect(result.ok).toBe(false);
    expect(result.failure).toBe('invalidInput');
  });
});

describe('dectDecomposition — the conditioning is the whole engineering story', () => {
  it('computes the 2x2 condition number', () => {
    expect(conditionNumber2x2([[1, 0], [0, 1]])).toBeCloseTo(1, 9);
    expect(conditionNumber2x2([[1, 1], [1, 1]])).toBe(Infinity);
  });

  // The raw condition number conflates "iodine attenuates forty times more than water"
  // (signal) with "these two materials are indistinguishable" (the failure). Normalising
  // the columns leaves only the angle between them, which is the real question.
  it('measures conditioning on the column-normalised matrix, so units do not matter', () => {
    const water = decompose({ ...mix(1, 0.02), basisA: WATER, basisB: IODINE });
    const scaledIodine = { name: 'iodine', muLow: 389, muHigh: 172 };
    const scaled = decompose({
      huLow: 0, huHigh: 0, basisA: WATER, basisB: scaledIodine,
    });
    expect(scaled.conditionNumber).toBeCloseTo(water.conditionNumber, 6);
  });

  it('the raw condition number WOULD have been changed by that rescaling', () => {
    const a = conditionNumber2x2([[1, 38.9], [1, 17.2]]);
    const b = conditionNumber2x2([[1, 389], [1, 172]]);
    expect(Math.abs(b / a - 1)).toBeGreaterThan(0.5);
    expect(basisConditionNumber([[1, 38.9], [1, 17.2]])).toBeCloseTo(
      basisConditionNumber([[1, 389], [1, 172]]),
      6
    );
  });

  it('reports it even on a successful decomposition', () => {
    const result = decompose({ ...mix(1, 0.02), basisA: WATER, basisB: IODINE });
    expect(result.conditionNumber).toBeGreaterThan(1);
    expect(result.conditionNumber).toBeLessThan(MAX_CONDITION_NUMBER);
  });

  // A 5 HU uncertainty becomes a 50 HU uncertainty, and the map looks like a map: smooth,
  // plausible, and wrong.
  it('REFUSES when the basis materials are barely distinguishable', () => {
    const nearlySame = { name: 'x', muLow: 1.001, muHigh: 1.0 };
    const result = decompose({ huLow: 50, huHigh: 45, basisA: WATER, basisB: nearlySame });
    expect(result.ok).toBe(false);
    expect(result.failure).toBe('illConditioned');
    expect(result.reason).toMatch(/amplificado/);
  });

  it('refuses exactly collinear basis materials', () => {
    const result = decompose({ huLow: 50, huHigh: 45, basisA: WATER, basisB: { ...WATER } });
    expect(result.ok).toBe(false);
    expect(result.failure).toBe('illConditioned');
  });

  // Spectral separation is not a quality setting; it is what makes the measurement
  // possible at all.
  it('refuses a kVp pair that is too close together', () => {
    const result = decompose({
      ...mix(1, 0.02),
      basisA: WATER,
      basisB: IODINE,
      kvpLow: 100,
      kvpHigh: 120,
    });
    expect(result.ok).toBe(false);
    expect(result.failure).toBe('kvpTooClose');
    expect(result.reason).toMatch(new RegExp(`${MIN_KVP_SEPARATION}`));
  });

  it('accepts a properly separated pair', () => {
    expect(
      decompose({ ...mix(1, 0.02), basisA: WATER, basisB: IODINE, kvpLow: 80, kvpHigh: 140 }).ok
    ).toBe(true);
  });

  // The noise amplification is the number that decides whether a map is usable.
  it('the water/iodine pair is well conditioned and a water/fat pair is not', () => {
    const iodinePair = decompose({ ...mix(1, 0.02), basisA: WATER, basisB: IODINE });
    const fatPair = decompose({ huLow: 40, huHigh: 38, basisA: WATER, basisB: BASIS_80_140.fat });
    expect(iodinePair.ok).toBe(true);
    expect(fatPair.ok).toBe(false);
    expect(fatPair.conditionNumber).toBeGreaterThan(iodinePair.conditionNumber);
  });
});

describe('dectDecomposition — mass attenuation', () => {
  it('falls with energy, steeply at the low end', () => {
    expect(waterMassAttenuation(40)).toBeGreaterThan(waterMassAttenuation(70));
    expect(waterMassAttenuation(70)).toBeGreaterThan(waterMassAttenuation(140));
  });

  it('iodine attenuates far more than water at low keV, and much less so at high', () => {
    const low = iodineMassAttenuation(40) / waterMassAttenuation(40);
    const high = iodineMassAttenuation(140) / waterMassAttenuation(140);
    expect(low).toBeGreaterThan(high * 3);
  });

  it('drops below the iodine K-edge', () => {
    expect(iodineMassAttenuation(34)).toBeGreaterThan(iodineMassAttenuation(32) * 3);
  });

  it('clamps outside the diagnostic range instead of extrapolating to nonsense', () => {
    expect(waterMassAttenuation(1)).toBe(waterMassAttenuation(20));
    expect(waterMassAttenuation(NaN)).toBe(waterMassAttenuation(70));
  });
});

describe('dectDecomposition — virtual monochromatic images', () => {
  const vmi = (kev: number, iodine = 0.02) =>
    virtualMonochromatic({ waterDensity: 1, iodineDensity: iodine, kev });

  it('pure water is 0 HU at any energy', () => {
    for (const kev of [40, 70, 140]) {
      expect(virtualMonochromatic({ waterDensity: 1, iodineDensity: 0, kev }).hu).toBeCloseTo(
        0,
        9
      );
    }
  });

  it('iodine enhancement rises steeply as keV falls', () => {
    expect(vmi(40).hu).toBeGreaterThan(vmi(70).hu * 2);
    expect(vmi(70).hu).toBeGreaterThan(vmi(140).hu);
  });

  it('scales linearly with iodine concentration', () => {
    expect(vmi(70, 0.04).hu / vmi(70, 0.02).hu).toBeCloseTo(2, 6);
  });

  it('clamps the energy to the reconstructable range', () => {
    expect(vmi(10).kev).toBe(40);
    expect(vmi(500).kev).toBe(140);
  });

  // A reader shown a 40 keV series without being told the noise tripled reads it as if it
  // were a 70 keV series.
  it('ALWAYS reports the noise amplification alongside the image', () => {
    expect(vmi(70).noiseAmplification).toBeCloseTo(1, 1);
    expect(vmi(40).noiseAmplification).toBeGreaterThan(1.5);
    expect(describeVmi(vmi(40))).toMatch(/ruído \d+\.\d+× vs 70 keV/);
  });

  it('predicts the noise in HU when the input noise is known, scaled by the conditioning', () => {
    const clean = virtualMonochromatic({
      waterDensity: 1, iodineDensity: 0.02, kev: 40, inputNoiseHu: 10, conditionNumber: 1,
    });
    const illConditioned = virtualMonochromatic({
      waterDensity: 1, iodineDensity: 0.02, kev: 40, inputNoiseHu: 10, conditionNumber: 5,
    });
    expect(illConditioned.predictedNoiseHu!).toBeCloseTo(clean.predictedNoiseHu! * 5, 6);
    expect(describeVmi(illConditioned)).toMatch(/ruído previsto ±\d+ HU/);
  });

  it('omits the HU prediction when the input noise is unknown, rather than inventing one', () => {
    expect(vmi(40).predictedNoiseHu).toBeNull();
    expect(describeVmi(vmi(40))).not.toMatch(/previsto/);
  });

  it('the noise curve is a bowl with its floor near 70 keV', () => {
    expect(vmiNoiseAmplification(70)).toBeLessThan(vmiNoiseAmplification(40));
    expect(vmiNoiseAmplification(70)).toBeLessThanOrEqual(vmiNoiseAmplification(140));
  });
});

describe('dectDecomposition — optimal keV', () => {
  // Contrast alone always answers "40 keV", which is why so many protocols default there.
  it('is an interior optimum, not the bottom of the range', () => {
    const best = optimalContrastToNoiseKev();
    expect(best).toBeGreaterThan(40);
    expect(best).toBeLessThan(140);
  });

  it('sits in the range the literature reports for iodine CNR', () => {
    const best = optimalContrastToNoiseKev();
    expect(best).toBeGreaterThanOrEqual(45);
    expect(best).toBeLessThanOrEqual(80);
  });

  it('respects a restricted search range', () => {
    expect(optimalContrastToNoiseKev(90, 110)).toBeGreaterThanOrEqual(90);
    expect(optimalContrastToNoiseKev(90, 110)).toBeLessThanOrEqual(110);
  });
});

describe('dectDecomposition — the readout', () => {
  it('carries energy, HU and the noise factor', () => {
    const text = describeVmi(virtualMonochromatic({ waterDensity: 1, iodineDensity: 0.02, kev: 55 }));
    expect(text).toMatch(/^55 keV · \d+ HU/);
  });

  it('survives a nullish result', () => {
    expect(describeVmi(undefined as never)).toBe('');
  });
});
