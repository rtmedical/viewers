/**
 * Virtual endoscopy: centreline extraction, camera path and surface coverage —
 * pure core (RTV-71).
 *
 * The fly-through itself is a vtk.js perspective camera and belongs in the viewport. What
 * belongs here is the part that decides *where the camera goes* and, more importantly,
 * *what it never saw*.
 *
 * ## A single pass does not see the whole surface, and that is the finding
 *
 * Virtual colonoscopy's characteristic failure is not a bad image, it is a **blind spot**:
 * the far side of a haustral fold is occluded from a camera flying antegrade, and a lesion
 * sitting there is not subtle in the images — it is absent from them. A reader who has
 * completed the fly-through has seen the whole colon in the sense that the camera traversed
 * it end to end, which is exactly why the gap is dangerous.
 *
 * This is why bidirectional review is the standard of practice, and why
 * {@link surfaceCoverage} exists: it measures the fraction of the lumen wall that was
 * actually within view, and {@link bidirectionalCoverage} shows what the second pass adds.
 * A coverage number is the only thing in the module that can contradict the reader's
 * impression of completeness.
 *
 * ## The centreline is not the shortest path
 *
 * A shortest path between two points in a bent lumen hugs the inside of every curve and
 * puts the camera in the wall, where the view is unusable and, worse, where the wall
 * occludes the segment beyond. {@link extractCenterline} runs a Dijkstra whose cost is
 * weighted by distance-to-wall, so a step near the axis is cheap and a step near the mucosa
 * is expensive. The result is longer and stays inside.
 *
 * ## A continuous fly-through is not proof of a continuous lumen
 *
 * Where the colon is collapsed, or where a loop touches adjacent small bowel, a path
 * search will happily bridge the gap. The camera then flies smoothly out of the colon and
 * into another organ, and nothing about the resulting video looks wrong.
 * {@link validatePath} reports the radius profile and flags the waists, because a sudden
 * near-zero radius is the signature of both failures.
 *
 * ## Nothing may be measured in the endoluminal view
 *
 * Apparent size under a perspective camera is a function of distance, and a wide field of
 * view adds barrel distortion on top. A 6 mm polyp seen up close and a 12 mm polyp seen
 * twice as far away subtend the same angle. {@link measureFromEndoluminalView} refuses, and
 * points at the source images.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export interface LumenVolume {
  /** Voxel counts, x fastest. */
  dims: [number, number, number];
  /** Millimetres per voxel. */
  spacing: [number, number, number];
  /** 1 inside the lumen, 0 outside. */
  mask: Uint8Array;
}

/** Default endoscopic field of view, degrees. Wider sees more and distorts more. */
export const DEFAULT_FOV_DEG = 120;
/** Beyond this the wall is too far and too oblique to read, millimetres. */
export const DEFAULT_VIEW_DISTANCE_MM = 60;
/** A lumen radius below this is a waist worth refusing to fly through, millimetres. */
export const MIN_LUMEN_RADIUS_MM = 2;

const index = (dims: [number, number, number], x: number, y: number, z: number): number =>
  x + dims[0] * (y + dims[1] * z);

const coords = (dims: [number, number, number], i: number): [number, number, number] => {
  const x = i % dims[0];
  const y = Math.floor(i / dims[0]) % dims[1];
  const z = Math.floor(i / (dims[0] * dims[1]));
  return [x, y, z];
};

const inside = (volume: LumenVolume, i: number): boolean => volume.mask[i] === 1;

/**
 * Exact squared Euclidean distance to the nearest non-lumen voxel, in millimetres.
 *
 * Exact rather than a chamfer approximation because the value is reported as a radius in
 * millimetres and used to decide whether a segment is passable; a 10% chamfer error at a
 * 2 mm waist is the difference between flagging a collapsed segment and flying through it.
 */
