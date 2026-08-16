import {
  DEFAULT_THRESHOLDS,
  describeQa,
  foldingReport,
  Grid,
  inverseConsistency,
  jacobianDeterminants,
  landmarkError,
  PLAUSIBILITY,
  plausibilityReport,
  propagatedMeasurement,
  sampleDvf,
  similarityAsAccuracy,
  usageVerdict,
} from './deformableQa';

const grid: Grid = { dims: [8, 8, 8], spacing: [1, 2, 3] };
const N = 8 * 8 * 8;

/** Builds a field from a function of the physical position, in millimetres. */
const field = (
  f: (x: number, y: number, z: number) => [number, number, number]
): Float64Array => {
  const dvf = new Float64Array(3 * N);
  for (let z = 0; z < 8; z++) {
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const i = x + 8 * (y + 8 * z);
        const [ux, uy, uz] = f(x * grid.spacing[0], y * grid.spacing[1], z * grid.spacing[2]);
        dvf[3 * i] = ux;
        dvf[3 * i + 1] = uy;
        dvf[3 * i + 2] = uz;
      }
    }
  }
  return dvf;
};

const identity = () => field(() => [0, 0, 0]);
const translation = (dx: number) => field(() => [dx, 0, 0]);
/** Uniform scaling of the mapped position by `s`. */
const scaling = (s: number) => field((x, y, z) => [(s - 1) * x, (s - 1) * y, (s - 1) * z]);

describe('deformableQa — the Jacobian is a property of the field alone', () => {
  it('is 1 everywhere for the identity', () => {
    const det = jacobianDeterminants(identity(), grid);
    expect(Math.min(...det)).toBeCloseTo(1, 10);
    expect(Math.max(...det)).toBeCloseTo(1, 10);
  });

  it('is 1 everywhere for a pure translation', () => {
    const det = jacobianDeterminants(translation(2.5), grid);
    expect(Math.max(...det)).toBeCloseTo(1, 10);
  });

  it('is s³ for a uniform scaling, on an anisotropic grid', () => {
    const det = jacobianDeterminants(scaling(1.2), grid);
    expect(det[8 + 8 * (2 + 8 * 3)]).toBeCloseTo(1.2 ** 3, 8);
  });

  it('halves and doubles the way the volume does', () => {
    expect(jacobianDeterminants(scaling(0.5), grid)[100]).toBeCloseTo(0.125, 8);
    expect(jacobianDeterminants(scaling(2), grid)[100]).toBeCloseTo(8, 8);
  });
});

describe('deformableQa — a field that folds is not a deformation', () => {
  it('reports no folding on a well-behaved field', () => {
    const report = foldingReport(jacobianDeterminants(scaling(1.2), grid));
    expect(report.folded).toBe(false);
    expect(report.message).toBe('');
  });

  // x -> x - 1.5x = -0.5x turns the axis inside out.
  it('detects a negative determinant and says what it means', () => {
    const folded = field(x => [-1.5 * x, 0, 0]);
    const report = foldingReport(jacobianDeterminants(folded, grid));
    expect(report.folded).toBe(true);
    expect(report.minDeterminant).toBeLessThan(0);
    expect(report.message).toMatch(/o tecido foi virado do avesso/);
  });

  // A global percentage tells a planner nothing about whether the fold is in the GTV.
  it('localises the folded voxels rather than only scoring them', () => {
    const folded = field(x => [-1.5 * x, 0, 0]);
    const report = foldingReport(jacobianDeterminants(folded, grid));
    expect(report.foldedVoxels.length).toBeGreaterThan(0);
    expect(report.foldedFraction).toBeGreaterThan(0);
  });

  it('treats a determinant of exactly zero as folding', () => {
    expect(foldingReport(Float64Array.from([1, 0, 1])).foldedVoxels).toEqual([1]);
  });
});

describe('deformableQa — plausible for the site, not just valid', () => {
  it('accepts a 1.2 expansion in lung', () => {
    expect(plausibilityReport(jacobianDeterminants(scaling(1.05), grid), PLAUSIBILITY.lung).plausible).toBe(true);
  });

  // Mathematically fine; in a brain it is the registration inventing motion.
  it('rejects the same field in brain', () => {
    const report = plausibilityReport(jacobianDeterminants(scaling(1.2), grid), PLAUSIBILITY.brain);
    expect(report.plausible).toBe(false);
    expect(report.message).toMatch(/fora da faixa de deformação plausível para encéfalo/);
  });

  it('gives lung a wider band than brain', () => {
    expect(PLAUSIBILITY.lung.max).toBeGreaterThan(PLAUSIBILITY.brain.max);
    expect(PLAUSIBILITY.lung.min).toBeLessThan(PLAUSIBILITY.brain.min);
  });
});

describe('deformableQa — inverse consistency', () => {
  it('is zero when the two directions agree exactly', () => {
    const result = inverseConsistency(translation(2), translation(-2), grid);
    expect(result.meanMm).toBeCloseTo(0, 10);
    expect(result.maxMm).toBeCloseTo(0, 10);
  });

  it('measures the disagreement in millimetres', () => {
    const result = inverseConsistency(translation(2), translation(-1), grid);
    expect(result.meanMm).toBeCloseTo(1, 10);
  });

  it('interpolates the backward field at the mapped point', () => {
    const forward = translation(1.5);
    const backward = field(x => [-x / 2, 0, 0]);
    const result = inverseConsistency(forward, backward, grid);
    expect(result.meanMm).toBeGreaterThan(0);
    expect(Number.isFinite(result.maxMm)).toBe(true);
  });

  it('reports mean, p95 and max', () => {
    expect(inverseConsistency(translation(2), translation(-1), grid).message).toMatch(
      /média 1\.00 mm, p95 1\.00 mm, máxima 1\.00 mm/
    );
  });

  it('honours the sampling stride', () => {
    expect(inverseConsistency(translation(2), translation(-2), grid, 4).meanMm).toBeCloseTo(0, 10);
  });
});

