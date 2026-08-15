import {
  correctOpacity,
  describePlan,
  findPreset,
  mipDivergence,
  opacityAt,
  planVip,
  projectMip,
  projectVip,
  REFERENCE_STEP_MM,
  TransferPoint,
  TRANSMITTANCE_EPSILON,
  VIP_PRESETS,
  VIP_SAMPLE_BUDGET,
  VIP_TARGET_FPS,
} from './vip';

const TRANSPARENT: TransferPoint[] = [
  { value: -1000, opacity: 0 },
  { value: 3000, opacity: 0 },
];

const VASCULAR = findPreset('vascular')!.points;

describe('vip — presets', () => {
  it('ships the three the ticket asks for', () => {
    expect(VIP_PRESETS.map(p => p.id)).toEqual(['bone', 'vascular', 'tissue']);
  });

  it('every ramp starts fully transparent and rises', () => {
    for (const preset of VIP_PRESETS) {
      expect(preset.points[0].opacity).toBe(0);
      const opacities = preset.points.map(p => p.opacity);
      expect([...opacities].sort((a, b) => a - b)).toEqual(opacities);
      const values = preset.points.map(p => p.value);
      expect([...values].sort((a, b) => a - b)).toEqual(values);
    }
  });

  it('never reaches fully opaque, so nothing behind is unreachable by construction', () => {
    for (const preset of VIP_PRESETS) {
      expect(Math.max(...preset.points.map(p => p.opacity))).toBeLessThan(1);
    }
  });

  it('looks presets up by id', () => {
    expect(findPreset('bone')!.label).toBe('Osso');
    expect(findPreset('nope')).toBeUndefined();
  });
});

describe('vip — transfer function lookup', () => {
  const points: TransferPoint[] = [
    { value: 0, opacity: 0 },
    { value: 100, opacity: 0.5 },
    { value: 200, opacity: 1 },
  ];

  it('interpolates linearly between control points', () => {
    expect(opacityAt(points, 50)).toBeCloseTo(0.25, 9);
    expect(opacityAt(points, 150)).toBeCloseTo(0.75, 9);
  });

  it('hits the control points exactly', () => {
    expect(opacityAt(points, 100)).toBe(0.5);
  });

  // Extrapolating an opacity ramp is how you get alpha > 1 on a metal implant.
  it('clamps instead of extrapolating past either end', () => {
    expect(opacityAt(points, -5000)).toBe(0);
    expect(opacityAt(points, 99999)).toBe(1);
  });

  it('is defensive about junk', () => {
    expect(opacityAt([], 100)).toBe(0);
    expect(opacityAt(points, NaN)).toBe(0);
    expect(opacityAt(points, undefined as never)).toBe(0);
  });
});

describe('vip — opacity is per unit distance, not per sample', () => {
  it('leaves a reference-length step alone', () => {
    expect(correctOpacity(0.5, REFERENCE_STEP_MM)).toBeCloseTo(0.5, 9);
  });

  it('a half-length step attenuates less', () => {
    expect(correctOpacity(0.5, 0.5)).toBeCloseTo(1 - Math.sqrt(0.5), 9);
    expect(correctOpacity(0.5, 0.5)).toBeLessThan(0.5);
  });

  it('a double-length step attenuates more', () => {
    expect(correctOpacity(0.5, 2)).toBeCloseTo(0.75, 9);
  });

  it('keeps the fixed points fixed', () => {
    expect(correctOpacity(0, 0.25)).toBe(0);
    expect(correctOpacity(1, 4)).toBe(1);
  });

  // The bug: "the volume got darker when I improved the quality". Same anatomy, same
  // distance, two sampling rates — the answer must not move.
  it('renders the same ray identically at two step sizes', () => {
    // 40 mm of lightly attenuating tissue with a bright target at 30 mm. The target has
    // to be the winner for the test to say anything — a ray whose first sample wins is
    // insensitive to attenuation and would pass either way.
    const coarse = Array.from({ length: 40 }, (_, i) => (i === 30 ? 400 : 90));
    // The same 40 mm, sampled twice as finely.
    const fine: number[] = [];
    for (const v of coarse) {
      fine.push(v, v);
    }

    const a = projectVip(coarse, { points: VASCULAR, stepMm: 1 });
    const b = projectVip(fine, { points: VASCULAR, stepMm: 0.5 });

    expect(b.value).toBeCloseTo(a.value, 6);
  });

  it('and would NOT, if the correction were skipped', () => {
    // Demonstrates the failure mode, so the guard above is not vacuous.
    const uncorrected = (samples: number[]) => {
      let t = 1;
      let best = -Infinity;
      for (const v of samples) {
        best = Math.max(best, t * v);
        t *= 1 - opacityAt(VASCULAR, v);
      }
      return best;
    };
    const coarse = Array.from({ length: 40 }, (_, i) => (i === 30 ? 400 : 90));
    const fine = coarse.flatMap(v => [v, v]);
    expect(uncorrected(fine)).toBeLessThan(uncorrected(coarse) * 0.9);
  });
});

