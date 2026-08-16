import {
  areaToDiameterStenosis,
  assessStenosis,
  CATEGORY_LABELS,
  COLLAPSED_DISTAL_MM,
  convertBetweenMethods,
  crossCheckDoppler,
  describeStenosis,
  ecstToNascet,
  METHOD_LABELS,
  nascetToEcst,
  PSV_SEVERE_CM_S,
  StenosisInput,
  SURGICAL_THRESHOLD,
  surgicalThreshold,
} from './carotidStenosis';

const input = (over: Partial<StenosisInput> = {}): StenosisInput => ({
  minLumenMm: 1.5,
  referenceMm: 5,
  method: 'nascet',
  contralateralDistalMm: 5,
  ...over,
});

describe('carotidStenosis — the same lesion on two scales', () => {
  it('computes the percentage from the residual lumen and the reference', () => {
    const result = assessStenosis(input());
    expect(result.percent).toBeCloseTo(70, 6);
    expect(result.category).toBe('severe');
  });

  // Two different quantities, not two estimates of one.
  it('gives a much higher number for the same lesion by ECST', () => {
    expect(nascetToEcst(70)).toBeCloseTo(82, 6);
    expect(nascetToEcst(50)).toBeCloseTo(70, 6);
    expect(ecstToNascet(70)).toBeCloseTo(50, 6);
  });

  // One set of clinical boundaries drives both scales, so the bands cannot drift apart.
  // This is the trap in one test: the SAME 70% is severe on one scale and moderate on the
  // other, because they are not the same quantity.
  it('bands both scales off one set of clinical boundaries', () => {
    expect(assessStenosis(input({ method: 'nascet', minLumenMm: 1.5, referenceMm: 5 })).category).toBe('severe');
    expect(assessStenosis(input({ method: 'ecst', minLumenMm: 1.5, referenceMm: 5 })).category).toBe('moderate');
    // 82% ECST is the ECST equivalent of 70% NASCET, and it does band as severe.
    expect(assessStenosis(input({ method: 'ecst', minLumenMm: 0.9, referenceMm: 5 })).category).toBe('severe');
  });

  it('makes the gap visible without making the two interchangeable', () => {
    const comparison = convertBetweenMethods(70, 'nascet');
    expect(comparison.ecstPercent).toBeCloseTo(82, 6);
    expect(comparison.message).toMatch(/não para relatar um número que o exame não mediu/);
  });

  it('refuses without a method', () => {
    const result = assessStenosis(input({ method: 'xx' as never }));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/70% por um método é 50% pelo outro/);
  });

  it('names both references', () => {
    expect(METHOD_LABELS.nascet).toMatch(/carótida interna distal normal/);
    expect(METHOD_LABELS.ecst).toMatch(/diâmetro original estimado do bulbo/);
  });
});

describe('carotidStenosis — near-occlusion is a category, not a large percentage', () => {
  // The denominator shrinks with the numerator and the percentage FALLS.
  it('would compute a moderate percentage for a nearly closed vessel', () => {
    // Residual 1.0 mm against a collapsed 2.0 mm distal ICA is 50% by arithmetic.
    expect((1 - 1.0 / 2.0) * 100).toBeCloseTo(50, 6);
  });

  it('refuses that arithmetic and says why', () => {
    const result = assessStenosis(input({ minLumenMm: 1.0, referenceMm: 2.0, contralateralDistalMm: 5 }));
    expect(result.ok).toBe(false);
    expect(result.percent).toBeNull();
    expect(result.category).toBe('near-occlusion');
    expect(result.message).toMatch(/o denominador encolhe junto com o numerador e a porcentagem CAI/);
    expect(result.message).toMatch(/Quase-oclusão é uma categoria, não uma porcentagem alta/);
  });

  it('catches distal collapse from the side-to-side difference alone', () => {
    const result = assessStenosis(input({ minLumenMm: 1.0, referenceMm: 3.0, contralateralDistalMm: 5 }));
    expect(result.category).toBe('near-occlusion');
    expect(result.message).toMatch(/contra 5\.0 mm do lado oposto/);
  });

  it('accepts a normal distal reference', () => {
    expect(assessStenosis(input({ referenceMm: 5, contralateralDistalMm: 5.2 })).ok).toBe(true);
    expect(COLLAPSED_DISTAL_MM).toBe(2.5);
  });

  // ECST measures at the bulb, so the distal-collapse check does not apply by default.
  it('does not apply the distal check to ECST unless told to', () => {
    expect(assessStenosis(input({ method: 'ecst', referenceMm: 2.0 })).ok).toBe(true);
    expect(assessStenosis(input({ method: 'ecst', referenceMm: 2.0, referenceIsDistalIca: true })).ok).toBe(false);
  });

  it('reports an occluded vessel as occluded rather than as 100% stenosis of something', () => {
    const result = assessStenosis(input({ minLumenMm: 0 }));
    expect(result.category).toBe('occluded');
    expect(CATEGORY_LABELS.occluded).toBe('ocluída');
  });

  it('warns when the residual lumen exceeds the reference', () => {
    expect(assessStenosis(input({ minLumenMm: 6, referenceMm: 5 })).warnings.join(' ')).toMatch(
      /não está num segmento normal/
    );
  });
});

