/**
 * SSD threshold presets — pure core (RTV-17).
 *
 * Surface Shaded Display extracts an isosurface at a density threshold. The
 * threshold *is* the clinical decision: 300 HU gives cortical bone, 100 HU pulls in
 * trabecular bone and calcified plaque, -300 HU gives the skin envelope. Getting
 * that number right matters more than anything about the rendering.
 *
 * ## What this module is NOT
 *
 * It is not a marching-cubes implementation. vtk.js already ships
 * `vtkImageMarchingCubes`, and it is bundled — writing another one would be strictly
 * worse. Nor is it an STL writer: vtk.js ships `STLWriter` too. This module owns the
 * part that is actually missing — which threshold, in what colour, and whether the
 * extraction will finish before the browser gives up (see {@link ./ssdBudget}).
 *
 * Framework-free and `@ohif/*`-free. Zero-fork per RTV-114.
 */

/** Hounsfield bounds worth allowing. Beyond these, an isosurface is meaningless. */
export const SSD_THRESHOLD_HU_MIN = -1000;
export const SSD_THRESHOLD_HU_MAX = 3000;

export type SsdPresetId =
  | 'corticalBone'
  | 'trabecularBone'
  | 'skin'
  | 'lung'
  | 'contrastVessels'
  | 'custom';

export interface SsdPreset {
  id: SsdPresetId;
  label: string;
  /** Isosurface threshold in Hounsfield units. */
  thresholdHu: number;
  /** Default surface colour, as `[r, g, b]` in 0-1 (what vtk actors take). */
  color: [number, number, number];
  opacity: number;
  /** Why this number — shown as the preset's help text. */
  rationale: string;
}

/**
 * The presets, in the order a physicist reaches for them.
 *
 * The thresholds are the conventional CT values, not tuned numbers: 300 HU is the
 * usual cortical-bone floor, ~100 HU catches trabecular bone and calcified plaque,
 * -300 HU sits in the fat/air gap that makes a clean skin surface, and -700 HU is
 * inside lung parenchyma. They are *starting points* — the panel keeps the slider.
 */
export const SSD_PRESETS: SsdPreset[] = [
  {
    id: 'corticalBone',
    label: 'Cortical bone',
    thresholdHu: 300,
    color: [0.95, 0.93, 0.88],
    opacity: 1,
    rationale: 'Dense cortical bone only — the cleanest skeletal surface.',
  },
  {
    id: 'trabecularBone',
    label: 'Trabecular bone',
    thresholdHu: 100,
    color: [0.93, 0.87, 0.76],
    opacity: 1,
    rationale: 'Includes trabecular bone and calcified plaque; noisier than cortical.',
  },
  {
    id: 'skin',
    label: 'Skin surface',
    thresholdHu: -300,
    color: [0.86, 0.68, 0.58],
    opacity: 1,
    rationale: 'The fat/air boundary — the patient outline, useful for setup checks.',
  },
  {
    id: 'lung',
    label: 'Lung',
    thresholdHu: -700,
    color: [0.6, 0.72, 0.85],
    opacity: 0.6,
    rationale: 'Inside lung parenchyma; semi-transparent so vessels stay visible.',
  },
  {
    id: 'contrastVessels',
    label: 'Contrast vessels',
    thresholdHu: 150,
    color: [0.85, 0.25, 0.25],
    opacity: 1,
    rationale: 'Opacified lumen on a contrast CT — depends on the injection protocol.',
  },
];

const PRESET_BY_ID = new Map<SsdPresetId, SsdPreset>(SSD_PRESETS.map(p => [p.id, p]));

/** Clamps a threshold into the range where an isosurface means something. */
export function clampThresholdHu(hu: unknown): number {
  const value = Number(hu);
  if (!Number.isFinite(value)) {
    return PRESET_BY_ID.get('corticalBone')!.thresholdHu;
  }
  return Math.round(Math.min(SSD_THRESHOLD_HU_MAX, Math.max(SSD_THRESHOLD_HU_MIN, value)));
}

