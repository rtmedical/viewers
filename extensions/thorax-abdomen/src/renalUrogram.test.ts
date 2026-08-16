import {
  CALCIFIED_HU_MIN,
  COMPOSITION_LABELS,
  describeStone,
  EXCRETORY_DELAY_SEC,
  GRADE_LABELS,
  hydronephrosisGrade,
  HydronephrosisInput,
  MIN_SLICES_ACROSS_STONE,
  stoneComposition,
  stoneSize,
  THIN_PARENCHYMA_MM,
  URIC_ACID_HU_MAX,
  urogramCoverage,
  WIDE_PELVIS_MM,
} from './renalUrogram';

const hydro = (over: Partial<HydronephrosisInput> = {}): HydronephrosisInput => ({
  pelvisApMm: 8,
  majorCalycesDilated: false,
  minorCalycesDilated: false,
  ...over,
});

describe('renalUrogram — a stone attenuation is a property of the slice thickness', () => {
  it('classifies a stone that spans enough slices', () => {
    const result = stoneComposition({ peakHu: 1400, sliceThicknessMm: 1, maxDiameterMm: 6 });
    expect(result.reliable).toBe(true);
    expect(result.composition).toBe('non-uric-acid');
    expect(CALCIFIED_HU_MIN).toBe(1000);
  });

  it('calls a low-attenuation stone uric acid and points at the therapy it changes', () => {
    const result = stoneComposition({ peakHu: 380, sliceThicknessMm: 1, maxDiameterMm: 6 });
    expect(result.composition).toBe('uric-acid');
    expect(result.message).toMatch(/dissolução por alcalinização/);
    expect(URIC_ACID_HU_MAX).toBe(500);
  });

  // Partial volume pulls the peak DOWN, which moves calcium into the uric-acid range.
  it('refuses on thick slices and names the direction of the error', () => {
    const result = stoneComposition({ peakHu: 380, sliceThicknessMm: 5, maxDiameterMm: 4 });
    expect(result.reliable).toBe(false);
    expect(result.composition).toBe('indeterminate');
    expect(result.message).toMatch(/empurra um cálculo de cálcio para a faixa do ácido úrico — e não o contrário/);
  });

  // The decision is live precisely for the stones the artefact hits hardest.
  it('says why small stones are the ones that matter', () => {
    expect(stoneComposition({ peakHu: 380, sliceThicknessMm: 5, maxDiameterMm: 4 }).message).toMatch(
      /nos cálculos pequenos que a decisão clínica ou cirúrgica está em aberto/
    );
  });

  it('defers to dual energy rather than guessing', () => {
    expect(stoneComposition({ peakHu: 380, sliceThicknessMm: 5, maxDiameterMm: 4 }).message).toMatch(
      /dupla energia \(RTV-89\), que separa por material e não por atenuação/
    );
    expect(stoneComposition({ peakHu: 700, sliceThicknessMm: 1, maxDiameterMm: 6 }).message).toMatch(
      /Dupla energia resolve/
    );
  });

  it('needs the thickness and the size to judge reliability at all', () => {
    expect(stoneComposition({ peakHu: 380, sliceThicknessMm: 0, maxDiameterMm: 4 }).reliable).toBe(false);
    expect(MIN_SLICES_ACROSS_STONE).toBe(2);
  });
});

describe('renalUrogram — maximum diameter depends on the plane', () => {
  it('takes the largest across the planes measured', () => {
    const result = stoneSize({ axialMaxMm: 4, coronalMaxMm: 9 });
    expect(result.maxDiameterMm).toBeCloseTo(9, 6);
    expect(result.plane).toBe('coronal');
    expect(result.planesMeasured).toBe(2);
  });

  // Biased towards smaller, and smaller predicts spontaneous passage.
  it('warns when only the axial plane was measured', () => {
    const result = stoneSize({ axialMaxMm: 4 });
    expect(result.warnings.join(' ')).toMatch(/ENVIESADA PARA MENOR/);
    expect(result.warnings.join(' ')).toMatch(/prevê eliminação espontânea/);
  });

  it('is quiet once a reformat was measured too', () => {
    expect(stoneSize({ axialMaxMm: 4, coronalMaxMm: 4 }).warnings).toEqual([]);
  });

  it('handles no measurement at all', () => {
    expect(stoneSize({ axialMaxMm: NaN }).planesMeasured).toBe(0);
  });
});

