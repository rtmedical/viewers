import {
  bidirectionalCoverage,
  DEFAULT_FOV_DEG,
  describeFlyThrough,
  distanceToWallMm,
  extractCenterline,
  LumenVolume,
  measureFromEndoluminalView,
  MIN_LUMEN_RADIUS_MM,
  surfaceCoverage,
  surfaceVoxels,
  validatePath,
} from './virtualEndoscopy';

const at = (dims: [number, number, number], x: number, y: number, z: number) =>
  x + dims[0] * (y + dims[1] * z);

/** A straight tube of the given radius along z, optionally with a ring stenosis. */
const tube = (
  radius: number,
  { size = 24, ringZ = -1, ringRadius = 2, zFrom = 2, zTo = 21 } = {}
): LumenVolume => {
  const dims: [number, number, number] = [size, size, size];
  const mask = new Uint8Array(size * size * size);
  const c = size / 2;
  for (let z = zFrom; z <= zTo; z++) {
    const r = z === ringZ ? ringRadius : radius;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (Math.hypot(x - c, y - c) <= r) {
          mask[at(dims, x, y, z)] = 1;
        }
      }
    }
  }
  return { dims, spacing: [1, 1, 1], mask };
};

/** A tube bent through a right angle, so the straight line between the ends is outside it. */
const bentTube = (): LumenVolume => {
  const dims: [number, number, number] = [32, 32, 10];
  const mask = new Uint8Array(32 * 32 * 10);
  const distanceToPolyline = (x: number, y: number, z: number): number => {
    const segments: Array<[number, number, number, number]> = [
      [4, 4, 26, 4],
      [26, 4, 26, 26],
    ];
    let best = Infinity;
    for (const [x0, y0, x1, y1] of segments) {
      const dx = x1 - x0;
      const dy = y1 - y0;
      const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy)));
      best = Math.min(best, Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy), z - 4));
    }
    return best;
  };
  for (let z = 0; z < 10; z++) {
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        if (distanceToPolyline(x, y, z) <= 4) {
          mask[at(dims, x, y, z)] = 1;
        }
      }
    }
  }
  return { dims, spacing: [1, 1, 1], mask };
};

describe('virtualEndoscopy — distance to wall', () => {
  it('measures the distance to the nearest non-lumen voxel', () => {
    const dims: [number, number, number] = [7, 7, 7];
    const mask = new Uint8Array(343).fill(1);
    mask[at(dims, 3, 3, 3)] = 0;
    const distances = distanceToWallMm({ dims, spacing: [1, 1, 1], mask });
    expect(distances[at(dims, 6, 3, 3)]).toBeCloseTo(3, 10);
    expect(distances[at(dims, 3, 3, 3)]).toBeCloseTo(0, 10);
    expect(distances[at(dims, 5, 5, 3)]).toBeCloseTo(Math.hypot(2, 2), 10);
  });

  // The value is reported as a radius in millimetres, so anisotropic spacing has to be
  // carried rather than assumed away.
  it('respects anisotropic spacing', () => {
    const dims: [number, number, number] = [7, 7, 7];
    const mask = new Uint8Array(343).fill(1);
    mask[at(dims, 3, 3, 3)] = 0;
    const distances = distanceToWallMm({ dims, spacing: [1, 1, 3], mask });
    expect(distances[at(dims, 3, 3, 5)]).toBeCloseTo(6, 10);
  });

  // The nearest exterior voxel of a digitised disc is DIAGONAL, not axial: for a radius-5
  // disc it is (5,1) at 5.10 mm, not (6,0) at 6 mm. So the reported lumen radius runs
  // slightly under the nominal one, and a waist threshold set at the nominal radius fires
  // on a tube of exactly that calibre.
  it('gives the axis of a tube a radius set by the nearest diagonal voxel', () => {
    const volume = tube(5);
    const distances = distanceToWallMm(volume);
    expect(distances[at(volume.dims, 12, 12, 10)]).toBeCloseTo(Math.hypot(5, 1), 6);
  });
});

describe('virtualEndoscopy — the centreline is not the shortest path', () => {
  const volume = bentTube();
  const start = at(volume.dims, 4, 4, 4);
  const end = at(volume.dims, 26, 26, 4);

  it('finds a path that stays inside the lumen', () => {
    const result = extractCenterline(volume, start, end);
    expect(result.ok).toBe(true);
    expect(result.path.every(i => volume.mask[i] === 1)).toBe(true);
  });

  // A straight line between the two ends leaves the tube entirely — the whole reason a
  // path search is needed.
  it('is needed at all: the straight line between the ends is outside the lumen', () => {
    expect(volume.mask[at(volume.dims, 15, 15, 4)]).toBe(0);
  });

  // An unweighted shortest path hugs the inside of the corner and puts the camera in the
  // mucosa, where the wall occludes the segment beyond.
  it('stays further from the wall than an unweighted shortest path', () => {
    const weighted = extractCenterline(volume, start, end);
    const unweighted = extractCenterline(volume, start, end, { centrality: 0 });
    expect(Math.min(...weighted.radiiMm)).toBeGreaterThan(Math.min(...unweighted.radiiMm));
  });

  it('pays for that in length', () => {
    const weighted = extractCenterline(volume, start, end);
    const unweighted = extractCenterline(volume, start, end, { centrality: 0 });
    expect(weighted.lengthMm).toBeGreaterThanOrEqual(unweighted.lengthMm);
  });

  it('moves one voxel at a time', () => {
    const { path, dims } = { ...extractCenterline(volume, start, end), dims: volume.dims };
    for (let i = 1; i < path.length; i++) {
      const a = [path[i - 1] % dims[0], Math.floor(path[i - 1] / dims[0]) % dims[1], Math.floor(path[i - 1] / (dims[0] * dims[1]))];
      const b = [path[i] % dims[0], Math.floor(path[i] / dims[0]) % dims[1], Math.floor(path[i] / (dims[0] * dims[1]))];
      expect(Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]))).toBe(1);
    }
  });

  it('refuses a start point inside the wall', () => {
    const result = extractCenterline(volume, at(volume.dims, 15, 15, 4), end);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/a câmera começaria dentro da parede/);
  });

  it('refuses when the two points are in disconnected lumina', () => {
    const dims: [number, number, number] = [10, 10, 10];
    const mask = new Uint8Array(1000);
    mask[at(dims, 2, 2, 2)] = 1;
    mask[at(dims, 8, 8, 8)] = 1;
    const result = extractCenterline({ dims, spacing: [1, 1, 1], mask }, at(dims, 2, 2, 2), at(dims, 8, 8, 8));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Não há caminho dentro do lúmen/);
  });
});

