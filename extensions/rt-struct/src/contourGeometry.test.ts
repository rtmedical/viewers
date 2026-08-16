import {
  Contour,
  CONVENTION_LABELS,
  contourNormal,
  contourVolume,
  describeVolume,
  MIN_AREA_MM2,
  PLANARITY_TOLERANCE_MM,
  Point3,
  pointInContour,
  polygonAreaMm2,
  resolveSlice,
  selfIntersects,
  validateContour,
} from './contourGeometry';

/** An axis-aligned square of side `side` centred on (cx, cy) at z. */
const square = (side: number, z: number, cx = 0, cy = 0): Point3[] => {
  const h = side / 2;
  return [
    [cx - h, cy - h, z],
    [cx + h, cy - h, z],
    [cx + h, cy + h, z],
    [cx - h, cy + h, z],
  ];
};

const contour = (points: Point3[], sliceMm: number): Contour => ({ points, sliceMm });

describe('contourGeometry — area and normal', () => {
  it('computes the area of an axial square', () => {
    expect(polygonAreaMm2(square(10, 0))).toBeCloseTo(100, 6);
  });

  it('computes the same area for a square in another plane', () => {
    const sagittal: Point3[] = [
      [0, -5, -5],
      [0, 5, -5],
      [0, 5, 5],
      [0, -5, 5],
    ];
    expect(polygonAreaMm2(sagittal)).toBeCloseTo(100, 6);
  });

  it('finds the plane normal and returns null for collinear points', () => {
    const normal = contourNormal(square(10, 3)) as Point3;
    expect(Math.abs(normal[2])).toBeCloseTo(1, 6);
    expect(contourNormal([[0, 0, 0], [1, 1, 1], [2, 2, 2]])).toBeNull();
  });

  it('returns zero area for fewer than three points', () => {
    expect(polygonAreaMm2([[0, 0, 0], [1, 0, 0]])).toBe(0);
  });
});

describe('contourGeometry — a self-intersecting contour has no defined interior', () => {
  it('accepts a simple polygon', () => {
    expect(selfIntersects(square(10, 0))).toBe(false);
  });

  it('detects a figure of eight', () => {
    const eight: Point3[] = [
      [0, 0, 0],
      [10, 10, 0],
      [10, 0, 0],
      [0, 10, 0],
    ];
    expect(selfIntersects(eight)).toBe(true);
  });

  // The file does not say which winding rule was meant.
  it('refuses it at draw time and says why it matters later', () => {
    const eight: Point3[] = [
      [0, 0, 0],
      [10, 10, 0],
      [10, 0, 0],
      [0, 10, 0],
    ];
    const result = validateContour(contour(eight, 0));
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(
      /O MESMO RTSTRUCT dá um volume no sistema de planejamento e outro no viewer/
    );
  });

  it('does not flag a triangle', () => {
    expect(selfIntersects([[0, 0, 0], [1, 0, 0], [0, 1, 0]])).toBe(false);
  });
});

describe('contourGeometry — validity', () => {
  it('accepts a clean square', () => {
    const result = validateContour(contour(square(10, 0), 0));
    expect(result.ok).toBe(true);
    expect(result.areaMm2).toBeCloseTo(100, 6);
  });

  it('refuses fewer than three points and a collinear contour', () => {
    expect(validateContour(contour([[0, 0, 0], [1, 0, 0]], 0)).ok).toBe(false);
    expect(validateContour(contour([[0, 0, 0], [1, 1, 0], [2, 2, 0]], 0)).errors.join(' ')).toMatch(
      /colineares/
    );
  });

  // Usually a trace made on an oblique reformat.
  it('refuses a non-planar contour', () => {
    const tilted = square(10, 0);
    tilted[2] = [5, 5, 2];
    const result = validateContour(contour(tilted, 0));
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/CLOSED_PLANAR exige coplanaridade/);
    expect(PLANARITY_TOLERANCE_MM).toBe(0.1);
  });

  it('refuses a degenerate sliver', () => {
    const sliver: Point3[] = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1e-6, 0],
    ];
    const result = validateContour(contour(sliver, 0));
    expect(result.ok).toBe(false);
    expect(MIN_AREA_MM2).toBe(0.01);
  });

  it('warns about duplicate consecutive points without refusing', () => {
    const withDuplicate = [...square(10, 0)];
    withDuplicate.splice(1, 0, withDuplicate[0]);
    const result = validateContour(contour(withDuplicate, 0));
    expect(result.ok).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/alguns consumidores tropeçam/);
  });
});

