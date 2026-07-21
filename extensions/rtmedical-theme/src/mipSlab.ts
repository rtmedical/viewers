/**
 * MIP/MinIP/AvgIP slab projection state model (RTV-15) + 2D slab thickness
 * rules (RTV-19). Pure module — no OHIF/cornerstone imports — so the command
 * glue in ./mipSlabCommands stays thin and every decision is unit-testable.
 *
 * Cornerstone3D's BlendModes enum is referenced BY NAME here
 * ('MAXIMUM_INTENSITY_BLEND', ...): rtmedical-theme must not import
 * '@cornerstonejs/core' (nested DEAD copy — see touchGestures.ts), so the
 * numeric enum resolution lives in the glue.
 */

/** User-facing projection modes ('none' = normal composite rendering). */
export type SlabProjectionMode = 'none' | 'mip' | 'minip' | 'avg';

/** Names of the @cornerstonejs/core Enums.BlendModes members we map onto. */
export type CsBlendModeName =
  | 'COMPOSITE'
  | 'MAXIMUM_INTENSITY_BLEND'
  | 'MINIMUM_INTENSITY_BLEND'
  | 'AVERAGE_INTENSITY_BLEND';

/** The whole feature state: which projection and how thick the slab is. */
export interface SlabProjectionState {
  mode: SlabProjectionMode;
  slabMm: number;
}

/** Slab thickness bounds/defaults in millimetres (RTV-19). */
export const SLAB_MM_MIN = 0.5;
export const SLAB_MM_MAX = 100;
export const SLAB_MM_DEFAULT = 10;
/** Step applied by the toolbar Slab +/− buttons (and delta fallback). */
export const SLAB_MM_STEP = 5;

const MODE_TO_BLEND_NAME: Record<SlabProjectionMode, CsBlendModeName> = {
  none: 'COMPOSITE',
  mip: 'MAXIMUM_INTENSITY_BLEND',
  minip: 'MINIMUM_INTENSITY_BLEND',
  avg: 'AVERAGE_INTENSITY_BLEND',
};

const BLEND_NAME_TO_MODE: Record<CsBlendModeName, SlabProjectionMode> = {
  COMPOSITE: 'none',
  MAXIMUM_INTENSITY_BLEND: 'mip',
  MINIMUM_INTENSITY_BLEND: 'minip',
  AVERAGE_INTENSITY_BLEND: 'avg',
};

/** Round to 0.1 mm so ± stepping never accumulates float dust in toasts. */
function roundMm(mm: number): number {
  return Math.round(mm * 10) / 10;
}

/** Initial state: no projection, 10 mm remembered slab. */
export function defaultState(): SlabProjectionState {
  return { mode: 'none', slabMm: SLAB_MM_DEFAULT };
}

/**
 * Parse a command-option mode ('MIP', ' avg ', ...) into a SlabProjectionMode.
 * Unknown/non-string input returns null so the caller can fail honestly
 * instead of silently picking a projection.
 */
export function normalizeMode(input: unknown): SlabProjectionMode | null {
  if (typeof input !== 'string') {
    return null;
  }
  const value = input.trim().toLowerCase();
  return value === 'none' || value === 'mip' || value === 'minip' || value === 'avg'
    ? value
    : null;
}

/**
 * Clamp a thickness to [0.5, 100] mm (rounded to 0.1 mm). Anything that is
 * not a finite number falls back to the 10 mm default.
 */
export function clampSlab(mm: unknown): number {
  if (typeof mm !== 'number' || !Number.isFinite(mm)) {
    return SLAB_MM_DEFAULT;
  }
  return roundMm(Math.min(SLAB_MM_MAX, Math.max(SLAB_MM_MIN, mm)));
}

/** Toggle semantics: re-requesting the active mode turns the projection off. */
export function nextMode(
  current: SlabProjectionMode,
  requested: SlabProjectionMode
): SlabProjectionMode {
  return requested === current ? 'none' : requested;
}

/** Cornerstone3D BlendModes member NAME for a projection mode. */
export function blendModeNameFor(mode: SlabProjectionMode): CsBlendModeName {
  return MODE_TO_BLEND_NAME[mode];
}

/**
 * Reverse of blendModeNameFor — used to read the ACTIVE viewport's state
 * back into the model. Unknown names (e.g. LABELMAP_EDGE_PROJECTION_BLEND)
 * read as 'none'.
 */
export function modeForBlendModeName(name: unknown): SlabProjectionMode {
  return (typeof name === 'string' && BLEND_NAME_TO_MODE[name as CsBlendModeName]) || 'none';
}

/**
 * Thickness to apply when a projection is (re)enabled: an explicit request
 * wins; otherwise the viewport's current slab is kept when it is a real slab
 * (>= 0.5 mm — cornerstone's idle default is a hair-thin 0.05 mm); otherwise
 * the 10 mm default.
 */
export function effectiveSlabMm(requestedMm: unknown, currentMm: unknown): number {
  if (typeof requestedMm === 'number' && Number.isFinite(requestedMm)) {
    return clampSlab(requestedMm);
  }
  if (typeof currentMm === 'number' && Number.isFinite(currentMm) && currentMm >= SLAB_MM_MIN) {
    return clampSlab(currentMm);
  }
  return SLAB_MM_DEFAULT;
}

/**
 * New thickness for a Slab +/− step. A hair-thin/unset current slab counts
 * as 0 so the first "+5" lands on a round 5 mm; invalid deltas fall back to
 * +SLAB_MM_STEP; the result clamps to [0.5, 100] mm.
 */
export function adjustSlab(currentMm: unknown, deltaMm: unknown): number {
  const delta =
    typeof deltaMm === 'number' && Number.isFinite(deltaMm) && deltaMm !== 0
      ? deltaMm
      : SLAB_MM_STEP;
  const base =
    typeof currentMm === 'number' && Number.isFinite(currentMm) && currentMm >= SLAB_MM_MIN
      ? currentMm
      : 0;
  return roundMm(Math.min(SLAB_MM_MAX, Math.max(SLAB_MM_MIN, base + delta)));
}

/**
 * Full state transition for a projection request. Toggle applies ONLY when
 * no explicit thickness came with the request — `setSlabProjection({ mode:
 * 'mip', slabMm: 20 })` on an active MIP means "make it 20 mm", not "off".
 * Turning off keeps the last thickness as the remembered slabMm.
 */
export function applyProjectionRequest(
  current: SlabProjectionState,
  requestedMode: SlabProjectionMode,
  requestedSlabMm?: unknown
): SlabProjectionState {
  const mode =
    requestedSlabMm === undefined ? nextMode(current.mode, requestedMode) : requestedMode;
  if (mode === 'none') {
    return { mode: 'none', slabMm: effectiveSlabMm(undefined, current.slabMm) };
  }
  return { mode, slabMm: effectiveSlabMm(requestedSlabMm, current.slabMm) };
}