/**
 * Resolves a preset id, falling back to cortical bone.
 * `custom` has no stored threshold, so it resolves to cortical bone's values and the
 * caller overrides the threshold.
 */
export function resolvePreset(id?: string): SsdPreset {
  const preset = PRESET_BY_ID.get(id as SsdPresetId);
  return preset ?? PRESET_BY_ID.get('corticalBone')!;
}

/**
 * The preset whose threshold matches, or `custom`.
 * Used to keep the picker in sync when the reader drags the threshold slider onto a
 * preset value — without it the picker would keep showing "custom" at exactly 300 HU.
 */
export function presetForThreshold(thresholdHu: number): SsdPresetId {
  const value = clampThresholdHu(thresholdHu);
  return SSD_PRESETS.find(p => p.thresholdHu === value)?.id ?? 'custom';
}

export interface SsdSettings {
  presetId: SsdPresetId;
  thresholdHu: number;
  color: [number, number, number];
  opacity: number;
}

export function defaultSsdSettings(): SsdSettings {
  const preset = resolvePreset('corticalBone');
  return {
    presetId: preset.id,
    thresholdHu: preset.thresholdHu,
    color: [...preset.color] as [number, number, number],
    opacity: preset.opacity,
  };
}

/** Applies a preset, replacing threshold, colour and opacity together. */
export function applyPreset(id: string): SsdSettings {
  const preset = resolvePreset(id);
  return {
    presetId: preset.id,
    thresholdHu: preset.thresholdHu,
    color: [...preset.color] as [number, number, number],
    opacity: preset.opacity,
  };
}

/** Sets the threshold, re-deriving whether it still matches a preset. */
export function setThresholdHu(settings: SsdSettings, hu: unknown): SsdSettings {
  const thresholdHu = clampThresholdHu(hu);
  return { ...settings, thresholdHu, presetId: presetForThreshold(thresholdHu) };
}

/** Clamps opacity into [0,1]. */
export function setOpacity(settings: SsdSettings, opacity: unknown): SsdSettings {
  const value = Number(opacity);
  if (!Number.isFinite(value)) {
    return settings;
  }
  return { ...settings, opacity: Math.min(1, Math.max(0, value)) };
}

/**
 * Accepts a colour as `#rrggbb` or `[r,g,b]` (0-1 or 0-255) and normalises to 0-1.
 * Returns the settings unchanged when the input is not a colour — a bad value from a
 * config file must not silently turn the surface black.
 */
export function setColor(settings: SsdSettings, color: unknown): SsdSettings {
  const parsed = parseColor(color);
  return parsed ? { ...settings, color: parsed } : settings;
}

export function parseColor(color: unknown): [number, number, number] | null {
  if (typeof color === 'string') {
    const hex = color.trim().replace(/^#/, '');
    if (!/^[0-9a-f]{6}$/i.test(hex)) {
      return null;
    }
    return [
      parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255,
      parseInt(hex.slice(4, 6), 16) / 255,
    ];
  }
  if (Array.isArray(color) && color.length >= 3) {
    const values = color.slice(0, 3).map(Number);
    if (values.some(v => !Number.isFinite(v) || v < 0)) {
      return null;
    }
    // 0-255 input is normalised; anything already in 0-1 passes through.
    const scale = values.some(v => v > 1) ? 255 : 1;
    const normalised = values.map(v => Math.min(1, v / scale));
    return [normalised[0], normalised[1], normalised[2]];
  }
  return null;
}

/** `#rrggbb` for a colour input. */
export function colorToHex(color: [number, number, number]): string {
  const channel = (v: number) =>
    Math.round(Math.min(1, Math.max(0, Number(v) || 0)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(color?.[0])}${channel(color?.[1])}${channel(color?.[2])}`;
}

/** One-line summary for the toolbar toast. */
export function describeSsd(settings: SsdSettings): string {
  const preset = settings.presetId === 'custom' ? 'Custom' : resolvePreset(settings.presetId).label;
  return `SSD ${preset} · ${settings.thresholdHu} HU`;
}
