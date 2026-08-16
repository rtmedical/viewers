import {
  DEFAULT_ALPHA,
  DEFAULT_BETA,
  frobeniusNorm,
  gaussianBlur,
  gaussianKernel,
  hessianAt,
  multiscaleVesselness,
  scaleNormalise,
  suggestC,
  symmetricEigenvalues,
  FrangiVolume,
  vesselness,
} from './frangi';

const N = 24;

/** A bright cylinder of the given radius along z, centred in an N³ volume. */
const cylinder = (radiusVox: number, bright = true): FrangiVolume => {
  const data = new Float32Array(N * N * N);
  const centre = (N - 1) / 2;
  for (let z = 0; z < N; z++) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const r = Math.hypot(x - centre, y - centre);
        const inside = r <= radiusVox;
        data[z * N * N + y * N + x] = bright ? (inside ? 1 : 0) : inside ? 0 : 1;
      }
    }
  }
  return { data, width: N, height: N, depth: N };
};

const indexOf = (x: number, y: number, z: number) => z * N * N + y * N + x;
const centre = Math.round((N - 1) / 2);

describe('frangi — eigenvalues', () => {
  it('returns the diagonal for a diagonal matrix, ordered by magnitude', () => {
    expect(symmetricEigenvalues(3, -1, 2, 0, 0, 0)).toEqual([-1, 2, 3]);
  });

  it('handles a genuinely off-diagonal matrix', () => {
    // [[2,1,0],[1,2,0],[0,0,5]] has eigenvalues 1, 3, 5.
    const values = symmetricEigenvalues(2, 2, 5, 1, 0, 0);
    expect(values[0]).toBeCloseTo(1, 6);
    expect(values[1]).toBeCloseTo(3, 6);
    expect(values[2]).toBeCloseTo(5, 6);
  });

  it('preserves the trace', () => {
    const values = symmetricEigenvalues(1, -2, 4, 0.5, -0.3, 0.7);
    expect(values[0] + values[1] + values[2]).toBeCloseTo(1 - 2 + 4, 6);
  });

  it('orders by ABSOLUTE value, which is what the vesselness formula assumes', () => {
    const values = symmetricEigenvalues(-9, 1, -4, 0, 0, 0);
    expect(values.map(Math.abs)).toEqual([1, 4, 9]);
  });

  it('handles the degenerate isotropic case', () => {
    expect(symmetricEigenvalues(2, 2, 2, 0, 0, 0)).toEqual([2, 2, 2]);
  });
});

describe('frangi — the sign convention', () => {
  const TUBE_BRIGHT: [number, number, number] = [0.01, -1, -1];
  const TUBE_DARK: [number, number, number] = [0.01, 1, 1];
  const params = { c: 1, polarity: 'bright' as const };

  it('responds to a bright tube when looking for bright tubes', () => {
    expect(vesselness(TUBE_BRIGHT, params)).toBeGreaterThan(0.5);
  });

  // Drop the sign check and the filter finds airways instead of arteries — a confident,
  // smooth, completely wrong result.
  it('gives a dark tube EXACTLY zero, not a weak positive', () => {
    expect(vesselness(TUBE_DARK, params)).toBe(0);
  });

  it('and the reverse with the polarity flipped', () => {
    expect(vesselness(TUBE_DARK, { c: 1, polarity: 'dark' })).toBeGreaterThan(0.5);
    expect(vesselness(TUBE_BRIGHT, { c: 1, polarity: 'dark' })).toBe(0);
  });

  it('has no default polarity', () => {
    expect(vesselness(TUBE_BRIGHT, { c: 1 } as never)).toBe(0);
  });
});

describe('frangi — the shape discrimination', () => {
  const params = { c: 1, polarity: 'bright' as const };

  it('a blob scores far below a tube', () => {
    const tube = vesselness([0.01, -1, -1], params);
    const blob = vesselness([-1, -1, -1], params);
    expect(blob).toBeLessThan(tube / 5);
  });

  it('a plate scores below a tube', () => {
    const tube = vesselness([0.01, -1, -1], params);
    const plate = vesselness([0.01, -0.01, -1], params);
    expect(plate).toBeLessThan(tube);
  });

  it('background with tiny eigenvalues is suppressed by the structureness term', () => {
    expect(vesselness([1e-4, -1e-3, -1e-3], params)).toBeLessThan(1e-4);
  });

  it('is bounded in 0..1', () => {
    const value = vesselness([0, -5, -5], params);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  });

  it('refuses nonsense parameters instead of producing NaN', () => {
    expect(vesselness([0.01, -1, -1], { c: 0, polarity: 'bright' })).toBe(0);
    expect(vesselness([NaN, -1, -1], params)).toBe(0);
    expect(DEFAULT_ALPHA).toBe(0.5);
    expect(DEFAULT_BETA).toBe(0.5);
  });
});