describe('carotidStenosis — the threshold belongs to the method', () => {
  it('grades a NASCET percentage against the NASCET cut-off', () => {
    const result = surgicalThreshold(assessStenosis(input()), true);
    expect(result.thresholdPercent).toBe(70);
    expect(result.meets).toBe(true);
  });

  // Grading an ECST figure against the NASCET cut-off refers a ~50% NASCET patient.
  it('uses the higher cut-off for an ECST percentage', () => {
    const ecst = assessStenosis(input({ method: 'ecst', minLumenMm: 3, referenceMm: 10 }));
    expect(ecst.percent).toBeCloseTo(70, 6);
    const threshold = surgicalThreshold(ecst, true);
    expect(threshold.thresholdPercent).toBe(SURGICAL_THRESHOLD.ecst.symptomatic);
    expect(threshold.meets).toBe(false);
  });

  it('uses the lower cut-off for an asymptomatic patient', () => {
    expect(surgicalThreshold(assessStenosis(input()), false).thresholdPercent).toBe(60);
  });

  it('refuses to apply a percentage threshold to a near-occlusion', () => {
    const result = surgicalThreshold(
      assessStenosis(input({ minLumenMm: 1, referenceMm: 2, contralateralDistalMm: 5 })),
      true
    );
    expect(result.applicable).toBe(false);
    expect(result.message).toMatch(/Decisão clínica, não aritmética/);
  });

  it('has nothing to operate on an occluded vessel', () => {
    expect(surgicalThreshold(assessStenosis(input({ minLumenMm: 0 })), true).applicable).toBe(false);
  });
});

describe('carotidStenosis — area is not diameter', () => {
  // The larger number is the one that reads as alarming.
  it('converts a 75% area reduction to a 50% diameter reduction', () => {
    const result = areaToDiameterStenosis(75);
    expect(result.diameterPercent).toBeCloseTo(50, 6);
    expect(result.message).toMatch(/citar a área ao lado de um limiar de diâmetro exagera a lesão/);
  });

  it('names the assumption it depends on', () => {
    expect(areaToDiameterStenosis(50).message).toMatch(/Placa excêntrica quebra a suposição de circularidade/);
  });

  it('clamps out-of-range input', () => {
    expect(areaToDiameterStenosis(150).diameterPercent).toBeCloseTo(100, 6);
    expect(areaToDiameterStenosis(-10).diameterPercent).toBeCloseTo(0, 6);
  });
});

describe('carotidStenosis — the Doppler cross-check', () => {
  it('is quiet when the two agree', () => {
    expect(crossCheckDoppler(assessStenosis(input()), 300).agrees).toBe(true);
    expect(crossCheckDoppler(assessStenosis(input({ minLumenMm: 4 })), 120).agrees).toBe(true);
  });

  // The calcium blooms and closes the lumen in the image.
  it('blames calcium when the anatomy looks worse than the velocity', () => {
    const result = crossCheckDoppler(assessStenosis(input()), 150);
    expect(result.agrees).toBe(false);
    expect(result.message).toMatch(/o cálcio florescente fecha a luz na imagem/);
  });

  // Contralateral occlusion raises velocities on the patent side.
  it('offers contralateral occlusion when the velocity looks worse than the anatomy', () => {
    const mild = assessStenosis(input({ minLumenMm: 4 }));
    expect(crossCheckDoppler(mild, 300, { contralateralOccluded: true }).message).toMatch(
      /eleva as velocidades do lado pérvio sem estreitamento adicional/
    );
    expect(crossCheckDoppler(mild, 300).message).toMatch(/tortuosidade ou erro de ângulo insonante/);
  });

  it('needs both measurements', () => {
    expect(crossCheckDoppler(assessStenosis(input()), NaN).agrees).toBe(false);
    expect(PSV_SEVERE_CM_S).toBe(230);
  });
});

describe('carotidStenosis — the panel line', () => {
  it('states the percentage, the method and the threshold', () => {
    const result = assessStenosis(input());
    const line = describeStenosis(result, surgicalThreshold(result, true));
    expect(line).toMatch(/^70% por NASCET/);
    expect(line).toMatch(/contra o limiar de 70% para sintomático/);
  });

  it('shows the refusal for a near-occlusion', () => {
    expect(describeStenosis(assessStenosis(input({ minLumenMm: 1, referenceMm: 2 })))).toMatch(
      /segmento de referência está colabado/
    );
  });
});
