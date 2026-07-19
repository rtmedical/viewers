import { sampleLineProfile, profileStats, profileToCsv, type Vec3 } from './lineProfile';

describe('sampleLineProfile', () => {
  it('samples evenly along an axis-aligned line, endpoints inclusive', () => {
    // sampler returns the x world coordinate as the "value"
    const sampler = (w: Vec3) => w[0];
    const pts = sampleLineProfile(sampler, [0, 0, 0], [10, 0, 0], { stepMm: 1 });
    expect(pts).toHaveLength(11); // 10 segments → 11 points
    expect(pts[0]).toEqual({ distanceMm: 0, value: 0 });
    expect(pts[10]).toEqual({ distanceMm: 10, value: 10 });
    expect(pts[5]).toEqual({ distanceMm: 5, value: 5 });
  });

  it('computes euclidean distance for an oblique line', () => {
    const pts = sampleLineProfile(() => 42, [0, 0, 0], [3, 4, 0], { stepMm: 1 });
    // length = 5mm; last point distance == 5
    expect(pts[pts.length - 1].distanceMm).toBeCloseTo(5, 6);
    expect(pts.every(p => p.value === 42)).toBe(true);
  });

  it('skips samples where the sampler returns null/NaN (outside volume)', () => {
    const sampler = (w: Vec3) => (w[0] < 5 ? null : 100);
    const pts = sampleLineProfile(sampler, [0, 0, 0], [10, 0, 0], { stepMm: 1 });
    expect(pts.every(p => p.value === 100)).toBe(true);
    expect(pts.every(p => p.distanceMm >= 5)).toBe(true);
  });

  it('returns [] for a degenerate zero-length line', () => {
    expect(sampleLineProfile(() => 1, [1, 2, 3], [1, 2, 3])).toEqual([]);
  });

  it('caps the number of samples via maxSamples', () => {
    const pts = sampleLineProfile(() => 1, [0, 0, 0], [1000, 0, 0], {
      stepMm: 0.1,
      maxSamples: 50,
    });
    expect(pts.length).toBeLessThanOrEqual(50);
  });
});

describe('profileStats', () => {
  it('reports min/max/mean/length/count', () => {
    const pts = sampleLineProfile((w: Vec3) => w[0] * 10, [0, 0, 0], [4, 0, 0], { stepMm: 1 });
    const s = profileStats(pts)!;
    expect(s.count).toBe(5);
    expect(s.min).toBe(0);
    expect(s.max).toBe(40);
    expect(s.mean).toBe(20);
    expect(s.lengthMm).toBeCloseTo(4, 6);
  });

  it('returns null for empty input', () => {
    expect(profileStats([])).toBeNull();
  });
});

describe('profileToCsv', () => {
  it('emits a distance_mm,value header + rows', () => {
    const csv = profileToCsv([
      { distanceMm: 0, value: -1000 },
      { distanceMm: 1.5, value: 40 },
    ]);
    expect(csv.split('\n')).toEqual(['distance_mm,value', '0.000,-1000', '1.500,40']);
  });
});
