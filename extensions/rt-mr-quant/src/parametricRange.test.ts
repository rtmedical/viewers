import { lutColor } from './parametricLut';
import {
  buildLegendTicks,
  formatParametricValue,
  inferMapKind,
  mapValueToRgba,
  normalizeRange,
  normalizeValue,
  PARAMETRIC_MAP_DESCRIPTORS,
  rangeToWindow,
  windowToRange,
} from './parametricRange';

describe('inferMapKind', () => {
  it.each([
    ['ADC map ax', 'ADC'],
    ['Perfusion CBV', 'CBV'],
    ['perfusion_cbf_map', 'CBF'],
    ['MTT', 'MTT'],
    ['TTP colour', 'TTP'],
  ])('reads %s as %s', (description, expected) => {
    expect(inferMapKind(description)).toBe(expected);
  });

  it('does not match a substring inside a longer token', () => {
    expect(inferMapKind('ADCX phantom')).toBe('generic');
    expect(inferMapKind('MTTL')).toBe('generic');
  });

  it('falls back to generic', () => {
    expect(inferMapKind('AX T2 TSE')).toBe('generic');
    expect(inferMapKind(undefined)).toBe('generic');
    expect(inferMapKind('')).toBe('generic');
  });
});

describe('normalizeRange', () => {
  it('passes an ordered range through', () => {
    expect(normalizeRange({ min: 0, max: 3000 })).toEqual({ min: 0, max: 3000 });
  });

  it('swaps an inverted range', () => {
    expect(normalizeRange({ min: 80, max: 10 })).toEqual({ min: 10, max: 80 });
  });

  it('widens a zero-width range instead of dividing by zero later', () => {
    expect(normalizeRange({ min: 5, max: 5 })).toEqual({ min: 5, max: 6 });
  });

  it('substitutes defaults for non-finite bounds', () => {
    expect(normalizeRange({ min: NaN, max: NaN })).toEqual({ min: 0, max: 1 });
  });
});

describe('normalizeValue', () => {
  const range = { min: 0, max: 3000 };

  it('maps the ends to 0 and 1', () => {
    expect(normalizeValue(0, range)).toBe(0);
    expect(normalizeValue(3000, range)).toBe(1);
  });

  it('maps the midpoint to 0.5', () => {
    expect(normalizeValue(1500, range)).toBeCloseTo(0.5, 10);
  });

  it('clamps outside the range', () => {
    expect(normalizeValue(-500, range)).toBe(0);
    expect(normalizeValue(9999, range)).toBe(1);
  });

  it('returns NaN for a non-finite value so callers can treat it as no-data', () => {
    expect(normalizeValue(NaN, range)).toBeNaN();
    expect(normalizeValue(Infinity, range)).toBeNaN();
  });

  it('survives a zero-width range', () => {
    expect(Number.isFinite(normalizeValue(5, { min: 5, max: 5 }))).toBe(true);
  });
});

describe('window/level ↔ range', () => {
  it('converts a range to window width and centre', () => {
    expect(rangeToWindow({ min: 0, max: 3000 })).toEqual({ windowWidth: 3000, windowCenter: 1500 });
  });

  it('round-trips (up to floating point)', () => {
    for (const range of [
      { min: 0, max: 3000 },
      { min: 10, max: 80 },
      { min: -5, max: 5 },
      // 0.8 - 0.2 is not exact in binary floating point, hence closeTo rather
      // than a structural equality on the whole object.
      { min: 0.2, max: 0.8 },
    ]) {
      const { windowWidth, windowCenter } = rangeToWindow(range);
      const back = windowToRange(windowWidth, windowCenter);
      expect(back.min).toBeCloseTo(range.min, 10);
      expect(back.max).toBeCloseTo(range.max, 10);
    }
  });

  it('treats a negative width as its magnitude', () => {
    expect(windowToRange(-100, 50)).toEqual({ min: 0, max: 100 });
  });

  it('falls back for non-finite input', () => {
    const range = windowToRange(NaN, NaN);
    expect(Number.isFinite(range.min)).toBe(true);
    expect(Number.isFinite(range.max)).toBe(true);
  });
});

