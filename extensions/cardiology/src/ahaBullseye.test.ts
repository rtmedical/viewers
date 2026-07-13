/**
 * Unit tests for the pure AHA bullseye core (RTV-48).
 */
import {
  AHA_SEGMENTS,
  AhaRing,
  COLOR_SCALES,
  ColorScaleName,
  colorForValue,
  polarPoint,
  ringSliceRange,
  segmentArcPath,
} from './ahaBullseye';

const norm360 = (deg: number) => ((deg % 360) + 360) % 360;

describe('AHA_SEGMENTS', () => {
  it('contains exactly the 17 standard segments with unique ids 1–17', () => {
    expect(AHA_SEGMENTS).toHaveLength(17);
    const ids = AHA_SEGMENTS.map(s => s.id).sort((a, b) => a - b);
    expect(ids).toEqual(Array.from({ length: 17 }, (_, i) => i + 1));
  });

  it('has the standard ring populations 6/6/4/1', () => {
    const count = (ring: AhaRing) => AHA_SEGMENTS.filter(s => s.ring === ring).length;
    expect(count('basal')).toBe(6);
    expect(count('mid')).toBe(6);
    expect(count('apical')).toBe(4);
    expect(count('apex')).toBe(1);
  });

  it('gives every segment an RTMedical i18n key with the cardio_seg_ prefix', () => {
    for (const seg of AHA_SEGMENTS) {
      expect(seg.labelKey).toMatch(/^cardio_seg_/);
    }
  });

  it.each(['basal', 'mid'] as AhaRing[])('%s ring: 6 × 60° covering 360° without overlap', ring => {
    const segs = AHA_SEGMENTS.filter(s => s.ring === ring);
    for (const s of segs) {
      expect(s.endDeg - s.startDeg).toBe(60);
    }
    const starts = segs.map(s => norm360(s.startDeg)).sort((a, b) => a - b);
    // Sorted normalized starts must be evenly spaced by the sweep → partition
    // of the circle with no overlap and no gap.
    expect(starts).toEqual([30, 90, 150, 210, 270, 330]);
  });

  it('apical ring: 4 × 90° covering 360° without overlap', () => {
    const segs = AHA_SEGMENTS.filter(s => s.ring === 'apical');
    for (const s of segs) {
      expect(s.endDeg - s.startDeg).toBe(90);
    }
    const starts = segs.map(s => norm360(s.startDeg)).sort((a, b) => a - b);
    expect(starts).toEqual([45, 135, 225, 315]);
  });

  it('apex is a full 360° disc', () => {
    const apex = AHA_SEGMENTS.find(s => s.ring === 'apex');
    expect(apex.id).toBe(17);
    expect(apex.endDeg - apex.startDeg).toBe(360);
  });

  it('encodes the AHA orientation: anterior top, septum left, inferior bottom, lateral right', () => {
    const centerOf = (id: number) => {
      const s = AHA_SEGMENTS.find(seg => seg.id === id);
      return norm360((s.startDeg + s.endDeg) / 2);
    };
    expect(centerOf(1)).toBe(0); // basal anterior at 12 o'clock
    expect(centerOf(4)).toBe(180); // basal inferior at 6 o'clock
    expect(centerOf(13)).toBe(0); // apical anterior top
    expect(centerOf(14)).toBe(270); // apical septal left
    expect(centerOf(15)).toBe(180); // apical inferior bottom
    expect(centerOf(16)).toBe(90); // apical lateral right
  });

  it('numbers the basal/mid rings counterclockwise from anterior (AHA chart order)', () => {
    // Counterclockwise numbering ⇒ each next segment sits 60° counterclockwise
    // (−60° in our clockwise-positive convention) from the previous one.
    for (const [first, last] of [
      [1, 6],
      [7, 12],
    ]) {
      for (let id = first; id < last; id++) {
        const cur = AHA_SEGMENTS.find(s => s.id === id);
        const next = AHA_SEGMENTS.find(s => s.id === id + 1);
        const curCenter = norm360((cur.startDeg + cur.endDeg) / 2);
        const nextCenter = norm360((next.startDeg + next.endDeg) / 2);
        expect(norm360(curCenter - nextCenter)).toBe(60);
      }
    }
  });
});

describe('polarPoint', () => {
  it('maps 0° to screen-up and 90° to screen-right (clockwise convention)', () => {
    const top = polarPoint(150, 150, 100, 0);
    expect(top.x).toBeCloseTo(150);
    expect(top.y).toBeCloseTo(50);
    const right = polarPoint(150, 150, 100, 90);
    expect(right.x).toBeCloseTo(250);
    expect(right.y).toBeCloseTo(150);
  });
});

