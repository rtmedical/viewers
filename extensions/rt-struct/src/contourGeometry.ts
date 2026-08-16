/**
 * Contour validity and volume from an RTSTRUCT — pure core (RTV-141).
 *
 * `drawingTools.ts` (RTV-214) owns the tool state and the panel. This is the geometry: what
 * makes a contour well formed, and what makes a volume computed from a set of them agree
 * with the number the planning system will compute from the same file.
 *
 * ## A self-intersecting contour has no defined interior
 *
 * A figure-of-eight can be filled two ways. Even-odd winding calls the crossed lobe empty;
 * non-zero calls it full. Both are legitimate rules and different software picks
 * differently — so the **same RTSTRUCT** yields one volume in the treatment planning system
 * and another in the viewer, and there is no way to tell which is right because the file
 * does not say.
 *
 * That is why {@link validateContour} refuses at draw time rather than at export. By export
 * the contour has been approved, and the disagreement surfaces as two systems that
 * "disagree about the volume" rather than as a contour that was never valid.
 *
 * ## A hole is not two regions
 *
 * A contour inside another contour, same slice, same ROI, is a keyhole: the inner one is
 * subtracted. Treating them as two separate regions adds the hole to the volume instead of
 * removing it, and for a structure drawn around a hollow organ that is a large error that
 * looks like a plausible volume.
 *
 * ## The end slices are a convention, and the two conventions differ by 20% on a small
 * structure
 *
 * A planning system treats each contour as a **slab** of one slice thickness, so six
 * contours at 2 mm span 12 mm of tissue. A viewer that integrates between the first and
 * last contour spans 10 mm and reports a sixth less. Both are defensible; neither is
 * written in the file.
 *
 * The difference is one slice thickness spread over the ends, which is negligible for a
 * sixty-slice liver and **twenty percent for a six-slice node**. Small structures are
 * exactly where the disagreement matters, so the convention is a named parameter that
 * travels with the result rather than a choice buried in a loop.
 *
 * ## A skipped slice is where the two systems part company
 *
 * Contouring every other slice and letting the planning system interpolate is normal
 * practice. The viewer that sums area × spacing over the slices that exist gets a volume
 * roughly half the truth; the one that assumes uniform spacing from the first gap gets
 * something else again. {@link contourVolume} detects the gaps and refuses to state a
 * volume across them rather than picking an interpolation the file never specified.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export type Point3 = [number, number, number];

export interface Contour {
  /** Ordered vertices, millimetres, patient coordinates. */
  points: Point3[];
  /** Slice position along the normal, millimetres. */
  sliceMm: number;
}

export interface ContourValidation {
  ok: boolean;
  /** Signed area in the contour plane, square millimetres. */
  areaMm2: number;
  errors: string[];
  warnings: string[];
}

/** Points further off the fitted plane than this break CLOSED_PLANAR, millimetres. */
export const PLANARITY_TOLERANCE_MM = 0.1;
/** A contour smaller than this contributes nothing and breaks some consumers, mm². */
export const MIN_AREA_MM2 = 0.01;
/** Consecutive points closer than this are duplicates. */
export const DUPLICATE_POINT_MM = 1e-6;

const sub = (a: Point3, b: Point3): Point3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Point3, b: Point3): Point3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot3 = (a: Point3, b: Point3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (a: Point3): number => Math.hypot(a[0], a[1], a[2]);

/** Unit normal of the best-fitting plane, from the largest non-degenerate triangle. */
export function contourNormal(points: Point3[]): Point3 | null {
  if (!points || points.length < 3) {
    return null;
  }
  let best: Point3 | null = null;
  let bestLength = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const n = cross(sub(points[i], points[0]), sub(points[i + 1], points[0]));
    const l = length(n);
    if (l > bestLength) {
      bestLength = l;
      best = n;
    }
  }
  if (!best || bestLength <= 0) {
    return null;
  }
  return [best[0] / bestLength, best[1] / bestLength, best[2] / bestLength];
}

