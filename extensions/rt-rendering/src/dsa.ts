/**
 * Digital Subtraction Angiography — pure core (RTV-65).
 *
 * DSA subtracts a pre-contrast **mask** frame from every later frame, so what remains
 * is what changed: the contrast column in the vessels, on a flat grey background.
 *
 * Two things make a naive implementation look broken, and both are handled here:
 *
 * 1. **The result is signed and centred on zero.** Subtracting two similar images
 *    gives values around 0, mostly negative where contrast darkens the pixel. Keeping
 *    the source window/level renders a uniformly black frame, and the usual reaction
 *    is "the subtraction did not work". {@link subtractionWindow} derives the window
 *    the result actually needs.
 * 2. **The mask has to be a pre-contrast frame.** Subtracting a frame that already has
 *    contrast in it erases the vessels instead of revealing them.
 *    {@link detectMaskFrame} picks one from the intensity curve rather than assuming
 *    frame 0 — many acquisitions start a beat or two before the run.
 *
 * Framework-free: works on plain typed arrays, so it is testable without a viewport.
 * Zero-fork per RTV-114.
 */

/** Anything indexable by number with a length — a frame's pixel data. */
export interface PixelFrame {
  readonly length: number;
  [index: number]: number;
}

export interface SubtractOptions {
  /**
   * Value the unchanged background maps to. Subtracted data is centred on zero, and a
   * viewer that cannot render negatives needs an offset; 0 keeps it signed.
   */
  offset?: number;
  /** Multiplies the difference — the usual "contrast" control on a DSA panel. */
  gain?: number;
  /** Reuse an existing buffer instead of allocating. */
  output?: Float32Array;
  /**
   * Invert the sign. Contrast *lowers* pixel values in X-ray, so the raw difference is
   * negative in the vessels; inverting renders them bright, which is the convention
   * most angiographers expect.
   */
  invert?: boolean;
}

/**
 * `frame - mask`, element-wise.
 *
 * Non-finite samples on either side produce `offset` (i.e. "no change") rather than
 * NaN: one bad pixel must not poison the window/level statistics of the whole frame.
 *
 * @throws RangeError when the frames cannot be compared.
 */
export function subtractFrame(
  frame: PixelFrame,
  mask: PixelFrame,
  options: SubtractOptions = {}
): Float32Array {
  if (!frame?.length || !mask?.length) {
    throw new RangeError('subtractFrame: frame and mask are required.');
  }
  if (frame.length !== mask.length) {
    throw new RangeError(
      `subtractFrame: size mismatch (frame ${frame.length}, mask ${mask.length}).`
    );
  }

  const length = frame.length;
  if (options.output && options.output.length < length) {
    throw new RangeError(
      `subtractFrame: output holds ${options.output.length}, needs ${length}.`
    );
  }

  const out = options.output ?? new Float32Array(length);
  const offset = Number.isFinite(Number(options.offset)) ? Number(options.offset) : 0;
  const gain = Number.isFinite(Number(options.gain)) && Number(options.gain) !== 0
    ? Number(options.gain)
    : 1;
  const sign = options.invert ? -1 : 1;

  for (let i = 0; i < length; i++) {
    const a = frame[i];
    const b = mask[i];
    out[i] =
      Number.isFinite(a) && Number.isFinite(b) ? offset + sign * gain * (a - b) : offset;
  }
  return out;
}

export interface FrameStats {
  min: number;
  max: number;
  mean: number;
  /** Samples that were finite. */
  count: number;
}

/** Min/max/mean over a frame, ignoring non-finite samples. */
export function frameStats(frame: PixelFrame): FrameStats {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let total = 0;
  let count = 0;

  for (let i = 0; i < (frame?.length ?? 0); i++) {
    const value = frame[i];
    if (!Number.isFinite(value)) {
      continue;
    }
    if (value < min) {
      min = value;
    }
    if (value > max) {
      max = value;
    }
    total += value;
    count += 1;
  }

  if (!count) {
    return { min: 0, max: 0, mean: 0, count: 0 };
  }
  return { min, max, mean: total / count, count };
}

export interface WindowLevel {
  windowWidth: number;
  windowCenter: number;
}

