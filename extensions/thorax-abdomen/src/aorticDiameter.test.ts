import {
  AAA_THRESHOLD_MM,
  axialOverestimate,
  CALIPER_VARIABILITY_MM,
  compareToPrior,
  CONVENTION_LABELS,
  describeAorta,
  AortaGrid,
  MIN_GROWTH_INTERVAL_DAYS,
  perpendicularDiameter,
  planeBasis,
  RAPID_GROWTH_MM_PER_YEAR,
  surveillanceAdvice,
  unit,
  Vec3,
} from './aorticDiameter';

const grid: AortaGrid = { dims: [80, 80, 80], spacing: [1, 1, 1] };
const N = 80 * 80 * 80;
const T0 = new Date('2026-01-01T00:00:00Z').getTime();
const DAY = 86_400_000;

/** A cylinder of radius `r` mm along `axis`, centred at (40,40,40). */
const cylinder = (r: number, axis: Vec3): Uint8Array => {
  const mask = new Uint8Array(N);
  const w = unit(axis);
  for (let z = 0; z < 80; z++) {
    for (let y = 0; y < 80; y++) {
      for (let x = 0; x < 80; x++) {
        const dx = x - 40;
        const dy = y - 40;
        const dz = z - 40;
        const along = dx * w[0] + dy * w[1] + dz * w[2];
        const radial = Math.hypot(dx - along * w[0], dy - along * w[1], dz - along * w[2]);
        if (radial <= r) {
          mask[x + 80 * (y + 80 * z)] = 1;
        }
      }
    }
  }
  return mask;
};

const centre: Vec3 = [40, 40, 40];

describe('aorticDiameter — the plane basis', () => {
  it('produces two unit vectors perpendicular to the axis and to each other', () => {
    const [u, v] = planeBasis([1, 2, 3]);
    const w = unit([1, 2, 3]);
    expect(Math.hypot(u[0], u[1], u[2])).toBeCloseTo(1, 10);
    expect(u[0] * w[0] + u[1] * w[1] + u[2] * w[2]).toBeCloseTo(0, 10);
    expect(u[0] * v[0] + u[1] * v[1] + u[2] * v[2]).toBeCloseTo(0, 10);
  });

  it('stays conditioned for an axis aligned with a world axis', () => {
    const [u, v] = planeBasis([0, 0, 1]);
    expect(Math.hypot(u[0], u[1], u[2])).toBeCloseTo(1, 10);
    expect(Math.hypot(v[0], v[1], v[2])).toBeCloseTo(1, 10);
  });
});

describe('aorticDiameter — measured in the plane normal to the vessel', () => {
  // A digitised radius-12 disc spans 25 voxels, not 24: the voxels at radial distance
  // exactly 12 are inside, so the object occupies -12..+12 inclusive. The same digitisation
  // bias the virtual-endoscopy radius has, and it is worth knowing which of the two a
  // threshold was calibrated against.
  it('recovers the diameter of an axis-aligned cylinder', () => {
    const section = perpendicularDiameter(cylinder(12, [0, 0, 1]), grid, centre, [0, 0, 1], 'outer-wall');
    expect(section.ok).toBe(true);
    expect(section.maxDiameterMm).toBeCloseTo(25, 0);
    expect(section.eccentricity).toBeLessThan(1.1);
  });

  // The oblique cylinder is the same vessel; measured correctly it is the same diameter.
  it('recovers the same diameter for an oblique cylinder', () => {
    const axis: Vec3 = [0, Math.sin(Math.PI / 6), Math.cos(Math.PI / 6)];
    const section = perpendicularDiameter(cylinder(12, axis), grid, centre, axis, 'outer-wall');
    expect(section.maxDiameterMm).toBeCloseTo(25, 0);
  });

  // Measuring the same vessel in the axial plane inflates it by 1/cos.
  it('shows the inflation when the same vessel is cut axially', () => {
    const axis: Vec3 = [0, Math.sin(Math.PI / 6), Math.cos(Math.PI / 6)];
    const oblique = perpendicularDiameter(cylinder(12, axis), grid, centre, axis, 'outer-wall');
    const axial = perpendicularDiameter(cylinder(12, axis), grid, centre, [0, 0, 1], 'outer-wall');
    expect(axial.maxDiameterMm / oblique.maxDiameterMm).toBeCloseTo(1 / Math.cos(Math.PI / 6), 1);
    expect(axial.eccentricity).toBeGreaterThan(1.1);
  });

  it('refuses a centre outside the mask', () => {
    const section = perpendicularDiameter(cylinder(12, [0, 0, 1]), grid, [5, 5, 5], [0, 0, 1], 'outer-wall');
    expect(section.ok).toBe(false);
    expect(section.reason).toMatch(/a medida sairia do nada/);
  });
});