/** Area of a planar polygon in 3D, by the vector shoelace. */
export function polygonAreaMm2(points: Point3[]): number {
  if (!points || points.length < 3) {
    return 0;
  }
  const normal = contourNormal(points);
  if (!normal) {
    return 0;
  }
  let sum: Point3 = [0, 0, 0];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const c = cross(a, b);
    sum = [sum[0] + c[0], sum[1] + c[1], sum[2] + c[2]];
  }
  return Math.abs(dot3(sum, normal)) / 2;
}

/**
 * Whether two segments of the polygon cross.
 *
 * Adjacent segments share an endpoint and are skipped; everything else is checked, which is
 * quadratic and entirely fine at contour sizes.
 */
export function selfIntersects(points: Point3[]): boolean {
  const n = points?.length ?? 0;
  if (n < 4) {
    return false;
  }
  const normal = contourNormal(points);
  if (!normal) {
    return false;
  }
  // Project onto the plane so the test is two-dimensional.
  const u = pickPerpendicular(normal);
  const v = cross(normal, u);
  const flat = points.map<[number, number]>(p => [dot3(p, u), dot3(p, v)]);

  for (let i = 0; i < n; i++) {
    const a1 = flat[i];
    const a2 = flat[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) {
        continue;
      }
      if (segmentsCross(a1, a2, flat[j], flat[(j + 1) % n])) {
        return true;
      }
    }
  }
  return false;
}

function pickPerpendicular(n: Point3): Point3 {
  const helper: Point3 =
    Math.abs(n[0]) < Math.abs(n[1]) && Math.abs(n[0]) < Math.abs(n[2])
      ? [1, 0, 0]
      : Math.abs(n[1]) < Math.abs(n[2])
        ? [0, 1, 0]
        : [0, 0, 1];
  const u = cross(n, helper);
  const l = length(u) || 1;
  return [u[0] / l, u[1] / l, u[2] / l];
}

function orientation(a: [number, number], b: [number, number], c: [number, number]): number {
  const value = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return Math.abs(value) < 1e-12 ? 0 : Math.sign(value);
}

function segmentsCross(
  p1: [number, number],
  p2: [number, number],
  q1: [number, number],
  q2: [number, number]
): boolean {
  const o1 = orientation(p1, p2, q1);
  const o2 = orientation(p1, p2, q2);
  const o3 = orientation(q1, q2, p1);
  const o4 = orientation(q1, q2, p2);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}

/**
 * Whether a contour may be stored.
 *
 * Refuses self-intersection at draw time. By export the contour has been approved, and the
 * problem then presents as two systems disagreeing about a volume rather than as a contour
 * that was never valid.
 */
export function validateContour(contour: Contour): ContourValidation {
  const points = (contour?.points ?? []).filter(
    p => Array.isArray(p) && p.every(c => Number.isFinite(Number(c)))
  ) as Point3[];
  const errors: string[] = [];
  const warnings: string[] = [];

  if (points.length < 3) {
    return { ok: false, areaMm2: 0, errors: ['Contorno com menos de três pontos.'], warnings };
  }

  let duplicates = 0;
  for (let i = 0; i < points.length; i++) {
    if (length(sub(points[i], points[(i + 1) % points.length])) < DUPLICATE_POINT_MM) {
      duplicates++;
    }
  }
  if (duplicates) {
    warnings.push(`${duplicates} ponto(s) consecutivo(s) coincidente(s) — inofensivos aqui, mas alguns consumidores tropeçam.`);
  }

  const normal = contourNormal(points);
  if (!normal) {
    errors.push('Todos os pontos são colineares — o contorno não delimita área.');
  } else {
    const origin = points[0];
    let maxDeviation = 0;
    for (const p of points) {
      maxDeviation = Math.max(maxDeviation, Math.abs(dot3(sub(p, origin), normal)));
    }
    if (maxDeviation > PLANARITY_TOLERANCE_MM) {
      errors.push(
        `Contorno não planar: ${maxDeviation.toFixed(2)} mm fora do plano. CLOSED_PLANAR exige coplanaridade, ` +
          'e área de polígono não plano não é definida — costuma ser um traço feito sobre reformatado oblíquo.'
      );
    }
  }

  if (selfIntersects(points)) {
    errors.push(
      'Contorno se autointersecta. Um oito pode ser preenchido de dois jeitos: par-ímpar chama o lobo cruzado de vazio e ' +
        'non-zero chama de cheio. As duas regras são legítimas e softwares diferentes escolhem diferente, então O MESMO RTSTRUCT ' +
        'dá um volume no sistema de planejamento e outro no viewer — e não há como saber qual está certo, porque o arquivo não diz.'
    );
  }

  const areaMm2 = polygonAreaMm2(points);
  if (areaMm2 < MIN_AREA_MM2 && !errors.length) {
    errors.push(`Área de ${areaMm2.toExponential(1)} mm² — contorno degenerado.`);
  }

  return { ok: errors.length === 0, areaMm2, errors, warnings };
}

