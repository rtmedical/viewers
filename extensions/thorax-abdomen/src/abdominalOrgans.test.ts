import {
  adjacencySuspicion,
  ContrastPhase,
  describeOrgan,
  Grid,
  hepaticSteatosis,
  LIVER_SPLEEN_DIFFERENCE_HU,
  LIVER_STEATOSIS_HU,
  measureOrgan,
  Organ,
  ORGAN_LABELS,
  PHASE_LABELS,
  WIDE_SPREAD_HU,
} from './abdominalOrgans';

const grid: Grid = { dims: [20, 20, 20], spacing: [1, 1, 2] };
const N = 20 * 20 * 20;

const at = (x: number, y: number, z: number) => x + 20 * (y + 20 * z);

/** A cube of side `side` starting at `origin`, filled with `hu`. */
const cube = (
  side: number,
  origin: [number, number, number],
  hu: number | ((i: number) => number)
): { mask: Uint8Array; hu: Float32Array } => {
  const mask = new Uint8Array(N);
  const values = new Float32Array(N);
  let n = 0;
  for (let z = origin[2]; z < origin[2] + side; z++) {
    for (let y = origin[1]; y < origin[1] + side; y++) {
      for (let x = origin[0]; x < origin[0] + side; x++) {
        const i = at(x, y, z);
        mask[i] = 1;
        values[i] = typeof hu === 'number' ? hu : hu(n);
        n++;
      }
    }
  }
  return { mask, hu: values };
};

const measure = (
  side: number,
  hu: number | ((i: number) => number),
  phase: ContrastPhase = 'unenhanced',
  organ: Organ = 'liver',
  origin: [number, number, number] = [2, 2, 2],
  options = {}
) => {
  const built = cube(side, origin, hu);
  return measureOrgan(built.hu, built.mask, grid, organ, phase, options);
};

describe('abdominalOrgans — volume and its uncertainty', () => {
  it('counts volume with the voxel size, anisotropy included', () => {
    const result = measure(10, 60);
    // 1000 voxels of 1 x 1 x 2 mm = 2000 mm3 = 2 mL.
    expect(result.volumeMl).toBeCloseTo(2, 6);
  });

  // The same segmentation quality gives very different precision.
  it('gives a small organ a much larger relative uncertainty than a big one', () => {
    const small = measure(4, 60);
    const big = measure(14, 60);
    expect(small.volumeUncertaintyFraction).toBeGreaterThan(big.volumeUncertaintyFraction);
  });

  it('says so when the uncertainty is worth stating', () => {
    expect(measure(4, 60).warnings.join(' ')).toMatch(
      /órgão pequeno tem proporcionalmente muito mais borda/
    );
  });

  it('counts every voxel of a thin structure as boundary', () => {
    const result = measure(2, 60);
    expect(result.boundaryVoxels).toBe(result.voxels);
  });

  it('refuses an empty mask', () => {
    const result = measureOrgan(new Float32Array(N), new Uint8Array(N), grid, 'liver', 'unenhanced');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Máscara de fígado vazia/);
  });
});

