import {
  parseRegistrationTranslation,
  translationMagnitude,
  buildFusionTimeline,
  buildFusionChart,
  FUSION_SERIES,
} from './fusionTimeline';

describe('parseRegistrationTranslation', () => {
  it('reads translation from a row-major 4×4 matrix (indices 3,7,11)', () => {
    // identity rotation + translation (3,4,12)
    const m = [1, 0, 0, 3, 0, 1, 0, 4, 0, 0, 1, 12, 0, 0, 0, 1];
    expect(parseRegistrationTranslation(m)).toEqual({ tx: 3, ty: 4, tz: 12 });
  });
  it('is defensive about short/invalid matrices', () => {
    expect(parseRegistrationTranslation([])).toEqual({ tx: 0, ty: 0, tz: 0 });
    expect(parseRegistrationTranslation(undefined as any)).toEqual({ tx: 0, ty: 0, tz: 0 });
  });
});

describe('translationMagnitude', () => {
  it('is the euclidean norm', () => {
    expect(translationMagnitude({ tx: 3, ty: 4, tz: 12 })).toBe(13);
  });
});

describe('buildFusionTimeline', () => {
  it('sorts by label (numeric-aware), computes magnitude + summary', () => {
    const tl = buildFusionTimeline([
      { label: 'fx10', tx: 0, ty: 0, tz: 0 },
      { label: 'fx2', tx: 3, ty: 4, tz: 0 }, // mag 5
      { label: 'fx1', tx: 0, ty: 0, tz: 1 }, // mag 1
    ]);
    expect(tl.points.map(p => p.label)).toEqual(['fx1', 'fx2', 'fx10']);
    expect(tl.points[1].magnitudeMm).toBe(5);
    expect(tl.summary).toEqual({ count: 3, maxMagnitudeMm: 5, meanMagnitudeMm: 2 });
  });

  it('handles an empty set', () => {
    const tl = buildFusionTimeline([]);
    expect(tl.summary).toEqual({ count: 0, maxMagnitudeMm: undefined, meanMagnitudeMm: undefined });
  });
});

describe('buildFusionChart', () => {
  it('produces a polyline per series (X/Y/Z/|d|)', () => {
    const tl = buildFusionTimeline([
      { label: '1', tx: 1, ty: -2, tz: 3 },
      { label: '2', tx: 2, ty: -1, tz: 0 },
    ]);
    const chart = buildFusionChart(tl);
    expect(chart.series).toHaveLength(FUSION_SERIES.length);
    expect(chart.series[0].polyline.split(' ')).toHaveLength(2);
    expect(chart.minMm).toBeLessThanOrEqual(-2);
    expect(chart.maxMm).toBeGreaterThanOrEqual(3);
  });
});
