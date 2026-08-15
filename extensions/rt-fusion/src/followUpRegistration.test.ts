import {
  compareVolumes,
  describeFollowUp,
  isMeasurable,
  JACOBIAN_TOLERANCE,
  jacobianWarning,
  MIN_LOCAL_SIMILARITY,
  propagateContour,
  registrationQuality,
  TRANSFORM_LABELS,
} from './followUpRegistration';

const CONTOUR: Array<[number, number, number]> = [
  [0, 0, 0],
  [10, 0, 0],
  [10, 10, 0],
];

describe('followUpRegistration — which transform may be measured through', () => {
  it('rigid may', () => {
    expect(isMeasurable({ kind: 'rigid' }).measurable).toBe(true);
  });

  // A field flexible enough to align the anatomy is flexible enough to compress the
  // tumour, and it does not know which structure it must not follow.
  it('deformable may NOT, and says why', () => {
    const verdict = isMeasurable({ kind: 'deformable' });
    expect(verdict.measurable).toBe(false);
    expect(verdict.reason).toBe('deformableField');
    expect(verdict.message).toMatch(/comprimir o tumor/);
    expect(verdict.message).toMatch(/Meça no rígido/);
  });

  it('affine may, but only when it did not scale', () => {
    expect(isMeasurable({ kind: 'affine', scaling: { x: 1, y: 1, z: 1 } }).measurable).toBe(true);
    const scaled = isMeasurable({ kind: 'affine', scaling: { x: 1.1, y: 1, z: 1 } });
    expect(scaled.measurable).toBe(false);
    expect(scaled.reason).toBe('affineScaling');
  });

  it('refuses on poor local alignment whatever the kind', () => {
    const verdict = isMeasurable({ kind: 'rigid', localSimilarity: 0.3 });
    expect(verdict.reason).toBe('poorLocalAlignment');
    expect(verdict.message).toMatch(/qualquer que seja a métrica global/);
  });

  it('refuses when the Jacobian says the transform moved volume here', () => {
    const verdict = isMeasurable({ kind: 'rigid', jacobianDeterminant: 0.8 });
    expect(verdict.reason).toBe('jacobianVolumeChange');
    expect(verdict.message).toMatch(/20%/);
    expect(verdict.message).toMatch(/grandeza sob investigação/);
  });

  it('tolerates a Jacobian close to one', () => {
    expect(isMeasurable({ kind: 'rigid', jacobianDeterminant: 1.02 }).measurable).toBe(true);
  });
});

describe('followUpRegistration — the Jacobian', () => {
  it('is quiet at volume preservation', () => {
    expect(jacobianWarning(1).present).toBe(false);
    expect(jacobianWarning(1 + JACOBIAN_TOLERANCE / 2).present).toBe(false);
  });

  // A 30% "response" inside a field that compressed by 25% is not a response.
  it('names a compression and its size', () => {
    const warning = jacobianWarning(0.75);
    expect(warning.present).toBe(true);
    expect(warning.volumeChangeFraction).toBeCloseTo(-0.25, 9);
    expect(warning.message).toMatch(/comprimiu esta região em 25%/);
    expect(warning.message).toMatch(/entra direto em qualquer variação de volume medida aqui/);
  });

  it('names an expansion too', () => {
    expect(jacobianWarning(1.3).message).toMatch(/expandiu/);
  });

  it('flags a folded transform', () => {
    expect(jacobianWarning(-0.2).message).toMatch(/dobrou o espaço sobre si mesmo/);
    expect(jacobianWarning(NaN).present).toBe(true);
  });

  it('honours a custom tolerance', () => {
    expect(jacobianWarning(1.03, 0.01).present).toBe(true);
  });
});

