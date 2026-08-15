import {
  applyPreset,
  clampThresholdHu,
  colorToHex,
  defaultSsdSettings,
  describeSsd,
  parseColor,
  presetForThreshold,
  resolvePreset,
  setColor,
  setOpacity,
  setThresholdHu,
  SSD_PRESETS,
  SSD_THRESHOLD_HU_MAX,
  SSD_THRESHOLD_HU_MIN,
} from './ssdPresets';
import {
  describeBudget,
  estimateTriangles,
  estimateVoxelCount,
  formatCount,
  planSsdExtraction,
  recommendSampleRate,
  SSD_MAX_SAMPLE_RATE,
  SSD_VOXEL_BUDGET,
} from './ssdBudget';

describe('SSD presets', () => {
  it('ships the conventional CT thresholds', () => {
    expect(resolvePreset('corticalBone').thresholdHu).toBe(300);
    expect(resolvePreset('trabecularBone').thresholdHu).toBe(100);
    expect(resolvePreset('skin').thresholdHu).toBe(-300);
    expect(resolvePreset('lung').thresholdHu).toBe(-700);
  });

  it('gives every preset a rationale, a colour and a sane opacity', () => {
    for (const preset of SSD_PRESETS) {
      expect(preset.rationale.length).toBeGreaterThan(10);
      expect(preset.color).toHaveLength(3);
      expect(preset.color.every(c => c >= 0 && c <= 1)).toBe(true);
      expect(preset.opacity).toBeGreaterThan(0);
      expect(preset.opacity).toBeLessThanOrEqual(1);
    }
  });

  it('falls back to cortical bone for an unknown id', () => {
    expect(resolvePreset('nope').id).toBe('corticalBone');
    expect(resolvePreset(undefined).id).toBe('corticalBone');
  });

  it('clamps the threshold to the usable Hounsfield range', () => {
    expect(clampThresholdHu(-99999)).toBe(SSD_THRESHOLD_HU_MIN);
    expect(clampThresholdHu(99999)).toBe(SSD_THRESHOLD_HU_MAX);
    expect(clampThresholdHu(250.6)).toBe(251);
    expect(clampThresholdHu(NaN)).toBe(300);
    expect(clampThresholdHu('bone')).toBe(300);
  });
});

describe('SSD settings transitions', () => {
  it('applies a preset as a unit', () => {
    const settings = applyPreset('skin');
    expect(settings).toMatchObject({ presetId: 'skin', thresholdHu: -300 });
    expect(settings.color).toEqual(resolvePreset('skin').color);
  });

  it('does not alias the preset colour array', () => {
    // Mutating the settings must not rewrite the shared preset table.
    const settings = applyPreset('skin');
    settings.color[0] = 0;
    expect(resolvePreset('skin').color[0]).not.toBe(0);
  });

  it('switches to custom when the threshold leaves a preset', () => {
    const settings = setThresholdHu(defaultSsdSettings(), 275);
    expect(settings.presetId).toBe('custom');
    expect(settings.thresholdHu).toBe(275);
  });

  it('snaps back to a preset when the slider lands on its value', () => {
    // Without this the picker would keep saying "custom" at exactly 300 HU.
    const custom = setThresholdHu(defaultSsdSettings(), 275);
    expect(setThresholdHu(custom, 300).presetId).toBe('corticalBone');
    expect(presetForThreshold(-700)).toBe('lung');
    expect(presetForThreshold(-701)).toBe('custom');
  });

  it('clamps opacity and ignores nonsense', () => {
    const base = defaultSsdSettings();
    expect(setOpacity(base, 0.5).opacity).toBe(0.5);
    expect(setOpacity(base, 5).opacity).toBe(1);
    expect(setOpacity(base, -1).opacity).toBe(0);
    expect(setOpacity(base, NaN)).toBe(base);
  });
});

describe('colour handling', () => {
  it('parses hex', () => {
    expect(parseColor('#ff8000')).toEqual([1, 128 / 255, 0]);
    expect(parseColor('ff8000')).toEqual([1, 128 / 255, 0]);
  });

  it('parses 0-1 and 0-255 triples', () => {
    expect(parseColor([1, 0.5, 0])).toEqual([1, 0.5, 0]);
    expect(parseColor([255, 128, 0])).toEqual([1, 128 / 255, 0]);
  });

  it('rejects anything that is not a colour', () => {
    // A bad value from a config file must not silently turn the surface black.
    for (const bad of ['', '#fff', 'red', '#gggggg', [1, 2], [1, -1, 0], null, 42]) {
      expect(parseColor(bad as never)).toBeNull();
    }
  });

  it('leaves the settings untouched for a bad colour', () => {
    const base = defaultSsdSettings();
    expect(setColor(base, 'not a colour')).toBe(base);
    expect(setColor(base, '#00ff00').color).toEqual([0, 1, 0]);
  });

  it('round-trips through hex', () => {
    expect(colorToHex([1, 0, 0])).toBe('#ff0000');
    expect(colorToHex(parseColor('#3a7bd5')!)).toBe('#3a7bd5');
  });

  it('clamps out-of-range channels when writing hex', () => {
    expect(colorToHex([2, -1, NaN] as never)).toBe('#ff0000');
  });
});

describe('describeSsd', () => {
  it('names the preset and the threshold', () => {
    expect(describeSsd(defaultSsdSettings())).toBe('SSD Cortical bone · 300 HU');
  });

  it('says Custom off-preset', () => {
    expect(describeSsd(setThresholdHu(defaultSsdSettings(), 275))).toBe('SSD Custom · 275 HU');
  });
});