export function distanceToWallMm(volume: LumenVolume): Float64Array {
  const [nx, ny, nz] = volume.dims;
  const [sx, sy, sz] = volume.spacing;
  const total = nx * ny * nz;
  const f = new Float64Array(total);
  // A large finite sentinel rather than Infinity: the lower-envelope arithmetic below
  // subtracts and divides these values, and Infinity - Infinity is NaN.
  const FAR = 1e12;

  for (let i = 0; i < total; i++) {
    f[i] = volume.mask[i] === 1 ? FAR : 0;
  }

  // Felzenszwalb & Huttenlocher: three separable 1D transforms of the squared distance.
  const buffer = new Float64Array(Math.max(nx, ny, nz));
  const output = new Float64Array(Math.max(nx, ny, nz));

  const pass = (
    n: number,
    spacing: number,
    get: (k: number) => number,
    set: (k: number, v: number) => void
  ) => {
    for (let k = 0; k < n; k++) {
      buffer[k] = get(k);
    }
    edt1d(buffer, output, n, spacing);
    for (let k = 0; k < n; k++) {
      set(k, output[k]);
    }
  };

  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      pass(nx, sx, k => f[index(volume.dims, k, y, z)], (k, v) => {
        f[index(volume.dims, k, y, z)] = v;
      });
    }
  }
  for (let z = 0; z < nz; z++) {
    for (let x = 0; x < nx; x++) {
      pass(ny, sy, k => f[index(volume.dims, x, k, z)], (k, v) => {
        f[index(volume.dims, x, k, z)] = v;
      });
    }
  }
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      pass(nz, sz, k => f[index(volume.dims, x, y, k)], (k, v) => {
        f[index(volume.dims, x, y, k)] = v;
      });
    }
  }

  const result = new Float64Array(total);
  for (let i = 0; i < total; i++) {
    result[i] = Math.sqrt(f[i]);
  }
  return result;
}

/** Lower envelope of parabolas — the 1D squared distance transform. */
function edt1d(f: Float64Array, d: Float64Array, n: number, spacing: number): void {
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const s2 = spacing * spacing;
  let k = 0;
  v[0] = 0;
  z[0] = Number.NEGATIVE_INFINITY;
  z[1] = Number.POSITIVE_INFINITY;

  for (let q = 1; q < n; q++) {
    let s = (f[q] + s2 * q * q - (f[v[k]] + s2 * v[k] * v[k])) / (2 * s2 * (q - v[k]));
    while (s <= z[k]) {
      k--;
      s = (f[q] + s2 * q * q - (f[v[k]] + s2 * v[k] * v[k])) / (2 * s2 * (q - v[k]));
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Number.POSITIVE_INFINITY;
  }

  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) {
      k++;
    }
    d[q] = s2 * (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Minimal binary heap keyed by cost. */
class Heap {
  private keys: number[] = [];
  private values: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, value: number): void {
    this.keys.push(key);
    this.values.push(value);
    let i = this.keys.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= this.keys[i]) {
        break;
      }
      this.swap(parent, i);
      i = parent;
    }
  }

  pop(): { key: number; value: number } {
    const key = this.keys[0];
    const value = this.values[0];
    const lastKey = this.keys.pop() as number;
    const lastValue = this.values.pop() as number;
    if (this.keys.length) {
      this.keys[0] = lastKey;
      this.values[0] = lastValue;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < this.keys.length && this.keys[left] < this.keys[smallest]) {
          smallest = left;
        }
        if (right < this.keys.length && this.keys[right] < this.keys[smallest]) {
          smallest = right;
        }
        if (smallest === i) {
          break;
        }
        this.swap(smallest, i);
        i = smallest;
      }
    }
    return { key, value };
  }

  private swap(a: number, b: number): void {
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
    [this.values[a], this.values[b]] = [this.values[b], this.values[a]];
  }
}

export interface CenterlineResult {
  /** Voxel indices from start to end. */
  path: number[];
  /** Distance to wall at each path point, millimetres. */
  radiiMm: number[];
  lengthMm: number;
  ok: boolean;
  reason?: string;
}

/**
 * Distance-to-wall weighted shortest path.
 *
 * The weighting is the whole point: an unweighted shortest path hugs the inside of every
 * curve, which puts the camera in the mucosa — where the view is unusable and, worse, where
 * the wall occludes the segment beyond, so the reader flies past a length of colon they
 * never saw.
 */
