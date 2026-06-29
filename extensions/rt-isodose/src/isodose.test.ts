import {
  colormapColor,
  buildColormap,
  mapDoseToColor,
  rgbToHex,
  buildIsodoseLevels,
  DEFAULT_ISODOSE_PERCENTS,
} from './isodose';

describe('colormapColor', () => {
  it('grayscale ramps black → white', () => {
    expect(colormapColor('grayscale', 0)).toEqual([0, 0, 0]);
    expect(colormapColor('grayscale', 1)).toEqual([255, 255, 255]);
    expect(colormapColor('grayscale', 0.5)).toEqual([128, 128, 128]);
  });

  it('hot ends white, starts black', () => {
    expect(colormapColor('hot', 0)).toEqual([0, 0, 0]);
    expect(colormapColor('hot', 1)).toEqual([255, 255, 255]);
  });

  it('jet runs dark-blue → dark-red', () => {
    expect(colormapColor('jet', 0)).toEqual([0, 0, 128]);
    expect(colormapColor('jet', 1)).toEqual([128, 0, 0]);
  });

  it('clamps t outside [0,1]', () => {
    expect(colormapColor('grayscale', -1)).toEqual([0, 0, 0]);
    expect(colormapColor('grayscale', 2)).toEqual([255, 255, 255]);
  });
});

describe('buildColormap / mapDoseToColor', () => {
  it('builds an N-entry LUT spanning the range', () => {
    const lut = buildColormap('grayscale', 256);
    expect(lut).toHaveLength(256);
    expect(lut[0]).toEqual([0, 0, 0]);
    expect(lut[255]).toEqual([255, 255, 255]);
  });

  it('maps an absolute dose through [min,max]', () => {
    expect(mapDoseToColor(30, 0, 60, 'grayscale')).toEqual([128, 128, 128]);
    expect(mapDoseToColor(0, 0, 60, 'grayscale')).toEqual([0, 0, 0]);
  });
});

describe('rgbToHex', () => {
  it('formats hex', () => {
    expect(rgbToHex([255, 0, 0])).toBe('#ff0000');
    expect(rgbToHex([0, 128, 255])).toBe('#0080ff');
  });
});

describe('buildIsodoseLevels', () => {
  it('computes absolute doses from a prescription, sorted high → low', () => {
    const levels = buildIsodoseLevels(60, [50, 100]);
    expect(levels.map(l => l.percent)).toEqual([100, 50]);
    expect(levels[0]).toMatchObject({ percent: 100, doseGy: 60 });
    expect(levels[1]).toMatchObject({ percent: 50, doseGy: 30 });
    expect(levels[0].hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('omits doseGy when no prescription is given', () => {
    const levels = buildIsodoseLevels(undefined, [100, 50]);
    expect(levels[0].doseGy).toBeUndefined();
    expect(levels[0].color).toHaveLength(3);
  });

  it('uses the conventional default percent set', () => {
    const levels = buildIsodoseLevels(50);
    expect(levels.map(l => l.percent)).toEqual([...DEFAULT_ISODOSE_PERCENTS].sort((a, b) => b - a));
    // 107% of 50 Gy = 53.5
    expect(levels[0]).toMatchObject({ percent: 107, doseGy: 53.5 });
  });
});
