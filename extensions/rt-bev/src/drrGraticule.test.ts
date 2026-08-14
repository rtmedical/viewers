/**
 * RTV-143 graticule tests, against the REAL Eclipse DRR fixture: 512x512,
 * RTImagePosition [-249.51171875, 249.51171875], spacing 0.9765625 mm, SID = SAD =
 * 1000. That geometry puts the beam axis at pixel (255.5, 255.5) — dead centre —
 * and makes 10 mm exactly 10.24 px, so the numbers below are checkable by hand.
 */
import { rtImageGeometry } from './__fixtures__/rtplanBevFixture';
import {
  buildDrrGraticule,
  buildGraticuleSvg,
  buildGraticuleSvgDocument,
  describeGraticule,
  GRATICULE_OVERLAY_CLASS,
  GRATICULE_SPACING_MM_DEFAULT,
  mountGraticule,
  unmountGraticule,
} from './drrGraticule';

const PX_PER_MM = 1 / 0.9765625; // 1.024
const CENTER = 255.5;

describe('buildDrrGraticule — placement', () => {
  it('puts the beam axis at the centre of the Eclipse DRR', () => {
    const g = buildDrrGraticule(rtImageGeometry)!;
    expect(g.centerPx[0]).toBeCloseTo(CENTER, 6);
    expect(g.centerPx[1]).toBeCloseTo(CENTER, 6);
  });

  it('draws two arms spanning the requested extent', () => {
    const g = buildDrrGraticule(rtImageGeometry, { extentMm: 150 })!;
    expect(g.axes).toHaveLength(2);

    const [xArm, yArm] = g.axes;
    // 150 mm is 153.6 px at 0.9765625 mm/px.
    expect(xArm.x1).toBeCloseTo(CENTER - 150 * PX_PER_MM, 4);
    expect(xArm.x2).toBeCloseTo(CENTER + 150 * PX_PER_MM, 4);
    expect(xArm.y1).toBeCloseTo(CENTER, 4);
    expect(yArm.y1).toBeCloseTo(CENTER + 150 * PX_PER_MM, 4);
    expect(yArm.x1).toBeCloseTo(CENTER, 4);
  });

  it('honours the isocenter-plane scale: 10 mm is 10.24 px', () => {
    const g = buildDrrGraticule(rtImageGeometry, { spacingMm: 10, extentMm: 20, majorEvery: 0 })!;
    const onXArm = g.ticks.filter(t => Math.abs(t.y1 - t.y2) > Math.abs(t.x1 - t.x2));
    const xs = [...new Set(onXArm.map(t => Math.round((t.x1 - CENTER) * 100) / 100))].sort(
      (a, b) => a - b
    );
    expect(xs).toEqual([-20.48, -10.24, 10.24, 20.48]);
  });
});

describe('buildDrrGraticule — collimator rotation', () => {
  it('turns the horizontal arm vertical at 90 degrees', () => {
    const g = buildDrrGraticule(rtImageGeometry, { extentMm: 150, collimatorDeg: 90 })!;
    const [xArm] = g.axes;
    // Rotated a quarter turn: the arm now runs along the image's y axis.
    expect(xArm.x1).toBeCloseTo(CENTER, 3);
    expect(xArm.x2).toBeCloseTo(CENTER, 3);
    expect(Math.abs(xArm.y2 - xArm.y1)).toBeCloseTo(300 * PX_PER_MM, 3);
  });

  it('is unchanged by a full turn', () => {
    const a = buildDrrGraticule(rtImageGeometry, { collimatorDeg: 0 })!;
    const b = buildDrrGraticule(rtImageGeometry, { collimatorDeg: 360 })!;
    expect(b.axes[0].x1).toBeCloseTo(a.axes[0].x1, 3);
    expect(b.axes[0].y1).toBeCloseTo(a.axes[0].y1, 3);
  });

  it('leaves the beam axis fixed under rotation', () => {
    // Rotation is about the axis, so the centre must not move.
    for (const collimatorDeg of [0, 15, 45, 90, 180, -30]) {
      const g = buildDrrGraticule(rtImageGeometry, { collimatorDeg })!;
      expect(g.centerPx[0]).toBeCloseTo(CENTER, 6);
      expect(g.centerPx[1]).toBeCloseTo(CENTER, 6);
    }
  });

  it('records the angle it used', () => {
    expect(buildDrrGraticule(rtImageGeometry, { collimatorDeg: 45 })!.collimatorDeg).toBe(45);
    expect(buildDrrGraticule(rtImageGeometry, { collimatorDeg: NaN })!.collimatorDeg).toBe(0);
    expect(buildDrrGraticule(rtImageGeometry)!.collimatorDeg).toBe(0);
  });
});

