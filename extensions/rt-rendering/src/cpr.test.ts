import {
  arcLengths,
  clampSpacing,
  cross,
  dot,
  length,
  normalise,
  rotationMinimisingFrames,
  resampleCenterline,
  sampleSpline,
  sanitisePoints,
  sub,
  totalLength,
  Vec3,
} from './centerline';
import {
  buildCprGeometry,
  constantRowDirection,
  CPR_MODE_CAVEATS,
  CPR_MODES,
  cprExtentMm,
  cprPixelToPatient,
  describeCpr,
  meanTangent,
  rowDirection,
  rowToArcLengthMm,
} from './cpr';

/** A straight line along +X, 100 mm long. */
const straight: Vec3[] = [
  [0, 0, 0],
  [50, 0, 0],
  [100, 0, 0],
];

/** A quarter circle in the XY plane, radius 100. */
const arc: Vec3[] = Array.from({ length: 9 }, (_u, i) => {
  const t = (i / 8) * (Math.PI / 2);
  return [100 * Math.cos(t), 100 * Math.sin(t), 0] as Vec3;
});

/** An S-curve, which has an inflection point — the case Frenet frames flip on. */
const sCurve: Vec3[] = Array.from({ length: 21 }, (_u, i) => {
  const x = i * 5;
  return [x, 20 * Math.sin((i / 20) * 2 * Math.PI), 0] as Vec3;
});

