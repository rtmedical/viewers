import {
  clampGain,
  clampMaskIndex,
  defaultDsaState,
  describeDsa,
  detectMaskFrame,
  DSA_GAIN_MAX,
  DSA_GAIN_MIN,
  frameStats,
  subtractFrame,
  subtractionWindow,
} from './dsa';

const flat = (value: number, length = 4) => Float32Array.from({ length }, () => value);

describe('subtractFrame', () => {
  it('subtracts element-wise', () => {
    const frame = Float32Array.from([10, 20, 30]);
    const mask = Float32Array.from([1, 2, 3]);
    // invert defaults to false here, so this is the raw difference.
    expect([...subtractFrame(frame, mask)]).toEqual([9, 18, 27]);
  });

  it('inverts so contrast renders bright', () => {
    // X-ray contrast LOWERS pixel values, so the raw difference is negative in the
    // vessels; angiographers expect them bright.
    const frame = Float32Array.from([5]);
    const mask = Float32Array.from([10]);
    expect(subtractFrame(frame, mask)[0]).toBe(-5);
    expect(subtractFrame(frame, mask, { invert: true })[0]).toBe(5);
  });

  it('applies gain and offset', () => {
    const out = subtractFrame(Float32Array.from([10]), Float32Array.from([8]), {
      gain: 3,
      offset: 100,
    });
    expect(out[0]).toBe(106);
  });

  it('treats a non-finite sample as no change rather than poisoning the frame', () => {
    // One bad pixel must not wreck the window/level statistics.
    const out = subtractFrame(
      Float32Array.from([NaN, 20]),
      Float32Array.from([1, NaN]),
      { offset: 50 }
    );
    expect([...out]).toEqual([50, 50]);
  });

  it('writes into a supplied buffer', () => {
    const output = new Float32Array(3);
    const result = subtractFrame(Float32Array.from([1, 2, 3]), flat(0, 3), { output });
    expect(result).toBe(output);
  });

  it('refuses mismatched or missing frames', () => {
    expect(() => subtractFrame(flat(1, 3), flat(1, 4))).toThrow(/size mismatch/);
    expect(() => subtractFrame(flat(1, 0), flat(1, 3))).toThrow(RangeError);
    expect(() => subtractFrame(undefined as never, flat(1))).toThrow(RangeError);
  });

  it('refuses a buffer that is too small', () => {
    expect(() =>
      subtractFrame(flat(1, 4), flat(1, 4), { output: new Float32Array(2) })
    ).toThrow(/needs 4/);
  });

  it('ignores a zero or nonsense gain', () => {
    const out = subtractFrame(Float32Array.from([10]), Float32Array.from([8]), { gain: 0 });
    expect(out[0]).toBe(2);
  });
});

describe('frameStats', () => {
  it('reports min, max and mean over finite samples', () => {
    expect(frameStats(Float32Array.from([1, 3, NaN, 5]))).toEqual({
      min: 1,
      max: 5,
      mean: 3,
      count: 3,
    });
  });

  it('is all zeros for an empty or all-NaN frame', () => {
    expect(frameStats(new Float32Array(0)).count).toBe(0);
    expect(frameStats(Float32Array.from([NaN, NaN]))).toEqual({ min: 0, max: 0, mean: 0, count: 0 });
  });
});

describe('subtractionWindow', () => {
  it('centres on the background, not on the data midpoint', () => {
    // After subtraction most pixels ARE background; a (min+max)/2 centre would be
    // dragged around by a handful of extreme pixels and wash the vessels out.
    const stats = frameStats(Float32Array.from([0, 0, 0, 0, -900]));
    const wl = subtractionWindow(stats, 0);
    expect(wl.windowCenter).toBe(0);
    expect(wl.windowWidth).toBe(1800);
  });

  it('sizes the window from the larger excursion', () => {
    const stats = frameStats(Float32Array.from([-100, 0, 40]));
    expect(subtractionWindow(stats, 0).windowWidth).toBe(200);
  });

  it('honours a non-zero background offset', () => {
    const stats = frameStats(Float32Array.from([1000, 1000, 600]));
    const wl = subtractionWindow(stats, 1000);
    expect(wl.windowCenter).toBe(1000);
    expect(wl.windowWidth).toBe(800);
  });

  it('never returns a zero-width window', () => {
    // Mask subtracted from itself is perfectly flat; a zero width divides by zero
    // downstream.
    expect(subtractionWindow(frameStats(flat(0)), 0).windowWidth).toBe(1);
    expect(subtractionWindow(frameStats(new Float32Array(0)), 0).windowWidth).toBe(1);
  });
});