/**
 * Window/level for a subtracted frame.
 *
 * Centred on the background value, not on the data's midpoint: after subtraction the
 * vast majority of pixels *are* background, so a naive (min+max)/2 centre is dragged
 * around by a handful of extreme pixels and the vessels wash out.
 *
 * The width comes from a symmetric span around the background, sized by the larger
 * excursion, so a mostly-negative result (the usual case, contrast darkens) still
 * renders with the background in mid-grey.
 */
export function subtractionWindow(stats: FrameStats, offset = 0): WindowLevel {
  if (!stats || !stats.count) {
    return { windowWidth: 1, windowCenter: offset };
  }
  const spread = Math.max(Math.abs(stats.max - offset), Math.abs(offset - stats.min));
  // A perfectly flat result (mask subtracted from itself) has zero spread; a
  // zero-width window would divide by zero downstream.
  const windowWidth = spread > 0 ? spread * 2 : 1;
  return { windowWidth, windowCenter: offset };
}

export interface MaskDetection {
  /** Index of the chosen mask frame. */
  index: number;
  /** How it was chosen. */
  reason: 'contrastArrival' | 'firstFrame' | 'onlyFrame';
  /** Mean intensity per frame, for a curve in the panel. */
  meanCurve: number[];
}

/**
 * Chooses a pre-contrast mask frame from the intensity curve.
 *
 * Contrast is radio-opaque, so it *lowers* mean intensity as it fills the field. The
 * mask is the last frame before that drop starts — not simply frame 0, because runs
 * routinely start a beat or two early and the first frames can be the noisiest.
 *
 * The drop has to clear `threshold` (as a fraction of the pre-contrast baseline) to
 * count, so ordinary frame-to-frame noise does not get mistaken for contrast arrival.
 * When nothing clears it, the first frame is used and `reason` says so.
 */
export function detectMaskFrame(frames: PixelFrame[], threshold = 0.02): MaskDetection {
  const list = (frames ?? []).filter(Boolean);
  const meanCurve = list.map(f => frameStats(f).mean);

  if (list.length <= 1) {
    return { index: 0, reason: 'onlyFrame', meanCurve };
  }

  // Baseline from the opening frames, so a single noisy frame does not set it.
  const baselineCount = Math.max(1, Math.min(3, Math.floor(list.length / 4)));
  const baseline =
    meanCurve.slice(0, baselineCount).reduce((sum, v) => sum + v, 0) / baselineCount;

  const limit = Number.isFinite(Number(threshold)) ? Math.abs(Number(threshold)) : 0.02;
  const trigger = baseline - Math.abs(baseline) * limit;

  for (let i = 1; i < meanCurve.length; i++) {
    if (meanCurve[i] < trigger) {
      // The frame *before* the drop is the last clean one.
      return { index: i - 1, reason: 'contrastArrival', meanCurve };
    }
  }

  return { index: 0, reason: 'firstFrame', meanCurve };
}

export interface DsaState {
  enabled: boolean;
  /** Index of the mask frame. */
  maskIndex: number;
  gain: number;
  invert: boolean;
  /** Background value the unchanged pixels map to. */
  offset: number;
}

export const DSA_GAIN_MIN = 0.1;
export const DSA_GAIN_MAX = 10;

export function defaultDsaState(): DsaState {
  return { enabled: false, maskIndex: 0, gain: 1, invert: true, offset: 0 };
}

export function clampGain(gain: unknown): number {
  const value = Number(gain);
  if (!Number.isFinite(value) || value === 0) {
    return 1;
  }
  return Math.min(DSA_GAIN_MAX, Math.max(DSA_GAIN_MIN, Math.abs(value)));
}

/** Clamps a mask index into the frame range. */
export function clampMaskIndex(index: unknown, frameCount: number): number {
  const count = Math.max(0, Math.floor(Number(frameCount) || 0));
  if (!count) {
    return 0;
  }
  const value = Math.floor(Number(index));
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(count - 1, Math.max(0, value));
}

/** One-line summary for the toolbar. */
export function describeDsa(state: DsaState, detection?: MaskDetection): string {
  if (!state?.enabled) {
    return 'DSA off';
  }
  const parts = [`DSA mask ${state.maskIndex + 1}`];
  if (state.gain !== 1) {
    parts.push(`gain ${Math.round(state.gain * 100) / 100}x`);
  }
  if (detection?.reason === 'firstFrame') {
    parts.push('no contrast arrival detected');
  }
  return parts.join(' · ');
}
