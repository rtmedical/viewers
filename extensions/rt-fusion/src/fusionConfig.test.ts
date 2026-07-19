import {
  defaultFusionConfig,
  normalizeFusionConfig,
  buildLayerStyle,
  isFusable,
  BLEND_MODES,
  FUSION_COLORMAPS,
} from './fusionConfig';

describe('defaultFusionConfig', () => {
  it('is 50% opacity, normal blend, no colormap', () => {
    expect(defaultFusionConfig()).toEqual({ opacity: 0.5, blendMode: 'normal', colormap: 'none', inverted: false });
  });
});

describe('normalizeFusionConfig', () => {
  it('clamps opacity to [0,1]', () => {
    expect(normalizeFusionConfig({ opacity: 2 }).opacity).toBe(1);
    expect(normalizeFusionConfig({ opacity: -3 }).opacity).toBe(0);
    expect(normalizeFusionConfig({ opacity: NaN }).opacity).toBe(0);
  });

  it('rejects invalid blend modes / colormaps, keeping defaults', () => {
    expect(normalizeFusionConfig({ blendMode: 'bogus' as any }).blendMode).toBe('normal');
    expect(normalizeFusionConfig({ colormap: 'bogus' as any }).colormap).toBe('none');
  });

  it('accepts valid enums and ids', () => {
    const c = normalizeFusionConfig({ blendMode: 'screen', colormap: 'jet', movingLayerId: 'm', fixedLayerId: 'f', inverted: true, opacity: 0.3 });
    expect(c).toEqual({ fixedLayerId: 'f', movingLayerId: 'm', opacity: 0.3, blendMode: 'screen', colormap: 'jet', inverted: true });
  });

  it('exposes the supported enums', () => {
    expect(BLEND_MODES).toContain('multiply');
    expect(FUSION_COLORMAPS).toContain('hot');
  });
});

describe('buildLayerStyle', () => {
  it('maps to opacity + mixBlendMode', () => {
    expect(buildLayerStyle(normalizeFusionConfig({ opacity: 0.7, blendMode: 'multiply' }))).toEqual({
      opacity: 0.7,
      mixBlendMode: 'multiply',
    });
  });
});

describe('isFusable', () => {
  it('requires two distinct layers', () => {
    expect(isFusable(normalizeFusionConfig({ fixedLayerId: 'a', movingLayerId: 'b' }))).toBe(true);
    expect(isFusable(normalizeFusionConfig({ fixedLayerId: 'a', movingLayerId: 'a' }))).toBe(false);
    expect(isFusable(normalizeFusionConfig({ fixedLayerId: 'a' }))).toBe(false);
  });
});
