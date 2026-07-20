/**
 * Cine → video export (RTV-95) — record the active viewport's frame sweep to
 * an MP4 (H.264) or WebM file, fully client-side.
 *
 * Same split as the SC feature (RTV-203): the container/codec pick and the
 * filename shaping are pure and unit-tested here; the MediaRecorder capture
 * loop is thin DOM glue (validated E2E). MP4/H.264 depends on the browser's
 * `MediaRecorder` encoder support (Chrome ≥126, current Safari); elsewhere we
 * fall back to WebM (VP9/VP8). Audio (recorded report narration) is a
 * follow-up — this exports video only.
 */

/** Container/codec candidates, most desirable first (MP4 → WebM fallback). */
export const VIDEO_MIME_CANDIDATES = [
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm',
];

/** `MediaRecorder.isTypeSupported` when the runtime has it, else "nothing". */
function defaultIsTypeSupported(type: string): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof MediaRecorder.isTypeSupported === 'function' &&
    MediaRecorder.isTypeSupported(type)
  );
}

/**
 * Pick the first recordable video MIME type. Pure: the support predicate is
 * injectable (defaults to `MediaRecorder.isTypeSupported`); a throwing
 * predicate counts as "unsupported". Returns `null` when nothing matches —
 * callers must surface that as a clear error.
 */
export function pickVideoMimeType(
  preferred?: string[],
  isSupported: (type: string) => boolean = defaultIsTypeSupported
): string | null {
  const candidates = preferred?.length ? preferred : VIDEO_MIME_CANDIDATES;
  for (const type of candidates) {
    try {
      if (isSupported(type)) {
        return type;
      }
    } catch (e) {
      /* an exploding predicate means "not supported" */
    }
  }
  return null;
}

/** Keep [A-Za-z0-9._-], collapse the rest into single dashes, cap length. */
function sanitizeToken(value: string | undefined, maxLength = 60): string {
  return (value ?? '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, maxLength);
}

/**
 * Download filename for an exported cine: `rt-cine-<desc>-<now>.<ext>` (the
 * description part is dropped when empty/unsanitizable). Pure — `now` is a
 * caller-formatted timestamp string; extension follows the MIME container.
 */
export function exportFilename(
  seriesDescription: string | undefined,
  mimeType: string,
  now: string
): string {
  const ext = /mp4/i.test(mimeType ?? '') ? 'mp4' : 'webm';
  const desc = sanitizeToken(seriesDescription);
  const stamp = sanitizeToken(now) || 'export';
  return desc ? `rt-cine-${desc}-${stamp}.${ext}` : `rt-cine-${stamp}.${ext}`;
}

export interface RecordCanvasFramesOptions {
  /** The (export-resolution) canvas the frames are drawn onto. */
  canvas: HTMLCanvasElement;
  /** Renders frame `i` onto `canvas`; awaited before the frame is emitted. */
  drawFrame: (frameIndex: number) => Promise<void> | void;
  frameCount: number;
  /** Playback rate of the resulting video (frames per second). */
  fps: number;
  /** A `pickVideoMimeType` result — the recorder's container/codec. */
  mimeType: string;
  /** Optional target video bitrate (default: MediaRecorder's own). */
  bitsPerSecond?: number;
}

/**
 * Record `frameCount` canvas frames into a video Blob — DOM glue (validated
 * E2E). Uses `canvas.captureStream(0)` + `CanvasCaptureMediaStreamTrack
 * .requestFrame()` so each drawn frame is emitted exactly once regardless of
 * draw latency; browsers without `requestFrame` fall back to a continuous
 * `captureStream(fps)`, where the awaited per-frame delay paces the capture.
 */
export async function recordCanvasFrames(options: RecordCanvasFramesOptions): Promise<Blob> {
  const { canvas, drawFrame, frameCount, fps, mimeType, bitsPerSecond } = options;
  const framePeriodMs = 1000 / Math.max(1, fps);

  let stream = canvas.captureStream(0);
  let track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
  const canRequestFrame = typeof track?.requestFrame === 'function';
  if (!canRequestFrame) {
    track?.stop?.();
    stream = canvas.captureStream(Math.max(1, fps));
    track = stream.getVideoTracks()[0];
  }

  const recorder = new MediaRecorder(stream, {
    mimeType,
    ...(bitsPerSecond ? { videoBitsPerSecond: bitsPerSecond } : {}),
  });
  const chunks: Blob[] = [];
  let recorderError: Error | null = null;
  const done = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = event => {
      if (event.data?.size) {
        chunks.push(event.data);
      }
    };
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType.split(';')[0] }));
    recorder.onerror = (event: Event & { error?: Error }) => {
      recorderError = event.error ?? new Error('MediaRecorder error');
      reject(recorderError);
    };
  });
  // A rejection can fire while the loop is between awaits — observe it so a
  // mid-loop recorder failure never surfaces as an unhandled rejection.
  done.catch(() => {});

  recorder.start();
  try {
    // Absolute-deadline pacing: captureStream(0) stamps each frame with the
    // wall-clock of requestFrame, so the sleep must ABSORB the draw cost
    // (deadline t0 + (i+1)·period) instead of adding to it — otherwise the
    // video plays slower than the requested fps by the accumulated draw time.
    const t0 = performance.now();
    for (let i = 0; i < frameCount; i++) {
      if (recorderError) {
        throw recorderError;
      }
      await drawFrame(i);
      if (canRequestFrame) {
        track.requestFrame();
      }
      const wait = t0 + (i + 1) * framePeriodMs - performance.now();
      if (wait > 0) {
        await new Promise(resolve => setTimeout(resolve, wait));
      }
    }
  } finally {
    // Always release the encoder/track — a drawFrame throw still cleans up
    // (the throw wins over `done`, which then resolves unobserved).
    if (recorder.state !== 'inactive') {
      recorder.stop();
    }
    stream.getTracks().forEach(t => t.stop());
  }
  return done;
}

/**
 * Trigger a browser download of `blob` as `filename` — anchor +
 * `URL.createObjectURL` + revoke, the same local pattern as
 * `downloadKosDocument` (rt-capture deliberately does not import @ohif/core).
 */
export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') {
    return;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