describe('buildDrrGraticule — ticks and labels', () => {
  it('emits four ticks per step: both signs on both arms', () => {
    const g = buildDrrGraticule(rtImageGeometry, { spacingMm: 10, extentMm: 150 })!;
    // 15 steps x 2 signs x 2 arms.
    expect(g.ticks).toHaveLength(15 * 4);
  });

  it('marks every Nth tick as major and labels only those', () => {
    const g = buildDrrGraticule(rtImageGeometry, {
      spacingMm: 10,
      extentMm: 150,
      majorEvery: 5,
    })!;
    // k = 5, 10, 15 -> 3 steps x 2 signs x 2 arms.
    expect(g.ticks.filter(t => t.major)).toHaveLength(3 * 4);
    expect(g.labels).toHaveLength(3 * 4);
    expect(g.labels.map(l => l.mm)).toEqual(
      expect.arrayContaining([50, -50, 100, -100, 150, -150])
    );
  });

  it('labels both axes', () => {
    const g = buildDrrGraticule(rtImageGeometry, { spacingMm: 50, extentMm: 100, majorEvery: 1 })!;
    expect(g.labels.some(l => l.axis === 'x')).toBe(true);
    expect(g.labels.some(l => l.axis === 'y')).toBe(true);
  });

  it('emits no major ticks or labels when majorEvery is 0', () => {
    const g = buildDrrGraticule(rtImageGeometry, { majorEvery: 0 })!;
    expect(g.ticks.some(t => t.major)).toBe(false);
    expect(g.labels).toHaveLength(0);
  });

  it('makes major ticks longer than minor ones', () => {
    const g = buildDrrGraticule(rtImageGeometry, { spacingMm: 10, extentMm: 50, majorEvery: 5 })!;
    const length = (t: { x1: number; y1: number; x2: number; y2: number }) =>
      Math.hypot(t.x2 - t.x1, t.y2 - t.y1);
    const minor = g.ticks.find(t => !t.major)!;
    const major = g.ticks.find(t => t.major)!;
    expect(length(major)).toBeGreaterThan(length(minor));
  });
});

describe('buildDrrGraticule — option clamping and guards', () => {
  it('clamps the spacing and extent', () => {
    expect(buildDrrGraticule(rtImageGeometry, { spacingMm: 0 })!.spacingMm).toBe(1);
    expect(buildDrrGraticule(rtImageGeometry, { spacingMm: 9999 })!.spacingMm).toBe(100);
    expect(buildDrrGraticule(rtImageGeometry, { extentMm: 99999 })!.extentMm).toBe(500);
  });

  it('never lets the extent fall below one step', () => {
    // An extent under the spacing would draw a reticle with no ticks at all.
    const g = buildDrrGraticule(rtImageGeometry, { spacingMm: 50, extentMm: 5 })!;
    expect(g.extentMm).toBeGreaterThanOrEqual(g.spacingMm);
    expect(g.ticks.length).toBeGreaterThan(0);
  });

  it('falls back to the defaults for nonsense', () => {
    const g = buildDrrGraticule(rtImageGeometry, { spacingMm: NaN, extentMm: undefined })!;
    expect(g.spacingMm).toBe(GRATICULE_SPACING_MM_DEFAULT);
  });

  it('returns null rather than guessing when the geometry is unusable', () => {
    // A reticle on guessed geometry puts confident mm labels on the wrong pixels.
    expect(buildDrrGraticule(null)).toBeNull();
    expect(buildDrrGraticule(undefined)).toBeNull();
    expect(buildDrrGraticule({} as never)).toBeNull();
    expect(
      buildDrrGraticule({ rtImagePositionMm: [0, 0], pixelSpacingMm: [0, 0] } as never)
    ).toBeNull();
    expect(
      buildDrrGraticule({ rtImagePositionMm: [0, 0], pixelSpacingMm: [NaN, 1] } as never)
    ).toBeNull();
  });
});

