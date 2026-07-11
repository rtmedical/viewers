import { doseToBandLabelmap, isodoseLevelsGy } from './doseBands';

describe('doseToBandLabelmap', () => {
  it('assigns each voxel to the highest level it reaches', () => {
    // levels sorted -> [10, 20, 30]
    const levels = [30, 10, 20];
    const scalar = [0, 5, 10, 15, 25, 35];
    const bands = doseToBandLabelmap(scalar, levels);
    expect(Array.from(bands)).toEqual([0, 0, 1, 1, 2, 3]);
  });

  it('treats <=0, NaN and negatives as band 0 (no dose)', () => {
    const bands = doseToBandLabelmap([0, -5, NaN, 12], [10]);
    expect(Array.from(bands)).toEqual([0, 0, 0, 1]);
  });

  it('returns all-zero when no levels are given', () => {
    const bands = doseToBandLabelmap([5, 50, 500], []);
    expect(Array.from(bands)).toEqual([0, 0, 0]);
  });

  it('handles boundary equality (dose exactly on a threshold counts)', () => {
    const bands = doseToBandLabelmap([10, 20, 30], [10, 20, 30]);
    expect(Array.from(bands)).toEqual([1, 2, 3]);
  });

  it('produces a Uint8Array of the same length', () => {
    const bands = doseToBandLabelmap(new Float32Array([1, 2, 3, 4]), [2]);
    expect(bands).toBeInstanceOf(Uint8Array);
    expect(bands.length).toBe(4);
  });
});

describe('isodoseLevelsGy', () => {
  it('converts percents of the prescription to sorted Gy thresholds', () => {
    // 50 Gy Rx, percents 95/100/107 -> 47.5 / 50 / 53.5, sorted ascending.
    expect(isodoseLevelsGy(50, [100, 107, 95])).toEqual([47.5, 50, 53.5]);
  });

  it('returns [] for a non-positive prescription', () => {
    expect(isodoseLevelsGy(0, [100])).toEqual([]);
    expect(isodoseLevelsGy(-10, [100])).toEqual([]);
  });

  it('round-trips with doseToBandLabelmap', () => {
    const levels = isodoseLevelsGy(48, [50, 95, 100]); // [24, 45.6, 48]
    const bands = doseToBandLabelmap([10, 30, 46, 50], levels);
    expect(Array.from(bands)).toEqual([0, 1, 2, 3]);
  });
});
