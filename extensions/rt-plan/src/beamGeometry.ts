/**
 * Beam lines in patient coordinates — pure core (RTV-11).
 *
 * `rt-bev` works inside the beam's frame, looking down the axis. This is the other
 * direction: where the central axis and the field edges land on the patient's CT, so a beam
 * can be drawn on an axial slice.
 *
 * ## Three rotations and a change of coordinate system, each a chance to invert a sign
 *
 * A beam's direction comes from the gantry angle, the couch angle and the patient's
 * orientation on the table, composed in that structure and then mapped from IEC 61217 room
 * coordinates into DICOM patient coordinates. Every step is a place to transpose a matrix
 * or negate the wrong axis.
 *
 * The reason it matters more here than in most geometry is **which view the mistake
 * survives**. Get the composition order wrong and an anterior beam still looks anterior on
 * the axial slice: the error only appears at oblique gantry angles or with a rotated couch,
 * and the AP beam is the one a reviewer checks first. A viewer that draws beams
 * convincingly for the common plan and wrongly for the oblique one is worse than one that
 * draws nothing.
 *
 * ## Patient orientation is not cosmetic
 *
 * Head-first and feet-first swap the patient's left with the room's left.
 * {@link PATIENT_ORIENTATIONS} is a required input rather than a default, because the
 * failure it prevents is left-for-right — the class of error that reaches the patient.
 *
 * ## The couch angle is the rarely-exercised path
 *
 * Most plans have couch zero, so the code that handles a non-zero couch runs on a small
 * minority of cases and a bug in it ships. The invariant worth testing is that rotating the
 * couch does not move a gantry-zero beam at all — a rotation about the vertical axis cannot
 * change a vertical beam.
 *
 * ## Field edges diverge
 *
 * Jaw positions are defined at the isocentre plane. Drawing that same rectangle on a slice
 * ten centimetres from the isocentre, at an SAD of a metre, is wrong by ten percent — and
 * it is wrong in a way that looks like a slightly generous or slightly tight field rather
 * than like a bug.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export type Vec3 = [number, number, number];

/** DICOM Patient Position values this module maps. */
export const PATIENT_ORIENTATIONS = ['HFS', 'FFS', 'HFP', 'FFP'] as const;
export type PatientOrientation = (typeof PATIENT_ORIENTATIONS)[number];

export interface Beam {
  name?: string;
  /** IEC 61217 gantry angle, degrees. 0 is source above the isocentre. */
  gantryAngleDeg: number;
  /** Beam limiting device (collimator) angle, degrees. */
  collimatorAngleDeg: number;
  /** Patient support (couch) angle, degrees. */
  couchAngleDeg: number;
  /** Source-to-axis distance, millimetres. */
  sadMm: number;
  /** Isocentre in DICOM patient coordinates, millimetres. */
  isocentreMm: Vec3;
  /** Jaw positions at the isocentre plane: [x1, x2, y1, y2], millimetres. */
  jawsMm?: [number, number, number, number];
}