describe('SVG', () => {
  const graticule = () => buildDrrGraticule(rtImageGeometry, { spacingMm: 50, extentMm: 100 });

  it('emits a line per axis and tick, plus the axis marker', () => {
    const g = graticule()!;
    const svg = buildGraticuleSvg(g, { labels: false });
    expect(svg.match(/<line /g)).toHaveLength(g.axes.length + g.ticks.length);
    expect(svg).toContain('<circle');
  });

  it('can hide the axis marker', () => {
    expect(buildGraticuleSvg(graticule(), { centerRadiusPx: 0 })).not.toContain('<circle');
  });

  it('never captures pointer events', () => {
    expect(buildGraticuleSvg(graticule())).toContain('pointer-events="none"');
  });

  it('escapes anything reaching an attribute', () => {
    const svg = buildGraticuleSvg(graticule(), { color: '"><script>x</script>' });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&quot;');
  });

  it('returns an empty string for a null graticule', () => {
    expect(buildGraticuleSvg(null)).toBe('');
    expect(buildGraticuleSvgDocument(null, 512, 512)).toBe('');
  });

  it('sizes the document to the image', () => {
    const svg = buildGraticuleSvgDocument(graticule(), 512, 512);
    expect(svg).toContain('viewBox="0 0 512 512"');
    expect(svg).toContain('preserveAspectRatio="none"');
  });

  it('returns an empty document for a degenerate image size', () => {
    expect(buildGraticuleSvgDocument(graticule(), 0, 512)).toBe('');
    expect(buildGraticuleSvgDocument(graticule(), NaN as never, 512)).toBe('');
  });
});

describe('mount / unmount', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => host.remove());

  const markup = () =>
    buildGraticuleSvgDocument(buildDrrGraticule(rtImageGeometry), 512, 512);

  it('mounts once and replaces on re-mount', () => {
    expect(mountGraticule(host, markup())).toBe(true);
    mountGraticule(host, markup());
    expect(host.querySelectorAll(`.${GRATICULE_OVERLAY_CLASS}-svg`)).toHaveLength(1);
  });

  it('empty markup clears an existing graticule', () => {
    mountGraticule(host, markup());
    expect(mountGraticule(host, '')).toBe(false);
    expect(host.querySelector(`.${GRATICULE_OVERLAY_CLASS}-svg`)).toBeNull();
  });

  it('unmounts and reports whether one was there', () => {
    mountGraticule(host, markup());
    expect(unmountGraticule(host)).toBe(true);
    expect(unmountGraticule(host)).toBe(false);
  });

  it('survives a missing host', () => {
    expect(mountGraticule(null, '<svg/>')).toBe(false);
    expect(unmountGraticule(null)).toBe(false);
  });
});

describe('describeGraticule', () => {
  it('reports the spacing', () => {
    expect(describeGraticule(buildDrrGraticule(rtImageGeometry, { spacingMm: 20 }))).toBe(
      'Graticule 20 mm'
    );
  });

  it('adds the collimator and gantry angles', () => {
    const g = buildDrrGraticule(rtImageGeometry, { collimatorDeg: 45 });
    expect(describeGraticule(g, 270)).toBe('Graticule 10 mm · coll 45° · gantry 270°');
  });

  it('omits a zero collimator angle as noise', () => {
    expect(describeGraticule(buildDrrGraticule(rtImageGeometry), 0)).toBe(
      'Graticule 10 mm · gantry 0°'
    );
  });

  it('says so when the geometry is unusable', () => {
    expect(describeGraticule(null)).toMatch(/unavailable/i);
  });
});