export function extractCenterline(
  volume: LumenVolume,
  startVoxel: number,
  endVoxel: number,
  options: { centrality?: number; distances?: Float64Array } = {}
): CenterlineResult {
  const empty: CenterlineResult = { path: [], radiiMm: [], lengthMm: 0, ok: false };
  if (!volume?.mask?.length) {
    return { ...empty, reason: 'Volume vazio.' };
  }
  if (!inside(volume, startVoxel) || !inside(volume, endVoxel)) {
    return {
      ...empty,
      reason: 'Ponto inicial ou final fora do lúmen — a câmera começaria dentro da parede.',
    };
  }

  const distances = options.distances instanceof Float64Array
    ? options.distances
    : distanceToWallMm(volume);
  const total = volume.mask.length;
  let maxRadius = 0;
  for (let i = 0; i < total; i++) {
    if (volume.mask[i] === 1 && distances[i] > maxRadius) {
      maxRadius = distances[i];
    }
  }
  if (!(maxRadius > 0)) {
    return { ...empty, reason: 'Lúmen sem espessura mensurável.' };
  }

  const centrality = Number.isFinite(Number(options.centrality)) ? Number(options.centrality) : 3;
  const cost = new Float64Array(total).fill(Number.POSITIVE_INFINITY);
  const from = new Int32Array(total).fill(-1);
  const done = new Uint8Array(total);
  const heap = new Heap();
  cost[startVoxel] = 0;
  heap.push(0, startVoxel);

  const [nx, ny, nz] = volume.dims;
  const [sx, sy, sz] = volume.spacing;
  const neighbours: Array<[number, number, number, number]> = [];
  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx || dy || dz) {
          neighbours.push([dx, dy, dz, Math.hypot(dx * sx, dy * sy, dz * sz)]);
        }
      }
    }
  }

  while (heap.size) {
    const { value: current } = heap.pop();
    if (done[current]) {
      continue;
    }
    done[current] = 1;
    if (current === endVoxel) {
      break;
    }
    const [x, y, z] = coords(volume.dims, current);
    for (const [dx, dy, dz, stepMm] of neighbours) {
      const nxx = x + dx;
      const nyy = y + dy;
      const nzz = z + dz;
      if (nxx < 0 || nyy < 0 || nzz < 0 || nxx >= nx || nyy >= ny || nzz >= nz) {
        continue;
      }
      const next = index(volume.dims, nxx, nyy, nzz);
      if (volume.mask[next] !== 1 || done[next]) {
        continue;
      }
      // Near the axis the penalty is 1; at the mucosa it grows without bound.
      const penalty = Math.pow(maxRadius / Math.max(distances[next], 1e-6), centrality);
      const candidate = cost[current] + stepMm * penalty;
      if (candidate < cost[next]) {
        cost[next] = candidate;
        from[next] = current;
        heap.push(candidate, next);
      }
    }
  }

  if (from[endVoxel] < 0 && startVoxel !== endVoxel) {
    return { ...empty, reason: 'Não há caminho dentro do lúmen entre os dois pontos.' };
  }

  const path: number[] = [];
  for (let i = endVoxel; i >= 0; i = from[i]) {
    path.push(i);
    if (i === startVoxel) {
      break;
    }
  }
  path.reverse();

  let lengthMm = 0;
  for (let i = 1; i < path.length; i++) {
    const a = coords(volume.dims, path[i - 1]);
    const b = coords(volume.dims, path[i]);
    lengthMm += Math.hypot((b[0] - a[0]) * sx, (b[1] - a[1]) * sy, (b[2] - a[2]) * sz);
  }

  return {
    path,
    radiiMm: path.map(i => distances[i]),
    lengthMm,
    ok: true,
  };
}

export interface PathValidation {
  ok: boolean;
  minRadiusMm: number;
  /** Path positions where the lumen narrows past the threshold. */
  waistIndices: number[];
  warnings: string[];
}

/**
 * Radius profile and its waists.
 *
 * A near-zero radius mid-path means one of two things and both invalidate the fly-through:
 * the segment is collapsed, or the path has leaked into an adjacent loop of bowel. The
 * video looks continuous either way — that is the reason this check cannot be optional.
 */
export function validatePath(
  result: CenterlineResult,
  minRadiusMm = MIN_LUMEN_RADIUS_MM
): PathValidation {
  const warnings: string[] = [];
  if (!result?.ok || !result.radiiMm.length) {
    return { ok: false, minRadiusMm: 0, waistIndices: [], warnings: [result?.reason ?? 'Sem trajeto.'] };
  }
  const limit = Math.max(0, Number(minRadiusMm) || 0);
  const waistIndices: number[] = [];
  let minimum = Number.POSITIVE_INFINITY;
  for (let i = 0; i < result.radiiMm.length; i++) {
    minimum = Math.min(minimum, result.radiiMm[i]);
    if (result.radiiMm[i] < limit) {
      waistIndices.push(i);
    }
  }
  if (waistIndices.length) {
    warnings.push(
      `Lúmen estreita para ${minimum.toFixed(1)} mm em ${waistIndices.length} ponto(s) do trajeto. ` +
        'Ou o segmento está colabado, ou o trajeto passou para uma alça vizinha — o vídeo fica contínuo nos dois casos.'
    );
  }
  return { ok: !waistIndices.length, minRadiusMm: minimum, waistIndices, warnings };
}

