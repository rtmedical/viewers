import {
  AIR_TRAPPING_HU,
  AirwayInput,
  BreathState,
  compareAirways,
  computePi10,
  describeAirway,
  EMPHYSEMA_HU,
  Kernel,
  KERNEL_LABELS,
  lungDensitometry,
  measureAirway,
  MIN_AIRWAYS_FOR_PI10,
  RESOLUTION_FLOOR_MM,
} from './airwayMetrics';

const airway = (over: Partial<AirwayInput> = {}): AirwayInput => ({
  label: 'RB1',
  lumenAreaMm2: Math.PI * 2 * 2, // 4 mm internal diameter
  totalAreaMm2: Math.PI * 3 * 3, // 6 mm outer diameter
  kernel: 'standard',
  breath: 'inspiration',
  ...over,
});

/** A set of airways of decreasing size, walls scaling with the perimeter. */
const airwaySet = (count: number, kernel: Kernel = 'standard', wallFactor = 1) =>
  Array.from({ length: count }, (_, i) => {
    const innerR = 3 - i * 0.25;
    const wall = 0.5 * wallFactor;
    return measureAirway(
      airway({
        label: `RB${i + 1}`,
        lumenAreaMm2: Math.PI * innerR * innerR,
        totalAreaMm2: Math.PI * (innerR + wall) * (innerR + wall),
        kernel,
      })
    );
  });

describe('airwayMetrics — one airway', () => {
  it('derives wall area, wall percent and internal perimeter', () => {
    const result = measureAirway(airway());
    expect(result.ok).toBe(true);
    expect(result.internalDiameterMm).toBeCloseTo(4, 6);
    expect(result.internalPerimeterMm).toBeCloseTo(Math.PI * 4, 6);
    expect(result.wallAreaMm2).toBeCloseTo(Math.PI * (9 - 4), 6);
    expect(result.wallAreaPercent).toBeCloseTo((5 / 9) * 100, 6);
  });

  // The measurement still returns a number, and the number still varies between patients.
  it('refuses below the resolution floor and says what the number would be', () => {
    const result = measureAirway(
      airway({ lumenAreaMm2: Math.PI * 0.5 * 0.5, totalAreaMm2: Math.PI * 1 * 1 })
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/só varia com como o borrão caiu/);
    expect(RESOLUTION_FLOOR_MM).toBe(2);
  });

  it('refuses an outer area smaller than the lumen', () => {
    expect(measureAirway(airway({ totalAreaMm2: 1 })).ok).toBe(false);
  });

  // Nothing in the image says which kernel produced it.
  it('warns when the kernel is unknown', () => {
    expect(measureAirway(airway({ kernel: 'unknown' })).warnings.join(' ')).toMatch(
      /nada na imagem diz qual foi usado/
    );
  });

  it('warns when the breath state is unknown', () => {
    expect(measureAirway(airway({ breath: 'unknown' })).warnings.join(' ')).toMatch(
      /calibre de via aérea muda com o volume pulmonar/
    );
  });
});

describe('airwayMetrics — Pi10 removes the size dependence, not the kernel dependence', () => {
  it('fits the regression across a set of airways', () => {
    const result = computePi10(airwaySet(8));
    expect(result.ok).toBe(true);
    expect(result.pi10Mm).toBeGreaterThan(0);
    expect(result.r2).toBeGreaterThan(0.9);
  });

  // Thicker walls throughout must raise Pi10; that is the whole point of the metric.
  it('rises when the walls are thicker at every size', () => {
    const thin = computePi10(airwaySet(8, 'standard', 1));
    const thick = computePi10(airwaySet(8, 'standard', 1.6));
    expect(thick.pi10Mm!).toBeGreaterThan(thin.pi10Mm!);
  });

  it('refuses too few airways rather than fitting noise', () => {
    const result = computePi10(airwaySet(3));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/estaria ajustando ruído/);
    expect(MIN_AIRWAYS_FOR_PI10).toBe(6);
  });

  // Routinely treated as though Pi10 standardised the reconstruction too.
  it('refuses a mixed-kernel set', () => {
    const mixed = [...airwaySet(4, 'sharp'), ...airwaySet(4, 'smooth')];
    const result = computePi10(mixed);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/descreve a mistura de reconstruções/);
  });

  it('warns when the kernel is unknown', () => {
    expect(computePi10(airwaySet(8, 'unknown')).warnings.join(' ')).toMatch(
      /não a da reconstrução — e é rotineiramente tratado como se removesse/
    );
  });

  it('skips airways that failed to measure', () => {
    const withBad = [...airwaySet(8), measureAirway(airway({ totalAreaMm2: 0 }))];
    expect(computePi10(withBad).airways).toBe(8);
  });
});