describe('virtualEndoscopy — a continuous fly-through is not a continuous lumen', () => {
  it('passes a tube of even calibre', () => {
    const volume = tube(5);
    const result = extractCenterline(volume, at(volume.dims, 12, 12, 3), at(volume.dims, 12, 12, 20));
    expect(validatePath(result, MIN_LUMEN_RADIUS_MM).ok).toBe(true);
  });

  // Collapsed segment or a leak into adjacent bowel: the video looks continuous either way.
  it('flags a waist and names both causes', () => {
    const volume = tube(5, { ringZ: 12, ringRadius: 1 });
    const result = extractCenterline(volume, at(volume.dims, 12, 12, 3), at(volume.dims, 12, 12, 20));
    const validation = validatePath(result, 3);
    expect(validation.ok).toBe(false);
    expect(validation.waistIndices.length).toBeGreaterThan(0);
    expect(validation.warnings.join(' ')).toMatch(/colabado.*alça vizinha/);
  });

  it('reports the refusal when there is no path to validate', () => {
    expect(validatePath({ path: [], radiiMm: [], lengthMm: 0, ok: false, reason: 'x' }).ok).toBe(false);
  });
});

describe('virtualEndoscopy — coverage is the only thing that can contradict the reader', () => {
  const volume = tube(6, { ringZ: 12, ringRadius: 2 });
  const path = extractCenterline(volume, at(volume.dims, 12, 12, 3), at(volume.dims, 12, 12, 20)).path;

  it('finds the wall voxels', () => {
    const surface = surfaceVoxels(volume);
    expect(surface.length).toBeGreaterThan(0);
    expect(surface.every(i => volume.mask[i] === 1)).toBe(true);
  });

  // The camera traversed the whole tube, and the far side of the fold was never on screen.
  it('a single pass does not see the whole surface', () => {
    const coverage = surfaceCoverage(volume, path);
    expect(coverage.fraction).toBeLessThan(1);
    expect(coverage.unseen.length).toBeGreaterThan(0);
  });

  it('the second pass sees what the first could not', () => {
    const result = bidirectionalCoverage(volume, path);
    expect(result.combined).toBeGreaterThan(result.antegrade);
    expect(result.combined).toBeGreaterThan(result.retrograde);
    expect(result.gain).toBeGreaterThan(0);
    expect(result.message).toMatch(/a segunda passagem acrescenta/);
  });

  it('a wider field of view sees more', () => {
    const narrow = surfaceCoverage(volume, path, { fovDeg: 60 });
    const wide = surfaceCoverage(volume, path, { fovDeg: 170 });
    expect(wide.fraction).toBeGreaterThan(narrow.fraction);
    expect(DEFAULT_FOV_DEG).toBe(120);
  });

  it('a shorter view distance sees less', () => {
    const near = surfaceCoverage(volume, path, { maxDistanceMm: 3 });
    const far = surfaceCoverage(volume, path, { maxDistanceMm: 60 });
    expect(near.fraction).toBeLessThan(far.fraction);
  });

  it('reports nothing seen when there is no path', () => {
    expect(surfaceCoverage(volume, []).fraction).toBe(0);
  });
});

describe('virtualEndoscopy — nothing may be measured in the endoluminal view', () => {
  // The size of a polyp decides polypectomy versus a three-year interval.
  it('refuses, and says where to measure instead', () => {
    const refusal = measureFromEndoluminalView();
    expect(refusal.ok).toBe(false);
    expect(refusal.reason).toMatch(/o tamanho aparente depende da distância/);
    expect(refusal.reason).toMatch(/distorção de barril/);
    expect(refusal.reason).toMatch(/Meça nas imagens de origem 2D/);
  });
});

describe('virtualEndoscopy — the readout', () => {
  it('states length, coverage and any waist', () => {
    const volume = tube(6, { ringZ: 12, ringRadius: 2 });
    const centerline = extractCenterline(volume, at(volume.dims, 12, 12, 3), at(volume.dims, 12, 12, 20));
    const line = describeFlyThrough(
      centerline,
      validatePath(centerline, 4),
      bidirectionalCoverage(volume, centerline.path)
    );
    expect(line).toMatch(/^Trajeto de \d+ mm\./);
    expect(line).toMatch(/Anterógrado .*retrógrado .*os dois juntos/);
    expect(line).toMatch(/alça vizinha/);
  });

  it('shows the refusal when there is no centreline', () => {
    expect(
      describeFlyThrough(
        { path: [], radiiMm: [], lengthMm: 0, ok: false, reason: 'sem lúmen' },
        { ok: false, minRadiusMm: 0, waistIndices: [], warnings: [] },
        { antegrade: 0, retrograde: 0, combined: 0, gain: 0, message: '' }
      )
    ).toBe('sem lúmen');
  });
});
