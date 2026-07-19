/**
 * RTV-139 pure-core tests: FPS sanitizing/interval and cine frame advance
 * (wrap, no-loop hold, degenerate CP counts, out-of-range current).
 */
import {
  DEFAULT_CINE_FPS,
  MAX_CINE_FPS,
  MIN_CINE_FPS,
  clampFps,
  frameIntervalMs,
  nextCineFrame,
} from './mlcCine';

describe('clampFps — user-typed FPS sanitizing', () => {
  it('falls back to the default on non-finite input', () => {
    expect(clampFps(NaN)).toBe(DEFAULT_CINE_FPS);
    expect(clampFps(Infinity)).toBe(DEFAULT_CINE_FPS);
    expect(clampFps(-Infinity)).toBe(DEFAULT_CINE_FPS);
  });

  it('clamps below the minimum (0 → MIN)', () => {
    expect(clampFps(0)).toBe(MIN_CINE_FPS);
    expect(clampFps(-3)).toBe(MIN_CINE_FPS);
  });

  it('clamps above the maximum (45 → MAX)', () => {
    expect(clampFps(45)).toBe(MAX_CINE_FPS);
  });

  it('rounds fractional values to the nearest integer (4.7 → 5)', () => {
    expect(clampFps(4.7)).toBe(5);
    expect(clampFps(4.2)).toBe(4);
  });

  it('passes valid integers through unchanged', () => {
    expect(clampFps(MIN_CINE_FPS)).toBe(MIN_CINE_FPS);
    expect(clampFps(MAX_CINE_FPS)).toBe(MAX_CINE_FPS);
    expect(clampFps(DEFAULT_CINE_FPS)).toBe(DEFAULT_CINE_FPS);
  });
});

describe('frameIntervalMs — setInterval period', () => {
  it('maps 4 fps to 250 ms', () => {
    expect(frameIntervalMs(4)).toBe(250);
  });

  it('clamps before converting (0 → MIN fps, NaN → default fps)', () => {
    expect(frameIntervalMs(0)).toBe(1000 / MIN_CINE_FPS);
    expect(frameIntervalMs(NaN)).toBe(1000 / DEFAULT_CINE_FPS);
  });
});

describe('nextCineFrame — control-point advance', () => {
  it('advances one frame within the range', () => {
    expect(nextCineFrame(0, 5)).toBe(1);
    expect(nextCineFrame(3, 5)).toBe(4);
  });

  it('wraps to 0 at the last frame when looping (default)', () => {
    expect(nextCineFrame(4, 5)).toBe(0);
  });

  it('holds the last frame when loop=false', () => {
    expect(nextCineFrame(4, 5, false)).toBe(4);
    expect(nextCineFrame(3, 5, false)).toBe(4);
  });

  it('returns 0 when there are no control points (cpCount 0/negative/NaN)', () => {
    expect(nextCineFrame(2, 0)).toBe(0);
    expect(nextCineFrame(2, -1)).toBe(0);
    expect(nextCineFrame(2, NaN)).toBe(0);
  });

  it('stays at 0 for a single-CP beam (loop and no-loop)', () => {
    expect(nextCineFrame(0, 1)).toBe(0);
    expect(nextCineFrame(0, 1, false)).toBe(0);
  });

  it('treats non-finite/negative current as a restart from 0', () => {
    expect(nextCineFrame(-1, 5)).toBe(0);
    expect(nextCineFrame(NaN, 5)).toBe(0);
  });

  it('handles current beyond the range like the last frame', () => {
    expect(nextCineFrame(10, 5)).toBe(0);
    expect(nextCineFrame(10, 5, false)).toBe(4);
  });
});