describe('deformableQa — landmarks bring information from outside the images', () => {
  it('is zero when the field lands on the marked point', () => {
    const result = landmarkError(translation(2), grid, [
      { label: 'carina', fixed: [3, 4, 6], moving: [5, 4, 6] },
    ]);
    expect(result.meanMm).toBeCloseTo(0, 10);
  });

  it('measures how far it missed', () => {
    const result = landmarkError(translation(2), grid, [
      { label: 'carina', fixed: [3, 4, 6], moving: [8, 4, 6] },
    ]);
    expect(result.perLandmark[0].errorMm).toBeCloseTo(3, 10);
    expect(result.maxMm).toBeCloseTo(3, 10);
  });

  // The only check that can catch a field that is smooth, invertible, plausible and wrong.
  it('says what is missing when there are no landmarks', () => {
    const result = landmarkError(translation(2), grid, []);
    expect(result.count).toBe(0);
    expect(result.message).toMatch(/só dizem que o campo é bem-comportado — não que ele está certo/);
  });
});

describe('deformableQa — what the field may be used for', () => {
  const good = {
    folding: foldingReport(jacobianDeterminants(scaling(1.05), grid)),
    consistency: inverseConsistency(translation(2), translation(-2), grid),
    landmarks: landmarkError(translation(2), grid, [
      { label: 'a', fixed: [3, 4, 6], moving: [5, 4, 6] },
    ]),
    plausibility: plausibilityReport(jacobianDeterminants(scaling(1.05), grid), PLAUSIBILITY.lung),
  };

  it('approves a clean field for contours and dose', () => {
    const verdict = usageVerdict(good.folding, good.consistency, good.landmarks, good.plausibility);
    expect(verdict.contourPropagation).toBe(true);
    expect(verdict.doseAccumulation).toBe(true);
    expect(verdict.message).toMatch(/Campo aprovado/);
  });

  // A propagated contour is reviewed by a human; an accumulated dose becomes a number in a
  // plan comparison.
  it('holds dose accumulation to the stricter standard', () => {
    const folded = foldingReport(jacobianDeterminants(field(x => [-1.5 * x, 0, 0]), grid));
    const verdict = usageVerdict(folded, good.consistency, good.landmarks, good.plausibility, {
      ...DEFAULT_THRESHOLDS,
      foldedFraction: 1,
    });
    expect(verdict.doseAccumulation).toBe(false);
    expect(verdict.contourPropagation).toBe(true);
  });

  it('refuses dose accumulation with no landmarks at all', () => {
    const verdict = usageVerdict(
      good.folding,
      good.consistency,
      landmarkError(translation(2), grid, []),
      good.plausibility
    );
    expect(verdict.doseAccumulation).toBe(false);
  });

  it('refuses both when the two directions disagree', () => {
    const verdict = usageVerdict(
      good.folding,
      inverseConsistency(translation(5), translation(-1), grid),
      good.landmarks,
      good.plausibility
    );
    expect(verdict.contourPropagation).toBe(false);
    expect(verdict.doseAccumulation).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/descreverem geometrias diferentes/);
  });

  it('never approves measurement, whatever the numbers say', () => {
    expect(usageVerdict(good.folding, good.consistency, good.landmarks, good.plausibility).measurement).toBe(false);
  });
});

describe('deformableQa — the two refusals', () => {
  // The failure this ticket sits inside.
  it('refuses a measurement read off a propagated contour, and says which way it is biased', () => {
    const refusal = propagatedMeasurement();
    expect(refusal.ok).toBe(false);
    expect(refusal.reason).toMatch(/no seguimento é justamente a intensidade que mudou/);
    expect(refusal.reason).toMatch(/viés é na direção de "sem mudança"/);
  });

  it('refuses image similarity offered as accuracy', () => {
    const refusal = similarityAsAccuracy('Informação mútua');
    expect(refusal.reason).toMatch(/mede o quanto o algoritmo se esforçou, não se ele acertou/);
    expect(refusal.reason).toMatch(/jacobiano, consistência inversa e landmarks/);
  });
});

describe('deformableQa — sampling and the readout', () => {
  it('interpolates the displacement between voxels', () => {
    const ramp = field(x => [x, 0, 0]);
    expect(sampleDvf(ramp, grid, [2.5, 0, 0])[0]).toBeCloseTo(2.5, 6);
  });

  it('clamps outside the grid rather than reading past it', () => {
    const ramp = field(x => [x, 0, 0]);
    expect(sampleDvf(ramp, grid, [1000, 0, 0])[0]).toBeCloseTo(7, 6);
  });

  it('states the three uses on one line', () => {
    const verdict = usageVerdict(
      foldingReport(jacobianDeterminants(scaling(1.05), grid)),
      inverseConsistency(translation(2), translation(-2), grid),
      landmarkError(translation(2), grid, [{ label: 'a', fixed: [3, 4, 6], moving: [5, 4, 6] }]),
      plausibilityReport(jacobianDeterminants(scaling(1.05), grid), PLAUSIBILITY.lung)
    );
    expect(describeQa(verdict)).toMatch(/^contorno: sim · dose: sim · medida: nunca\./);
  });
});
