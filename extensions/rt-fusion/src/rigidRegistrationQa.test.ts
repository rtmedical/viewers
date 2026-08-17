import {
  describeRigidQa,
  determinantOf,
  distortionEnvelope,
  KIND_LABELS,
  Matrix4,
  MR_TRUSTED_RADIUS_MM,
  ORTHONORMALITY_TOLERANCE,
  orthonormalityError,
  posturePlausibility,
  rigidQaVerdict,
  rotationAngleDeg,
  transformCacheKey,
  rigidTranslationOf,
  validateRigid,
  VERTEBRAL_PITCH_MM,
  vertebralAmbiguity,
} from './rigidRegistrationQa';

const identity = (): Matrix4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const translate = (x: number, y: number, z: number): Matrix4 => {
  const m = identity();
  m[3] = x;
  m[7] = y;
  m[11] = z;
  return m;
};

/** Rotation about z by `deg`, row-major. */
const rotateZ = (deg: number): Matrix4 => {
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
};

/** Mirror in x — the LPS/RAS mistake. */
const mirrorX = (): Matrix4 => {
  const m = identity();
  m[0] = -1;
  return m;
};

describe('rigidRegistrationQa — decomposition', () => {
  it('reads the translation and the determinant', () => {
    expect(rigidTranslationOf(translate(3, -4, 12))).toEqual([3, -4, 12]);
    expect(determinantOf(identity())).toBeCloseTo(1, 10);
  });

  // No convention, so no sign to get wrong -- unlike the Euler decomposition that had a
  // negated yaw in couchShifts.ts.
  it('takes the rotation magnitude from the trace', () => {
    expect(rotationAngleDeg(identity())).toBeCloseTo(0, 10);
    expect(rotationAngleDeg(rotateZ(30))).toBeCloseTo(30, 8);
    expect(rotationAngleDeg(rotateZ(-30))).toBeCloseTo(30, 8);
    expect(rotationAngleDeg(rotateZ(180))).toBeCloseTo(180, 6);
  });

  it('measures departure from orthonormal', () => {
    expect(orthonormalityError(rotateZ(42))).toBeLessThan(1e-12);
    const scaled = identity();
    scaled[0] = 1.1;
    expect(orthonormalityError(scaled)).toBeGreaterThan(ORTHONORMALITY_TOLERANCE);
  });
});

describe('rigidRegistrationQa — a negative determinant is a reflection', () => {
  it('accepts a genuine rigid transform', () => {
    const result = validateRigid(rotateZ(15));
    expect(result.ok).toBe(true);
    expect(result.determinant).toBeCloseTo(1, 10);
  });

  // The visual check a human would apply is exactly the one this failure survives.
  it('refuses a mirror and names the usual cause', () => {
    const result = validateRigid(mirrorX());
    expect(result.ok).toBe(false);
    expect(result.refusals.join(' ')).toMatch(/nenhum movimento físico produz isso/);
    expect(result.refusals.join(' ')).toMatch(/confusão LPS\/RAS/);
    expect(result.refusals.join(' ')).toMatch(/esquerda e direita trocadas/);
  });

  it('refuses scale hidden inside a transform declared rigid', () => {
    const scaled = identity();
    scaled[0] = 1.2;
    scaled[5] = 1.2;
    scaled[10] = 1.2;
    const result = validateRigid(scaled, 'rigid');
    expect(result.ok).toBe(false);
    expect(result.refusals.join(' ')).toMatch(/isso é afim rotulado como rígido/);
  });

  it('lets an affine transform carry scale', () => {
    const scaled = identity();
    scaled[0] = 1.2;
    scaled[5] = 1.2;
    scaled[10] = 1.2;
    expect(validateRigid(scaled, 'affine').ok).toBe(true);
    expect(KIND_LABELS.affine).toMatch(/12 graus de liberdade/);
  });

  it('refuses a malformed matrix', () => {
    expect(validateRigid([1, 2, 3] as Matrix4).ok).toBe(false);
  });
});

describe('rigidRegistrationQa — MR is not geometrically true', () => {
  it('is quiet near the magnet isocentre', () => {
    const envelope = distortionEnvelope(50);
    expect(envelope.usable).toBe(true);
    expect(envelope.atRadiusMm).toBeCloseTo(0, 10);
  });

  // Six degrees of freedom cannot absorb a displacement that varies in space.
  it('states the gradient beyond the trusted radius', () => {
    const envelope = distortionEnvelope(200);
    expect(envelope.usable).toBe(false);
    expect(envelope.atRadiusMm).toBeGreaterThan(1);
    expect(envelope.message).toMatch(/não absorve deslocamento que varia no espaço/);
    expect(envelope.message).toMatch(/onde estão o crânio, a superfície cerebral e o pescoço/);
    expect(MR_TRUSTED_RADIUS_MM).toBe(100);
  });

  // Averaging the good centre with the bad periphery describes neither.
  it('says why a single residual figure is not enough', () => {
    expect(distortionEnvelope(200).message).toMatch(/não descreve nenhum dos dois/);
  });

  it('steps aside for a distortion-corrected sequence', () => {
    const envelope = distortionEnvelope(200, { distortionCorrected: true });
    expect(envelope.usable).toBe(true);
    expect(envelope.message).toMatch(/correção de distorção declarada/);
  });
});

