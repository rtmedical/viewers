import {
  compareMuscle,
  MuscleContrastPhase,
  describeMuscle,
  MUSCLE_HU,
  REFERENCE_LEVEL,
  skeletalMuscleArea,
  skeletalMuscleIndex,
  SliceGrid,
  SMI_CUTOFF,
  VertebralLevel,
} from './muscleIndex';

const grid: SliceGrid = { dims: [100, 100], spacing: [1, 1] };
const N = 100 * 100;

/** A square muscle compartment of `side` pixels, filled with `hu`. */
const slice = (side: number, hu: number | ((i: number) => number)) => {
  const mask = new Uint8Array(N);
  const values = new Float32Array(N);
  let n = 0;
  for (let y = 10; y < 10 + side; y++) {
    for (let x = 10; x < 10 + side; x++) {
      const i = x + 100 * y;
      mask[i] = 1;
      values[i] = typeof hu === 'number' ? hu : hu(n);
      n++;
    }
  }
  return { mask, hu: values };
};

const area = (
  side: number,
  hu: number | ((i: number) => number),
  level: VertebralLevel = 'L3',
  phase: MuscleContrastPhase = 'unenhanced',
  window?: [number, number]
) => {
  const built = slice(side, hu);
  return skeletalMuscleArea(built.hu, built.mask, grid, level, phase, window);
};

describe('muscleIndex — the Hounsfield window is part of the definition', () => {
  it('counts muscle inside the window', () => {
    const result = area(50, 40);
    // 2500 pixels of 1 mm2 = 25 cm2.
    expect(result.areaCm2).toBeCloseTo(25, 6);
    expect(result.meanHu).toBeCloseTo(40, 6);
    expect(MUSCLE_HU).toEqual([-29, 150]);
  });

  it('excludes intramuscular fat and reports it separately', () => {
    const result = area(50, i => (i < 500 ? -60 : 40));
    expect(result.voxels).toBe(2000);
    expect(result.imatCm2).toBeCloseTo(5, 6);
  });

  // Widening it quietly includes fat, and a sarcopenic patient stops being sarcopenic.
  it('warns when the window was widened', () => {
    const result = area(50, 40, 'L3', 'unenhanced', [-100, 150]);
    expect(result.warnings.join(' ')).toMatch(/um paciente sarcopênico deixa de ser sarcopênico/);
  });

  it('refuses when nothing fell inside the window', () => {
    const result = area(50, 400);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/confira a máscara e o nível/);
  });
});

describe('muscleIndex — the slice is part of the definition', () => {
  // The area is still an area of muscle, just not the one the threshold describes.
  it('warns when measured off L3', () => {
    const result = area(50, 40, 'L2');
    expect(result.warnings.join(' ')).toMatch(/só não é a que o limiar descreve/);
    expect(REFERENCE_LEVEL).toBe('L3');
  });

  it('computes the index but refuses to grade it off L3', () => {
    const result = skeletalMuscleIndex(area(50, 40, 'L2'), 1.75, 'male');
    expect(result.smi).not.toBeNull();
    expect(result.applicable).toBe(false);
    expect(result.sarcopenic).toBeNull();
    expect(result.message).toMatch(/não classificado/);
  });
});

describe('muscleIndex — contrast raises muscle attenuation', () => {
  // The change is the injection, not the patient.
  it('warns on an enhanced study', () => {
    expect(area(50, 40, 'L3', 'portal-venous').warnings.join(' ')).toMatch(
      /produz uma mudança que é a injeção/
    );
  });

  it('warns when the phase is unknown', () => {
    expect(area(50, 40, 'L3', 'unknown').warnings.join(' ')).toMatch(/Fase de contraste desconhecida/);
  });

  it('is quiet on an unenhanced study at L3 with the standard window', () => {
    expect(area(50, 40).warnings).toEqual([]);
  });
});

describe('muscleIndex — the index is an area over a height squared', () => {
  it('divides by height squared', () => {
    const result = skeletalMuscleIndex(area(90, 40), 1.75, 'male');
    // 8100 pixels = 81 cm2; 81 / 3.0625 = 26.4.
    expect(result.smi).toBeCloseTo(26.4, 1);
  });

  it('grades against the sex-specific cutoff', () => {
    expect(SMI_CUTOFF).toEqual({ male: 52.4, female: 38.5 });
    const built = area(90, 40);
    expect(skeletalMuscleIndex(built, 1.75, 'male').sarcopenic).toBe(true);
  });

  it('puts the same index on different sides of the line for the two cutoffs', () => {
    const built = area(90, 40);
    const smi = skeletalMuscleIndex(built, 1.4, 'male').smi as number;
    expect(smi).toBeGreaterThan(SMI_CUTOFF.female);
    expect(smi).toBeLessThan(SMI_CUTOFF.male);
    expect(skeletalMuscleIndex(built, 1.4, 'female').sarcopenic).toBe(false);
    expect(skeletalMuscleIndex(built, 1.4, 'male').sarcopenic).toBe(true);
  });

  // A number that looks like a measurement.
  it('refuses without a plausible height', () => {
    const result = skeletalMuscleIndex(area(50, 40), NaN, 'male');
    expect(result.applicable).toBe(false);
    expect(result.message).toMatch(/um índice calculado a partir de uma altura presumida é um número com cara de medida/);
    expect(skeletalMuscleIndex(area(50, 40), 3.2, 'male').applicable).toBe(false);
  });

  it('passes the refusal through when the area failed', () => {
    expect(skeletalMuscleIndex(area(50, 400), 1.75, 'male').applicable).toBe(false);
  });
});

describe('muscleIndex — comparing two studies', () => {
  it('reports the change when everything matches', () => {
    const result = compareMuscle(area(90, 40), area(80, 40));
    expect(result.comparable).toBe(true);
    expect(result.deltaCm2).toBeCloseTo(81 - 64, 6);
  });

  it('refuses across levels', () => {
    expect(compareMuscle(area(90, 40, 'L3'), area(90, 40, 'L2')).message).toMatch(
      /a diferença seria o corte escolhido/
    );
  });

  it('refuses across phases', () => {
    expect(compareMuscle(area(90, 40, 'L3', 'unenhanced'), area(90, 40, 'L3', 'portal-venous')).message).toMatch(
      /a diferença seria a injeção/
    );
  });

  it('refuses when one measurement failed', () => {
    expect(compareMuscle(area(90, 40), area(50, 400)).comparable).toBe(false);
  });
});

describe('muscleIndex — the panel line', () => {
  it('states area, attenuation, intramuscular fat and the index', () => {
    const built = area(90, 40);
    const line = describeMuscle(built, skeletalMuscleIndex(built, 1.75, 'male'));
    expect(line).toMatch(/^81\.0 cm² de músculo em L3, média 40 HU, gordura intramuscular 0\.0 cm²\./);
    expect(line).toMatch(/cm²\/m² \(corte 52\.4 cm²\/m²\)/);
  });

  it('shows the refusal when nothing was in the window', () => {
    expect(describeMuscle(area(50, 400))).toMatch(/confira a máscara e o nível/);
  });
});