describe('followUpRegistration — global similarity can hide a local disaster', () => {
  // MI over a thorax is dominated by lung and chest wall.
  it('flags a beautiful global score with a broken local one', () => {
    const quality = registrationQuality({
      globalSimilarity: 0.95,
      localSimilarity: 0.3,
      kind: 'rigid',
    });
    expect(quality.misleadingGlobal).toBe(true);
    expect(quality.usable).toBe(false);
    expect(quality.message).toMatch(/dominada por pulmão e parede torácica/);
  });

  // The average is the number that hides the problem.
  it('never averages the two', () => {
    const quality = registrationQuality({
      globalSimilarity: 0.95,
      localSimilarity: 0.3,
      kind: 'rigid',
    });
    expect(quality.globalSimilarity).toBeCloseTo(0.95, 9);
    expect(quality.localSimilarity).toBeCloseTo(0.3, 9);
    expect(quality.message).not.toMatch(/0\.6/);
  });

  it('is usable when the local alignment holds', () => {
    const quality = registrationQuality({
      globalSimilarity: 0.7,
      localSimilarity: 0.85,
      kind: 'deformable',
    });
    expect(quality.usable).toBe(true);
    expect(quality.misleadingGlobal).toBe(false);
    expect(quality.message).toMatch(/deformável/);
  });

  it('reports a plain local failure without blaming the global metric', () => {
    const quality = registrationQuality({
      globalSimilarity: 0.4,
      localSimilarity: 0.3,
      kind: 'rigid',
    });
    expect(quality.misleadingGlobal).toBe(false);
    expect(quality.message).toMatch(/Alinhamento local insuficiente/);
  });

  it('clamps nonsense similarities', () => {
    const quality = registrationQuality({
      globalSimilarity: 5,
      localSimilarity: -1,
      kind: 'rigid',
    });
    expect(quality.globalSimilarity).toBe(1);
    expect(quality.localSimilarity).toBe(0);
  });

  it('labels every transform kind', () => {
    for (const key of Object.keys(TRANSFORM_LABELS)) {
      expect(TRANSFORM_LABELS[key as keyof typeof TRANSFORM_LABELS].length).toBeGreaterThan(3);
    }
    expect(MIN_LOCAL_SIMILARITY).toBe(0.5);
  });
});

describe('followUpRegistration — propagating a contour', () => {
  const shift = (p: [number, number, number]): [number, number, number] => [p[0] + 5, p[1], p[2]];

  it('moves the points', () => {
    const result = propagateContour(CONTOUR, shift, 'rigid');
    expect(result.points[0]).toEqual([5, 0, 0]);
    expect(result.use).toBe('measurement');
    expect(result.warnings).toEqual([]);
  });

  // The marking is on the value rather than in a comment, because a comment does not
  // survive being passed to a volume function.
  it('marks a deformably propagated contour as VISUAL ONLY', () => {
    const result = propagateContour(CONTOUR, shift, 'deformable');
    expect(result.use).toBe('visualOnly');
    expect(result.warnings.join(' ')).toMatch(/não para medida/);
  });

  it('keeps a point the displacement could not move', () => {
    const broken = () => [NaN, NaN, NaN] as [number, number, number];
    expect(propagateContour(CONTOUR, broken, 'rigid').points[0]).toEqual([0, 0, 0]);
  });

  it('drops malformed points instead of producing NaN', () => {
    const result = propagateContour(
      [...CONTOUR, [1, 2] as never, ['a', 'b', 'c'] as never],
      shift,
      'rigid'
    );
    expect(result.points).toHaveLength(3);
  });

  it('survives an empty contour', () => {
    expect(propagateContour([], shift, 'rigid').points).toEqual([]);
  });
});

describe('followUpRegistration — comparing volumes', () => {
  const rigid = isMeasurable({ kind: 'rigid' });

  it('reports the change through a measurable transform', () => {
    const result = compareVolumes(1000, 700, rigid);
    expect(result.valid).toBe(true);
    expect(result.changeFraction).toBeCloseTo(-0.3, 9);
    expect(result.message).toBe('Volume -30%.');
  });

  // A number with a percent sign that describes the algorithm.
  it('REFUSES through a deformable one, carrying the reason', () => {
    const result = compareVolumes(1000, 700, isMeasurable({ kind: 'deformable' }));
    expect(result.valid).toBe(false);
    expect(result.changeFraction).toBe(0);
    expect(result.message).toMatch(/Meça no rígido/);
  });

  it('refuses a zero or invalid baseline', () => {
    expect(compareVolumes(0, 700, rigid).valid).toBe(false);
    expect(compareVolumes(NaN, 700, rigid).message).toMatch(/inválidos/);
  });

  it('the readout stacks quality, measurability and the Jacobian', () => {
    const text = describeFollowUp(
      registrationQuality({ globalSimilarity: 0.95, localSimilarity: 0.3, kind: 'deformable' }),
      isMeasurable({ kind: 'deformable' }),
      jacobianWarning(0.8)
    );
    expect(text).toMatch(/dominada por pulmão/);
    expect(text).toMatch(/Meça no rígido/);
    expect(text).toMatch(/comprimiu/);
  });

  it('the readout is empty when there is nothing to say', () => {
    expect(describeFollowUp(undefined as never, undefined as never)).toBe('');
  });
});
