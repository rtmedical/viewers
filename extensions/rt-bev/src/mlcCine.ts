/**
 * MLC cine core (RTV-139) — pure module, zero imports.
 *
 * Frame arithmetic + FPS sanitizing for the BEV panel's control-point cine
 * player (getPanelModule/BevPanel.tsx). Kept framework-free so jest covers it
 * without a DOM: the panel owns the timer (setInterval with
 * {@link frameIntervalMs}) and drives the overlay via the
 * `setBevControlPoint` command with the index {@link nextCineFrame} returns.
 */

export const DEFAULT_CINE_FPS = 4;
export const MIN_CINE_FPS = 1;
export const MAX_CINE_FPS = 30;

/**
 * Sanitize a user-typed FPS: non-finite (NaN, ±Infinity) falls back to
 * {@link DEFAULT_CINE_FPS}; everything else is rounded to the nearest integer
 * and clamped to [{@link MIN_CINE_FPS}, {@link MAX_CINE_FPS}].
 */
export function clampFps(v: number): number {
  if (!Number.isFinite(v)) {
    return DEFAULT_CINE_FPS;
  }
  return Math.min(MAX_CINE_FPS, Math.max(MIN_CINE_FPS, Math.round(v)));
}

/** setInterval period in ms for a given FPS (clamped first). */
export function frameIntervalMs(fps: number): number {
  return 1000 / clampFps(fps);
}

/**
 * Control-point index for the next cine tick. `cpCount <= 0` (no beam) → 0;
 * a non-finite or negative `current` restarts at 0; from the last frame (or
 * beyond it) the cine wraps to 0 when `loop`, otherwise holds the last frame.
 */
export function nextCineFrame(current: number, cpCount: number, loop = true): number {
  if (!Number.isFinite(cpCount) || cpCount <= 0) {
    return 0;
  }
  const last = Math.floor(cpCount) - 1;
  const cur = Number.isFinite(current) && current >= 0 ? Math.floor(current) : -1;
  if (cur >= last) {
    return loop ? 0 : last;
  }
  return cur + 1;
}
