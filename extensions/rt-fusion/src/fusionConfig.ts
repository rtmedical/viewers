/**
 * Pure **image-fusion configuration** model (RTV-197).
 *
 * Framework-free and `@ohif/*`-free: the fusion overlay config (moving layer,
 * opacity, blend mode, colormap, inversion), normalization, and the CSS style it
 * maps to — all unit-tested. Actually compositing the moving layer onto the
 * fixed layer in the cornerstone viewport is an integration follow-up; this is
 * the config/state + preview data layer the panel renders.
 *
 * Colormap names mirror `@ohif/extension-rt-isodose` (the LUT generator lives
 * there); duplicated here as a small constant to avoid a cross-extension import.
 */

export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay';
export const BLEND_MODES: BlendMode[] = ['normal', 'multiply', 'screen', 'overlay'];

/** Mirrors rt-isodose ColormapName (LUT generation lives there). */
export type FusionColormap = 'none' | 'hot' | 'jet' | 'grayscale' | 'rainbow';
export const FUSION_COLORMAPS: FusionColormap[] = ['none', 'hot', 'jet', 'grayscale', 'rainbow'];

export interface FusionConfig {
  /** Display-set UID of the fixed (base) layer. */
  fixedLayerId?: string;
  /** Display-set UID of the moving (overlay) layer. */
  movingLayerId?: string;
  /** Overlay opacity, 0–1. */
  opacity: number;
  blendMode: BlendMode;
  colormap: FusionColormap;
  /** Invert the colormap. */
  inverted: boolean;
}

export function defaultFusionConfig(): FusionConfig {
  return { opacity: 0.5, blendMode: 'normal', colormap: 'none', inverted: false };
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** Normalize a partial/untrusted config into a valid one. */
export function normalizeFusionConfig(partial: Partial<FusionConfig> = {}): FusionConfig {
  const base = defaultFusionConfig();
  return {
    fixedLayerId: partial.fixedLayerId ?? base.fixedLayerId,
    movingLayerId: partial.movingLayerId ?? base.movingLayerId,
    opacity: clamp01(partial.opacity ?? base.opacity),
    blendMode: BLEND_MODES.includes(partial.blendMode as BlendMode) ? (partial.blendMode as BlendMode) : base.blendMode,
    colormap: FUSION_COLORMAPS.includes(partial.colormap as FusionColormap) ? (partial.colormap as FusionColormap) : base.colormap,
    inverted: !!partial.inverted,
  };
}

export interface LayerStyle {
  opacity: number;
  mixBlendMode: BlendMode;
}

/** Map a config to the CSS the preview (and a future viewport overlay) use. */
export function buildLayerStyle(config: FusionConfig): LayerStyle {
  return { opacity: clamp01(config.opacity), mixBlendMode: config.blendMode };
}

/** Can the fusion actually composite (needs two distinct layers)? */
export function isFusable(config: FusionConfig): boolean {
  return !!config.fixedLayerId && !!config.movingLayerId && config.fixedLayerId !== config.movingLayerId;
}

export default normalizeFusionConfig;
