import { orbitStep, rotateAroundAxis, OrbitCameraState, Vec3 } from './orbitCamera';

/** Element-wise closeness for float vectors. */
function expectVec(actual: ArrayLike<number>, expected: Vec3, digits = 10): void {
  expect(actual[0]).toBeCloseTo(expected[0], digits);
  expect(actual[1]).toBeCloseTo(expected[1], digits);
  expect(actual[2]).toBeCloseTo(expected[2], digits);
}

function distance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

describe('rotateAroundAxis (RTV-96)', () => {
  it('rotates 90° around +z following the right-hand rule', () => {
    expectVec(rotateAroundAxis([1, 0, 0], [0, 0, 1], Math.PI / 2), [0, 1, 0]);
    expectVec(rotateAroundAxis([0, 1, 0], [0, 0, 1], Math.PI / 2), [-1, 0, 0]);
  });

  it('rotates 180° and 360° back onto the expected vectors', () => {
    expectVec(rotateAroundAxis([1, 0, 0], [0, 0, 1], Math.PI), [-1, 0, 0]);
    expectVec(rotateAroundAxis([1, 0, 0], [0, 0, 1], 2 * Math.PI), [1, 0, 0]);
  });

  it('normalizes a non-unit axis internally', () => {
    expectVec(rotateAroundAxis([1, 0, 0], [0, 0, 5], Math.PI / 2), [0, 1, 0]);
  });

  it('leaves vectors parallel to the axis invariant', () => {
    expectVec(rotateAroundAxis([0, 0, 3], [0, 0, 1], 1.234), [0, 0, 3]);
  });

  it('is the identity for a zero/degenerate axis (no NaNs)', () => {
    expectVec(rotateAroundAxis([1, 2, 3], [0, 0, 0], Math.PI / 2), [1, 2, 3]);
    expectVec(rotateAroundAxis([1, 2, 3], [1e-9, 0, 0], Math.PI / 2), [1, 2, 3]);
  });

  it('is the identity for a non-finite angle', () => {
    expectVec(rotateAroundAxis([1, 2, 3], [0, 0, 1], NaN), [1, 2, 3]);
  });

  it('preserves vector length for arbitrary axes and angles', () => {
    const rotated = rotateAroundAxis([3, -4, 12], [1, 2, -2], 0.7331);
    expect(Math.hypot(...rotated)).toBeCloseTo(13, 10);
  });

  it('accepts array-likes (Float32Array camera vectors)', () => {
    const rotated = rotateAroundAxis(
      new Float32Array([1, 0, 0]),
      new Float32Array([0, 0, 1]),
      Math.PI
    );
    expectVec(rotated, [-1, 0, 0], 6);
  });

  it('does not mutate its inputs', () => {
    const vec: Vec3 = [1, 0, 0];
    const axis: Vec3 = [0, 0, 1];
    rotateAroundAxis(vec, axis, Math.PI / 2);
    expect(vec).toEqual([1, 0, 0]);
    expect(axis).toEqual([0, 0, 1]);
  });
});

describe('orbitStep (RTV-96)', () => {
  const camera: OrbitCameraState = {
    position: [10, 0, 0],
    focalPoint: [0, 0, 0],
    viewUp: [0, 0, 1],
  };

  it('orbits the position around the focal point about the default viewUp axis', () => {
    const step = orbitStep(camera, Math.PI / 2);
    expectVec(step.position, [0, 10, 0]);
    // Turntable spin: the up vector is the axis, so it must stay put.
    expectVec(step.viewUp, [0, 0, 1]);
  });

  it('returns to the start after a 180°+180° and a full 360° sweep', () => {
    const half = orbitStep(camera, Math.PI);
    expectVec(half.position, [-10, 0, 0]);
    const back = orbitStep({ ...camera, position: half.position }, Math.PI);
    expectVec(back.position, [10, 0, 0]);
    const full = orbitStep(camera, 2 * Math.PI);
    expectVec(full.position, [10, 0, 0]);
  });

  it('accumulates N steps of 2π/N back onto the original camera (frame loop)', () => {
    const frames = 120;
    const angle = (2 * Math.PI) / frames;
    let state: OrbitCameraState = { ...camera };
    for (let i = 0; i < frames; i++) {
      const next = orbitStep(state, angle);
      state = { ...state, position: next.position, viewUp: next.viewUp };
    }
    expectVec(state.position, [10, 0, 0], 8);
    expectVec(state.viewUp, [0, 0, 1], 8);
  });

  it('keeps the orbit radius constant (position stays on the sphere)', () => {
    const offCenter: OrbitCameraState = {
      position: [8, -3, 7],
      focalPoint: [5, 5, 5],
      viewUp: [0, 0, 1],
    };
    const radius = distance(offCenter.position, offCenter.focalPoint);
    let state = offCenter;
    for (const angle of [0.3, 1.1, 2.9]) {
      const next = orbitStep(state, angle);
      expect(distance(next.position, offCenter.focalPoint)).toBeCloseTo(radius, 10);
      state = { ...state, position: next.position, viewUp: next.viewUp };
    }
  });

  it('orbits around a non-origin focal point', () => {
    const shifted: OrbitCameraState = {
      position: [15, 5, 5],
      focalPoint: [5, 5, 5],
      viewUp: [0, 0, 1],
    };
    const step = orbitStep(shifted, Math.PI / 2);
    expectVec(step.position, [5, 15, 5]);
  });

  it('rotates viewUp along when an explicit non-up axis is given', () => {
    const step = orbitStep(camera, Math.PI / 2, [1, 0, 0]);
    // position [10,0,0] is on the axis → invariant; viewUp [0,0,1] → [0,-1,0].
    expectVec(step.position, [10, 0, 0]);
    expectVec(step.viewUp, [0, -1, 0]);
  });

  it('keeps viewUp ~invariant when the explicit axis is parallel to viewUp', () => {
    const step = orbitStep(camera, Math.PI / 2, [0, 0, 2]);
    expectVec(step.position, [0, 10, 0]);
    expectVec(step.viewUp, [0, 0, 1]);
  });

  it('is the identity for a zero axis', () => {
    const step = orbitStep(camera, Math.PI / 2, [0, 0, 0]);
    expectVec(step.position, [10, 0, 0]);
    expectVec(step.viewUp, [0, 0, 1]);
  });

  it('does not mutate the input camera', () => {
    const input: OrbitCameraState = {
      position: [10, 0, 0],
      focalPoint: [0, 0, 0],
      viewUp: [0, 0, 1],
    };
    orbitStep(input, Math.PI / 3, [1, 1, 0]);
    expect(input).toEqual({ position: [10, 0, 0], focalPoint: [0, 0, 0], viewUp: [0, 0, 1] });
  });
});
