import {
  buildRegistration,
  describeRegistration,
  identity,
  invertRigid,
  isIdentity,
  isocenterAlignment,
  Mat4,
  multiply,
  rotationAboutPoint,
  rotationFromAngles,
  rotationMagnitudeDeg,
  rotationX,
  rotationY,
  rotationZ,
  transformPoint,
  translation,
  translationOf,
  Vec3,
} from './fusionRegistration';

const near = (a: Vec3, b: Vec3, tol = 1e-9) => {
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));
  expect(tol).toBeGreaterThan(0);
};

describe('fusionRegistration — primitives', () => {
  it('identity leaves a point alone', () => {
    near(transformPoint(identity(), [3, -4, 5]), [3, -4, 5]);
  });

  it('translation moves a point', () => {
    near(transformPoint(translation([10, 0, -2]), [1, 1, 1]), [11, 1, -1]);
  });

  it('multiplies row-major, right operand applied first', () => {
    // Scale-free check: translate by +x, then translate by +y.
    const m = multiply(translation([0, 5, 0]), translation([5, 0, 0]));
    near(transformPoint(m, [0, 0, 0]), [5, 5, 0]);
  });

  it('rotates 90° about each patient axis right-handed', () => {
    near(transformPoint(rotationX(90), [0, 1, 0]), [0, 0, 1]);
    near(transformPoint(rotationY(90), [0, 0, 1]), [1, 0, 0]);
    near(transformPoint(rotationZ(90), [1, 0, 0]), [0, 1, 0]);
  });

  it('reports the total rotation angle', () => {
    expect(rotationMagnitudeDeg(rotationZ(30))).toBeCloseTo(30, 6);
    expect(rotationMagnitudeDeg(identity())).toBeCloseTo(0, 6);
  });

  it('coerces junk into finite numbers instead of producing NaN', () => {
    near(transformPoint(identity(), ['x', undefined, null] as unknown as Vec3), [0, 0, 0]);
  });
});

describe('fusionRegistration — one point gives translation only', () => {
  it('carries the moving isocenter onto the fixed one', () => {
    const m = isocenterAlignment([10, 20, 30], [12, 18, 35]);
    near(transformPoint(m, [10, 20, 30]), [12, 18, 35]);
    near(translationOf(m), [2, -2, 5]);
  });

  // A single landmark pair has no information about orientation. Claiming otherwise is
  // the modal saying more than it knows.
  it('produces NO rotation, ever', () => {
    const m = isocenterAlignment([10, 20, 30], [-5, 60, 0]);
    expect(rotationMagnitudeDeg(m)).toBeCloseTo(0, 9);
  });

  it('says so in the summary the reader sees', () => {
    const text = describeRegistration(isocenterAlignment([0, 0, 0], [2, 0, 0]));
    expect(text).toMatch(/apenas translação/);
    expect(text).toMatch(/um ponto não determina rotação/);
  });

  it('names an aligned pair rather than printing zeros', () => {
    expect(describeRegistration(identity())).toMatch(/já estão alinhados/);
  });
});

describe('fusionRegistration — rotation about the CR', () => {
  // The bug this is designed against: R alone rotates about the patient ORIGIN, which is
  // wherever the scanner put it. A head at +250 mm swings through an arc of that radius.
  it('leaves the centre of rotation exactly where it was', () => {
    const centre: Vec3 = [0, 0, 250];
    const m = rotationAboutPoint({ z: 37 }, centre);
    near(transformPoint(m, centre), centre);
  });

  it('rotating about the origin instead would move the point by the lever arm', () => {
    const centre: Vec3 = [0, 0, 250];
    const wrong = rotationFromAngles({ x: 37 });
    const moved = transformPoint(wrong, centre);
    // Demonstrates the failure mode, so the guard above is not vacuous.
    const distance = Math.hypot(moved[0] - centre[0], moved[1] - centre[1], moved[2] - centre[2]);
    expect(distance).toBeGreaterThan(100);
  });

  it('rotates points around the centre by the right angle', () => {
    const m = rotationAboutPoint({ z: 90 }, [100, 100, 0]);
    near(transformPoint(m, [110, 100, 0]), [100, 110, 0]);
  });

  it('composes Z then Y then X, and says so', () => {
    const composed = rotationFromAngles({ x: 10, y: 20, z: 30 });
    const manual = multiply(rotationX(10), multiply(rotationY(20), rotationZ(30)));
    composed.forEach((v, i) => expect(v).toBeCloseTo(manual[i], 9));
  });

  // Euler angles do not commute; a different order is a different orientation.
  it('a different order is a different matrix', () => {
    const zyx = rotationFromAngles({ x: 10, y: 20, z: 30 });
    const xyz = multiply(rotationZ(30), multiply(rotationY(20), rotationX(10)));
    expect(zyx.some((v, i) => Math.abs(v - xyz[i]) > 1e-6)).toBe(true);
  });
});

describe('fusionRegistration — buildRegistration', () => {
  const input = {
    movingIsocenter: [0, 0, 0] as Vec3,
    fixedIsocenter: [10, 0, 0] as Vec3,
  };

  it('is a plain translation with no angles', () => {
    const m = buildRegistration(input);
    expect(rotationMagnitudeDeg(m)).toBeCloseTo(0, 9);
    near(translationOf(m), [10, 0, 0]);
  });

  it('ignores an all-zero angle set rather than composing an identity rotation', () => {
    const m = buildRegistration({ ...input, angles: { x: 0, y: 0, z: 0 } });
    near(translationOf(m), [10, 0, 0]);
  });

  // The isocenter the reader just placed is the natural pivot, and it is in fixed
  // coordinates — using the moving frame would make the CR drift as the shift changes.
  it('defaults the centre of rotation to the FIXED isocenter, which stays put', () => {
    const m = buildRegistration({ ...input, angles: { z: 45 } });
    near(transformPoint(m, [0, 0, 0]), [10, 0, 0]);
  });

  it('honours an explicit centre of rotation', () => {
    const m = buildRegistration({ ...input, angles: { z: 90 }, centreOfRotation: [0, 0, 0] });
    // Moving origin lands on fixed isocenter (10,0,0), then rotates 90° about world origin.
    near(transformPoint(m, [0, 0, 0]), [0, 10, 0]);
  });
});

describe('fusionRegistration — inverse', () => {
  const forward = buildRegistration({
    movingIsocenter: [3, -7, 11],
    fixedIsocenter: [-2, 4, 40],
    angles: { x: 12, y: -25, z: 8 },
  });

  // Getting the direction backwards is the classic fusion sign error: it looks plausible
  // until the offset doubles instead of cancelling.
  it('round-trips a point exactly', () => {
    const p: Vec3 = [17, 3, -21];
    near(transformPoint(invertRigid(forward), transformPoint(forward, p)), p);
  });

  it('composes to the identity', () => {
    const product = multiply(forward, invertRigid(forward)) as Mat4;
    expect(isIdentity(product, 1e-9)).toBe(true);
  });

  it('inverts a pure translation by negating it', () => {
    near(translationOf(invertRigid(translation([5, -3, 2]))), [-5, 3, -2]);
  });

  it('is exact for a rotation, using the transpose rather than a general inverse', () => {
    const r = rotationFromAngles({ x: 30, y: 60, z: 90 });
    expect(isIdentity(multiply(r, invertRigid(r)), 1e-12)).toBe(true);
  });
});