describe('rigidRegistrationQa — periodic anatomy gives a near-equal wrong answer', () => {
  it('is quiet for a small cranio-caudal shift', () => {
    expect(vertebralAmbiguity(translate(0, 0, 4)).suspicious).toBe(false);
  });

  // There is no slice on which it looks wrong, because every slice matches a vertebra.
  it('flags a shift of about one vertebral pitch', () => {
    const check = vertebralAmbiguity(translate(0, 0, VERTEBRAL_PITCH_MM + 2));
    expect(check.suspicious).toBe(true);
    expect(check.levels).toBe(1);
    expect(check.message).toMatch(/o resultado parece correto em TODOS os cortes e põe a dose uma vértebra ao lado/);
    expect(check.message).toMatch(/Confirme por landmark ósseo numerado/);
  });

  it('flags two levels as well, in either direction', () => {
    expect(vertebralAmbiguity(translate(0, 0, -2 * VERTEBRAL_PITCH_MM)).levels).toBe(2);
  });

  it('does not flag a shift between pitches', () => {
    expect(vertebralAmbiguity(translate(0, 0, 45)).suspicious).toBe(false);
  });

  it('honours a custom pitch for the cervical spine', () => {
    expect(vertebralAmbiguity(translate(0, 0, 17), { pitchMm: 17, toleranceMm: 4 }).suspicious).toBe(true);
  });
});

describe('rigidRegistrationQa — a rigid transform cannot correct posture', () => {
  it('accepts a small difference between two studies of the same protocol', () => {
    expect(posturePlausibility(translate(2, 3, 5), { sameProtocol: true }).plausible).toBe(true);
  });

  it('flags a large difference between same-protocol studies as a local minimum or a mispositioning', () => {
    const check = posturePlausibility(rotateZ(25), { sameProtocol: true });
    expect(check.plausible).toBe(false);
    expect(check.message).toMatch(/convergiu num mínimo local/);
    expect(check.message).toMatch(/um número único esconde qual região foi ajustada/);
  });

  // Right where the intensity gradient dominated and wrong elsewhere.
  it('names posture for a cross-modality pair', () => {
    const check = posturePlausibility(rotateZ(40), { sameProtocol: false });
    expect(check.message).toMatch(/braços para cima contra braços para baixo/);
  });

  it('tolerates more across modalities than within a protocol', () => {
    expect(posturePlausibility(rotateZ(12), { sameProtocol: false }).plausible).toBe(true);
    expect(posturePlausibility(rotateZ(12), { sameProtocol: true }).plausible).toBe(false);
  });
});

describe('rigidRegistrationQa — the cache key', () => {
  it('includes the transform kind', () => {
    const rigid = transformCacheKey({ fixedSeriesUid: 'A', movingSeriesUid: 'B', kind: 'rigid' });
    const affine = transformCacheKey({ fixedSeriesUid: 'A', movingSeriesUid: 'B', kind: 'affine' });
    expect(rigid.key).not.toBe(affine.key);
  });

  it('includes the preprocessing and the metric', () => {
    const a = transformCacheKey({ fixedSeriesUid: 'A', movingSeriesUid: 'B', kind: 'rigid', metric: 'mi' });
    const b = transformCacheKey({ fixedSeriesUid: 'A', movingSeriesUid: 'B', kind: 'rigid', metric: 'ncc' });
    expect(a.key).not.toBe(b.key);
  });

  // The answer is plausible, which is the whole problem.
  it('refuses a key with no transform kind', () => {
    const result = transformCacheKey({
      fixedSeriesUid: 'A',
      movingSeriesUid: 'B',
      kind: 'nearly' as never,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/devolve uma transformação rígida a quem pediu afim/);
  });

  it('refuses a key missing a series', () => {
    expect(transformCacheKey({ fixedSeriesUid: '', movingSeriesUid: 'B', kind: 'rigid' }).ok).toBe(false);
  });
});

describe('rigidRegistrationQa — what the registration may be used for', () => {
  const clean = validateRigid(translate(2, 1, 3));

  it('separates visual fusion from contour transfer', () => {
    const verdict = rigidQaVerdict({
      validation: clean,
      landmarkCount: 4,
      landmarkErrorMm: 3.5,
    });
    expect(verdict.fusion).toBe(true);
    expect(verdict.transfer).toBe(false);
    expect(verdict.message).toMatch(/Fusão visual: liberada\. Transferência de contorno ou dose: não liberada/);
  });

  it('allows both when the landmark error is small', () => {
    const verdict = rigidQaVerdict({ validation: clean, landmarkCount: 5, landmarkErrorMm: 1.2 });
    expect(verdict.fusion).toBe(true);
    expect(verdict.transfer).toBe(true);
  });

  // A well-behaved wrong rigid transform looks exactly like a right one.
  it('refuses transfer with no landmarks and says why similarity does not substitute', () => {
    const verdict = rigidQaVerdict({ validation: clean });
    expect(verdict.transfer).toBe(false);
    expect(verdict.warnings.join(' ')).toMatch(
      /uma transformação rígida bem-comportada e errada tem exatamente a mesma aparência de uma certa/
    );
  });

  it('blocks everything on a mirrored transform', () => {
    const verdict = rigidQaVerdict({ validation: validateRigid(mirrorX()), landmarkCount: 5, landmarkErrorMm: 0.5 });
    expect(verdict.usable).toBe(false);
    expect(verdict.fusion).toBe(false);
    expect(verdict.transfer).toBe(false);
  });

  it('blocks on a vertebral ambiguity even with good landmarks', () => {
    const verdict = rigidQaVerdict({
      validation: clean,
      landmarkCount: 5,
      landmarkErrorMm: 0.5,
      vertebral: vertebralAmbiguity(translate(0, 0, 30)),
    });
    expect(verdict.usable).toBe(false);
  });

  it('carries the distortion envelope as a warning, not a block', () => {
    const verdict = rigidQaVerdict({
      validation: clean,
      landmarkCount: 5,
      landmarkErrorMm: 0.5,
      distortion: distortionEnvelope(220),
    });
    expect(verdict.usable).toBe(true);
    expect(describeRigidQa(verdict)).toMatch(/distorção geométrica da RM/);
  });
});