describe('detectMaskFrame', () => {
  /** Frames whose mean drops after `arrival`, as contrast fills the field. */
  const run = (count: number, arrival: number) =>
    Array.from({ length: count }, (_u, i) => flat(i < arrival ? 1000 : 400));

  it('picks the last frame before contrast arrives', () => {
    const detection = detectMaskFrame(run(10, 4));
    expect(detection.reason).toBe('contrastArrival');
    expect(detection.index).toBe(3);
  });

  it('does not assume frame 0', () => {
    // Runs routinely start a beat or two early, and the opening frames are noisiest.
    expect(detectMaskFrame(run(12, 5)).index).toBe(4);
  });

  it('falls back to the first frame when nothing drops', () => {
    const detection = detectMaskFrame(Array.from({ length: 8 }, () => flat(1000)));
    expect(detection.reason).toBe('firstFrame');
    expect(detection.index).toBe(0);
  });

  it('does not mistake noise for contrast', () => {
    // 0.5% wobble against a 2% threshold.
    const noisy = Array.from({ length: 10 }, (_u, i) => flat(1000 + (i % 2 ? -5 : 5)));
    expect(detectMaskFrame(noisy).reason).toBe('firstFrame');
  });

  it('respects an explicit threshold', () => {
    const gentle = Array.from({ length: 8 }, (_u, i) => flat(i < 4 ? 1000 : 985));
    expect(detectMaskFrame(gentle, 0.05).reason).toBe('firstFrame');
    expect(detectMaskFrame(gentle, 0.01).reason).toBe('contrastArrival');
  });

  it('handles a single frame and no frames', () => {
    expect(detectMaskFrame([flat(1)]).reason).toBe('onlyFrame');
    expect(detectMaskFrame([]).reason).toBe('onlyFrame');
    expect(detectMaskFrame(undefined as never).index).toBe(0);
  });

  it('returns the intensity curve for the panel', () => {
    expect(detectMaskFrame(run(5, 2)).meanCurve).toEqual([1000, 1000, 400, 400, 400]);
  });
});

describe('state helpers', () => {
  it('starts off, inverted, gain 1', () => {
    // Inverted by default: bright vessels is what angiographers expect.
    expect(defaultDsaState()).toEqual({
      enabled: false,
      maskIndex: 0,
      gain: 1,
      invert: true,
      offset: 0,
    });
  });

  it('clamps gain and rejects nonsense', () => {
    expect(clampGain(2.5)).toBe(2.5);
    expect(clampGain(0)).toBe(1);
    expect(clampGain(NaN)).toBe(1);
    expect(clampGain(999)).toBe(DSA_GAIN_MAX);
    expect(clampGain(0.001)).toBe(DSA_GAIN_MIN);
    expect(clampGain(-3)).toBe(3);
  });

  it('clamps the mask index into the run', () => {
    expect(clampMaskIndex(5, 10)).toBe(5);
    expect(clampMaskIndex(99, 10)).toBe(9);
    expect(clampMaskIndex(-1, 10)).toBe(0);
    expect(clampMaskIndex(3, 0)).toBe(0);
    expect(clampMaskIndex(NaN, 10)).toBe(0);
  });

  it('describes the state', () => {
    expect(describeDsa(defaultDsaState())).toBe('DSA off');
    const on = { ...defaultDsaState(), enabled: true, maskIndex: 3, gain: 2 };
    expect(describeDsa(on)).toBe('DSA mask 4 · gain 2x');
    expect(
      describeDsa({ ...defaultDsaState(), enabled: true }, {
        index: 0,
        reason: 'firstFrame',
        meanCurve: [],
      })
    ).toContain('no contrast arrival detected');
  });
});
