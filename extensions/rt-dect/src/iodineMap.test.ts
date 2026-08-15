import { BASIS_80_140, decompose, muToHu } from './dectDecomposition';
import {
  assessEnhancement,
  CALCIUM_SUSPICION_HU,
  DEFAULT_IODINE_CALIBRATION_MG_ML,
  describeRoi,
  IODINE_ENHANCEMENT_MG_ML,
  iodineConcentration,
  IodineResult,
  roiStatistics,
} from './iodineMap';

const WATER = BASIS_80_140.water;
const IODINE = BASIS_80_140.iodine;

/** HU pair for a mixture of water and iodine basis densities. */
const mix = (water: number, iodine: number) => ({
  huLow: muToHu(water * WATER.muLow + iodine * IODINE.muLow),
  huHigh: muToHu(water * WATER.muHigh + iodine * IODINE.muHigh),
});

/** Iodine basis density that corresponds to a given mg/mL. */
const densityFor = (mgPerMl: number) => mgPerMl / DEFAULT_IODINE_CALIBRATION_MG_ML;

const at = (mgPerMl: number, options = {}) =>
  iodineConcentration(
    decompose({ ...mix(1, densityFor(mgPerMl)), basisA: WATER, basisB: IODINE }),
    options
  );

describe('iodineMap — concentration', () => {
  it('recovers the concentration that went in', () => {
    const result = at(5);
    expect(result.ok).toBe(true);
    expect(result.concentrationMgMl).toBeCloseTo(5, 6);
  });

  it('is zero for pure water', () => {
    expect(at(0).concentrationMgMl).toBe(0);
    expect(at(0).level).toBe('none');
  });

  it('scales with the calibration factor', () => {
    const doubled = at(5, { calibrationMgPerMl: DEFAULT_IODINE_CALIBRATION_MG_ML * 2 });
    expect(doubled.concentrationMgMl).toBeCloseTo(10, 5);
  });

  it('reports the failure when the decomposition failed', () => {
    const result = iodineConcentration(
      decompose({ huLow: 50, huHigh: 45, basisA: WATER, basisB: { ...WATER } })
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
  });
});

describe('iodineMap — below the noise floor there is no iodine, there is noise', () => {
  // Rendering 0.3 mg/mL as a faint blush creates enhancement where there is none, in
  // exactly the low-contrast lesions people use iodine maps to settle.
  it('reports zero, not a small number, below the floor', () => {
    const noisy = at(0.4, { inputNoiseHu: 3 });
    expect(noisy.noiseFloorMgMl).toBeGreaterThan(0.4);
    expect(noisy.concentrationMgMl).toBe(0);
    expect(noisy.level).toBe('none');
  });

  it('keeps a value comfortably above the floor', () => {
    // 3 HU is what an ROI-averaged or filtered measurement looks like; 10 HU per voxel
    // gives a floor around 10 mg/mL, which is the honest cost of single-voxel iodine
    // quantification and the reason ROIs exist.
    const clean = at(8, { inputNoiseHu: 3 });
    expect(clean.noiseFloorMgMl).toBeLessThan(8);
    expect(clean.concentrationMgMl).toBeCloseTo(8, 5);
    expect(clean.level).toBe('enhancing');
  });

  it('the honest single-voxel floor at 10 HU noise is around 10 mg/mL', () => {
    const floor = at(5, { inputNoiseHu: 10 }).noiseFloorMgMl;
    expect(floor).toBeGreaterThan(7);
    expect(floor).toBeLessThan(14);
  });

  // A noisy acquisition gets a higher floor instead of a more confident-looking map.
  it('raises the floor with the input noise', () => {
    expect(at(5, { inputNoiseHu: 20 }).noiseFloorMgMl).toBeGreaterThan(
      at(5, { inputNoiseHu: 5 }).noiseFloorMgMl
    );
  });

  it('reports the floor so the reader sees what the study could resolve', () => {
    expect(at(5, { inputNoiseHu: 10 }).noiseFloorMgMl).toBeGreaterThan(0);
    expect(at(5).noiseFloorMgMl).toBe(0);
  });

  it('distinguishes trace from enhancing', () => {
    expect(at(1).level).toBe('trace');
    expect(at(IODINE_ENHANCEMENT_MG_ML).level).toBe('enhancing');
  });

  it('honours a custom enhancement threshold', () => {
    expect(at(3, { enhancementThresholdMgMl: 5 }).level).toBe('trace');
  });
});

describe('iodineMap — calcium is projected onto the iodine basis', () => {
  // The basis is water and iodine. Calcium is neither, and the solve has only two
  // directions to express it in.
  it('flags a voxel in the calcium attenuation range', () => {
    expect(at(5, { meanHu: CALCIUM_SUSPICION_HU + 50 }).calciumSuspected).toBe(true);
    expect(at(5, { meanHu: 40 }).calciumSuspected).toBe(false);
  });

  // A calcified renal cyst reads as enhancing, and enhancement is "follow up" vs "resect".
  it('REFUSES to call a calcium-suspect voxel enhancing', () => {
    const assessment = assessEnhancement(at(9, { meanHu: 300 }));
    expect(assessment.verdict).toBe('calciumConfound');
    expect(assessment.message).toMatch(/cálcio é projetado sobre a base de iodo/);
    expect(assessment.needsTrueNonContrast).toBe(true);
  });

  it('does call the same concentration enhancing at soft-tissue attenuation', () => {
    expect(assessEnhancement(at(9, { meanHu: 40 })).verdict).toBe('enhancing');
  });

  it('demonstrates the projection: pure calcium reports iodine that is not there', () => {
    const calcium = BASIS_80_140.calcium;
    const density = 0.06;
    const result = iodineConcentration(
      decompose({
        huLow: muToHu(1 + density * (calcium.muLow - 1)),
        huHigh: muToHu(1 + density * (calcium.muHigh - 1)),
        basisA: WATER,
        basisB: IODINE,
      })
    );
    // No iodine was in the mixture at all.
    expect(result.concentrationMgMl).toBeGreaterThan(1);
  });
});

describe('iodineMap — the clinical read', () => {
  it('calls a clearly enhancing lesion enhancing, with the number', () => {
    const assessment = assessEnhancement(at(6, { meanHu: 60 }));
    expect(assessment.verdict).toBe('enhancing');
    expect(assessment.message).toMatch(/6\.0 mg\/mL/);
    expect(assessment.needsTrueNonContrast).toBe(false);
  });

  it('calls a simple cyst not enhancing, and quotes the floor', () => {
    const assessment = assessEnhancement(at(0.2, { inputNoiseHu: 10, meanHu: 10 }));
    expect(assessment.verdict).toBe('notEnhancing');
    expect(assessment.message).toMatch(/piso de ruído/);
  });

  // A real answer: saying so sends the patient to a true non-contrast, not to surgery.
  it('says indeterminate when the value sits between the floor and the threshold', () => {
    const assessment = assessEnhancement(at(1.2, { meanHu: 40 }));
    expect(assessment.verdict).toBe('indeterminate');
    expect(assessment.message).toMatch(/este exame não decide/);
    expect(assessment.needsTrueNonContrast).toBe(true);
  });

  it('reports unavailable rather than guessing when the decomposition failed', () => {
    const assessment = assessEnhancement(
      iodineConcentration(decompose({ huLow: 1, huHigh: 1, basisA: WATER, basisB: { ...WATER } }))
    );
    expect(assessment.verdict).toBe('unavailable');
    expect(assessment.needsTrueNonContrast).toBe(true);
  });
});

describe('iodineMap — ROI statistics', () => {
  const voxels = (values: number[], options = {}): IodineResult[] =>
    values.map(v => at(v, options));

  it('averages the usable voxels', () => {
    const stats = roiStatistics(voxels([2, 4, 6]));
    expect(stats.meanMgMl).toBeCloseTo(4, 5);
    expect(stats.maxMgMl).toBeCloseTo(6, 5);
    expect(stats.voxels).toBe(3);
  });

  it('reports the fraction above the threshold', () => {
    expect(roiStatistics(voxels([0.5, 3, 9])).enhancingFraction).toBeCloseTo(2 / 3, 6);
  });

  // A rim of calcification dragging a non-enhancing cyst over the threshold is exactly the
  // failure — the mean is the number the radiologist quotes.
  it('EXCLUDES calcium-suspect voxels from the mean and counts them separately', () => {
    const clean = voxels([0.1, 0.1, 0.1], { meanHu: 20 });
    const calcified = voxels([40], { meanHu: 400 });
    const stats = roiStatistics([...clean, ...calcified]);
    expect(stats.voxels).toBe(3);
    expect(stats.excludedForCalcium).toBe(1);
    expect(stats.meanMgMl).toBeLessThan(1);
    expect(describeRoi(stats)).toMatch(/1 voxels excluídos por cálcio/);
  });

  it('says so when nothing is interpretable', () => {
    const stats = roiStatistics(voxels([5, 5], { meanHu: 400 }));
    expect(stats.voxels).toBe(0);
    expect(describeRoi(stats)).toMatch(/Nenhum voxel interpretável \(2 excluídos/);
  });

  it('handles an empty ROI', () => {
    expect(describeRoi(roiStatistics([]))).toBe('ROI vazia.');
    expect(describeRoi(undefined as never)).toBe('ROI vazia.');
  });

  it('renders the summary line', () => {
    expect(describeRoi(roiStatistics(voxels([0.5, 4, 6], { meanHu: 40 })))).toMatch(
      /^Iodo médio 3\.5 mg\/mL \(máx 6\.0\) · 67% dos voxels acima do limiar$/
    );
  });
});
