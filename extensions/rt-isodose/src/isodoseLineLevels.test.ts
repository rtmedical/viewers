import { resolveIsodoseLineLevels } from './isodoseLineLevels';

describe('resolveIsodoseLineLevels', () => {
  it('uses DoseGridScaling + Rx for absolute Gy levels in raw units', () => {
    // raw max 2_400_000 with scaling 2e-5 → max ≈ 48 Gy; Rx 48 Gy
    const spec = resolveIsodoseLineLevels(2_400_000, 2e-5, 48);
    expect(spec.mode).toBe('absolute');
    expect(spec.gyPerRaw).toBe(2e-5);
    const p100 = spec.levels.find(l => l.percent === 100);
    expect(p100).toBeDefined();
    expect(p100!.doseGy).toBeCloseTo(48, 6);
    expect(p100!.raw).toBeCloseTo(48 / 2e-5, 3); // 2.4M raw
    const p50 = spec.levels.find(l => l.percent === 50);
    expect(p50!.raw).toBeCloseTo(24 / 2e-5, 3);
    // every level carries a color
    for (const l of spec.levels) {
      expect(l.hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('treats small-valued volumes as already in Gy (gyPerRaw = 1)', () => {
    const spec = resolveIsodoseLineLevels(52.3, undefined, 48);
    expect(spec.mode).toBe('absolute');
    expect(spec.gyPerRaw).toBe(1);
    const p95 = spec.levels.find(l => l.percent === 95);
    expect(p95!.raw).toBeCloseTo(45.6, 6);
  });

  it('falls back to percent-of-max when no Rx is known', () => {
    const spec = resolveIsodoseLineLevels(2_400_000, 2e-5, undefined);
    expect(spec.mode).toBe('relative');
    // >100% levels are dropped in relative mode (nothing exceeds the max)
    expect(spec.levels.every(l => l.percent <= 100)).toBe(true);
    const p50 = spec.levels.find(l => l.percent === 50);
    expect(p50!.raw).toBeCloseTo(1_200_000, 3);
    expect(p50!.doseGy).toBeCloseTo(24, 2); // scaling known → Gy label still shown
  });

  it('falls back to percent-of-max with no Gy labels when uncalibrated', () => {
    const spec = resolveIsodoseLineLevels(3_000_000, undefined, 48);
    expect(spec.mode).toBe('relative'); // raw too large to be Gy, no scaling
    expect(spec.gyPerRaw).toBeUndefined();
    expect(spec.levels.every(l => l.doseGy === undefined)).toBe(true);
    const p80 = spec.levels.find(l => l.percent === 80);
    expect(p80!.raw).toBeCloseTo(2_400_000, 3);
  });

  it('honours custom percents', () => {
    const spec = resolveIsodoseLineLevels(100, 1, 50, [110, 90, 20]);
    expect(spec.levels.map(l => l.percent)).toEqual([110, 90, 20]);
    expect(spec.levels[0].raw).toBeCloseTo(55, 6);
  });
});
