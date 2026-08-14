import {
  DRR_SLAB_MM_DEFAULT,
  SLAB_MM_DEFAULT,
  SLAB_MM_MAX,
  SLAB_MM_MIN,
  SLAB_MM_STEP,
  adjustSlab,
  applyProjectionRequest,
  blendModeNameFor,
  clampSlab,
  defaultState,
  effectiveSlabMm,
  modeForBlendModeName,
  nextMode,
  normalizeMode,
} from './mipSlab';

describe('mipSlab (RTV-15 MIP/MinIP/AvgIP + RTV-19 2D slab)', () => {
  describe('defaultState', () => {
    it('starts with no projection and the 10 mm default slab', () => {
      expect(defaultState()).toEqual({ mode: 'none', slabMm: SLAB_MM_DEFAULT });
    });
  });

  describe('normalizeMode', () => {
    it.each([
      ['mip', 'mip'],
      ['MIP', 'mip'],
      [' MinIP ', 'minip'],
      ['avg', 'avg'],
      ['none', 'none'],
    ])('accepts %s as %s', (input, expected) => {
      expect(normalizeMode(input)).toBe(expected);
    });

    it.each([['maximum'], [''], [undefined], [null], [3], [{}]])(
      'rejects %p with null',
      input => {
        expect(normalizeMode(input)).toBeNull();
      }
    );
  });

  describe('clampSlab', () => {
    it('keeps in-range values (rounded to 0.1 mm)', () => {
      expect(clampSlab(10)).toBe(10);
      expect(clampSlab(7.44)).toBe(7.4);
    });

    it('clamps to the 0.5–100 mm range', () => {
      expect(clampSlab(0.1)).toBe(SLAB_MM_MIN);
      expect(clampSlab(1000)).toBe(SLAB_MM_MAX);
      expect(clampSlab(SLAB_MM_MIN)).toBe(SLAB_MM_MIN);
      expect(clampSlab(SLAB_MM_MAX)).toBe(SLAB_MM_MAX);
    });

    it('falls back to the 10 mm default for non-numbers', () => {
      expect(clampSlab(undefined)).toBe(SLAB_MM_DEFAULT);
      expect(clampSlab(null)).toBe(SLAB_MM_DEFAULT);
      expect(clampSlab('12')).toBe(SLAB_MM_DEFAULT);
      expect(clampSlab(NaN)).toBe(SLAB_MM_DEFAULT);
      expect(clampSlab(Infinity)).toBe(SLAB_MM_DEFAULT);
    });
  });

  describe('nextMode', () => {
    it('re-requesting the active mode toggles off', () => {
      expect(nextMode('mip', 'mip')).toBe('none');
      expect(nextMode('avg', 'avg')).toBe('none');
    });

    it('requesting a different mode switches to it', () => {
      expect(nextMode('none', 'mip')).toBe('mip');
      expect(nextMode('mip', 'minip')).toBe('minip');
    });
  });

  describe('blendModeNameFor / modeForBlendModeName', () => {
    it('maps every mode onto the Cornerstone3D BlendModes member name', () => {
      expect(blendModeNameFor('none')).toBe('COMPOSITE');
      expect(blendModeNameFor('mip')).toBe('MAXIMUM_INTENSITY_BLEND');
      expect(blendModeNameFor('minip')).toBe('MINIMUM_INTENSITY_BLEND');
      expect(blendModeNameFor('avg')).toBe('AVERAGE_INTENSITY_BLEND');
    });

    it('round-trips through modeForBlendModeName', () => {
      (['none', 'mip', 'minip', 'avg'] as const).forEach(mode => {
        expect(modeForBlendModeName(blendModeNameFor(mode))).toBe(mode);
      });
    });

    it('reads unknown blend modes as none', () => {
      expect(modeForBlendModeName('LABELMAP_EDGE_PROJECTION_BLEND')).toBe('none');
      expect(modeForBlendModeName(undefined)).toBe('none');
      expect(modeForBlendModeName(1)).toBe('none');
    });
  });

  describe('effectiveSlabMm', () => {
    it('an explicit request wins (clamped)', () => {
      expect(effectiveSlabMm(20, 5)).toBe(20);
      expect(effectiveSlabMm(1000, 5)).toBe(SLAB_MM_MAX);
      expect(effectiveSlabMm(0.1, 5)).toBe(SLAB_MM_MIN);
    });

    it('keeps the current slab when it is a real slab', () => {
      expect(effectiveSlabMm(undefined, 15)).toBe(15);
      expect(effectiveSlabMm(undefined, 150)).toBe(SLAB_MM_MAX);
    });

    it("ignores cornerstone's hair-thin 0.05 mm idle default", () => {
      expect(effectiveSlabMm(undefined, 0.05)).toBe(SLAB_MM_DEFAULT);
      expect(effectiveSlabMm(undefined, undefined)).toBe(SLAB_MM_DEFAULT);
      expect(effectiveSlabMm('abc', 'def')).toBe(SLAB_MM_DEFAULT);
    });
  });

  describe('adjustSlab', () => {
    it('steps the current thickness by the delta', () => {
      expect(adjustSlab(10, 5)).toBe(15);
      expect(adjustSlab(10, -5)).toBe(5);
      expect(adjustSlab(10, 2.5)).toBe(12.5);
    });

    it('treats a hair-thin/unset slab as 0 so the first + lands on 5 mm', () => {
      expect(adjustSlab(0.05, 5)).toBe(5);
      expect(adjustSlab(undefined, 5)).toBe(5);
    });

    it('clamps at both ends', () => {
      expect(adjustSlab(98, 5)).toBe(SLAB_MM_MAX);
      expect(adjustSlab(2, -5)).toBe(SLAB_MM_MIN);
      expect(adjustSlab(undefined, -5)).toBe(SLAB_MM_MIN);
    });

    it('falls back to a +5 mm step for invalid deltas', () => {
      expect(adjustSlab(10, undefined)).toBe(10 + SLAB_MM_STEP);
      expect(adjustSlab(10, NaN)).toBe(10 + SLAB_MM_STEP);
      expect(adjustSlab(10, 0)).toBe(10 + SLAB_MM_STEP);
    });

    it('rounds to 0.1 mm', () => {
      expect(adjustSlab(0.5, 0.05 + 0.05)).toBe(0.6);
    });
  });

  describe('applyProjectionRequest', () => {
    it('toggles off when the active mode is re-requested without a thickness', () => {
      expect(applyProjectionRequest({ mode: 'mip', slabMm: 15 }, 'mip')).toEqual({
        mode: 'none',
        slabMm: 15,
      });
    });

    it('does NOT toggle when an explicit thickness comes with the request', () => {
      expect(applyProjectionRequest({ mode: 'mip', slabMm: 15 }, 'mip', 20)).toEqual({
        mode: 'mip',
        slabMm: 20,
      });
    });

    it('switches modes keeping the current real slab', () => {
      expect(applyProjectionRequest({ mode: 'mip', slabMm: 15 }, 'avg')).toEqual({
        mode: 'avg',
        slabMm: 15,
      });
    });

    it('enables with the default thickness from an idle viewport', () => {
      expect(applyProjectionRequest({ mode: 'none', slabMm: 0.05 }, 'minip')).toEqual({
        mode: 'minip',
        slabMm: SLAB_MM_DEFAULT,
      });
    });

    it("a 'none' request turns off regardless of the current mode", () => {
      expect(applyProjectionRequest({ mode: 'avg', slabMm: 30 }, 'none')).toEqual({
        mode: 'none',
        slabMm: 30,
      });
    });
  });
});