describe('mapValueToRgba', () => {
  const base = { lut: 'viridis' as const, range: { min: 0, max: 100 } };

  it('is fully transparent at or below the threshold', () => {
    // Background voxels must not paint the slice with the ramp's low end.
    expect(mapValueToRgba(0, base)).toEqual([0, 0, 0, 0]);
    expect(mapValueToRgba(-10, base)).toEqual([0, 0, 0, 0]);
  });

  it('is transparent for a non-finite value', () => {
    expect(mapValueToRgba(NaN, base)).toEqual([0, 0, 0, 0]);
    expect(mapValueToRgba(Infinity, base)).toEqual([0, 0, 0, 0]);
  });

  it('honours an explicit threshold above the range minimum', () => {
    const options = { ...base, lowerThreshold: 50 };
    expect(mapValueToRgba(40, options)[3]).toBe(0);
    expect(mapValueToRgba(60, options)[3]).toBeGreaterThan(0);
  });

  it('honours a threshold of zero even when the range starts below it', () => {
    // `lowerThreshold: 0` must not be mistaken for "absent" and fall back to min.
    const options = { lut: 'viridis' as const, range: { min: -100, max: 100 }, lowerThreshold: 0 };
    expect(mapValueToRgba(-50, options)[3]).toBe(0);
    expect(mapValueToRgba(50, options)[3]).toBeGreaterThan(0);
  });

  it('colours from the chosen ramp', () => {
    const [r, g, b] = mapValueToRgba(100, base);
    expect([r, g, b]).toEqual(lutColor('viridis', 1));
  });

  it('applies opacity and clamps it', () => {
    expect(mapValueToRgba(50, { ...base, opacity: 0.4 })[3]).toBeCloseTo(0.4, 10);
    expect(mapValueToRgba(50, { ...base, opacity: 5 })[3]).toBe(1);
    expect(mapValueToRgba(50, { ...base, opacity: -1 })[3]).toBe(0);
    expect(mapValueToRgba(50, { ...base, opacity: NaN })[3]).toBe(1);
  });
});

describe('formatParametricValue', () => {
  it('formats with the kind decimals and unit', () => {
    expect(formatParametricValue(1234, 'ADC')).toBe('1234 ×10⁻⁶ mm²/s');
    expect(formatParametricValue(3.14159, 'CBV')).toBe('3.1 mL/100 g');
    expect(formatParametricValue(12.5, 'MTT')).toBe('12.5 s');
  });

  it('omits the unit on request', () => {
    expect(formatParametricValue(1234, 'ADC', false)).toBe('1234');
  });

  it('emits an em dash for no value', () => {
    expect(formatParametricValue(NaN, 'ADC')).toBe('—');
    expect(formatParametricValue(Infinity)).toBe('—');
  });

  it('uses generic formatting for an unknown kind', () => {
    expect(formatParametricValue(0.5, 'nope' as never)).toBe('0.500');
  });

  it('has a descriptor for every kind it advertises', () => {
    for (const kind of Object.keys(PARAMETRIC_MAP_DESCRIPTORS)) {
      const descriptor = PARAMETRIC_MAP_DESCRIPTORS[kind as never];
      expect(descriptor.defaultRange.max).toBeGreaterThan(descriptor.defaultRange.min);
      expect(descriptor.decimals).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('buildLegendTicks', () => {
  it('includes both ends', () => {
    const ticks = buildLegendTicks({ min: 0, max: 3000 }, 'ADC', 5);
    expect(ticks).toHaveLength(5);
    expect(ticks[0]).toMatchObject({ value: 0, position: 0 });
    expect(ticks[4]).toMatchObject({ value: 3000, position: 1 });
  });

  it('spaces ticks evenly', () => {
    const ticks = buildLegendTicks({ min: 0, max: 100 }, 'generic', 5);
    expect(ticks.map(t => t.value)).toEqual([0, 25, 50, 75, 100]);
  });

  it('puts the unit only on the top tick', () => {
    const ticks = buildLegendTicks({ min: 0, max: 3000 }, 'ADC', 3);
    expect(ticks[0].label).toBe('0');
    expect(ticks[2].label).toBe('3000 ×10⁻⁶ mm²/s');
  });

  it('always yields a low and a high label', () => {
    expect(buildLegendTicks({ min: 0, max: 1 }, 'generic', 0)).toHaveLength(2);
    expect(buildLegendTicks({ min: 0, max: 1 }, 'generic', 1)).toHaveLength(2);
  });
});