export interface CoverageResult {
  /** Fraction of lumen surface voxels seen from at least one camera position, 0..1. */
  fraction: number;
  seen: number;
  surfaceVoxels: number;
  /** Indices of surface voxels never in view. */
  unseen: number[];
  message: string;
}

/** Lumen voxels with at least one face neighbour outside the lumen. */
export function surfaceVoxels(volume: LumenVolume): number[] {
  const [nx, ny, nz] = volume.dims;
  const result: number[] = [];
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const i = index(volume.dims, x, y, z);
        if (volume.mask[i] !== 1) {
          continue;
        }
        const faces: Array<[number, number, number]> = [
          [x - 1, y, z], [x + 1, y, z], [x, y - 1, z], [x, y + 1, z], [x, y, z - 1], [x, y, z + 1],
        ];
        for (const [fx, fy, fz] of faces) {
          const outOfBounds = fx < 0 || fy < 0 || fz < 0 || fx >= nx || fy >= ny || fz >= nz;
          if (outOfBounds || volume.mask[index(volume.dims, fx, fy, fz)] !== 1) {
            result.push(i);
            break;
          }
        }
      }
    }
  }
  return result;
}

function clearLineOfSight(
  volume: LumenVolume,
  from: [number, number, number],
  to: [number, number, number]
): boolean {
  const [sx, sy, sz] = volume.spacing;
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) * 2);
  if (steps <= 1) {
    return true;
  }
  // Stops just short of the target: the target voxel is wall-adjacent by definition.
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    const x = Math.round(from[0] + dx * t);
    const y = Math.round(from[1] + dy * t);
    const z = Math.round(from[2] + dz * t);
    if (
      x < 0 || y < 0 || z < 0 ||
      x >= volume.dims[0] || y >= volume.dims[1] || z >= volume.dims[2] ||
      volume.mask[index(volume.dims, x, y, z)] !== 1
    ) {
      return false;
    }
  }
  void sx; void sy; void sz;
  return true;
}

/**
 * Fraction of the lumen wall that was actually within view along this path.
 *
 * The only number in the module that can contradict the reader's impression of
 * completeness: the camera traversed the whole colon, and the far side of every fold was
 * never on screen.
 */
export function surfaceCoverage(
  volume: LumenVolume,
  path: number[],
  options: { fovDeg?: number; maxDistanceMm?: number; surface?: number[]; reverse?: boolean } = {}
): CoverageResult {
  const surface = options.surface ? options.surface : surfaceVoxels(volume);
  if (!surface.length || !path?.length) {
    return { fraction: 0, seen: 0, surfaceVoxels: surface.length, unseen: surface.slice(), message: 'Sem superfície ou sem trajeto.' };
  }

  const fov = Number.isFinite(Number(options.fovDeg)) ? Number(options.fovDeg) : DEFAULT_FOV_DEG;
  const halfAngleCos = Math.cos((Math.min(179, Math.max(1, fov)) / 2) * (Math.PI / 180));
  const maxDistance = Number.isFinite(Number(options.maxDistanceMm))
    ? Number(options.maxDistanceMm)
    : DEFAULT_VIEW_DISTANCE_MM;
  const ordered = options.reverse ? path.slice().reverse() : path;
  const [sx, sy, sz] = volume.spacing;

  const cameras = ordered.map((voxel, i) => {
    const here = coords(volume.dims, voxel);
    const aheadVoxel = ordered[Math.min(ordered.length - 1, i + 1)];
    const behindVoxel = ordered[Math.max(0, i - 1)];
    const ahead = coords(volume.dims, aheadVoxel);
    const behind = coords(volume.dims, behindVoxel);
    let dirX = (ahead[0] - behind[0]) * sx;
    let dirY = (ahead[1] - behind[1]) * sy;
    let dirZ = (ahead[2] - behind[2]) * sz;
    const norm = Math.hypot(dirX, dirY, dirZ) || 1;
    dirX /= norm;
    dirY /= norm;
    dirZ /= norm;
    return { here, dir: [dirX, dirY, dirZ] as [number, number, number] };
  });

  const unseen: number[] = [];
  let seen = 0;

  for (const target of surface) {
    const t = coords(volume.dims, target);
    let visible = false;
    for (const camera of cameras) {
      const vx = (t[0] - camera.here[0]) * sx;
      const vy = (t[1] - camera.here[1]) * sy;
      const vz = (t[2] - camera.here[2]) * sz;
      const distance = Math.hypot(vx, vy, vz);
      if (distance > maxDistance) {
        continue;
      }
      if (distance > 0) {
        const cosine = (vx * camera.dir[0] + vy * camera.dir[1] + vz * camera.dir[2]) / distance;
        if (cosine < halfAngleCos) {
          continue;
        }
      }
      if (clearLineOfSight(volume, camera.here, t)) {
        visible = true;
        break;
      }
    }
    if (visible) {
      seen++;
    } else {
      unseen.push(target);
    }
  }

  const fraction = seen / surface.length;
  return {
    fraction,
    seen,
    surfaceVoxels: surface.length,
    unseen,
    message: `${(fraction * 100).toFixed(1)}% da superfície do lúmen esteve em campo.`,
  };
}

