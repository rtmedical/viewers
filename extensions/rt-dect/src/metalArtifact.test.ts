import { vmiNoiseAmplification } from './dectDecomposition';
import {
  ARTEFACT_SD_RATIO,
  classifyArtefact,
  describeMar,
  expectedImprovement,
  iodineContrastAt,
  MAR_KEV_MAX,
  MAR_KEV_MIN,
  needsProjectionMar,
  recommendMarKev,
} from './metalArtifact';

/** Beam hardening: much worse at low kVp. */
const BEAM_HARDENING = { sdLow: 120, sdHigh: 35, sdReference: 20 };
/** Photon starvation: about the same at both energies. */
const PHOTON_STARVATION = { sdLow: 120, sdHigh: 115, sdReference: 20 };
/** Half and half. */
const MIXED = { sdLow: 120, sdHigh: 70, sdReference: 20 };
const CLEAN = { sdLow: 22, sdHigh: 21, sdReference: 20 };

describe('metalArtifact — telling the two artefacts apart', () => {
  // Both produce dark streaks and both are called "metal artefact", but they have nothing
  // in common underneath.
  it('calls an energy-dependent artefact beam hardening', () => {
    const result = classifyArtefact(BEAM_HARDENING);
    expect(result.kind).toBe('beamHardening');
    expect(result.spectralFraction).toBeGreaterThan(0.6);
    expect(result.message).toMatch(/VMI de alta energia deve reduzir/);
  });

  // No spectral trick recovers information that was never measured.
  it('calls an energy-independent artefact photon starvation, and says VMI will not help', () => {
    const result = classifyArtefact(PHOTON_STARVATION);
    expect(result.kind).toBe('photonStarvation');
    expect(result.spectralFraction).toBeLessThan(0.25);
    expect(result.message).toMatch(/VMI NÃO recupera/);
    expect(result.message).toMatch(/iMAR\/O-MAR/);
  });

  it('calls the in-between case mixed', () => {
    expect(classifyArtefact(MIXED).kind).toBe('mixed');
  });

  it('reports the severity relative to the reference ROI', () => {
    expect(classifyArtefact(BEAM_HARDENING).severity).toBeCloseTo(6, 6);
  });

  it('finds no artefact when the region matches the reference', () => {
    const result = classifyArtefact(CLEAN);
    expect(result.kind).toBe('none');
    expect(result.severity).toBeLessThan(ARTEFACT_SD_RATIO);
  });

  it('refuses to classify from unusable samples', () => {
    expect(classifyArtefact({ sdLow: 100, sdHigh: 50, sdReference: 0 }).kind).toBe('none');
    expect(classifyArtefact({ sdLow: NaN, sdHigh: 50, sdReference: 20 }).message).toMatch(
      /insuficientes/
    );
  });
});

describe('metalArtifact — what a VMI can actually deliver', () => {
  // Promising more is how a reader concludes the prosthesis is fine.
  it('is bounded by the spectral fraction, however high the energy goes', () => {
    const starvation = classifyArtefact(PHOTON_STARVATION);
    expect(expectedImprovement(starvation, MAR_KEV_MAX)).toBeLessThanOrEqual(
      starvation.spectralFraction
    );
    expect(expectedImprovement(starvation, MAR_KEV_MAX)).toBeLessThan(0.25);
  });

  it('delivers most of a beam-hardening artefact at the top of the range', () => {
    expect(expectedImprovement(classifyArtefact(BEAM_HARDENING), MAR_KEV_MAX)).toBeGreaterThan(
      0.6
    );
  });

  it('rises with energy and saturates', () => {
    const bh = classifyArtefact(BEAM_HARDENING);
    expect(expectedImprovement(bh, 100)).toBeGreaterThan(expectedImprovement(bh, 80));
    expect(expectedImprovement(bh, MAR_KEV_MAX)).toBeGreaterThan(expectedImprovement(bh, 100));
  });

  it('is zero at or below the reference energy', () => {
    expect(expectedImprovement(classifyArtefact(BEAM_HARDENING), 70)).toBe(0);
    expect(expectedImprovement(classifyArtefact(BEAM_HARDENING), 40)).toBe(0);
  });

  it('is zero when there is no artefact', () => {
    expect(expectedImprovement(classifyArtefact(CLEAN), MAR_KEV_MAX)).toBe(0);
  });
});