const rad = (deg: number): number => (Number(deg) || 0) * (Math.PI / 180);

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function norm(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function unit(a: Vec3): Vec3 {
  const n = norm(a);
  return n > 0 ? [a[0] / n, a[1] / n, a[2] / n] : [0, 0, 0];
}

/**
 * IEC 61217 fixed room axes to DICOM patient axes.
 *
 * The IEC fixed frame belongs to the room: X to the room's right as seen from the gantry,
 * Y along the couch towards the gantry, Z up. Which patient axis each of those is depends
 * entirely on how the patient was laid down, which is why the orientation is required and
 * not defaulted.
 */
export function iecToPatient(v: Vec3, orientation: PatientOrientation): Vec3 {
  const [a, b, c] = v;
  switch (orientation) {
    case 'HFS':
      return [a, -c, b];
    case 'FFS':
      return [-a, -c, -b];
    case 'HFP':
      return [-a, c, b];
    case 'FFP':
      return [a, c, -b];
    default:
      return [a, -c, b];
  }
}

/** Rotation about the IEC vertical axis, used for the couch. */
function rotateAboutZf(v: Vec3, angleDeg: number): Vec3 {
  const t = rad(angleDeg);
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  return [v[0] * cos + v[1] * sin, -v[0] * sin + v[1] * cos, v[2]];
}

export interface BeamAxes {
  /** Unit vector from the isocentre towards the source, DICOM patient coordinates. */
  towardsSource: Vec3;
  /** Unit vector the beam travels along, DICOM patient coordinates. */
  direction: Vec3;
  /** Source position, DICOM patient coordinates, millimetres. */
  sourceMm: Vec3;
  /** In-plane axis corresponding to the collimator x direction. */
  u: Vec3;
  /** In-plane axis corresponding to the collimator y direction. */
  v: Vec3;
}

/**
 * The beam's axes in patient coordinates.
 *
 * The couch rotation is applied in the room frame before the mapping to patient
 * coordinates: the couch turns the patient relative to the room, so in the patient's own
 * frame the beam is what moves. Doing it the other way round produces a beam that is
 * correct at couch zero and wrong everywhere else — and couch zero is most plans.
 */
export function beamAxes(beam: Beam, orientation: PatientOrientation): BeamAxes {
  const g = rad(beam?.gantryAngleDeg);
  const sinG = Math.sin(g);
  const cosG = Math.cos(g);

  // In the IEC fixed frame: gantry 0 puts the source straight up, gantry 90 puts it at the
  // room's +X. The collimator x axis rides the gantry; the y axis is the rotation axis.
  const towardsSourceF: Vec3 = [sinG, 0, cosG];
  const uF: Vec3 = [cosG, 0, -sinG];
  const vF: Vec3 = [0, 1, 0];

  const theta = rad(beam?.collimatorAngleDeg);
  const cosC = Math.cos(theta);
  const sinC = Math.sin(theta);
  const uRot: Vec3 = [
    uF[0] * cosC + vF[0] * sinC,
    uF[1] * cosC + vF[1] * sinC,
    uF[2] * cosC + vF[2] * sinC,
  ];
  const vRot: Vec3 = [
    -uF[0] * sinC + vF[0] * cosC,
    -uF[1] * sinC + vF[1] * cosC,
    -uF[2] * sinC + vF[2] * cosC,
  ];

  const couch = Number(beam?.couchAngleDeg) || 0;
  const towardsSource = unit(iecToPatient(rotateAboutZf(towardsSourceF, couch), orientation));
  const u = unit(iecToPatient(rotateAboutZf(uRot, couch), orientation));
  const v = unit(iecToPatient(rotateAboutZf(vRot, couch), orientation));
  const direction = scale(towardsSource, -1);

  const sad = Number(beam?.sadMm);
  const isocentre = (beam?.isocentreMm ?? [0, 0, 0]) as Vec3;
  const sourceMm = Number.isFinite(sad)
    ? add(isocentre, scale(towardsSource, sad))
    : ([NaN, NaN, NaN] as Vec3);

  return { towardsSource, direction, sourceMm, u, v };
}

export interface FieldCorners {
  /** Four corners, in order x1y1, x2y1, x2y2, x1y2. */
  cornersMm: Vec3[];
  /** Distance from the source to the plane the corners lie in, millimetres. */
  distanceFromSourceMm: number;
  /** Scaling applied to the jaw positions to reach that plane. */
  divergenceFactor: number;
  ok: boolean;
  reason?: string;
}

/**
 * The field outline projected onto a plane at a given depth.
 *
 * Jaws are defined at the isocentre. On a plane closer to the source the field is smaller
 * and further away it is larger, in proportion to the distance — ten percent over ten
 * centimetres at a metre SAD. Drawing the isocentre rectangle everywhere reads as a
 * slightly generous field rather than as an error.
 */
export function fieldCornersAtDepth(
  beam: Beam,
  orientation: PatientOrientation,
  distanceFromSourceMm: number
): FieldCorners {
  const jaws = beam?.jawsMm;
  const sad = Number(beam?.sadMm);
  if (!jaws || jaws.length !== 4 || jaws.some(j => !Number.isFinite(Number(j)))) {
    return {
      cornersMm: [],
      distanceFromSourceMm: NaN,
      divergenceFactor: NaN,
      ok: false,
      reason: 'Posições de mandíbula ausentes ou incompletas.',
    };
  }
  if (!(sad > 0)) {
    return {
      cornersMm: [],
      distanceFromSourceMm: NaN,
      divergenceFactor: NaN,
      ok: false,
      reason: 'Distância foco-eixo ausente — sem ela não há como escalar a divergência.',
    };
  }
  const distance = Number(distanceFromSourceMm);
  if (!Number.isFinite(distance) || distance <= 0) {
    return {
      cornersMm: [],
      distanceFromSourceMm: NaN,
      divergenceFactor: NaN,
      ok: false,
      reason: 'Distância ao plano inválida.',
    };
  }

  const axes = beamAxes(beam, orientation);
  const factor = distance / sad;
  const [x1, x2, y1, y2] = jaws.map(Number);
  const centre = add(axes.sourceMm, scale(axes.direction, distance));

  const corner = (x: number, y: number): Vec3 =>
    add(centre, add(scale(axes.u, x * factor), scale(axes.v, y * factor)));

  return {
    cornersMm: [corner(x1, y1), corner(x2, y1), corner(x2, y2), corner(x1, y2)],
    distanceFromSourceMm: distance,
    divergenceFactor: factor,
    ok: true,
  };
}

export interface SliceIntersection {
  /** Where the central axis crosses the slice, DICOM patient coordinates. */
  pointMm: Vec3 | null;
  /** Distance from the source to that point, millimetres. */
  distanceFromSourceMm: number;
  /** True when the axis runs parallel to the slice and never crosses it. */
  parallel: boolean;
  message: string;
}

/**
 * Where the central axis crosses an axial slice.
 *
 * A lateral beam is parallel to an axial slice and does not cross it. Returning the
 * isocentre in that case would draw a point that means nothing; the caller has to know the
 * difference between "crosses here" and "runs along this plane".
 */
export function centralAxisOnAxialSlice(
  beam: Beam,
  orientation: PatientOrientation,
  sliceZMm: number
): SliceIntersection {
  const axes = beamAxes(beam, orientation);
  const dz = axes.direction[2];
  const z = Number(sliceZMm);

  if (!Number.isFinite(z) || !Number.isFinite(dz)) {
    return { pointMm: null, distanceFromSourceMm: NaN, parallel: false, message: 'Entrada inválida.' };
  }
  if (Math.abs(dz) < 1e-9) {
    return {
      pointMm: null,
      distanceFromSourceMm: NaN,
      parallel: true,
      message:
        'O eixo central corre paralelo ao corte e não o atravessa. Devolver o isocentro aqui desenharia um ponto que não significa nada.',
    };
  }

  const t = (z - axes.sourceMm[2]) / dz;
  if (t <= 0) {
    return {
      pointMm: null,
      distanceFromSourceMm: NaN,
      parallel: false,
      message: 'O corte está atrás da fonte.',
    };
  }
  return {
    pointMm: add(axes.sourceMm, scale(axes.direction, t)),
    distanceFromSourceMm: t,
    parallel: false,
    message: '',
  };
}

export interface BeamLine {
  /** Entry point of the drawn segment, patient coordinates. */
  fromMm: Vec3;
  /** Exit point of the drawn segment. */
  toMm: Vec3;
  lengthMm: number;
}

/**
 * A segment of the central axis around the isocentre, for drawing.
 *
 * Drawn from a point before the isocentre to a point after it rather than from the source:
 * the source is a metre away and outside every image, and a line that starts off-screen
 * gives the viewer no indication of where the beam actually enters the patient.
 */
export function centralAxisSegment(
  beam: Beam,
  orientation: PatientOrientation,
  halfLengthMm = 200
): BeamLine {
  const axes = beamAxes(beam, orientation);
  const half = Math.max(1, Number(halfLengthMm) || 200);
  const isocentre = (beam?.isocentreMm ?? [0, 0, 0]) as Vec3;
  return {
    fromMm: add(isocentre, scale(axes.direction, -half)),
    toMm: add(isocentre, scale(axes.direction, half)),
    lengthMm: 2 * half,
  };
}

/** One line per beam for the beam-lines overlay legend. */
export function describeBeam(beam: Beam, orientation: PatientOrientation): string {
  const axes = beamAxes(beam, orientation);
  const name = beam.name ? `${beam.name}: ` : '';
  const couch = Number(beam.couchAngleDeg) || 0;
  const couchPart = couch !== 0 ? `, mesa ${couch}°` : '';
  return (
    `${name}gantry ${Number(beam.gantryAngleDeg) || 0}°, colimador ${Number(beam.collimatorAngleDeg) || 0}°${couchPart} ` +
    `(${orientation}) — direção [${axes.direction.map(c => c.toFixed(2)).join(', ')}]`
  );
}