export interface BidirectionalCoverage {
  antegrade: number;
  retrograde: number;
  combined: number;
  /** What the second pass added, in percentage points. */
  gain: number;
  message: string;
}

/**
 * What the second pass adds.
 *
 * The argument for bidirectional review, stated as a number for this patient's anatomy
 * rather than as a citation.
 */
export function bidirectionalCoverage(
  volume: LumenVolume,
  path: number[],
  options: { fovDeg?: number; maxDistanceMm?: number } = {}
): BidirectionalCoverage {
  const surface = surfaceVoxels(volume);
  const forward = surfaceCoverage(volume, path, { ...options, surface });
  const backward = surfaceCoverage(volume, path, { ...options, surface, reverse: true });
  const missedByBoth = new Set(forward.unseen);
  const stillUnseen = backward.unseen.filter(v => missedByBoth.has(v));
  const combined = surface.length ? (surface.length - stillUnseen.length) / surface.length : 0;
  const gain = (combined - Math.max(forward.fraction, backward.fraction)) * 100;

  return {
    antegrade: forward.fraction,
    retrograde: backward.fraction,
    combined,
    gain,
    message:
      `Anterógrado ${(forward.fraction * 100).toFixed(1)}%, retrógrado ${(backward.fraction * 100).toFixed(1)}%, ` +
      `os dois juntos ${(combined * 100).toFixed(1)}% — a segunda passagem acrescenta ${gain.toFixed(1)} pontos. ` +
      `Restam ${stillUnseen.length} voxel(s) de parede que nenhuma das passagens viu.`,
  };
}

export interface MeasurementRefusal {
  ok: false;
  reason: string;
}

/**
 * Refuses a measurement taken in the endoluminal view.
 *
 * Apparent size under a perspective camera is a function of distance, and a wide field of
 * view adds barrel distortion on top: a 6 mm polyp seen up close and a 12 mm polyp seen
 * twice as far away subtend the same angle. The size of a polyp decides whether the patient
 * gets polypectomy or a three-year interval, so the number has to come from the source
 * images.
 */
export function measureFromEndoluminalView(): MeasurementRefusal {
  return {
    ok: false,
    reason:
      'Medida na vista endoluminal não é confiável: em câmera perspectiva o tamanho aparente depende da distância, ' +
      'e o FOV largo ainda acrescenta distorção de barril — um pólipo de 6 mm perto e um de 12 mm ao dobro da distância ' +
      'ocupam o mesmo ângulo. Meça nas imagens de origem 2D.',
  };
}

/** Readout for the fly-through panel. */
export function describeFlyThrough(
  centerline: CenterlineResult,
  validation: PathValidation,
  coverage: BidirectionalCoverage
): string {
  if (!centerline?.ok) {
    return centerline?.reason ?? '';
  }
  const warnings = validation.warnings.length ? ` ${validation.warnings.join(' ')}` : '';
  return `Trajeto de ${centerline.lengthMm.toFixed(0)} mm. ${coverage.message}${warnings}`;
}