describe('aorticDiameter — what an axial measurement would have added', () => {
  // A genuine 4.8 cm aneurysm measures 5.5 cm, which is the referral number.
  it('turns a 48 mm aneurysm into a referral at thirty degrees', () => {
    const result = axialOverestimate([0, Math.sin(Math.PI / 6), Math.cos(Math.PI / 6)], 48);
    expect(result.angleDeg).toBeCloseTo(30, 6);
    expect(48 + result.extraMm).toBeCloseTo(55.4, 0);
  });

  // Consistent and predictable, and it looks like a careful measurement.
  it('names it as a bias rather than as noise', () => {
    expect(axialOverestimate([0, 0.5, 0.866], 48).message).toMatch(
      /Não é ruído — é um aumento consistente e previsível/
    );
  });

  it('says nothing for a vessel already perpendicular to the plane', () => {
    const result = axialOverestimate([0, 0, 1], 48);
    expect(result.factor).toBeCloseTo(1, 10);
    expect(result.message).toBe('');
  });
});

describe('aorticDiameter — outer wall or lumen is not a detail', () => {
  // Measuring the lumen produces a reassuring number for a dangerous aorta.
  it('refuses to compute growth across two conventions', () => {
    const result = compareToPrior(55, T0, 'outer-wall', {
      diameterMm: 40,
      at: T0 - 365 * DAY,
      convention: 'lumen',
    });
    expect(result.comparable).toBe(false);
    expect(result.message).toMatch(/a mudança relatada seria a convenção, não a aorta/);
    expect(CONVENTION_LABELS.lumen).toBe('luz opacificada');
  });
});

describe('aorticDiameter — a short interval is mostly noise', () => {
  it('computes a rate over a year', () => {
    const result = compareToPrior(52, T0, 'outer-wall', {
      diameterMm: 48,
      at: T0 - 365 * DAY,
      convention: 'outer-wall',
    });
    expect(result.mmPerYear).toBeCloseTo(4, 0);
    expect(result.rapid).toBe(false);
  });

  // Two millimetres over three months annualises to eight a year, and nothing grew.
  it('refuses to annualise three months and shows what the noise alone would give', () => {
    const result = compareToPrior(50, T0, 'outer-wall', {
      diameterMm: 48,
      at: T0 - 90 * DAY,
      convention: 'outer-wall',
    });
    expect(result.mmPerYear).toBeNull();
    expect(result.comparable).toBe(true);
    expect(result.message).toMatch(/O intervalo pesa mais que a diferença/);
    expect(result.message).toMatch(new RegExp(`${CALIPER_VARIABILITY_MM} mm`));
    expect(MIN_GROWTH_INTERVAL_DAYS).toBe(180);
  });

  it('flags rapid growth over a long enough interval', () => {
    const result = compareToPrior(60, T0, 'outer-wall', {
      diameterMm: 48,
      at: T0 - 365 * DAY,
      convention: 'outer-wall',
    });
    expect(result.rapid).toBe(true);
    expect(result.mmPerYear!).toBeGreaterThanOrEqual(RAPID_GROWTH_MM_PER_YEAR);
  });

  it('refuses a non-positive interval and a missing prior', () => {
    expect(compareToPrior(50, T0, 'outer-wall', { diameterMm: 48, at: T0, convention: 'outer-wall' }).comparable).toBe(false);
    expect(compareToPrior(50, T0, 'outer-wall', { diameterMm: NaN, at: T0 - DAY, convention: 'outer-wall' }).comparable).toBe(false);
  });
});

describe('aorticDiameter — the threshold differs by sex', () => {
  // 52 mm is below the male line and above the female one.
  it('puts the same aneurysm on different sides of the line', () => {
    expect(surveillanceAdvice(52, 'male').atThreshold).toBe(false);
    expect(surveillanceAdvice(52, 'female').atThreshold).toBe(true);
    expect(AAA_THRESHOLD_MM).toEqual({ male: 55, female: 50 });
  });

  it('raises rapid growth even below the size threshold', () => {
    const growth = compareToPrior(50, T0, 'outer-wall', {
      diameterMm: 38,
      at: T0 - 365 * DAY,
      convention: 'outer-wall',
    });
    const advice = surveillanceAdvice(50, 'male', growth);
    expect(advice.atThreshold).toBe(false);
    expect(advice.rapidGrowth).toBe(true);
  });

  it('says so when nothing is triggered', () => {
    expect(surveillanceAdvice(42, 'male').message).toMatch(/abaixo do limiar de 55 mm/);
  });
});

describe('aorticDiameter — the panel line', () => {
  it('states the perpendicular diameter, the convention and the caveats', () => {
    const axis: Vec3 = [0, Math.sin(Math.PI / 6), Math.cos(Math.PI / 6)];
    const section = perpendicularDiameter(cylinder(12, axis), grid, centre, axis, 'outer-wall');
    const line = describeAorta(section, axialOverestimate(axis, section.maxDiameterMm), surveillanceAdvice(24, 'male'));
    expect(line).toMatch(/perpendicular ao eixo \(parede externa a parede externa\)/);
    expect(line).toMatch(/uma medida axial somaria/);
  });

  it('shows the refusal when the centre was outside', () => {
    const section = perpendicularDiameter(cylinder(12, [0, 0, 1]), grid, [1, 1, 1], [0, 0, 1], 'lumen');
    expect(describeAorta(section)).toMatch(/sairia do nada/);
  });
});