describe('frangi — scale normalisation and c', () => {
  it('multiplies the Hessian by sigma squared', () => {
    expect(scaleNormalise([1, 2, 3, 0, 0, 0], 2)).toEqual([4, 8, 12, 0, 0, 0]);
    expect(scaleNormalise([1], 0)).toEqual([1]);
  });

  // Without it the maximum over scales is decided by the arithmetic instead of by the
  // anatomy.
  it('makes two scales comparable instead of letting one dominate by construction', () => {
    const raw = [0.04, -0.04, -0.04, 0, 0, 0];
    const atSigma1 = scaleNormalise(raw, 1)[1];
    const atSigma4 = scaleNormalise(raw, 4)[1];
    expect(Math.abs(atSigma4 / atSigma1)).toBe(16);
  });

  it('suggestC is half the largest norm in the data', () => {
    expect(suggestC([1, 5, 3])).toBe(2.5);
    expect(suggestC([])).toBe(0);
  });

  it('frobeniusNorm is the root sum of squares', () => {
    expect(frobeniusNorm([3, 4, 0])).toBeCloseTo(5, 9);
  });
});

describe('frangi — Gaussian machinery', () => {
  it('the kernel sums to one and is symmetric', () => {
    const kernel = gaussianKernel(1.5);
    expect(kernel.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(kernel[0]).toBeCloseTo(kernel[kernel.length - 1], 12);
  });

  it('blurring preserves a constant volume', () => {
    const data = new Float32Array(N * N * N).fill(7);
    const blurred = gaussianBlur({ data, width: N, height: N, depth: N }, 2);
    expect(blurred[indexOf(centre, centre, centre)]).toBeCloseTo(7, 4);
  });

  it('blurring reduces the peak of a delta', () => {
    const data = new Float32Array(N * N * N);
    data[indexOf(centre, centre, centre)] = 1;
    const blurred = gaussianBlur({ data, width: N, height: N, depth: N }, 1.5);
    expect(blurred[indexOf(centre, centre, centre)]).toBeLessThan(0.5);
    expect(blurred[indexOf(centre, centre, centre)]).toBeGreaterThan(0);
  });

  it('the Hessian of a bright ridge is negative across it and near zero along it', () => {
    const blurred = gaussianBlur(cylinder(3), 1.5);
    const smoothed: FrangiVolume = { data: blurred, width: N, height: N, depth: N };
    const [xx, yy, zz] = hessianAt(smoothed, centre, centre, centre);
    expect(xx).toBeLessThan(0);
    expect(yy).toBeLessThan(0);
    expect(Math.abs(zz)).toBeLessThan(Math.abs(xx) / 10);
  });
});

describe('frangi — on a synthetic vessel', () => {
  it('responds strongly on the centreline and weakly in the background', () => {
    const { response } = multiscaleVesselness(cylinder(3), {
      scales: [1, 2, 3],
      polarity: 'bright',
    });
    const onVessel = response[indexOf(centre, centre, centre)];
    const inBackground = response[indexOf(1, 1, centre)];
    expect(onVessel).toBeGreaterThan(0.5);
    expect(inBackground).toBeLessThan(onVessel / 5);
  });

  // Finding airways instead of arteries.
  it('finds nothing at all in a bright cylinder when told to look for dark ones', () => {
    const { response } = multiscaleVesselness(cylinder(3), {
      scales: [1, 2, 3],
      polarity: 'dark',
    });
    expect(response[indexOf(centre, centre, centre)]).toBe(0);
  });

  it('finds a dark cylinder when told to', () => {
    const { response } = multiscaleVesselness(cylinder(3, false), {
      scales: [1, 2, 3],
      polarity: 'dark',
    });
    expect(response[indexOf(centre, centre, centre)]).toBeGreaterThan(0.5);
  });

  // A single-scale filter is a filter for vessels of ONE size.
  it('the winning scale tracks the vessel caliber', () => {
    const thin = multiscaleVesselness(cylinder(1), { scales: [1, 2, 4], polarity: 'bright' });
    const thick = multiscaleVesselness(cylinder(5), { scales: [1, 2, 4], polarity: 'bright' });
    expect(thick.scale[indexOf(centre, centre, centre)]).toBeGreaterThan(
      thin.scale[indexOf(centre, centre, centre)]
    );
  });

  it('records a scale wherever it recorded a response', () => {
    const { response, scale } = multiscaleVesselness(cylinder(3), {
      scales: [1, 2],
      polarity: 'bright',
    });
    for (let i = 0; i < response.length; i++) {
      if (response[i] > 0) {
        expect(scale[i]).toBeGreaterThan(0);
      }
    }
  });

  it('returns empty arrays rather than throwing on no scales', () => {
    const result = multiscaleVesselness(cylinder(3), { scales: [], polarity: 'bright' });
    expect(result.response.every(v => v === 0)).toBe(true);
  });

  it('honours an explicit c', () => {
    const auto = multiscaleVesselness(cylinder(3), { scales: [2], polarity: 'bright' });
    const tiny = multiscaleVesselness(cylinder(3), { scales: [2], polarity: 'bright', c: 1e6 });
    expect(tiny.response[indexOf(centre, centre, centre)]).toBeLessThan(
      auto.response[indexOf(centre, centre, centre)]
    );
  });
});
