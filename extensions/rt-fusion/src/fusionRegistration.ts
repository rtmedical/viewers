/**
 * Rigid registration from an isocenter and an optional centre of rotation — pure core
 * (RTV-134).
 *
 * The Fusion modal asks the reader for a point on each volume ("isocenter") and, for
 * angio, a rotation about a second point ("CR"). This module turns that into a 4×4 and
 * says exactly what it does and does not claim.
 *
 * ## One point gives you translation. Only translation.
 *
 * Marking the same anatomical landmark on both volumes determines the offset between
 * them and nothing else — a single point pair has no information about orientation. A
 * modal that collects one isocenter and then presents a "registration" is claiming more
 * than it knows; {@link isocenterAlignment} therefore returns a pure translation and
 * {@link describeRegistration} says so in words the reader sees.
 *
 * Rotation has to come from somewhere else: from the frames of reference already
 * agreeing, from a real registration algorithm, or — for the angio case this ticket
 * calls out — from the reader dialling angles explicitly. That is the CR step.
 *
 * ## Rotate about the CR, not about the origin
 *
 * This is the bug worth designing against. A rotation matrix rotates about the coordinate
 * origin. The DICOM patient origin is wherever the scanner put it, often tens of
 * centimetres from the anatomy. Apply `R` and then the translation and the volume swings
 * through an arc with that distance as its lever arm — the preview jumps completely off
 * screen, and if the reader "corrects" it by dragging the isocenter, the saved
 * registration is quietly wrong by however much they dragged.
 *
 * The composition is therefore **T(c) · R · T(−c)**: move the centre of rotation to the
 * origin, rotate, put it back. {@link rotationAboutPoint} does that, and a test asserts
 * the centre is a fixed point of the result.
 *
 * ## Which direction the matrix goes
 *
 * Everything here maps **moving → fixed** patient coordinates. Resampling the moving
 * volume onto the fixed grid needs the *inverse* of that; getting this backwards is the
 * classic fusion sign error and it looks plausible right up until the offset doubles
 * instead of cancelling. {@link invertRigid} exists so nobody hand-rolls it, and it
 * exploits rigidity (Rᵀ, −Rᵀt) rather than running a general inverse.
 *
 * Matrices are 16-element row-major arrays, the same convention as DICOM's Frame of
 * Reference Transformation Matrix (3006,00C6). Framework-free, no vtk, no cornerstone.
 * Zero-fork per RTV-114.
 */

export type Vec3 = [number, number, number];

/** 4×4 row-major, DICOM (3006,00C6) order. */
export type Mat4 = number[];

const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export function toVec3(value: unknown): Vec3 {
  const list = (value as unknown[]) ?? [];
  return [num(list[0]), num(list[1]), num(list[2])];
}

export const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export const identity = (): Mat4 => IDENTITY.slice();

/** Row-major multiply: `a · b`, i.e. b applied first. */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array(16).fill(0);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += num(a[row * 4 + k]) * num(b[k * 4 + col]);
      }
      out[row * 4 + col] = sum;
    }
  }
  return out;
}

/** Applies a 4×4 to a point (w = 1). */
export function transformPoint(matrix: Mat4, point: Vec3): Vec3 {
  const p = toVec3(point);
  const out: number[] = [];
  for (let row = 0; row < 3; row++) {
    out.push(
      num(matrix[row * 4]) * p[0] +
        num(matrix[row * 4 + 1]) * p[1] +
        num(matrix[row * 4 + 2]) * p[2] +
        num(matrix[row * 4 + 3])
    );
  }
  return out as Vec3;
}

export function translation(offset: Vec3): Mat4 {
  const t = toVec3(offset);
  return [1, 0, 0, t[0], 0, 1, 0, t[1], 0, 0, 1, t[2], 0, 0, 0, 1];
}

const deg2rad = (deg: number): number => (num(deg) * Math.PI) / 180;

/** Right-handed rotation about the patient x (LR) axis, in degrees. */
export function rotationX(deg: number): Mat4 {
  const c = Math.cos(deg2rad(deg));
  const s = Math.sin(deg2rad(deg));
  return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1];
}

/** Right-handed rotation about the patient y (AP) axis, in degrees. */
export function rotationY(deg: number): Mat4 {
  const c = Math.cos(deg2rad(deg));
  const s = Math.sin(deg2rad(deg));
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1];
}

