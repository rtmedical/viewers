import {
  bandsAreSeparable,
  classifyMaterial,
  describeClassification,
  dualEnergyRatio,
  effectiveZ,
  METAL_HU,
  MIN_ATTENUATION_HU,
  MIN_OBJECT_SIZE_MM,
  RATIO_BANDS_80_140,
} from './materialClassification';

/** Builds an HU pair with a given ratio and mean attenuation. */
const withRatio = (ratio: number, meanHu: number) => {
  // (low+1000)/(high+1000) = ratio and (low+high)/2 = meanHu
  const high = (2 * (meanHu + 1000)) / (1 + ratio) - 1000;
  const low = ratio * (high + 1000) - 1000;
  return { huLow: low, huHigh: high };
};

describe('materialClassification — the ratio', () => {
  it('is attenuation relative to air, not raw HU', () => {
    expect(dualEnergyRatio(500, 300)).toBeCloseTo(1500 / 1300, 9);
  });

  // Computing it on raw HU gives a number that changes sign around water.
  it('is well behaved through water, where raw HU would flip sign', () => {
    expect(dualEnergyRatio(1, -1)).toBeCloseTo(1001 / 999, 9);
    expect(dualEnergyRatio(0, 0)).toBe(1);
  });

  it('is NaN rather than Infinity below air', () => {
    expect(Number.isNaN(dualEnergyRatio(0, -1200))).toBe(true);
    expect(Number.isNaN(dualEnergyRatio(NaN, 100))).toBe(true);
  });

  it('the helper builds the pair it claims to', () => {
    const pair = withRatio(1.4, 600);
    expect(dualEnergyRatio(pair.huLow, pair.huHigh)).toBeCloseTo(1.4, 9);
    expect((pair.huLow + pair.huHigh) / 2).toBeCloseTo(600, 9);
  });
});

describe('materialClassification — the attenuation floor', () => {
  // As both approach water the ratio approaches 1 whatever the material is, while the
  // noise stays the same size. Every voxel would have an opinion.
  it('REFUSES below the floor, with a reason', () => {
    const result = classifyMaterial(withRatio(1.4, 30));
    expect(result.ok).toBe(false);
    expect(result.refusal).toBe('belowAttenuationFloor');
    expect(result.message).toMatch(new RegExp(`${MIN_ATTENUATION_HU} HU`));
    expect(result.material).toBe('indeterminate');
  });

  it('classifies the same ratio once the attenuation supports it', () => {
    expect(classifyMaterial(withRatio(1.4, 600)).material).toBe('nonUricAcid');
  });

  it('honours a site-specific floor', () => {
    expect(classifyMaterial({ ...withRatio(1.4, 60), minAttenuationHu: 50 }).ok).toBe(true);
  });
});

describe('materialClassification — partial volume', () => {
  // A 2 mm stone in a 3 mm slice is mostly urine by volume.
  it('refuses an object smaller than the partial-volume limit', () => {
    const result = classifyMaterial({ ...withRatio(1.4, 600), sizeMm: 2 });
    expect(result.ok).toBe(false);
    expect(result.refusal).toBe('partialVolume');
    expect(result.message).toMatch(new RegExp(`${MIN_OBJECT_SIZE_MM} mm`));
  });

  it('classifies one at or above the limit', () => {
    expect(classifyMaterial({ ...withRatio(1.4, 600), sizeMm: MIN_OBJECT_SIZE_MM }).ok).toBe(true);
  });

  it('classifies when the size is unknown, since there is nothing to check', () => {
    expect(classifyMaterial(withRatio(1.4, 600)).ok).toBe(true);
  });

  it('honours a site-specific size limit', () => {
    expect(classifyMaterial({ ...withRatio(1.4, 600), sizeMm: 4, minSizeMm: 6 }).ok).toBe(false);
  });
});

