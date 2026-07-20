/**
 * Unit tests for the PS3.14 GSDF math (RTV-211). Pure functions — no DOM.
 */
import {
  GSDF_COEFFICIENTS,
  JND_MIN,
  JND_MAX,
  gsdfLuminance,
  jndIndexForLuminance,
  gsdfCurve,
  contrastPerJnd,
} from './gsdf';

describe('gsdfLuminance', () => {
  it('matches the PS3.14 luminance range endpoints (~0.05 and ~4000 cd/m²)', () => {
    // ln(1) = 0 so L(1) = 10^a exactly.
    expect(gsdfLuminance(1)).toBeCloseTo(Math.pow(10, GSDF_COEFFICIENTS.a), 12);
    expect(gsdfLuminance(1)).toBeGreaterThan(0.045);
    expect(gsdfLuminance(1)).toBeLessThan(0.055);
    // PS3.14 quotes the GSDF as covering ~0.05 to ~4000 cd/m².
    expect(gsdfLuminance(1023)).toBeGreaterThan(3800);
    expect(gsdfLuminance(1023)).toBeLessThan(4200);
  });

  it('is strictly monotonically increasing over the whole JND domain', () => {
    let previous = gsdfLuminance(JND_MIN);
    for (let j = JND_MIN + 1; j <= JND_MAX; j++) {
      const L = gsdfLuminance(j);
      expect(L).toBeGreaterThan(previous);
      previous = L;
    }
  });

  it('produces mid-range luminances of the right order of magnitude', () => {
    // Well-known anchor: ~100 cd/m² falls in the upper-middle of the JND scale.
    const j = jndIndexForLuminance(100);
    expect(j).toBeGreaterThan(400);
    expect(j).toBeLessThan(800);
  });

  it('rejects JND indices outside [1, 1023]', () => {
    expect(() => gsdfLuminance(0)).toThrow(RangeError);
    expect(() => gsdfLuminance(1024)).toThrow(RangeError);
    expect(() => gsdfLuminance(NaN)).toThrow(RangeError);
  });
});

describe('jndIndexForLuminance (inverse)', () => {
  it('round-trips j → L → j within ±1 JND across the domain', () => {
    for (const j of [1, 2, 10, 50, 100, 250, 500, 750, 1000, 1023]) {
      const L = gsdfLuminance(j);
      expect(Math.abs(jndIndexForLuminance(L) - j)).toBeLessThanOrEqual(1);
    }
  });

  it('round-trips L → j → L within a small relative error', () => {
    for (const L of [0.06, 0.5, 1, 5, 50, 250, 1000, 3500]) {
      const back = gsdfLuminance(jndIndexForLuminance(L));
      expect(Math.abs(back - L) / L).toBeLessThan(1e-4);
    }
  });

  it('clamps luminances outside the GSDF range to the domain bounds', () => {
    expect(jndIndexForLuminance(1e-4)).toBe(JND_MIN);
    expect(jndIndexForLuminance(1e6)).toBe(JND_MAX);
  });

  it('rejects non-positive luminance', () => {
    expect(() => jndIndexForLuminance(0)).toThrow(RangeError);
    expect(() => jndIndexForLuminance(-1)).toThrow(RangeError);
  });
});

describe('gsdfCurve', () => {
  it('samples nPoints including both endpoints', () => {
    const curve = gsdfCurve(11);
    expect(curve).toHaveLength(11);
    expect(curve[0].j).toBe(JND_MIN);
    expect(curve[10].j).toBe(JND_MAX);
    expect(curve[0].L).toBeCloseTo(gsdfLuminance(JND_MIN), 12);
    expect(curve[10].L).toBeCloseTo(gsdfLuminance(JND_MAX), 12);
  });

  it('is monotonic in both j and L', () => {
    const curve = gsdfCurve(100);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i].j).toBeGreaterThan(curve[i - 1].j);
      expect(curve[i].L).toBeGreaterThan(curve[i - 1].L);
    }
  });

  it('rejects invalid arguments', () => {
    expect(() => gsdfCurve(1)).toThrow(RangeError);
    expect(() => gsdfCurve(10, 0, 1023)).toThrow(RangeError);
    expect(() => gsdfCurve(10, 500, 100)).toThrow(RangeError);
  });
});

describe('contrastPerJnd', () => {
  it('spans exactly [jnd(lMin), jnd(lMax)] with the requested step count', () => {
    const table = contrastPerJnd(0.5, 400, 18);
    expect(table).toHaveLength(18);
    expect(table[0].j).toBeCloseTo(jndIndexForLuminance(0.5), 3);
    expect(table[17].j).toBeCloseTo(jndIndexForLuminance(400), 3);
    expect(table[0].luminance).toBeCloseTo(0.5, 3);
    expect(table[17].luminance).toBeCloseTo(400, 1);
  });

  it('reports positive contrasts that shrink toward higher luminance', () => {
    const table = contrastPerJnd(0.5, 400, 18);
    for (const row of table) {
      expect(row.contrastPerJnd).toBeGreaterThan(0);
    }
    // The eye resolves smaller relative contrast at high luminance — the
    // per-JND dL/L target must decrease monotonically along the table.
    for (let i = 1; i < table.length; i++) {
      expect(table[i].contrastPerJnd).toBeLessThan(table[i - 1].contrastPerJnd);
    }
  });

  it('rejects invalid ranges and step counts', () => {
    expect(() => contrastPerJnd(0.5, 400, 1)).toThrow(RangeError);
    expect(() => contrastPerJnd(-1, 400, 18)).toThrow(RangeError);
    expect(() => contrastPerJnd(400, 0.5, 18)).toThrow(RangeError);
  });
});