/**
 * RTV-18 — DRR / X-ray projection. Appended to the RTV-15/19 suite because DRR is
 * a fifth mode of the same state model, not a separate feature.
 */
describe('DRR / X-ray projection (RTV-18)', () => {
  it('maps drr onto the vtk.js radon-transform blend mode', () => {
    expect(blendModeNameFor('drr')).toBe('RADON_TRANSFORM_BLEND');
    expect(modeForBlendModeName('RADON_TRANSFORM_BLEND')).toBe('drr');
  });

  it('accepts drr and the RX / X-ray aliases', () => {
    // "projeção de RX" is how the requirement is worded, so a caller will reach
    // for 'rx' before 'drr'.
    expect(normalizeMode('drr')).toBe('drr');
    expect(normalizeMode('DRR')).toBe('drr');
    expect(normalizeMode('  rx ')).toBe('drr');
    expect(normalizeMode('xray')).toBe('drr');
    expect(normalizeMode('x-ray')).toBe('drr');
  });

  it('still rejects unknown modes', () => {
    expect(normalizeMode('radon')).toBeNull();
    expect(normalizeMode('drrr')).toBeNull();
  });

  it('opens at the FULL slab, not the 10 mm default', () => {
    // A radiograph integrates through the whole patient; a 10 mm radon projection
    // is a thick-slab reformat, not a DRR.
    const next = applyProjectionRequest({ mode: 'none', slabMm: SLAB_MM_DEFAULT }, 'drr');
    expect(next).toEqual({ mode: 'drr', slabMm: DRR_SLAB_MM_DEFAULT });
    expect(DRR_SLAB_MM_DEFAULT).toBe(SLAB_MM_MAX);
  });

  it('does not inherit the slab left behind by a previous projection', () => {
    const next = applyProjectionRequest({ mode: 'mip', slabMm: 20 }, 'drr');
    expect(next.slabMm).toBe(DRR_SLAB_MM_DEFAULT);
  });

  it('honours an explicit thickness', () => {
    const next = applyProjectionRequest({ mode: 'none', slabMm: 10 }, 'drr', 40);
    expect(next).toEqual({ mode: 'drr', slabMm: 40 });
  });

  it('clamps an explicit thickness', () => {
    expect(applyProjectionRequest({ mode: 'none', slabMm: 10 }, 'drr', 9999).slabMm).toBe(
      SLAB_MM_MAX
    );
  });

  it('toggles off when re-requested with no thickness', () => {
    expect(applyProjectionRequest({ mode: 'drr', slabMm: SLAB_MM_MAX }, 'drr').mode).toBe('none');
  });

  it('does not hand a 100 mm slab to the next projection when switched off', () => {
    // Leaving DRR and pressing MIP must not silently give a 100 mm MIP.
    const off = applyProjectionRequest({ mode: 'drr', slabMm: SLAB_MM_MAX }, 'drr');
    expect(off.slabMm).toBe(SLAB_MM_DEFAULT);
    expect(applyProjectionRequest(off, 'mip').slabMm).toBe(SLAB_MM_DEFAULT);
  });

  it('leaves inheritance for the other projections untouched', () => {
    // Regression guard for RTV-15/19 behaviour.
    expect(applyProjectionRequest({ mode: 'none', slabMm: 20 }, 'mip').slabMm).toBe(20);
    expect(applyProjectionRequest({ mode: 'mip', slabMm: 20 }, 'mip').mode).toBe('none');
  });
});
