/**
 * Unit tests for the TG18-style pattern specs (RTV-211). Pure geometry — the
 * canvas rasterization (renderPattern.ts) is DOM glue validated E2E.
 */
import { tg18qcSpec, tg18lnSpec, luminanceRampSpec, PatternRect, PatternSpec } from './tg18Patterns';

function expectWithinUnitBounds(spec: PatternSpec): void {
  expect(spec.background).toBeGreaterThanOrEqual(0);
  expect(spec.background).toBeLessThanOrEqual(1);
  for (const r of spec.rects) {
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.w).toBeGreaterThan(0);
    expect(r.h).toBeGreaterThan(0);
    expect(r.x + r.w).toBeLessThanOrEqual(1 + 1e-9);
    expect(r.y + r.h).toBeLessThanOrEqual(1 + 1e-9);
    expect(r.gray).toBeGreaterThanOrEqual(0);
    expect(r.gray).toBeLessThanOrEqual(1);
  }
}

const byRole = (spec: PatternSpec, role: PatternRect['role']) =>
  spec.rects.filter(r => r.role === role);

describe('tg18qcSpec', () => {
  const spec = tg18qcSpec();

  it('uses a 50% background and stays within normalized bounds', () => {
    expect(spec.background).toBe(0.5);
    expectWithinUnitBounds(spec);
  });

  it('has 16 grayscale patches spanning 0–100% in equal steps', () => {
    const patches = byRole(spec, 'patch');
    expect(patches).toHaveLength(16);
    const grays = patches.map(p => p.gray);
    expect(grays[0]).toBe(0);
    expect(grays[15]).toBe(1);
    for (let i = 1; i < grays.length; i++) {
      expect(grays[i]).toBeGreaterThan(grays[i - 1]);
      expect(grays[i] - grays[i - 1]).toBeCloseTo(1 / 15, 10);
    }
  });

  it('has 5%/95% corner patches with 0%/100% inner squares (two of each)', () => {
    const corners = byRole(spec, 'corner');
    const inners = byRole(spec, 'corner-inner');
    expect(corners).toHaveLength(4);
    expect(inners).toHaveLength(4);
    expect(corners.filter(c => c.gray === 0.05)).toHaveLength(2);
    expect(corners.filter(c => c.gray === 0.95)).toHaveLength(2);
    expect(inners.filter(c => c.gray === 0)).toHaveLength(2);
    expect(inners.filter(c => c.gray === 1)).toHaveLength(2);
  });

  it('nests each inner square inside its corner patch with the matched contrast pair', () => {
    const corners = byRole(spec, 'corner');
    const inners = byRole(spec, 'corner-inner');
    for (const inner of inners) {
      const host = corners.find(
        c =>
          inner.x >= c.x &&
          inner.y >= c.y &&
          inner.x + inner.w <= c.x + c.w &&
          inner.y + inner.h <= c.y + c.h
      );
      expect(host).toBeDefined();
      // 0% square lives in the 5% patch, 100% square in the 95% patch.
      expect(host!.gray).toBe(inner.gray === 0 ? 0.05 : 0.95);
    }
  });

  it('includes a monotonic 0→1 ramp with the requested step count', () => {
    const ramp = byRole(spec, 'ramp');
    expect(ramp).toHaveLength(256);
    expect(ramp[0].gray).toBe(0);
    expect(ramp[ramp.length - 1].gray).toBe(1);
    for (let i = 1; i < ramp.length; i++) {
      expect(ramp[i].gray).toBeGreaterThan(ramp[i - 1].gray);
      expect(ramp[i].x).toBeGreaterThan(ramp[i - 1].x);
    }
  });

  it('rejects invalid ramp step counts', () => {
    expect(() => tg18qcSpec(1)).toThrow(RangeError);
    expect(() => tg18qcSpec(2.5)).toThrow(RangeError);
  });
});

describe('tg18lnSpec', () => {
  it('produces the requested number of equally spaced luminance patches', () => {
    const spec = tg18lnSpec(18);
    expect(spec.name).toBe('tg18-ln');
    expect(spec.background).toBe(0.2);
    expectWithinUnitBounds(spec);
    const patches = byRole(spec, 'patch');
    expect(patches).toHaveLength(18);
    expect(patches[0].gray).toBe(0);
    expect(patches[17].gray).toBe(1);
    for (let i = 1; i < patches.length; i++) {
      expect(patches[i].gray - patches[i - 1].gray).toBeCloseTo(1 / 17, 10);
    }
  });

  it('supports other step counts and rejects invalid ones', () => {
    expect(byRole(tg18lnSpec(12), 'patch')).toHaveLength(12);
    expect(() => tg18lnSpec(1)).toThrow(RangeError);
    expect(() => tg18lnSpec(17.5)).toThrow(RangeError);
  });
});

describe('luminanceRampSpec', () => {
  it('covers the full screen with contiguous monotonic bars', () => {
    const spec = luminanceRampSpec(256);
    expect(spec.name).toBe('ramp');
    expect(spec.background).toBe(0);
    expectWithinUnitBounds(spec);
    const bars = spec.rects;
    expect(bars).toHaveLength(256);
    expect(bars[0].x).toBe(0);
    expect(bars[0].gray).toBe(0);
    expect(bars[bars.length - 1].gray).toBe(1);
    // Contiguity: each bar starts where the previous ends; last bar reaches 1.
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i].x).toBeCloseTo(bars[i - 1].x + bars[i - 1].w, 10);
      expect(bars[i].gray).toBeGreaterThan(bars[i - 1].gray);
    }
    const last = bars[bars.length - 1];
    expect(last.x + last.w).toBeCloseTo(1, 10);
    expect(bars.every(b => b.y === 0 && b.h === 1)).toBe(true);
  });

  it('rejects invalid step counts', () => {
    expect(() => luminanceRampSpec(0)).toThrow(RangeError);
    expect(() => luminanceRampSpec(10.5)).toThrow(RangeError);
  });
});