describe('vector helpers', () => {
  it('computes length and cross products', () => {
    expect(length([3, 4, 0])).toBe(5);
    expect(cross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
    expect(dot([1, 2, 3], [4, 5, 6])).toBe(32);
  });

  it('returns null for a zero-length normalise', () => {
    expect(normalise([0, 0, 0])).toBeNull();
    expect(normalise([2, 0, 0])).toEqual([1, 0, 0]);
  });

  it('drops points that are not 3D', () => {
    expect(sanitisePoints([[1, 2, 3], [1, 2], 'nope', null])).toEqual([[1, 2, 3]]);
    expect(sanitisePoints(undefined)).toEqual([]);
  });
});

describe('arc length', () => {
  it('accumulates along the polyline', () => {
    expect(arcLengths(straight)).toEqual([0, 50, 100]);
    expect(totalLength(straight)).toBe(100);
  });

  it('is zero for a single point', () => {
    expect(totalLength([[1, 1, 1]])).toBe(0);
    expect(totalLength([])).toBe(0);
  });
});

describe('sampleSpline', () => {
  it('passes through every control point', () => {
    // A physicist clicking along a vessel expects the curve to hit their clicks.
    const dense = sampleSpline(straight, 8);
    for (const control of straight) {
      const hit = dense.some(p => length(sub(p, control)) < 1e-6);
      expect(hit).toBe(true);
    }
  });

  it('ends on the last control point', () => {
    const dense = sampleSpline(arc, 4);
    expect(length(sub(dense[dense.length - 1], arc[arc.length - 1]))).toBeLessThan(1e-9);
  });

  it('passes short inputs through', () => {
    expect(sampleSpline([[0, 0, 0]])).toEqual([[0, 0, 0]]);
    expect(sampleSpline([])).toEqual([]);
  });
});

describe('resampleCenterline', () => {
  it('spaces samples uniformly along arc length', () => {
    // Uniform spacing is what makes a length measured on the CPR a real length.
    const resampled = resampleCenterline(straight, 5);
    const gaps = resampled.slice(1).map((p, i) => length(sub(p, resampled[i])));
    for (const gap of gaps) {
      expect(gap).toBeCloseTo(5, 6);
    }
  });

  it('stays uniform around a curve, where spline parameter would bunch', () => {
    const resampled = resampleCenterline(arc, 5);
    const gaps = resampled.slice(1, -1).map((p, i) => length(sub(p, resampled[i])));
    for (const gap of gaps) {
      expect(gap).toBeCloseTo(5, 1);
    }
  });

  it('starts at the first control point and finishes at the last', () => {
    const resampled = resampleCenterline(arc, 7);
    expect(length(sub(resampled[0], arc[0]))).toBeLessThan(1e-9);
    expect(length(sub(resampled[resampled.length - 1], arc[arc.length - 1]))).toBeLessThan(7);
  });

  it('clamps a nonsense spacing', () => {
    expect(clampSpacing(0)).toBe(0.5);
    expect(clampSpacing(-1)).toBe(0.5);
    expect(clampSpacing(NaN)).toBe(0.5);
    expect(clampSpacing(999)).toBe(10);
  });

  it('handles degenerate input', () => {
    expect(resampleCenterline([], 1)).toEqual([]);
    expect(resampleCenterline([[1, 1, 1]], 1)).toEqual([[1, 1, 1]]);
    // Every control point identical: no length to walk.
    expect(resampleCenterline([[0, 0, 0], [0, 0, 0]], 1)).toHaveLength(1);
  });
});

describe('rotationMinimisingFrames', () => {
  const orthonormal = (frames: ReturnType<typeof rotationMinimisingFrames>) => {
    for (const f of frames) {
      expect(length(f.tangent)).toBeCloseTo(1, 6);
      expect(length(f.normal)).toBeCloseTo(1, 6);
      expect(dot(f.tangent, f.normal)).toBeCloseTo(0, 6);
      expect(dot(f.tangent, f.binormal)).toBeCloseTo(0, 6);
      expect(dot(f.normal, f.binormal)).toBeCloseTo(0, 6);
    }
  };

  it('produces an orthonormal frame at every sample', () => {
    orthonormal(rotationMinimisingFrames(resampleCenterline(arc, 2)));
  });

  it('does not twist along a straight segment', () => {
    // The Frenet normal is undefined where curvature is zero and spins on noise.
    const frames = rotationMinimisingFrames(resampleCenterline(straight, 5));
    orthonormal(frames);
    const first = frames[0].normal;
    for (const f of frames) {
      expect(Math.abs(dot(f.normal, first))).toBeCloseTo(1, 6);
    }
  });

  it('stays continuous through an inflection point', () => {
    // The case that flips a Frenet frame 180 degrees and mirrors the reformation.
    const frames = rotationMinimisingFrames(resampleCenterline(sCurve, 2));
    orthonormal(frames);
    for (let i = 1; i < frames.length; i++) {
      // Consecutive normals must not jump; a flip would show up as a negative dot.
      expect(dot(frames[i].normal, frames[i - 1].normal)).toBeGreaterThan(0.9);
    }
  });

  it('honours an initial normal', () => {
    const frames = rotationMinimisingFrames(resampleCenterline(straight, 10), [0, 0, 1]);
    expect(Math.abs(dot(frames[0].normal, [0, 0, 1]))).toBeCloseTo(1, 6);
  });

  it('ignores an initial normal parallel to the tangent', () => {
    // Would otherwise reject to a zero vector.
    const frames = rotationMinimisingFrames(resampleCenterline(straight, 10), [1, 0, 0]);
    expect(length(frames[0].normal)).toBeCloseTo(1, 6);
    expect(dot(frames[0].normal, frames[0].tangent)).toBeCloseTo(0, 6);
  });

  it('returns nothing for fewer than two points', () => {
    expect(rotationMinimisingFrames([[0, 0, 0]])).toEqual([]);
    expect(rotationMinimisingFrames([])).toEqual([]);
  });
});

describe('row direction', () => {
  const frame = {
    position: [0, 0, 0] as Vec3,
    tangent: [1, 0, 0] as Vec3,
    normal: [0, 1, 0] as Vec3,
    binormal: [0, 0, 1] as Vec3,
  };

  it('uses the frame normal when straightened', () => {
    expect(rowDirection(frame, 'straightened', [9, 9, 9])).toEqual([0, 1, 0]);
  });

  it('uses the constant direction when stretched', () => {
    // Every row parallel is what preserves length along the vessel.
    expect(rowDirection(frame, 'stretched', [0, -1, 0])).toEqual([0, -1, 0]);
  });

  it('averages the tangents for the overall vessel direction', () => {
    const a = { ...frame, tangent: [1, 0, 0] as Vec3 };
    const b = { ...frame, tangent: [0, 1, 0] as Vec3 };
    const mean = meanTangent([a, b]);
    expect(mean[0]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(mean[1]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(meanTangent([])).toEqual([1, 0, 0]);
  });

  it('picks a constant perpendicular to both up and the vessel', () => {
    const direction = constantRowDirection([frame], [0, 0, 1]);
    expect(dot(direction, [0, 0, 1])).toBeCloseTo(0, 6);
    expect(dot(direction, frame.tangent)).toBeCloseTo(0, 6);
  });

  it('still returns a usable direction when the vessel runs along up', () => {
    // A vertical aorta with up = +Z: the cross product degenerates, and without the
    // fallback the direction would be zero and the reformation would collapse to a line.
    const vertical = { ...frame, tangent: [0, 0, 1] as Vec3 };
    const direction = constantRowDirection([vertical], [0, 0, 1]);
    expect(length(direction)).toBeCloseTo(1, 6);
    expect(dot(direction, [0, 0, 1])).toBeCloseTo(0, 6);
  });
});

describe('buildCprGeometry', () => {
  const frames = () => rotationMinimisingFrames(resampleCenterline(arc, 2));

  it('builds an odd number of columns centred on the vessel', () => {
    const geometry = buildCprGeometry(frames(), 'straightened', 2, {
      widthMm: 10,
      pixelSpacingMm: 1,
    });
    expect(geometry.columns).toBe(21);
    // The centre sample sits exactly on the centerline.
    const middle = geometry.rows[0][10];
    expect(length(sub(middle, frames()[0].position))).toBeLessThan(1e-9);
  });

  it('spaces samples across the row by the pixel spacing', () => {
    const geometry = buildCprGeometry(frames(), 'straightened', 2, {
      widthMm: 10,
      pixelSpacingMm: 0.5,
    });
    const row = geometry.rows[0];
    expect(length(sub(row[1], row[0]))).toBeCloseTo(0.5, 9);
  });

  it('makes every row parallel in stretched mode', () => {
    const geometry = buildCprGeometry(frames(), 'stretched', 2, { up: [0, 0, 1] });
    const directionOf = (row: Vec3[]) => normalise(sub(row[row.length - 1], row[0]))!;
    const first = directionOf(geometry.rows[0]);
    for (const row of geometry.rows) {
      // Exactly parallel: the direction is constant, not derived per frame.
      expect(Math.abs(dot(directionOf(row), first))).toBeCloseTo(1, 12);
    }
    expect(geometry.rowDirection).not.toBeNull();
  });

  it('places rows at uniform arc length when stretched, and foreshortened when projected', () => {
    const built = frames();
    const stretched = buildCprGeometry(built, 'stretched', 2, { up: [0, 0, 1] });
    const projected = buildCprGeometry(built, 'projected', 2, { up: [0, 1, 0] });

    // Stretched: uniform, so distance along the vessel is true.
    const stretchedGaps = stretched.rowOffsetsMm.slice(1).map((v, i) => v - stretched.rowOffsetsMm[i]);
    for (const gap of stretchedGaps) {
      expect(gap).toBeCloseTo(2, 9);
    }

    // Projected onto +Y for a quarter arc in XY: the rows bunch as the vessel turns
    // away from Y. That foreshortening is why a length must not be read off it.
    const projectedGaps = projected.rowOffsetsMm
      .slice(1)
      .map((v, i) => v - projected.rowOffsetsMm[i]);
    const spread = Math.max(...projectedGaps) - Math.min(...projectedGaps);
    expect(spread).toBeGreaterThan(0.5);
  });

  it('makes rows perpendicular to the vessel in straightened mode', () => {
    const built = frames();
    const geometry = buildCprGeometry(built, 'straightened', 2);
    geometry.rows.forEach((row, i) => {
      const direction = normalise(sub(row[row.length - 1], row[0]))!;
      expect(dot(direction, built[i].tangent)).toBeCloseTo(0, 6);
    });
  });

  it('carries the caveat for the mode', () => {
    for (const mode of CPR_MODES) {
      const geometry = buildCprGeometry(frames(), mode, 2);
      expect(geometry.caveat).toBe(CPR_MODE_CAVEATS[mode]);
    }
    // The one people get wrong.
    expect(CPR_MODE_CAVEATS.stretched).toMatch(/diameters read wide/i);
    expect(CPR_MODE_CAVEATS.straightened).toMatch(/measure diameters here/i);
    expect(CPR_MODE_CAVEATS.projected).toMatch(/foreshortened/i);
  });

  it('falls back to straightened for an unknown mode', () => {
    expect(buildCprGeometry(frames(), 'nope' as never, 2).mode).toBe('straightened');
  });

  it('clamps width and pixel spacing', () => {
    const wide = buildCprGeometry(frames(), 'straightened', 2, {
      widthMm: 99999,
      pixelSpacingMm: 0,
    });
    expect(cprExtentMm(wide).widthMm).toBeLessThanOrEqual(400);
    expect(wide.columnSpacingMm).toBe(0.5);
  });

  it('handles no frames', () => {
    const geometry = buildCprGeometry([], 'straightened', 2);
    expect(geometry.rows).toEqual([]);
    expect(describeCpr(geometry)).toBe('No centerline');
  });
});

describe('mapping back to patient space', () => {
  const geometry = () =>
    buildCprGeometry(rotationMinimisingFrames(resampleCenterline(arc, 5)), 'straightened', 5, {
      widthMm: 10,
      pixelSpacingMm: 1,
    });

  it('returns the sample position for a pixel', () => {
    const g = geometry();
    expect(cprPixelToPatient(g, 10, 0)).toEqual(g.rows[0][10]);
  });

  it('returns null outside the image rather than extrapolating', () => {
    // A point off the reformation has no defined position; inventing one would put an
    // annotation somewhere plausible and wrong.
    const g = geometry();
    expect(cprPixelToPatient(g, -1, 0)).toBeNull();
    expect(cprPixelToPatient(g, 0, 9999)).toBeNull();
    expect(cprPixelToPatient(g, NaN, 0)).toBeNull();
  });

  it('converts a row to arc length', () => {
    const g = geometry();
    expect(rowToArcLengthMm(g, 0)).toBe(0);
    expect(rowToArcLengthMm(g, 3)).toBe(15);
    expect(rowToArcLengthMm(g, 9999)).toBeNull();
  });

  it('reports the physical extent', () => {
    const g = geometry();
    const { widthMm, heightMm } = cprExtentMm(g);
    expect(widthMm).toBe(20);
    expect(heightMm).toBeCloseTo((g.rows.length - 1) * 5, 6);
    expect(describeCpr(g)).toMatch(/along the vessel/);
  });
});