describe('materialClassification — uric acid versus everything else', () => {
  it('calls a uric acid stone uric acid', () => {
    const result = classifyMaterial({ ...withRatio(1.1, 450), sizeMm: 6 });
    expect(result.material).toBe('uricAcid');
    expect(result.clinicalNote).toMatch(/alcalinização urinária/);
  });

  it('calls a calcium stone non-uric-acid', () => {
    const result = classifyMaterial({ ...withRatio(1.45, 900), sizeMm: 6 });
    expect(result.material).toBe('nonUricAcid');
  });

  // A viewer that prints "calcium oxalate monohydrate" from a ratio is inventing a
  // precision the physics does not have, and a urologist will act on it.
  it('REFUSES to name the mineral, and says why in the note', () => {
    const result = classifyMaterial({ ...withRatio(1.45, 900), sizeMm: 6 });
    expect(result.label).not.toMatch(/oxalato|fosfato/i);
    expect(result.clinicalNote).toMatch(/NÃO separa oxalato de fosfato/);
  });

  it('has no oxalate or phosphate band at all', () => {
    const names = RATIO_BANDS_80_140.map(b => `${b.material} ${b.label}`).join(' ');
    expect(names).not.toMatch(/oxalat|fosfat/i);
  });

  it('separates water, fat and iodine too', () => {
    expect(classifyMaterial(withRatio(1.0, 200)).material).toBe('water');
    expect(classifyMaterial(withRatio(0.95, 200)).material).toBe('fat');
    expect(classifyMaterial(withRatio(1.9, 300)).material).toBe('iodine');
  });
});

describe('materialClassification — out of range', () => {
  it('flags metal instead of classifying it as a very dense stone', () => {
    const result = classifyMaterial(withRatio(1.3, METAL_HU + 500));
    expect(result.material).toBe('metal');
    expect(result.message).toMatch(/decomposição não é válida/);
  });

  // The nearest band is always available and always wrong when the input is out of range,
  // which is what makes it the dangerous default.
  it('refuses a ratio outside the calibrated bands rather than snapping to the nearest', () => {
    const result = classifyMaterial(withRatio(3.5, 600));
    expect(result.ok).toBe(false);
    expect(result.refusal).toBe('outsideBands');
    expect(result.material).toBe('indeterminate');
  });

  it('refuses malformed input', () => {
    expect(classifyMaterial({ huLow: NaN, huHigh: 100 }).refusal).toBe('invalidInput');
  });
});

describe('materialClassification — band sanity', () => {
  it('the shipped bands do not overlap', () => {
    const sorted = [...RATIO_BANDS_80_140].sort((a, b) => a.min - b.min);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].min).toBeGreaterThanOrEqual(sorted[i - 1].max);
    }
  });

  // So a site adding its own bands finds out immediately, instead of finding out from a
  // classifier that flips between them voxel by voxel.
  it('reports two bands that are too close to tell apart', () => {
    const a = { material: 'uricAcid' as const, min: 1.06, max: 1.15, label: 'A' };
    const b = { material: 'nonUricAcid' as const, min: 1.16, max: 1.4, label: 'B' };
    const separation = bandsAreSeparable(a, b, 0.05);
    expect(separation.separated).toBe(false);
    expect(separation.message).toMatch(/não são separáveis/);
  });

  it('accepts bands with a real gap between them', () => {
    const a = { material: 'uricAcid' as const, min: 1.0, max: 1.1, label: 'A' };
    const b = { material: 'nonUricAcid' as const, min: 1.3, max: 1.6, label: 'B' };
    expect(bandsAreSeparable(a, b, 0.05).separated).toBe(true);
  });
});

describe('materialClassification — effective Z', () => {
  it('is water at the water ratio and much higher for iodine', () => {
    expect(effectiveZ(1)).toBeCloseTo(7.4, 6);
    expect(effectiveZ(2)).toBeGreaterThan(40);
  });

  it('rises monotonically with the ratio', () => {
    expect(effectiveZ(1.4)).toBeGreaterThan(effectiveZ(1.1));
  });

  it('is NaN for a nonsense ratio rather than a number', () => {
    expect(Number.isNaN(effectiveZ(0))).toBe(true);
    expect(Number.isNaN(effectiveZ(NaN))).toBe(true);
  });
});

describe('materialClassification — the readout', () => {
  it('carries the class, the ratio, Zeff, the attenuation and the note', () => {
    const text = describeClassification(classifyMaterial({ ...withRatio(1.1, 450), sizeMm: 6 }));
    expect(text).toMatch(/^Ácido úrico · razão 1\.10 · Zeff ~\d+ · 450 HU\./);
    expect(text).toMatch(/alcalinização urinária/);
  });

  it('shows the refusal reason instead of a class', () => {
    expect(describeClassification(classifyMaterial(withRatio(1.4, 30)))).toMatch(
      /abaixo de 100 HU/
    );
  });

  it('survives a nullish result', () => {
    expect(describeClassification(undefined as never)).toBe('');
  });
});