/** Right-handed rotation about the patient z (SI) axis, in degrees. */
export function rotationZ(deg: number): Mat4 {
  const c = Math.cos(deg2rad(deg));
  const s = Math.sin(deg2rad(deg));
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

export interface EulerAngles {
  /** Degrees about the patient x, y and z axes. */
  x?: number;
  y?: number;
  z?: number;
}

/**
 * Composed rotation, applied Z then Y then X.
 *
 * The order is fixed and stated because Euler angles do not commute: the same three
 * numbers in a different order are a different orientation, and a modal that persists
 * angles without persisting the convention produces a registration that cannot be
 * reproduced.
 */
export function rotationFromAngles(angles: EulerAngles): Mat4 {
  return multiply(
    rotationX(num(angles?.x)),
    multiply(rotationY(num(angles?.y)), rotationZ(num(angles?.z)))
  );
}

/**
 * Rotation about an arbitrary point: `T(c) · R · T(−c)`.
 *
 * See the module note — rotating about the origin instead swings the volume by a lever
 * arm equal to its distance from the patient origin.
 */
export function rotationAboutPoint(angles: EulerAngles, centre: Vec3): Mat4 {
  const c = toVec3(centre);
  const back = translation([-c[0], -c[1], -c[2]]);
  return multiply(translation(c), multiply(rotationFromAngles(angles), back));
}

/**
 * Translation that carries the moving isocenter onto the fixed one.
 *
 * A pure translation, deliberately: one landmark pair says nothing about orientation.
 */
export function isocenterAlignment(movingIsocenter: Vec3, fixedIsocenter: Vec3): Mat4 {
  const m = toVec3(movingIsocenter);
  const f = toVec3(fixedIsocenter);
  return translation([f[0] - m[0], f[1] - m[1], f[2] - m[2]]);
}

export interface RegistrationInput {
  /** Landmark on the moving volume, patient mm. */
  movingIsocenter?: Vec3;
  /** The same landmark on the fixed volume, patient mm. */
  fixedIsocenter?: Vec3;
  /** Angio: rotation dialled by the reader. */
  angles?: EulerAngles;
  /**
   * Point the rotation turns about, patient mm, in *fixed* coordinates. Defaults to the
   * fixed isocenter, which is the point the reader just placed and is looking at.
   */
  centreOfRotation?: Vec3;
}

/**
 * The full moving → fixed transform.
 *
 * Translation first, then the rotation about the CR — so the CR is expressed in fixed
 * coordinates, where the reader picked it, rather than in the moving volume's frame
 * where it would drift as the translation changes.
 */
export function buildRegistration(input: RegistrationInput): Mat4 {
  const shift = isocenterAlignment(
    toVec3(input?.movingIsocenter),
    toVec3(input?.fixedIsocenter)
  );
  const angles = input?.angles;
  const hasRotation =
    !!angles && [angles.x, angles.y, angles.z].some(a => Math.abs(num(a)) > 1e-9);
  if (!hasRotation) {
    return shift;
  }
  const centre = input?.centreOfRotation ? toVec3(input.centreOfRotation) : toVec3(input?.fixedIsocenter);
  return multiply(rotationAboutPoint(angles!, centre), shift);
}

/**
 * Inverse of a rigid transform, via `Rᵀ` and `−Rᵀt`.
 *
 * Rigidity is exploited rather than running a general 4×4 inverse: it is exact, it cannot
 * fail on a near-singular matrix, and it makes the rigidity assumption explicit instead
 * of hiding it behind a determinant.
 */
export function invertRigid(matrix: Mat4): Mat4 {
  const m = (matrix ?? []).map(v => num(v));
  const rt = [
    m[0], m[4], m[8],
    m[1], m[5], m[9],
    m[2], m[6], m[10],
  ];
  const t: Vec3 = [m[3], m[7], m[11]];
  const inv: Vec3 = [
    -(rt[0] * t[0] + rt[1] * t[1] + rt[2] * t[2]),
    -(rt[3] * t[0] + rt[4] * t[1] + rt[5] * t[2]),
    -(rt[6] * t[0] + rt[7] * t[1] + rt[8] * t[2]),
  ];
  return [
    rt[0], rt[1], rt[2], inv[0],
    rt[3], rt[4], rt[5], inv[1],
    rt[6], rt[7], rt[8], inv[2],
    0, 0, 0, 1,
  ];
}

/** Translation component, in mm. */
export function translationOf(matrix: Mat4): Vec3 {
  return [num(matrix?.[3]), num(matrix?.[7]), num(matrix?.[11])];
}

/** Total rotation angle in degrees, from the trace of the rotation block. */
export function rotationMagnitudeDeg(matrix: Mat4): number {
  const trace = num(matrix?.[0], 1) + num(matrix?.[5], 1) + num(matrix?.[10], 1);
  const cos = Math.min(1, Math.max(-1, (trace - 1) / 2));
  return (Math.acos(cos) * 180) / Math.PI;
}

export function isIdentity(matrix: Mat4, toleranceMm = 1e-6): boolean {
  return (matrix ?? []).every((v, i) => Math.abs(num(v) - IDENTITY[i]) <= toleranceMm);
}

/**
 * Plain-language summary for the modal footer.
 *
 * Says "apenas translação" when that is all it is. A reader who believes a
 * one-point alignment corrected orientation will stop looking for the misalignment that
 * is still there.
 */
export function describeRegistration(matrix: Mat4): string {
  if (isIdentity(matrix)) {
    return 'Sem deslocamento — os volumes já estão alinhados.';
  }
  const t = translationOf(matrix);
  const mm = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
  const shift = `Δ ${mm(t[0])}, ${mm(t[1])}, ${mm(t[2])} mm`;
  const rotation = rotationMagnitudeDeg(matrix);
  return rotation > 0.05
    ? `${shift}; rotação ${rotation.toFixed(1)}°`
    : `${shift} (apenas translação — um ponto não determina rotação)`;
}
