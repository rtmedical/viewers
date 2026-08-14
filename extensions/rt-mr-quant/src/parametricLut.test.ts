import {
  buildLut,
  lutColor,
  lutCssColor,
  lutCssGradient,
  parametricColormapPresets,
  PARAMETRIC_LUT_NAMES,
  toColormapPreset,
} from './parametricLut';

describe('lutColor', () => {
  it('returns channels in 0-255 for every ramp', () => {
    for (const name of PARAMETRIC_LUT_NAMES) {
      for (const t of [0, 0.13, 0.5, 0.87, 1]) {
        const rgb = lutColor(name, t);
        expect(rgb).toHaveLength(3);
        for (const channel of rgb) {
          expect(Number.isInteger(channel)).toBe(true);
          expect(channel).toBeGreaterThanOrEqual(0);
          expect(channel).toBeLessThanOrEqual(255);
        }
      }
    }
  });

  it('clamps t outside [0,1] to the ends', () => {
    for (const name of PARAMETRIC_LUT_NAMES) {
      expect(lutColor(name, -5)).toEqual(lutColor(name, 0));
      expect(lutColor(name, 5)).toEqual(lutColor(name, 1));
    }
  });

  it('never produces NaN channels for a non-finite t', () => {
    for (const name of PARAMETRIC_LUT_NAMES) {
      for (const bad of [NaN, Infinity, -Infinity, undefined as never]) {
        const rgb = lutColor(name, bad);
        expect(rgb.every(Number.isFinite)).toBe(true);
      }
    }
  });

  it('is monotonic in luminance for grayscale', () => {
    let previous = -1;
    for (let i = 0; i <= 10; i++) {
      const [v] = lutColor('grayscale', i / 10);
      expect(v).toBeGreaterThan(previous);
      previous = v;
    }
  });

  it('starts dark and ends bright for the perceptual ramps', () => {
    // The defining property of the family: luminance rises across the ramp,
    // which is what makes them readable as quantities.
    for (const name of ['viridis', 'magma', 'inferno', 'plasma'] as const) {
      const low = luminance(lutColor(name, 0));
      const high = luminance(lutColor(name, 1));
      expect(high).toBeGreaterThan(low);
    }
  });

  it('rises in luminance overall, sampled across the ramp', () => {
    for (const name of ['viridis', 'magma', 'inferno', 'plasma'] as const) {
      const samples = Array.from({ length: 11 }, (_u, i) => luminance(lutColor(name, i / 10)));
      // Not strictly monotonic point-to-point in sRGB, but each third must climb.
      expect(samples[5]).toBeGreaterThan(samples[0]);
      expect(samples[10]).toBeGreaterThan(samples[5]);
    }
  });

  it('interpolates between control points instead of stepping', () => {
    const a = lutColor('viridis', 0.0);
    const mid = lutColor('viridis', 0.05);
    const b = lutColor('viridis', 0.1);
    expect(mid).not.toEqual(a);
    expect(mid).not.toEqual(b);
  });

  it('falls back to viridis for an unknown ramp name', () => {
    expect(lutColor('nope' as never, 0.4)).toEqual(lutColor('viridis', 0.4));
  });
});

function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe('buildLut', () => {
  it('builds the requested number of entries', () => {
    expect(buildLut('viridis', 256)).toHaveLength(256);
    expect(buildLut('magma', 8)).toHaveLength(8);
  });

  it('spans the full ramp', () => {
    const lut = buildLut('inferno', 16);
    expect(lut[0]).toEqual(lutColor('inferno', 0));
    expect(lut[lut.length - 1]).toEqual(lutColor('inferno', 1));
  });

  it('clamps a nonsense step count to a usable minimum', () => {
    expect(buildLut('plasma', 0)).toHaveLength(2);
    expect(buildLut('plasma', -10)).toHaveLength(2);
    expect(buildLut('plasma', 1)).toHaveLength(2);
  });
});

describe('css helpers', () => {
  it('emits an rgb() string', () => {
    expect(lutCssColor('grayscale', 1)).toBe('rgb(255, 255, 255)');
    expect(lutCssColor('grayscale', 0)).toBe('rgb(0, 0, 0)');
  });

  it('emits a linear-gradient with the requested stop count', () => {
    const gradient = lutCssGradient('viridis', 3);
    expect(gradient).toMatch(/^linear-gradient\(to right, /);
    expect(gradient.match(/rgb\(/g)).toHaveLength(3);
    expect(gradient).toContain('0%');
    expect(gradient).toContain('100%');
  });

  it('honours a custom angle', () => {
    expect(lutCssGradient('magma', 2, 'to top')).toMatch(/^linear-gradient\(to top, /);
  });
});

describe('toColormapPreset', () => {
  it('matches the shape the cornerstone colorbar consumes', () => {
    const preset = toColormapPreset('viridis', 4);
    expect(preset.ColorSpace).toBe('RGB');
    expect(preset.Name).toBe('Viridis');
    // Flat [position, r, g, b] quadruples.
    expect(preset.RGBPoints).toHaveLength(4 * 4);
  });

  it('emits positions from 0 to 1 and channels in [0,1]', () => {
    const { RGBPoints } = toColormapPreset('plasma', 8);
    for (let i = 0; i < RGBPoints.length; i += 4) {
      const [position, r, g, b] = RGBPoints.slice(i, i + 4);
      expect(position).toBeGreaterThanOrEqual(0);
      expect(position).toBeLessThanOrEqual(1);
      for (const channel of [r, g, b]) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }
    expect(RGBPoints[0]).toBe(0);
    expect(RGBPoints[RGBPoints.length - 4]).toBe(1);
  });

  it('exposes every ramp as a preset', () => {
    const presets = parametricColormapPresets(4);
    expect(presets).toHaveLength(PARAMETRIC_LUT_NAMES.length);
    expect(presets.map(p => p.Name)).toContain('Grayscale');
  });
});