describe('vip — the definition and its relationship to MIP', () => {
  // The property that makes VIP a strict generalisation rather than a different picture.
  it('is EXACTLY MIP when nothing is opaque', () => {
    const ray = [10, 900, 40, 300, 5];
    expect(projectVip(ray, { points: TRANSPARENT }).value).toBe(projectMip(ray));
  });

  // MIP's blind spot: same brightest value, different depth, identical pixel.
  it('separates two rays that MIP cannot tell apart', () => {
    const inFront = [600, 200, 200, 200, 200];
    const behind = [200, 200, 200, 200, 600];

    expect(projectMip(inFront)).toBe(projectMip(behind));

    const a = projectVip(inFront, { points: VASCULAR });
    const b = projectVip(behind, { points: VASCULAR });
    expect(a.value).toBeGreaterThan(b.value);
  });

  it('attenuates a deep target in proportion to what is in front', () => {
    const light = [90, 90, 3000];
    const heavy = [200, 200, 3000];
    const a = projectVip(light, { points: VASCULAR });
    const b = projectVip(heavy, { points: VASCULAR });
    expect(a.index).toBe(2);
    expect(b.index).toBe(2);
    expect(b.transmittance).toBeLessThan(a.transmittance);
    expect(b.value).toBeLessThan(a.value);
  });

  // Not a defect — the point of the mode. Once the tissue in front is dense enough, the
  // wall IS what a viewer would see, and VIP says so by switching winners. MIP would keep
  // reporting the buried structure as if it were on the surface.
  it('hands the pixel to the wall when the wall is what survives', () => {
    const buried = [500, 500, 3000];
    const result = projectVip(buried, { points: VASCULAR });
    expect(result.index).toBe(0);
    expect(result.value).toBe(500);
    expect(projectMip(buried)).toBe(3000);
  });

  it('leaves a bright structure in clear space untouched, keeping the MIP reading', () => {
    const ray = [-900, -900, 700, -900];
    const result = projectVip(ray, { points: VASCULAR });
    expect(result.transmittance).toBe(1);
    expect(result.value).toBe(700);
    expect(result.index).toBe(2);
  });

  it('names which sample won', () => {
    expect(projectVip([10, 800, 20], { points: TRANSPARENT }).index).toBe(1);
  });

  it('returns zero for an empty ray rather than -Infinity', () => {
    expect(projectVip([], { points: VASCULAR })).toMatchObject({ value: 0, index: -1 });
    expect(projectMip([])).toBe(0);
  });

  it('skips NaN samples instead of poisoning the whole ray', () => {
    const ray = [100, NaN, 700, NaN];
    expect(projectVip(ray, { points: TRANSPARENT }).value).toBe(700);
  });
});

