import {
  blendWeightAt,
  contributionsAt,
  describeStitch,
  planStitch,
  Station,
  stationExtent,
} from './stitching';

const FRAME = '1.2.840.frame';

/** A station covering [z, z + (slices-1)*spacing]. */
const station = (uid: string, z: number, slices = 100, spacing = 1): Station => ({
  seriesInstanceUid: uid,
  frameOfReferenceUid: FRAME,
  originMm: [0, 0, z],
  sliceSpacingMm: spacing,
  slices,
});

describe('stationExtent', () => {
  it('computes the z span', () => {
    expect(stationExtent(station('a', 100, 51, 2))).toMatchObject({
      startMm: 100,
      endMm: 200,
      slices: 51,
    });
  });

  it('handles a stack that runs in negative z', () => {
    const extent = stationExtent({ ...station('a', 100, 51), sliceSpacingMm: -2 } as never);
    // Negative spacing is not a usable stack description here.
    expect(extent).toBeNull();
  });

  it('rejects unusable geometry', () => {
    expect(stationExtent({ ...station('a', 0), slices: 0 })).toBeNull();
    expect(stationExtent({ ...station('a', 0), sliceSpacingMm: 0 })).toBeNull();
    expect(stationExtent({ ...station('a', 0), seriesInstanceUid: '' })).toBeNull();
    expect(stationExtent(undefined as never)).toBeNull();
  });
});

describe('planStitch — the frame-of-reference check', () => {
  it('refuses stations from different frames of reference', () => {
    // Stitching across frames does not fail loudly -- it produces a composite that
    // looks plausible and is geometrically wrong.
    const plan = planStitch([
      station('a', 0),
      { ...station('b', 80), frameOfReferenceUid: 'other-frame' },
    ]);
    expect(plan.ok).toBe(false);
    expect(plan.errors[0]).toMatch(/FrameOfReferenceUID/);
  });

  it('warns, but proceeds, when no station declares one', () => {
    const plan = planStitch([
      { ...station('a', 0), frameOfReferenceUid: undefined },
      { ...station('b', 80), frameOfReferenceUid: undefined },
    ]);
    expect(plan.ok).toBe(true);
    expect(plan.warnings.join(' ')).toMatch(/assumes their positions share a frame/i);
  });

  it('needs at least two usable stations', () => {
    expect(planStitch([station('a', 0)]).ok).toBe(false);
    expect(planStitch([]).ok).toBe(false);
    expect(planStitch(undefined as never).ok).toBe(false);
  });

  it('skips a station with no geometry, and says so', () => {
    const plan = planStitch([
      station('a', 0),
      station('b', 80),
      { ...station('c', 160), slices: 0 },
    ]);
    expect(plan.ordered).toHaveLength(2);
    expect(plan.warnings.join(' ')).toMatch(/skipped/i);
  });
});

describe('planStitch — ordering, overlaps and gaps', () => {
  it('orders stations along z regardless of input order', () => {
    const plan = planStitch([station('c', 160), station('a', 0), station('b', 80)]);
    expect(plan.ordered.map(e => e.seriesInstanceUid)).toEqual(['a', 'b', 'c']);
  });

  it('finds the overlap between consecutive stations', () => {
    // a: 0..99, b: 80..179 -> 19 mm of overlap.
    const plan = planStitch([station('a', 0), station('b', 80)]);
    expect(plan.overlaps).toHaveLength(1);
    expect(plan.overlaps[0]).toMatchObject({ lowerUid: 'a', upperUid: 'b', startMm: 80, endMm: 99 });
    expect(plan.overlaps[0].lengthMm).toBe(19);
    expect(plan.gaps).toEqual([]);
  });

  it('reports a gap and warns that a MIP will look occluded', () => {
    const plan = planStitch([station('a', 0), station('b', 150)]);
    expect(plan.overlaps).toEqual([]);
    expect(plan.gaps[0]).toMatchObject({ afterUid: 'a', beforeUid: 'b' });
    expect(plan.gaps[0].lengthMm).toBeCloseTo(51, 6);
    expect(plan.warnings.join(' ')).toMatch(/occlusion/i);
  });

  it('resamples at the FINEST spacing, not the coarsest', () => {
    // Downsampling to the coarse station throws away detail that was acquired, and a
    // whole-body run is usually finest where the vessels are smallest.
    const plan = planStitch([station('a', 0, 100, 2), station('b', 150, 100, 0.5)]);
    expect(plan.outputSpacingMm).toBe(0.5);
  });

  it('measures the total coverage and slice count', () => {
    const plan = planStitch([station('a', 0, 101, 1), station('b', 80, 101, 1)]);
    // 0..180 inclusive at 1 mm.
    expect(plan.totalLengthMm).toBe(180);
    expect(plan.outputSlices).toBe(181);
  });

  it('summarises', () => {
    const plan = planStitch([station('a', 0), station('b', 80)]);
    expect(describeStitch(plan)).toMatch(/2 stations/);
    const broken = planStitch([station('a', 0), { ...station('b', 80), frameOfReferenceUid: 'x' }]);
    expect(describeStitch(broken)).toMatch(/FrameOfReferenceUID/);
  });
});