/** Whether a point lies inside a planar polygon, by ray casting in the plane. */
export function pointInContour(point: Point3, contour: Point3[]): boolean {
  const normal = contourNormal(contour);
  if (!normal) {
    return false;
  }
  const u = pickPerpendicular(normal);
  const v = cross(normal, u);
  const flat = contour.map<[number, number]>(p => [dot3(p, u), dot3(p, v)]);
  const target: [number, number] = [dot3(point, u), dot3(point, v)];

  let inside = false;
  for (let i = 0, j = flat.length - 1; i < flat.length; j = i++) {
    const [xi, yi] = flat[i];
    const [xj, yj] = flat[j];
    const crosses = yi > target[1] !== yj > target[1];
    if (crosses && target[0] < ((xj - xi) * (target[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export interface SliceGeometry {
  sliceMm: number;
  /** Outer boundaries. */
  outers: Contour[];
  /** Holes, each inside one of the outers. */
  holes: Contour[];
  netAreaMm2: number;
}

/**
 * Sorts the contours of one slice into outers and holes.
 *
 * A contour inside another, same slice and same ROI, is a keyhole. Treating the pair as two
 * regions **adds** the hole instead of removing it, which for a structure drawn around a
 * hollow organ is a large error that still looks like a plausible volume.
 */
export function resolveSlice(contours: Contour[]): SliceGeometry {
  const valid = (contours ?? []).filter(c => validateContour(c).ok);
  const sliceMm = valid[0]?.sliceMm ?? NaN;
  const areas = valid.map(c => polygonAreaMm2(c.points));

  const outers: Contour[] = [];
  const holes: Contour[] = [];
  for (let i = 0; i < valid.length; i++) {
    const containedBy = valid.findIndex(
      (other, j) => j !== i && areas[j] > areas[i] && pointInContour(valid[i].points[0], other.points)
    );
    if (containedBy >= 0) {
      holes.push(valid[i]);
    } else {
      outers.push(valid[i]);
    }
  }

  const outerArea = outers.reduce((sum, c) => sum + polygonAreaMm2(c.points), 0);
  const holeArea = holes.reduce((sum, c) => sum + polygonAreaMm2(c.points), 0);

  return { sliceMm, outers, holes, netAreaMm2: outerArea - holeArea };
}

/**
 * How the end slices are handled.
 *
 * `slab` is what treatment planning systems do: every contour represents one slice
 * thickness of tissue. `trapezoid` integrates between the first and last contour and
 * reports one slice thickness less.
 */
export type VolumeConvention = 'slab' | 'trapezoid';

export const CONVENTION_LABELS: Record<VolumeConvention, string> = {
  slab: 'fatia (cada contorno vale uma espessura de corte, como o sistema de planejamento)',
  trapezoid: 'trapezoidal (integra entre o primeiro e o último contorno)',
};

export interface VolumeResult {
  /** Millilitres. Null when the slices do not support a volume. */
  volumeMl: number | null;
  slices: number;
  spacingMm: number;
  convention: VolumeConvention;
  /** Slice positions where a contour is missing between two that exist. */
  gaps: Array<{ fromMm: number; toMm: number; missingSlices: number }>;
  warnings: string[];
  ok: boolean;
  reason?: string;
}

/**
 * Volume from a stack of contoured slices.
 *
 * Refuses across a gap. Contouring every other slice and letting the planning system
 * interpolate is normal practice, and a viewer that sums area × spacing over the slices
 * that exist reports roughly half the truth — while a viewer that assumes uniform spacing
 * from the first gap reports something else again. The file does not say which
 * interpolation was intended, so neither number can be defended.
 */
export function contourVolume(
  contours: Contour[],
  convention: VolumeConvention = 'slab'
): VolumeResult {
  const bySlice = new Map<number, Contour[]>();
  for (const contour of contours ?? []) {
    const slice = Number(contour?.sliceMm);
    if (!Number.isFinite(slice)) {
      continue;
    }
    bySlice.set(slice, [...(bySlice.get(slice) ?? []), contour]);
  }

  const slices = [...bySlice.keys()].sort((a, b) => a - b);
  const warnings: string[] = [];

  if (slices.length < 2) {
    return {
      volumeMl: null,
      slices: slices.length,
      spacingMm: NaN,
      convention,
      gaps: [],
      warnings,
      ok: false,
      reason: 'Menos de dois cortes contornados — sem espaçamento não há volume.',
    };
  }

  const spacings: number[] = [];
  for (let i = 1; i < slices.length; i++) {
    spacings.push(slices[i] - slices[i - 1]);
  }
  // The acquisition spacing is the SMALLEST distance between two contoured slices: contours
  // are drawn on acquisition slices, so nothing can be closer than the grid. Taking the
  // median instead lets a stack with more gaps than slices adopt the gap as its spacing --
  // and then no gap is ever detected.
  const spacingMm = Math.min(...spacings);

  const gaps: Array<{ fromMm: number; toMm: number; missingSlices: number }> = [];
  for (let i = 1; i < slices.length; i++) {
    const gap = slices[i] - slices[i - 1];
    if (gap > spacingMm * 1.5) {
      gaps.push({
        fromMm: slices[i - 1],
        toMm: slices[i],
        missingSlices: Math.max(1, Math.round(gap / spacingMm) - 1),
      });
    }
  }

  if (gaps.length) {
    return {
      volumeMl: null,
      slices: slices.length,
      spacingMm,
      convention,
      gaps,
      warnings,
      ok: false,
      reason:
        `${gaps.length} intervalo(s) sem contorno entre cortes contornados. Contornar corte sim, corte não e deixar o sistema de ` +
        'planejamento interpolar é prática normal — mas quem soma área x espaçamento sobre os cortes que existem reporta cerca de metade da verdade, ' +
        'e quem assume espaçamento uniforme a partir da primeira lacuna reporta outra coisa. O arquivo não diz qual interpolação era a intenção, ' +
        'então nenhum dos dois números é defensável.',
    };
  }

  let netAreaSum = 0;
  for (const slice of slices) {
    const geometry = resolveSlice(bySlice.get(slice) as Contour[]);
    netAreaSum += geometry.netAreaMm2;
    if (geometry.holes.length) {
      warnings.push(
        `Corte ${slice}: ${geometry.holes.length} contorno(s) interno(s) tratado(s) como buraco e subtraído(s).`
      );
    }
  }

  // Slab: every contour is one slice thickness. Trapezoid: the extent between the first and
  // last contour, which is one slice thickness less.
  const meanArea = netAreaSum / slices.length;
  const volumeMm3 =
    convention === 'slab'
      ? netAreaSum * spacingMm
      : netAreaSum * spacingMm - meanArea * spacingMm;

  if (slices.length <= 10) {
    warnings.push(
      `Convenção ${CONVENTION_LABELS[convention]}. Com ${slices.length} cortes as duas convenções diferem em cerca de ` +
        `${(100 / slices.length).toFixed(0)}% — a diferença é uma espessura de corte espalhada nas pontas, desprezível num fígado e grande num linfonodo.`
    );
  }

  return {
    volumeMl: volumeMm3 / 1000,
    slices: slices.length,
    spacingMm,
    convention,
    gaps: [],
    warnings,
    ok: true,
  };
}

/** One line for the structure panel. */
export function describeVolume(result: VolumeResult): string {
  if (!result.ok) {
    return result.reason ?? '';
  }
  const warnings = result.warnings.length ? ` ${result.warnings.join(' ')}` : '';
  return `${result.volumeMl!.toFixed(2)} mL em ${result.slices} cortes de ${result.spacingMm.toFixed(1)} mm.${warnings}`;
}
