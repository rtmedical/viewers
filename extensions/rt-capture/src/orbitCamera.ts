/**
 * Rotational 3D cine — orbit camera math (RTV-96).
 *
 * Pure vector rotation used by the `exportRotational3D` command to spin a
 * VolumeViewport3D camera around its focal point, one fixed angular step per
 * recorded frame. Same split as the other rt-capture features: the math is
 * pure and unit-tested here; the setCamera/render/record loop is thin DOM
 * glue in `getCommandsModule` (validated E2E).
 */

export type Vec3 = [number, number, number];

/** Below this squared length an axis is treated as degenerate (no rotation). */
const EPSILON = 1e-12;

/** Camera triplet as returned by cornerstone3D `viewport.getCamera()`. */
export interface OrbitCameraState {
  position: Vec3;
  focalPoint: Vec3;
  viewUp: Vec3;
}

/** The parts of the camera an orbit step changes (focalPoint is fixed). */
export interface OrbitStepResult {
  position: Vec3;
  viewUp: Vec3;
}

function toVec3(v: ArrayLike<number>): Vec3 {
  return [Number(v[0]), Number(v[1]), Number(v[2])];
}

/**
 * Rotate `vec` by `angleRad` around `axis` (Rodrigues' rotation formula).
 * The axis is normalized internally; a zero/degenerate axis returns `vec`
 * unchanged (identity) instead of producing NaNs. Pure — inputs are not
 * mutated, and array-likes (e.g. Float32Array from getCamera) are accepted.
 */
export function rotateAroundAxis(
  vec: ArrayLike<number>,
  axis: ArrayLike<number>,
  angleRad: number
): Vec3 {
  const v = toVec3(vec);
  const a = toVec3(axis);
  const lenSq = a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
  if (!(lenSq > EPSILON) || !Number.isFinite(angleRad)) {
    return v;
  }
  const len = Math.sqrt(lenSq);
  const k: Vec3 = [a[0] / len, a[1] / len, a[2] / len];
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  // k × v
  const cross: Vec3 = [
    k[1] * v[2] - k[2] * v[1],
    k[2] * v[0] - k[0] * v[2],
    k[0] * v[1] - k[1] * v[0],
  ];
  const dot = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  // v·cosθ + (k×v)·sinθ + k·(k·v)·(1−cosθ)
  return [
    v[0] * cos + cross[0] * sin + k[0] * dot * (1 - cos),
    v[1] * cos + cross[1] * sin + k[1] * dot * (1 - cos),
    v[2] * cos + cross[2] * sin + k[2] * dot * (1 - cos),
  ];
}

/**
 * One orbit step: rotate the camera `position` around the `focalPoint` by
 * `angleRad` about `axis` (default: the camera's own `viewUp`, i.e. a
 * turntable spin) — position' = focalPoint + R·(position − focalPoint).
 *
 * `viewUp` rotates along ONLY when an explicit axis is given (spinning about
 * the up vector itself leaves it invariant by construction, so the default
 * returns it untouched — no float drift over a 360° sweep). A degenerate
 * (zero) axis yields the identity: the input camera is returned as copies.
 * The focal point never moves; the orbit radius is preserved exactly by the
 * rotation. Pure — the input camera is not mutated.
 */
export function orbitStep(
  camera: OrbitCameraState,
  angleRad: number,
  axis?: ArrayLike<number>
): OrbitStepResult {
  const position = toVec3(camera.position);
  const focalPoint = toVec3(camera.focalPoint);
  const viewUp = toVec3(camera.viewUp);
  const axisVec = axis !== undefined ? toVec3(axis) : viewUp;
  const lenSq = axisVec[0] * axisVec[0] + axisVec[1] * axisVec[1] + axisVec[2] * axisVec[2];
  if (!(lenSq > EPSILON) || !Number.isFinite(angleRad)) {
    return { position, viewUp };
  }
  const offset: Vec3 = [
    position[0] - focalPoint[0],
    position[1] - focalPoint[1],
    position[2] - focalPoint[2],
  ];
  const rotated = rotateAroundAxis(offset, axisVec, angleRad);
  return {
    position: [
      focalPoint[0] + rotated[0],
      focalPoint[1] + rotated[1],
      focalPoint[2] + rotated[2],
    ],
    viewUp: axis !== undefined ? rotateAroundAxis(viewUp, axisVec, angleRad) : viewUp,
  };
}