describe('blendWeightAt', () => {
  const plan = () => planStitch([station('a', 0), station('b', 80)]);
  const overlap = () => plan().overlaps[0];

  it('ramps linearly across the overlap', () => {
    // Linear rather than smoothstep: a smooth curve keeps the mix near 50/50 across
    // most of the overlap, which doubles the noise where the ramp is flattest.
    const o = overlap();
    expect(blendWeightAt(o, 80)).toBe(0);
    expect(blendWeightAt(o, 99)).toBe(1);
    expect(blendWeightAt(o, 89.5)).toBeCloseTo(0.5, 6);
  });

  it('saturates outside the overlap so callers need no special case', () => {
    const o = overlap();
    expect(blendWeightAt(o, -100)).toBe(0);
    expect(blendWeightAt(o, 1000)).toBe(1);
  });

  it('treats a degenerate overlap as a hard cut', () => {
    const degenerate = { lowerUid: 'a', upperUid: 'b', startMm: 10, endMm: 10, lengthMm: 0 };
    expect(blendWeightAt(degenerate as never, 9)).toBe(0);
    expect(blendWeightAt(degenerate as never, 10)).toBe(1);
  });

  it('handles a missing overlap or position', () => {
    expect(blendWeightAt(null, 10)).toBe(0);
    expect(blendWeightAt(overlap(), NaN)).toBe(0);
  });
});

describe('contributionsAt', () => {
  const plan = () => planStitch([station('a', 0), station('b', 80)]);

  it('gives one station full weight outside the overlap', () => {
    expect(contributionsAt(plan(), 40)).toEqual([{ seriesInstanceUid: 'a', weight: 1 }]);
    expect(contributionsAt(plan(), 150)).toEqual([{ seriesInstanceUid: 'b', weight: 1 }]);
  });

  it('splits the weight inside the overlap, summing to 1', () => {
    const contributions = contributionsAt(plan(), 89.5);
    expect(contributions).toHaveLength(2);
    expect(contributions[0].weight + contributions[1].weight).toBeCloseTo(1, 9);
    expect(contributions[0].weight).toBeCloseTo(0.5, 6);
  });

  it('hands over completely by the end of the overlap', () => {
    expect(contributionsAt(plan(), 99)).toEqual([
      { seriesInstanceUid: 'a', weight: 0 },
      { seriesInstanceUid: 'b', weight: 1 },
    ]);
  });

  it('returns nothing inside a gap, which is the honest answer', () => {
    const gapped = planStitch([station('a', 0), station('b', 150)]);
    expect(contributionsAt(gapped, 120)).toEqual([]);
  });

  it('returns nothing outside the composite', () => {
    expect(contributionsAt(plan(), -50)).toEqual([]);
    expect(contributionsAt(plan(), 9999)).toEqual([]);
  });

  it('handles a broken plan', () => {
    expect(contributionsAt(planStitch([]), 0)).toEqual([]);
    expect(contributionsAt(undefined as never, 0)).toEqual([]);
  });
});
