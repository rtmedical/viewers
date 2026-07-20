import { VIDEO_MIME_CANDIDATES, exportFilename, pickVideoMimeType } from './cineExport';

describe('pickVideoMimeType (RTV-95)', () => {
  it('prefers MP4/H.264 over everything when supported', () => {
    expect(pickVideoMimeType(undefined, () => true)).toBe('video/mp4;codecs=avc1');
  });

  it('walks the default candidates in order (MP4 → WebM fallback)', () => {
    expect(VIDEO_MIME_CANDIDATES).toEqual([
      'video/mp4;codecs=avc1',
      'video/mp4',
      'video/webm;codecs=vp9',
      'video/webm',
    ]);
    const webmOnly = (type: string) => type.startsWith('video/webm');
    expect(pickVideoMimeType(undefined, webmOnly)).toBe('video/webm;codecs=vp9');
    const plainWebmOnly = (type: string) => type === 'video/webm';
    expect(pickVideoMimeType(undefined, plainWebmOnly)).toBe('video/webm');
  });

  it('respects an explicit candidate list, in the given order', () => {
    const picked = pickVideoMimeType(['video/webm', 'video/mp4'], () => true);
    expect(picked).toBe('video/webm');
  });

  it('returns null when nothing is supported', () => {
    expect(pickVideoMimeType(undefined, () => false)).toBeNull();
    expect(pickVideoMimeType(['video/mp4'], () => false)).toBeNull();
  });

  it('treats a throwing predicate as unsupported instead of crashing', () => {
    const throwsOnMp4 = (type: string) => {
      if (type.includes('mp4')) {
        throw new Error('boom');
      }
      return true;
    };
    expect(pickVideoMimeType(undefined, throwsOnMp4)).toBe('video/webm;codecs=vp9');
  });

  it('returns null when no predicate is injected and MediaRecorder is absent (jsdom)', () => {
    // jsdom has no MediaRecorder — the default predicate must fail closed.
    expect(pickVideoMimeType()).toBeNull();
  });
});

describe('exportFilename (RTV-95)', () => {
  it('builds rt-cine-<desc>-<now> with the extension from the MIME container', () => {
    expect(exportFilename('CHEST CT', 'video/mp4;codecs=avc1', '20260720-1015')).toBe(
      'rt-cine-CHEST-CT-20260720-1015.mp4'
    );
    expect(exportFilename('CHEST CT', 'video/webm;codecs=vp9', '20260720-1015')).toBe(
      'rt-cine-CHEST-CT-20260720-1015.webm'
    );
    expect(exportFilename('CHEST CT', 'video/mp4', 'now')).toBe('rt-cine-CHEST-CT-now.mp4');
  });

  it('sanitizes hostile series descriptions to filesystem-safe tokens', () => {
    expect(exportFilename('T2/FLAIR: axial  (post-op)', 'video/webm', '20260720')).toBe(
      'rt-cine-T2-FLAIR-axial-post-op-20260720.webm'
    );
    expect(exportFilename('../..\\evil', 'video/webm', '20260720')).toBe(
      'rt-cine-evil-20260720.webm'
    );
  });

  it('drops the description part when it is missing or unsanitizable', () => {
    expect(exportFilename(undefined, 'video/mp4', '20260720')).toBe('rt-cine-20260720.mp4');
    expect(exportFilename('///***', 'video/mp4', '20260720')).toBe('rt-cine-20260720.mp4');
  });

  it('caps runaway descriptions at 60 characters', () => {
    const name = exportFilename('x'.repeat(200), 'video/webm', '20260720');
    expect(name).toBe(`rt-cine-${'x'.repeat(60)}-20260720.webm`);
  });
});