describe('airwayMetrics — comparing two studies', () => {
  it('reports the change when kernel and breath match', () => {
    const current = measureAirway(airway({ totalAreaMm2: Math.PI * 3.2 * 3.2 }));
    const result = compareAirways(current, measureAirway(airway()));
    expect(result.comparable).toBe(true);
    expect(result.deltaPercent!).toBeGreaterThan(0);
  });

  // It moves the measurement more than most diseases do.
  it('refuses across kernels and says which way each one biases', () => {
    const result = compareAirways(
      measureAirway(airway({ kernel: 'sharp' })),
      measureAirway(airway({ kernel: 'smooth' }))
    );
    expect(result.comparable).toBe(false);
    expect(result.message).toMatch(/Kernel duro realça a borda e a parede parece mais fina/);
    expect(result.message).toMatch(/move a medida mais do que a maioria das doenças/);
  });

  it('refuses across breath states', () => {
    const result = compareAirways(
      measureAirway(airway({ breath: 'inspiration' })),
      measureAirway(airway({ breath: 'expiration' }))
    );
    expect(result.message).toMatch(/a diferença seria a apneia/);
  });

  it('refuses when one measurement failed', () => {
    expect(compareAirways(measureAirway(airway()), measureAirway(airway({ totalAreaMm2: 0 }))).comparable).toBe(
      false
    );
  });
});

describe('airwayMetrics — lung densitometry', () => {
  const lung = (values: number[]) => ({
    hu: Float32Array.from(values),
    mask: Uint8Array.from(values.map(() => 1)),
  });

  it('counts the fraction below the threshold', () => {
    const built = lung([-900, -900, -800, -700]);
    const result = lungDensitometry(built.hu, built.mask, 'expiration');
    expect(result.percentBelow).toBeCloseTo(50, 6);
  });

  // The same computation on a different acquisition describes something else.
  it('warns when the trapping threshold is applied to an inspiratory scan', () => {
    const built = lung([-900, -800]);
    expect(lungDensitometry(built.hu, built.mask, 'inspiration').warnings.join(' ')).toMatch(
      /o número sai plausível e descreve outra coisa/
    );
    expect(AIR_TRAPPING_HU).toBe(-856);
  });

  it('warns when the emphysema threshold is applied to an expiratory scan', () => {
    const built = lung([-960, -800]);
    expect(
      lungDensitometry(built.hu, built.mask, 'expiration', EMPHYSEMA_HU).warnings.join(' ')
    ).toMatch(/Limiar de enfisema/);
  });

  // The confound points at reassurance.
  it('spots an expiratory scan that never emptied', () => {
    const built = lung([-870, -880, -890, -900]);
    const result = lungDensitometry(built.hu, built.mask, 'expiration');
    expect(result.warnings.join(' ')).toMatch(/o viés aponta para o resultado tranquilizador/);
  });

  it('is quiet on a proper expiratory scan', () => {
    const built = lung([-700, -650, -900, -600]);
    expect(lungDensitometry(built.hu, built.mask, 'expiration').warnings).toEqual([]);
  });

  it('refuses an empty mask', () => {
    expect(lungDensitometry(new Float32Array(4), new Uint8Array(4), 'expiration').ok).toBe(false);
  });
});

describe('airwayMetrics — the panel line', () => {
  it('states lumen, wall percent and kernel', () => {
    expect(describeAirway(measureAirway(airway()))).toBe(
      `RB1: luz 4.0 mm, parede 55.6% da área total (${KERNEL_LABELS.standard}).`
    );
  });

  it('shows the refusal below the floor', () => {
    const tiny = measureAirway(airway({ lumenAreaMm2: 0.5, totalAreaMm2: 2 }));
    expect(describeAirway(tiny)).toMatch(/abaixo do piso de 2 mm/);
  });
});