describe('renalUrogram — dilation is not obstruction', () => {
  it('grades on the calyces, not on the pelvis', () => {
    expect(hydronephrosisGrade(hydro({ pelvisApMm: 20 })).grade).toBe(1);
    expect(hydronephrosisGrade(hydro({ majorCalycesDilated: true })).grade).toBe(2);
    expect(hydronephrosisGrade(hydro({ majorCalycesDilated: true, minorCalycesDilated: true })).grade).toBe(3);
  });

  it('adds parenchymal thinning as the fourth grade', () => {
    const result = hydronephrosisGrade(
      hydro({ majorCalycesDilated: true, minorCalycesDilated: true, parenchymalThicknessMm: 4 })
    );
    expect(result.grade).toBe(4);
    expect(GRADE_LABELS[4]).toMatch(/afilamento parenquimatoso/);
  });

  // Wide in a normal kidney.
  it('flags an extrarenal pelvis instead of calling it hydronephrosis', () => {
    const result = hydronephrosisGrade(hydro({ pelvisApMm: 20, extrarenalPelvis: true }));
    expect(result.obstructionLikely).toBe(false);
    expect(result.warnings.join(' ')).toMatch(/ela é larga num rim normal/);
    expect(WIDE_PELVIS_MM).toBe(15);
  });

  // Early or decompressed obstruction barely dilates.
  it('says a quiet system does not exclude obstruction', () => {
    expect(hydronephrosisGrade(hydro({ pelvisApMm: 12 })).warnings.join(' ')).toMatch(
      /obstrução precoce, ou já descomprimida, dilata pouco ou nada/
    );
  });

  it('links thin parenchyma to what relative function cannot answer', () => {
    const result = hydronephrosisGrade(hydro({ parenchymalThicknessMm: 5 }));
    expect(result.warnings.join(' ')).toMatch(/A medida absoluta de função \(RTV-209\) responde isso; a função relativa não/);
    expect(THIN_PARENCHYMA_MM).toBe(7);
  });
});

describe('renalUrogram — a ureter never opacified is not a normal ureter', () => {
  it('reports a fully opacified ureter as complete', () => {
    const result = urogramCoverage({ side: 'left', opacified: ['proximal', 'mid', 'distal'] });
    expect(result.complete).toBe(true);
    expect(result.notAssessed).toEqual([]);
  });

  // A statement about contrast timing that reads as a statement about the ureter.
  it('lists what could not be assessed and says what the phrase would really mean', () => {
    const result = urogramCoverage({ side: 'right', opacified: ['proximal'] });
    expect(result.notAssessed).toEqual(['mid', 'distal']);
    expect(result.message).toMatch(/afirmação sobre o tempo do contraste que se lê como afirmação sobre o ureter/);
  });

  it('offers the timing explanation when the delay was short', () => {
    const result = urogramCoverage({ side: 'left', opacified: ['proximal'], excretoryDelaySec: 180 });
    expect(result.message).toMatch(/a falta de opacificação pode ser só tempo/);
    expect(EXCRETORY_DELAY_SEC).toBe(480);
  });

  it('does not blame the timing when the delay was adequate', () => {
    const result = urogramCoverage({ side: 'left', opacified: ['proximal'], excretoryDelaySec: 900 });
    expect(result.message).not.toMatch(/pode ser só tempo/);
  });
});

describe('renalUrogram — the panel line', () => {
  it('states size, plane and composition', () => {
    const line = describeStone(
      stoneComposition({ peakHu: 1400, sliceThicknessMm: 1, maxDiameterMm: 9 }),
      stoneSize({ axialMaxMm: 4, coronalMaxMm: 9 })
    );
    expect(line).toMatch(/^Cálculo de 9\.0 mm \(maior no plano coronal\), 1400 HU — calcificado/);
  });

  it('carries the axial-only warning through', () => {
    const line = describeStone(
      stoneComposition({ peakHu: 1400, sliceThicknessMm: 1, maxDiameterMm: 4 }),
      stoneSize({ axialMaxMm: 4 })
    );
    expect(line).toMatch(/ENVIESADA PARA MENOR/);
    expect(COMPOSITION_LABELS['non-uric-acid']).toMatch(/não úrico/);
  });
});
