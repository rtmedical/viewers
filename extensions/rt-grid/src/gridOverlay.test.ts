import { buildGridLines } from './grid';
import {
  buildGridSvg,
  buildGridSvgDocument,
  GRID_OVERLAY_CLASS,
  mountGridOverlay,
  unmountGridOverlay,
} from './gridOverlay';

const lines = () =>
  buildGridLines({ widthPx: 100, heightPx: 100, pixelSpacingMm: 1, spacingMm: 10, majorEvery: 5 });

describe('buildGridSvg', () => {
  it('emits one line per gridline', () => {
    const l = lines();
    const svg = buildGridSvg(l, 100, 100, { labels: false });
    expect(svg.match(/<line /g)).toHaveLength(l.vertical.length + l.horizontal.length);
  });

  it('spans the full image on both axes', () => {
    const svg = buildGridSvg(lines(), 100, 100, { labels: false });
    // A vertical line at x=0 runs the whole height; a horizontal one the whole width.
    expect(svg).toContain('x1="0" y1="0" x2="0" y2="100"');
    expect(svg).toContain('x1="0" y1="0" x2="100" y2="0"');
  });

  it('draws major lines heavier and in the major colour', () => {
    const svg = buildGridSvg(lines(), 100, 100, {
      color: '#111111',
      majorColor: '#eeeeee',
      minorWidth: 0.5,
      majorWidth: 2,
      labels: false,
    });
    expect(svg).toContain('stroke="#eeeeee" stroke-width="2"');
    expect(svg).toContain('stroke="#111111" stroke-width="0.5"');
  });

  it('falls back to the minor colour when no major colour is given', () => {
    const svg = buildGridSvg(lines(), 100, 100, { color: '#abcdef', labels: false });
    expect(svg).not.toContain('#78a9ff');
    expect(svg).toContain('#abcdef');
  });

  it('labels only major lines, and only along the axes', () => {
    const svg = buildGridSvg(lines(), 100, 100, { labels: true });
    const labels = svg.match(/<text /g) ?? [];
    // 3 major verticals (0, 50, 100) + the horizontals past the top-label gutter.
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.length).toBeLessThan(lines().vertical.length + lines().horizontal.length);
  });

  it('omits labels on request', () => {
    expect(buildGridSvg(lines(), 100, 100, { labels: false })).not.toContain('<text');
  });

  it('never captures pointer events', () => {
    // The grid is decoration; it must not eat clicks meant for the image tools.
    expect(buildGridSvg(lines(), 100, 100)).toContain('pointer-events="none"');
  });

  it('returns an empty string when there is nothing to draw', () => {
    const empty = buildGridLines({ widthPx: 0, heightPx: 0, spacingMm: 10 });
    expect(buildGridSvg(empty, 0, 0)).toBe('');
    expect(buildGridSvg(undefined as never, 100, 100)).toBe('');
  });

  it('escapes anything that reaches an attribute', () => {
    // Colours come from configuration, which is not necessarily trustworthy.
    const svg = buildGridSvg(lines(), 100, 100, { color: '"><script>x</script>', labels: false });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&quot;');
  });
});

describe('buildGridSvgDocument', () => {
  it('sizes the viewBox in image pixels', () => {
    const svg = buildGridSvgDocument(lines(), 120, 90);
    expect(svg).toContain('viewBox="0 0 120 90"');
    // preserveAspectRatio="none" is what lets CSS scale it with the image.
    expect(svg).toContain('preserveAspectRatio="none"');
  });

  it('is absolutely positioned and transparent to the pointer', () => {
    const svg = buildGridSvgDocument(lines(), 100, 100);
    expect(svg).toContain('position:absolute');
    expect(svg).toContain('pointer-events:none');
  });

  it('returns an empty string when the body is empty', () => {
    const empty = buildGridLines({ widthPx: 0, heightPx: 0, spacingMm: 10 });
    expect(buildGridSvgDocument(empty, 0, 0)).toBe('');
  });
});

describe('mount / unmount', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  it('mounts the overlay', () => {
    expect(mountGridOverlay(host, buildGridSvgDocument(lines(), 100, 100))).toBe(true);
    expect(host.querySelectorAll(`.${GRID_OVERLAY_CLASS}-svg`)).toHaveLength(1);
  });

  it('replaces rather than stacks', () => {
    // A re-render must not leave two grids fighting.
    const markup = buildGridSvgDocument(lines(), 100, 100);
    mountGridOverlay(host, markup);
    mountGridOverlay(host, markup);
    expect(host.querySelectorAll(`.${GRID_OVERLAY_CLASS}-svg`)).toHaveLength(1);
  });

  it('mounting empty markup clears an existing overlay', () => {
    mountGridOverlay(host, buildGridSvgDocument(lines(), 100, 100));
    expect(mountGridOverlay(host, '')).toBe(false);
    expect(host.querySelector(`.${GRID_OVERLAY_CLASS}-svg`)).toBeNull();
  });

  it('unmounts, and reports whether anything was there', () => {
    mountGridOverlay(host, buildGridSvgDocument(lines(), 100, 100));
    expect(unmountGridOverlay(host)).toBe(true);
    expect(unmountGridOverlay(host)).toBe(false);
  });

  it('survives a missing host', () => {
    expect(mountGridOverlay(null, '<svg/>')).toBe(false);
    expect(unmountGridOverlay(null)).toBe(false);
  });
});