describe('metalArtifact — the MAR keV is not the diagnostic keV', () => {
  it('recommends the top of the range for beam hardening', () => {
    expect(recommendMarKev(classifyArtefact(BEAM_HARDENING)).kev).toBe(MAR_KEV_MAX);
  });

  it('does not push the energy as far when the artefact is not spectral', () => {
    expect(recommendMarKev(classifyArtefact(PHOTON_STARVATION)).kev).toBe(MAR_KEV_MIN);
  });

  it('recommends nothing when there is no artefact', () => {
    const result = recommendMarKev(classifyArtefact(CLEAN));
    expect(result.kev).toBe(70);
    expect(result.message).toMatch(/não há motivo para reconstruir em alta energia/);
  });

  it('iodine contrast falls steeply with energy', () => {
    expect(iodineContrastAt(70)).toBeCloseTo(1, 9);
    expect(iodineContrastAt(140)).toBeCloseTo(0.125, 6);
    expect(iodineContrastAt(MAR_KEV_MIN)).toBeLessThan(0.5);
  });

  // So nobody quietly reads a post-contrast study at 140 keV.
  it('ALWAYS reports the contrast cost alongside the energy', () => {
    const result = recommendMarKev(classifyArtefact(BEAM_HARDENING));
    expect(result.iodineContrastRetained).toBeLessThan(0.2);
    expect(result.message).toMatch(/Contraste de iodo remanescente \d+%/);
  });

  it('demands a separate diagnostic series on a contrast-enhanced study', () => {
    const result = recommendMarKev(classifyArtefact(BEAM_HARDENING), true);
    expect(result.needsSeparateDiagnosticSeries).toBe(true);
    expect(result.message).toMatch(/não serve para avaliar realce/);
  });

  it('does not demand one on a non-contrast study', () => {
    expect(recommendMarKev(classifyArtefact(BEAM_HARDENING), false).needsSeparateDiagnosticSeries).toBe(
      false
    );
  });

  // The cost of a MAR series is contrast, not noise: high-keV VMI is quieter than low-keV
  // and no worse than 70 keV. Worth pinning, because it is the opposite of the 40 keV case
  // and someone will assume the trade-off runs the same way at both ends.
  it('the cost is contrast, not noise', () => {
    const result = recommendMarKev(classifyArtefact(BEAM_HARDENING));
    expect(result.noiseFactor).toBeLessThanOrEqual(vmiNoiseAmplification(40));
    expect(result.noiseFactor).toBeLessThanOrEqual(1.2);
    expect(result.iodineContrastRetained).toBeLessThan(0.2);
  });
});

describe('metalArtifact — dual-energy is not a substitute for projection MAR', () => {
  // iMAR/O-MAR operate on the sinogram and address exactly the part a VMI cannot.
  it('says projection MAR is needed when much of the artefact is not spectral', () => {
    const result = needsProjectionMar(classifyArtefact(PHOTON_STARVATION));
    expect(result.needed).toBe(true);
    expect(result.reason).toMatch(/complementar, não alternativa/);
    expect(result.reason).toMatch(/9\d% do artefato não é espectral/);
  });

  it('says it is needed for a mixed artefact too', () => {
    expect(needsProjectionMar(classifyArtefact(MIXED)).needed).toBe(true);
  });

  it('does not demand it for a purely spectral artefact', () => {
    expect(needsProjectionMar(classifyArtefact(BEAM_HARDENING)).needed).toBe(false);
  });

  it('says nothing when there is no artefact', () => {
    expect(needsProjectionMar(classifyArtefact(CLEAN))).toEqual({ needed: false, reason: '' });
  });
});

describe('metalArtifact — the readout', () => {
  it('carries severity, the recommendation and the projection-MAR caveat', () => {
    const classification = classifyArtefact(PHOTON_STARVATION);
    const text = describeMar(classification, recommendMarKev(classification));
    expect(text).toMatch(/^Artefato 6\.0× a referência/);
    expect(text).toMatch(new RegExp(`${MAR_KEV_MIN} keV`));
    expect(text).toMatch(/iMAR\/O-MAR/);
  });

  it('says only the obvious thing when there is no artefact', () => {
    const classification = classifyArtefact(CLEAN);
    expect(describeMar(classification, recommendMarKev(classification))).toMatch(
      /Sem artefato significativo/
    );
  });

  it('survives nullish input', () => {
    expect(describeMar(undefined as never, undefined as never)).toBe('');
  });
});