describe('vip — the MIP-divergence metric', () => {
  // Turns "clear visual differentiation from MIP" into a number a test can assert.
  it('is large when the bright structure sits behind dense tissue', () => {
    const ray = [500, 500, 500, 500, 500, 500, 3000];
    expect(mipDivergence(ray, { points: VASCULAR })).toBeGreaterThan(0.5);
  });

  // A legitimate outcome, not a failure: through clear air the two modes SHOULD agree.
  it('is zero on a ray with nothing in front of its maximum', () => {
    expect(mipDivergence([-900, -900, 700], { points: VASCULAR })).toBe(0);
  });

  it('is zero for an empty or all-zero ray, without dividing by zero', () => {
    expect(mipDivergence([], { points: VASCULAR })).toBe(0);
    expect(mipDivergence([0, 0, 0], { points: VASCULAR })).toBe(0);
  });
});

describe('vip — early ray termination', () => {
  const OPAQUE: TransferPoint[] = [
    { value: 0, opacity: 0.9 },
    { value: 1000, opacity: 0.9 },
  ];

  it('stops once the ray is saturated', () => {
    const ray = Array.from({ length: 500 }, () => 100);
    const result = projectVip(ray, { points: OPAQUE });
    expect(result.terminatedEarly).toBe(true);
    expect(result.samplesVisited).toBeLessThan(20);
  });

  // Correctness, not only speed: samples behind a saturated ray CANNOT change the answer.
  it('appending anything behind a saturated ray changes nothing', () => {
    const front = Array.from({ length: 20 }, () => 100);
    const a = projectVip(front, { points: OPAQUE });
    const b = projectVip([...front, 3000, 3000, 3000], { points: OPAQUE });
    expect(b.value).toBe(a.value);
    expect(b.index).toBe(a.index);
  });

  it('visits the whole ray when nothing is opaque', () => {
    const ray = Array.from({ length: 64 }, (_, i) => i);
    const result = projectVip(ray, { points: TRANSPARENT });
    expect(result.samplesVisited).toBe(64);
    expect(result.terminatedEarly).toBe(false);
  });

  it('the saturation threshold is a visible-difference threshold, not zero', () => {
    expect(TRANSMITTANCE_EPSILON).toBeCloseTo(1 / 255, 9);
  });
});

describe('vip — frame budget', () => {
  it('keeps the requested step when it fits', () => {
    const plan = planVip(100, 0.5, 512 * 512);
    expect(plan.stepMm).toBe(0.5);
    expect(plan.samplesPerRay).toBe(200);
    expect(plan.coarsened).toBe(false);
    expect(plan.withinBudget).toBe(true);
  });

  // A projection quietly rendered at 3 mm when the reader asked for 0.5 looks like a
  // different dataset.
  it('coarsens to fit and SAYS it coarsened', () => {
    const plan = planVip(400, 0.1, 2048 * 2048);
    expect(plan.coarsened).toBe(true);
    expect(plan.stepMm).toBeGreaterThan(0.1);
    expect(plan.totalSamples).toBeLessThanOrEqual(VIP_SAMPLE_BUDGET);
    expect(describePlan(plan)).toMatch(new RegExp(`${VIP_TARGET_FPS} fps`));
  });

  it('gives up honestly rather than proposing an absurd step', () => {
    const plan = planVip(500, 1, 100_000_000, 10);
    expect(plan.withinBudget).toBe(false);
    expect(describePlan(plan)).toMatch(/reduza a espessura do slab/);
  });

  it('never proposes zero samples for a degenerate slab', () => {
    expect(planVip(0, 1, 1024).samplesPerRay).toBe(1);
    expect(planVip(10, 0, 1024).samplesPerRay).toBeGreaterThan(0);
  });

  it('describes an untouched plan plainly', () => {
    expect(describePlan(planVip(50, 1, 256 * 256))).toBe('50 amostras/raio a 1.00 mm');
  });
});