describe('segmentArcPath', () => {
  const expectValidPath = (d: string) => {
    expect(d).not.toMatch(/NaN|Infinity|undefined/);
    const numbers = d.match(/-?\d+(\.\d+)?/g) ?? [];
    expect(numbers.length).toBeGreaterThan(0);
    for (const n of numbers) {
      expect(Number.isFinite(Number(n))).toBe(true);
    }
    expect(d.trim().endsWith('Z')).toBe(true);
  };

  it('emits a finite, closed annular sector for every AHA segment', () => {
    for (const seg of AHA_SEGMENTS) {
      const rInner = seg.ring === 'apex' ? 0 : 40;
      const d = segmentArcPath(150, 150, rInner, 140, seg.startDeg, seg.endDeg);
      expectValidPath(d);
      expect(d).toContain('A ');
    }
  });

  it('starts a plain sector on the outer radius at startDeg', () => {
    const d = segmentArcPath(150, 150, 110, 147, -30, 30);
    const start = polarPoint(150, 150, 147, -30);
    const m = d.match(/^M (-?\d+(\.\d+)?) (-?\d+(\.\d+)?)/);
    expect(m).toBeTruthy();
    expect(Number(m[1])).toBeCloseTo(start.x, 1);
    expect(Number(m[3])).toBeCloseTo(start.y, 1);
  });

  it('uses the large-arc flag for sweeps over 180°', () => {
    const d = segmentArcPath(150, 150, 40, 80, 0, 270);
    expect(d).toMatch(/A 80 80 0 1 1 /);
  });

  it('renders the apex full disc (rInner = 0) as two semicircular arcs', () => {
    const d = segmentArcPath(150, 150, 0, 36, 0, 360);
    expectValidPath(d);
    expect((d.match(/A /g) ?? []).length).toBe(2);
    expect(d).not.toContain('L ');
  });

  it('renders a full-circle ring (rInner > 0) as a donut with a reversed inner subpath', () => {
    const d = segmentArcPath(150, 150, 20, 36, 0, 360);
    expectValidPath(d);
    expect((d.match(/M /g) ?? []).length).toBe(2);
    expect(d).toMatch(/A 20 20 0 1 0 /); // inner circle drawn counterclockwise
  });
});

describe('COLOR_SCALES / colorForValue', () => {
  const scaleNames = Object.keys(COLOR_SCALES) as ColorScaleName[];

  it('ships at least the three required scales', () => {
    expect(scaleNames).toEqual(expect.arrayContaining(['perfusion', 'viability', 'grayscale']));
    for (const name of scaleNames) {
      expect(COLOR_SCALES[name].length).toBeGreaterThanOrEqual(2);
      for (const stop of COLOR_SCALES[name]) {
        expect(stop).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it.each(scaleNames)('%s: endpoints hit the first/last stop and output is hex', name => {
    const stops = COLOR_SCALES[name];
    expect(colorForValue(0, name)).toBe(stops[0]);
    expect(colorForValue(100, name)).toBe(stops[stops.length - 1]);
    expect(colorForValue(37.5, name)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it.each(scaleNames)('%s: clamps out-of-range and non-finite values', name => {
    const stops = COLOR_SCALES[name];
    expect(colorForValue(-50, name)).toBe(stops[0]);
    expect(colorForValue(250, name)).toBe(stops[stops.length - 1]);
    expect(colorForValue(NaN, name)).toBe(stops[0]);
  });

  it('perfusion maps 100% → green and 0% → red (descending % walks green→yellow→red)', () => {
    expect(colorForValue(100, 'perfusion')).toBe('#24a148');
    expect(colorForValue(50, 'perfusion')).toBe('#f1c21b');
    expect(colorForValue(0, 'perfusion')).toBe('#da1e28');
  });

  it('honors a custom [min, max] domain', () => {
    const stops = COLOR_SCALES.grayscale;
    expect(colorForValue(2, 'grayscale', 2, 4)).toBe(stops[0]);
    expect(colorForValue(4, 'grayscale', 2, 4)).toBe(stops[1]);
    expect(colorForValue(3, 'grayscale', 2, 4)).toBe('#808080');
  });
});

describe('ringSliceRange', () => {
  const RINGS_BASE_FIRST: AhaRing[] = ['basal', 'mid', 'apical', 'apex'];

  const expectPartition = (n: number, apexAtEnd: boolean) => {
    const order = apexAtEnd ? RINGS_BASE_FIRST : [...RINGS_BASE_FIRST].reverse();
    let cursor = 0;
    for (const ring of order) {
      const [s, e] = ringSliceRange(ring, n, apexAtEnd);
      expect(s).toBe(cursor); // contiguous + monotonic
      expect(e).toBeGreaterThanOrEqual(s);
      cursor = e;
    }
    expect(cursor).toBe(n); // full coverage of [0, n)
  };

  it.each([3, 4, 10, 17, 30, 64, 100])(
    'partitions [0, %i) contiguously and monotonically (apexAtEnd = true)',
    n => expectPartition(n, true)
  );

  it.each([3, 4, 10, 17, 30, 64, 100])(
    'partitions [0, %i) contiguously and monotonically (apexAtEnd = false)',
    n => expectPartition(n, false)
  );

  it('always gives the apex at least one slice', () => {
    for (const n of [1, 2, 3, 10, 100]) {
      const [s, e] = ringSliceRange('apex', n, true);
      expect(e - s).toBeGreaterThanOrEqual(1);
    }
  });

  it('sizes the apex to ~10% of the stack', () => {
    expect(ringSliceRange('apex', 100, true)).toEqual([90, 100]);
    expect(ringSliceRange('apex', 30, true)).toEqual([27, 30]);
  });

  it('splits the remainder into thirds (n = 100: 30/30/30 + apex 10)', () => {
    expect(ringSliceRange('basal', 100, true)).toEqual([0, 30]);
    expect(ringSliceRange('mid', 100, true)).toEqual([30, 60]);
    expect(ringSliceRange('apical', 100, true)).toEqual([60, 90]);
  });

  it('mirrors the ranges for apex-first stacks (apexAtEnd = false)', () => {
    expect(ringSliceRange('apex', 100, false)).toEqual([0, 10]);
    expect(ringSliceRange('apical', 100, false)).toEqual([10, 40]);
    expect(ringSliceRange('mid', 100, false)).toEqual([40, 70]);
    expect(ringSliceRange('basal', 100, false)).toEqual([70, 100]);
  });

  it('degrades gracefully on empty/invalid stacks', () => {
    expect(ringSliceRange('basal', 0, true)).toEqual([0, 0]);
    expect(ringSliceRange('apex', 0, false)).toEqual([0, 0]);
    expect(ringSliceRange('apex', -5, true)).toEqual([0, 0]);
  });
});