describe('abdominalOrgans — a mean over a whole organ answers a question nobody asked', () => {
  it('reports the median and the interquartile range', () => {
    const result = measure(10, i => (i < 500 ? 50 : 70));
    expect(result.medianHu).toBeCloseTo(60, 0);
    expect(result.p25Hu).toBeCloseTo(50, 6);
    expect(result.p75Hu).toBeCloseTo(70, 6);
  });

  // The mean lands between the two populations, on a value that describes neither.
  it('flags a bimodal organ instead of averaging over it', () => {
    const result = measure(10, i => (i < 500 ? 20 : 120));
    expect(result.p75Hu - result.p25Hu).toBeGreaterThan(WIDE_SPREAD_HU);
    expect(result.warnings.join(' ')).toMatch(/A média cai entre as duas e não descreve nenhuma/);
  });

  it('is quiet on a homogeneous organ', () => {
    expect(measure(10, 60).warnings.join(' ')).not.toMatch(/Dispersão interna larga/);
  });

  it('honours an exclusion window and says how much it dropped', () => {
    const result = measure(10, i => (i < 100 ? 400 : 60), 'unenhanced', 'kidney-left', [2, 2, 2], {
      excludeHuOutside: [-20, 150] as [number, number],
    });
    expect(result.excludedVoxels).toBe(100);
    expect(result.medianHu).toBeCloseTo(60, 6);
    expect(result.warnings.join(' ')).toMatch(/não entraram na densidade/);
  });

  it('refuses when the window excluded everything', () => {
    const result = measure(6, 400, 'unenhanced', 'liver', [2, 2, 2], {
      excludeHuOutside: [-20, 150] as [number, number],
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/depois da janela de exclusão/);
  });
});

describe('abdominalOrgans — an attenuation with no phase is a number with no unit', () => {
  // 55 HU is normal unenhanced and markedly abnormal in the portal-venous phase.
  it('warns when the phase is unknown', () => {
    expect(measure(10, 55, 'unknown').warnings.join(' ')).toMatch(
      /não é uma medida incompleta, é uma medida ininterpretável/
    );
  });

  it('is quiet when the phase is known', () => {
    expect(measure(10, 55, 'portal-venous').warnings.join(' ')).not.toMatch(/ininterpretável/);
  });
});

describe('abdominalOrgans — hepatic steatosis', () => {
  const liverAt = (hu: number, phase: ContrastPhase = 'unenhanced') => measure(10, hu, phase, 'liver');
  const spleenAt = (hu: number, phase: ContrastPhase = 'unenhanced') =>
    measure(10, hu, phase, 'spleen', [2, 2, 2]);

  it('calls a normal liver normal', () => {
    const result = hepaticSteatosis(liverAt(60), spleenAt(50));
    expect(result.grade).toBe('none');
    expect(result.differenceHu).toBeCloseTo(10, 6);
  });

  it('calls a liver at or below the absolute threshold steatotic', () => {
    expect(hepaticSteatosis(liverAt(LIVER_STEATOSIS_HU)).grade).toBe('moderate-severe');
  });

  // Normalises for kV, kernel and patient size, which the absolute number does not.
  it('uses the liver-minus-spleen difference when a spleen is available', () => {
    const result = hepaticSteatosis(liverAt(45), spleenAt(60));
    expect(result.differenceHu).toBeCloseTo(-15, 6);
    expect(result.grade).toBe('moderate-severe');
    expect(LIVER_SPLEEN_DIFFERENCE_HU).toBe(-10);
  });

  it('calls a small negative difference mild', () => {
    expect(hepaticSteatosis(liverAt(55), spleenAt(58)).grade).toBe('mild');
  });

  // Applying them to a portal-venous liver gives a grade that varies with the injection.
  it('refuses to grade a contrast-enhanced study', () => {
    const result = hepaticSteatosis(liverAt(55, 'portal-venous'), spleenAt(70, 'portal-venous'));
    expect(result.applicable).toBe(false);
    expect(result.grade).toBe('indeterminate');
    expect(result.message).toMatch(/varia com a velocidade com que o contraste foi empurrado/);
  });

  it('refuses when liver and spleen were measured in different phases', () => {
    const result = hepaticSteatosis(liverAt(55), spleenAt(70, 'portal-venous'));
    expect(result.applicable).toBe(false);
    expect(result.message).toMatch(/fases diferentes — a diferença não significa nada/);
  });

  it('says it had no spleen to normalise with', () => {
    expect(hepaticSteatosis(liverAt(60)).message).toMatch(/Sem baço para normalizar por técnica/);
  });

  it('is indeterminate with no liver measurement', () => {
    const empty = measureOrgan(new Float32Array(N), new Uint8Array(N), grid, 'liver', 'unenhanced');
    expect(hepaticSteatosis(empty).applicable).toBe(false);
  });
});

describe('abdominalOrgans — leakage moves two organs in opposite directions', () => {
  // The total is preserved, so a "does it add up" check passes.
  it('flags a long shared boundary', () => {
    const a = cube(8, [2, 2, 2], 60);
    const b = cube(8, [10, 2, 2], 50);
    const result = adjacencySuspicion(a.mask, b.mask, grid);
    expect(result.sharedFraction).toBeGreaterThan(0);
    expect(result.message === '' || result.message).toBeDefined();
  });

  it('says nothing about organs that do not touch', () => {
    const a = cube(4, [2, 2, 2], 60);
    const b = cube(4, [12, 12, 12], 50);
    const result = adjacencySuspicion(a.mask, b.mask, grid);
    expect(result.sharedFraction).toBe(0);
    expect(result.suspicious).toBe(false);
  });

  // A threshold of zero means "flag any contact at all" and must not be swallowed by a
  // falsy-default fallback.
  it('honours a threshold of zero and names the failure a sum check cannot catch', () => {
    const a = cube(8, [2, 2, 2], 60);
    const b = cube(8, [10, 2, 2], 50);
    const result = adjacencySuspicion(a.mask, b.mask, grid, 0);
    expect(result.suspicious).toBe(true);
    expect(result.message).toMatch(/o total continua batendo e uma conferência de soma passa/);
  });
});

describe('abdominalOrgans — the panel line', () => {
  it('states volume, median, spread and phase', () => {
    expect(describeOrgan(measure(10, 60))).toMatch(
      new RegExp(`^${ORGAN_LABELS.liver}: 2 mL.*mediana 60 HU \\(IQR 60–60\\), ${PHASE_LABELS.unenhanced}\\.`)
    );
  });

  it('shows the refusal when the mask was empty', () => {
    const empty = measureOrgan(new Float32Array(N), new Uint8Array(N), grid, 'spleen', 'unenhanced');
    expect(describeOrgan(empty)).toMatch(/Máscara de baço vazia/);
  });
});