describe('contourGeometry — a hole is not two regions', () => {
  it('tells inside from outside', () => {
    expect(pointInContour([0, 0, 0], square(10, 0))).toBe(true);
    expect(pointInContour([20, 0, 0], square(10, 0))).toBe(false);
  });

  // Treating them as two regions ADDS the hole instead of removing it.
  it('subtracts an inner contour from its outer', () => {
    const geometry = resolveSlice([contour(square(10, 0), 0), contour(square(4, 0), 0)]);
    expect(geometry.outers).toHaveLength(1);
    expect(geometry.holes).toHaveLength(1);
    expect(geometry.netAreaMm2).toBeCloseTo(100 - 16, 6);
  });

  it('keeps two side-by-side contours as two outers', () => {
    const geometry = resolveSlice([
      contour(square(10, 0, -20, 0), 0),
      contour(square(10, 0, 20, 0), 0),
    ]);
    expect(geometry.outers).toHaveLength(2);
    expect(geometry.netAreaMm2).toBeCloseTo(200, 6);
  });

  it('drops contours that failed validation', () => {
    const geometry = resolveSlice([contour(square(10, 0), 0), contour([[0, 0, 0], [1, 0, 0]], 0)]);
    expect(geometry.outers).toHaveLength(1);
  });
});

describe('contourGeometry — a skipped slice is where two systems part company', () => {
  const stack = (count: number, step = 2) =>
    Array.from({ length: count }, (_, i) => contour(square(10, i * step), i * step));

  // Slab: six contours of 100 mm2, each one 2 mm thick, is 1200 mm3.
  it('computes a slab volume over a uniform stack', () => {
    const result = contourVolume(stack(6));
    expect(result.ok).toBe(true);
    expect(result.convention).toBe('slab');
    expect(result.volumeMl).toBeCloseTo(1.2, 6);
    expect(result.spacingMm).toBeCloseTo(2, 6);
  });

  // The two conventions differ by exactly one slice thickness at the ends.
  it('gives the trapezoid convention one slice thickness less', () => {
    const slab = contourVolume(stack(6), 'slab');
    const trapezoid = contourVolume(stack(6), 'trapezoid');
    expect(trapezoid.volumeMl).toBeCloseTo(1.0, 6);
    expect(slab.volumeMl! - trapezoid.volumeMl!).toBeCloseTo(0.2, 6);
  });

  // Negligible on a liver, twenty percent on a node.
  it('states how much the choice is worth on a small structure', () => {
    expect(contourVolume(stack(6)).warnings.join(' ')).toMatch(
      /as duas convenções diferem em cerca de 17%/
    );
    expect(contourVolume(stack(6)).warnings.join(' ')).toMatch(/desprezível num fígado e grande num linfonodo/);
  });

  it('names the convention it used', () => {
    expect(CONVENTION_LABELS.slab).toMatch(/como o sistema de planejamento/);
  });

  // One reader reports half the truth, another reports something else again.
  it('refuses across a gap instead of picking an interpolation', () => {
    const gapped = [...stack(3), contour(square(10, 20), 20)];
    const result = contourVolume(gapped);
    expect(result.ok).toBe(false);
    expect(result.volumeMl).toBeNull();
    expect(result.gaps).toHaveLength(1);
    expect(result.reason).toMatch(/nenhum dos dois números é defensável/);
  });

  it('subtracts holes into the volume', () => {
    const withHoles = stack(6).flatMap(c => [c, contour(square(4, c.sliceMm), c.sliceMm)]);
    const result = contourVolume(withHoles);
    expect(result.volumeMl!).toBeLessThan(contourVolume(stack(6)).volumeMl!);
    // 100 - 16 = 84 mm2 over six 2 mm slabs.
    expect(result.volumeMl).toBeCloseTo(1.008, 6);
    expect(result.warnings.join(' ')).toMatch(/tratado\(s\) como buraco e subtraído\(s\)/);
  });

  it('refuses a single slice', () => {
    expect(contourVolume(stack(1)).ok).toBe(false);
  });

  it('ignores contours with no slice position', () => {
    const result = contourVolume([...stack(4), contour(square(10, 0), NaN)]);
    expect(result.slices).toBe(4);
  });
});

describe('contourGeometry — the structure panel line', () => {
  it('states volume, slices and spacing', () => {
    const stack = Array.from({ length: 6 }, (_, i) => contour(square(10, i * 2), i * 2));
    expect(describeVolume(contourVolume(stack))).toMatch(/^1\.20 mL em 6 cortes de 2\.0 mm\./);
  });

  it('shows the refusal across a gap', () => {
    const gapped = [contour(square(10, 0), 0), contour(square(10, 2), 2), contour(square(10, 20), 20)];
    expect(describeVolume(contourVolume(gapped))).toMatch(/interpolação era a intenção/);
  });
});