describe('estimateVoxelCount / recommendSampleRate', () => {
  it('multiplies the three dimensions', () => {
    expect(estimateVoxelCount([512, 512, 400])).toBe(104_857_600);
  });

  it('returns 0 for unusable dimensions', () => {
    for (const dims of [undefined, [], [512, 512], [512, 512, 0], [512, NaN, 10]]) {
      expect(estimateVoxelCount(dims as never)).toBe(0);
    }
  });

  it('leaves a volume within budget at full resolution', () => {
    expect(recommendSampleRate(1_000_000)).toBe(1);
    expect(recommendSampleRate(SSD_VOXEL_BUDGET)).toBe(1);
  });

  it('strides a routine CT down until it fits', () => {
    // 512 x 512 x 400 is 105 M voxels — unthrottled that locks the tab.
    const rate = recommendSampleRate(104_857_600);
    expect(rate).toBeGreaterThan(1);
    expect(104_857_600 / rate ** 3).toBeLessThanOrEqual(SSD_VOXEL_BUDGET);
  });

  it('never strides past the cap', () => {
    // Past 4 the surface is blocky enough to mislead.
    expect(recommendSampleRate(1e12)).toBe(SSD_MAX_SAMPLE_RATE);
  });

  it('handles nonsense', () => {
    expect(recommendSampleRate(0)).toBe(1);
    expect(recommendSampleRate(NaN)).toBe(1);
    expect(recommendSampleRate(-5)).toBe(1);
  });
});

describe('estimateTriangles', () => {
  it('scales with the surface, not the volume', () => {
    // ~N^(2/3): eight times the voxels is four times the triangles.
    const small = estimateTriangles(1_000_000);
    const big = estimateTriangles(8_000_000);
    expect(big / small).toBeCloseTo(4, 1);
  });

  it('is zero for an empty volume', () => {
    expect(estimateTriangles(0)).toBe(0);
    expect(estimateTriangles(NaN)).toBe(0);
  });
});

describe('planSsdExtraction', () => {
  const ct = (dimensions: number[], extra = {}) => ({ dimensions, modality: 'CT', ...extra });

  it('passes a small CT at full resolution with no complaints', () => {
    const plan = planSsdExtraction(ct([256, 256, 100]));
    expect(plan.errors).toEqual([]);
    expect(plan.sampleRate).toBe(1);
    expect(plan.downsampled).toBe(false);
  });

  it('downsamples a routine CT and says so', () => {
    const plan = planSsdExtraction(ct([512, 512, 400]));
    expect(plan.downsampled).toBe(true);
    expect(plan.effectiveVoxelCount).toBeLessThanOrEqual(SSD_VOXEL_BUDGET);
    expect(plan.warnings.join(' ')).toMatch(/Sampling every/);
  });

  it('blocks a volume with no usable dimensions', () => {
    expect(planSsdExtraction({} as never).errors).toHaveLength(1);
    expect(planSsdExtraction(ct([512, 512, 0])).errors[0]).toMatch(/no usable dimensions/i);
  });

  it('blocks a volume too thin to hold a cell', () => {
    // Marching cubes needs two samples on every axis.
    expect(planSsdExtraction(ct([512, 512, 1])).errors[0]).toMatch(/too thin/i);
  });

  it('warns that a Hounsfield threshold is meaningless off CT', () => {
    // Not a worse surface — a meaningless one.
    const plan = planSsdExtraction({ dimensions: [256, 256, 100], modality: 'MR' });
    expect(plan.errors).toEqual([]);
    expect(plan.warnings.join(' ')).toMatch(/only defined for CT/i);
  });

  it('does not warn about modality when it is unknown', () => {
    const plan = planSsdExtraction({ dimensions: [256, 256, 100] });
    expect(plan.warnings.join(' ')).not.toMatch(/only defined for CT/i);
  });

  it('warns about anisotropic slices', () => {
    const plan = planSsdExtraction(ct([256, 256, 60], { spacing: [0.8, 0.8, 5] }));
    expect(plan.warnings.join(' ')).toMatch(/stepped/i);
  });

  it('does not warn about near-isotropic spacing', () => {
    const plan = planSsdExtraction(ct([256, 256, 200], { spacing: [1, 1, 1.5] }));
    expect(plan.warnings.join(' ')).not.toMatch(/stepped/i);
  });

  it('warns when the threshold had to be clamped', () => {
    const plan = planSsdExtraction(ct([256, 256, 100]), 99999);
    expect(plan.warnings.join(' ')).toMatch(/clamped/i);
  });

  it('does not warn for a threshold already in range', () => {
    const plan = planSsdExtraction(ct([256, 256, 100]), 300);
    expect(plan.warnings.join(' ')).not.toMatch(/clamped/i);
  });
});

describe('formatCount / describeBudget', () => {
  it('formats compactly', () => {
    expect(formatCount(105_000_000)).toBe('105 M');
    expect(formatCount(2_500)).toBe('2.5 k');
    expect(formatCount(42)).toBe('42');
    expect(formatCount(NaN)).toBe('0');
  });

  it('leads with the blocking problem when there is one', () => {
    expect(describeBudget(planSsdExtraction({} as never))).toMatch(/no usable dimensions/i);
  });

  it('summarises a healthy plan', () => {
    const text = describeBudget(planSsdExtraction({ dimensions: [256, 256, 100], modality: 'CT' }));
    expect(text).toMatch(/voxels/);
    expect(text).toMatch(/triangles/);
    expect(text).not.toMatch(/sampled/);
  });

  it('mentions the stride when downsampled', () => {
    const text = describeBudget(planSsdExtraction({ dimensions: [512, 512, 400], modality: 'CT' }));
    expect(text).toMatch(/sampled 1:/);
  });
});
