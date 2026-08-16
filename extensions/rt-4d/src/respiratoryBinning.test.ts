import {
  assessRegularity,
  bin,
  binByAmplitude,
  binByPhase,
  BINNING_LABELS,
  describeBinning,
  detectCycles,
  IRREGULARITY_THRESHOLD,
  itvReliability,
  SurrogateSample,
} from './respiratoryBinning';

/** A sinusoidal trace: `cycles` breaths of the given period and amplitude. */
const trace = (
  cycles: number,
  { periodSec = 4, amplitude = 10, rate = 20, jitter = 0 } = {}
): SurrogateSample[] => {
  // Starts just below the first peak so that peak is detectable: a peak at index 0 has no
  // preceding sample to compare against, and a detector cannot confirm it.
  const samples: SurrogateSample[] = [{ time: 0, amplitude: amplitude * 0.99 }];
  let t = 1 / rate;
  for (let c = 0; c < cycles; c++) {
    // Deterministic per-cycle variation, so the tests do not flake.
    const period = periodSec * (1 + jitter * (c % 2 === 0 ? 1 : -1));
    const amp = amplitude * (1 + jitter * (c % 3 === 0 ? 1 : -0.5));
    const steps = Math.round(period * rate);
    for (let i = 0; i < steps; i++) {
      samples.push({ time: t, amplitude: amp * Math.cos((2 * Math.PI * i) / steps) });
      t += 1 / rate;
    }
  }
  samples.push({ time: t, amplitude: amplitude });
  return samples;
};

describe('respiratoryBinning — cycles', () => {
  it('finds one cycle boundary per breath', () => {
    expect(detectCycles(trace(5))).toHaveLength(4);
  });

  // The diaphragm pauses longer at end-expiration, which makes the trough a broad plateau
  // and a poor landmark.
  it('splits at end-inspiration peaks', () => {
    const cycles = detectCycles(trace(3));
    const samples = trace(3);
    for (const cycle of cycles) {
      expect(samples[cycle.startIndex].amplitude).toBeGreaterThan(0);
    }
  });

  // Sensor noise at end-expiration is a local maximum, because the trace is nearly flat
  // there. Counting it as a breath halves an apparent period, inflates the period variation,
  // and reports a regular patient as irregular.
  it('does not count noise at end-expiration as a breath', () => {
    const noisy = trace(3).map((s, i) => ({ ...s, amplitude: s.amplitude + (i % 2 ? 0.05 : 0) }));
    expect(detectCycles(noisy)).toHaveLength(detectCycles(trace(3)).length);
    expect(assessRegularity(noisy).regular).toBe(true);
  });

  // Prominence is measured against the trough behind the candidate, not an absolute height,
  // so a patient whose baseline sinks over the acquisition keeps being detected.
  it('keeps detecting breaths through a drifting baseline', () => {
    const drifting = trace(6).map((s, i) => ({ ...s, amplitude: s.amplitude - i * 0.02 }));
    expect(detectCycles(drifting).length).toBe(detectCycles(trace(6)).length);
  });

  it('rejects a peak too close to the previous one', () => {
    const doubled = trace(3).flatMap(s => [s, { time: s.time + 0.001, amplitude: s.amplitude }]);
    expect(detectCycles(doubled).length).toBeLessThanOrEqual(3);
  });

  it('returns nothing for a trace too short to have a cycle', () => {
    expect(detectCycles([{ time: 0, amplitude: 1 }])).toEqual([]);
  });
});

describe('respiratoryBinning — irregularity is the finding', () => {
  it('calls a steady trace regular', () => {
    const result = assessRegularity(trace(6));
    expect(result.regular).toBe(true);
    expect(result.periodVariation).toBeLessThan(IRREGULARITY_THRESHOLD);
    expect(result.recommended).toBe('phase');
  });

  it('calls a varying trace irregular and recommends amplitude', () => {
    const result = assessRegularity(trace(6, { jitter: 0.35 }));
    expect(result.regular).toBe(false);
    expect(result.recommended).toBe('amplitude');
  });

  // The number predicts the artefact before any reconstruction happens.
  it('names the artefact and the RT consequence', () => {
    const result = assessRegularity(trace(6, { jitter: 0.35 }));
    expect(result.message).toMatch(/artefato de degrau e o diafragma duplicado/);
    expect(result.message).toMatch(/ITV construído a partir daqui subestima a excursão/);
  });

  it('refuses to judge fewer than two cycles', () => {
    const result = assessRegularity(trace(2).slice(0, 40));
    expect(result.regular).toBe(false);
    expect(result.message).toMatch(/não dá para julgar regularidade/);
  });

  it('honours a custom threshold', () => {
    expect(assessRegularity(trace(6, { jitter: 0.1 }), 0.01).regular).toBe(false);
  });
});

describe('respiratoryBinning — phase binning fills every bin, which is the trap', () => {
  it('fills all ten bins from a regular trace', () => {
    const result = binByPhase(trace(6), 10);
    expect(result.ok).toBe(true);
    expect(result.emptyBins).toEqual([]);
    expect(result.bins.every(b => b.sampleIndices.length > 0)).toBe(true);
  });

  // Looks complete, is not.
  it('STILL fills every bin from an irregular trace, and warns', () => {
    const result = binByPhase(trace(6, { jitter: 0.4 }), 10);
    expect(result.emptyBins).toEqual([]);
    expect(result.warnings.join(' ')).toMatch(/posições anatômicas diferentes no mesmo bin/);
  });

  // 0% and 100% are the same phase; counting the boundary twice is the stutter bug.
  it('labels bins from 0% and never emits 100%', () => {
    const labels = binByPhase(trace(4), 10).bins.map(b => b.label);
    expect(labels[0]).toBe('0%');
    expect(labels).toHaveLength(10);
    expect(labels).not.toContain('100%');
  });

  it('does not assign the cycle boundary to two bins', () => {
    const result = binByPhase(trace(4), 10);
    const all = result.bins.flatMap(b => b.sampleIndices);
    expect(new Set(all).size).toBe(all.length);
  });

  it('refuses a trace with no complete cycle', () => {
    expect(binByPhase([{ time: 0, amplitude: 1 }], 10).ok).toBe(false);
  });
});

describe('respiratoryBinning — amplitude binning leaves holes, and says so', () => {
  it('bins a regular trace across the range', () => {
    const result = binByAmplitude(trace(6), 10);
    expect(result.ok).toBe(true);
    expect(result.bins.some(b => b.sampleIndices.length > 0)).toBe(true);
  });

  // An empty bin is a phase the reconstruction cannot produce at all.
  it('reports empty bins and warns against interpolating them', () => {
    // A sigh, which is how this actually happens: one deep breath stretches the amplitude
    // range far past where the patient spent the rest of the acquisition, and the bins in
    // between have nothing in them. Scaling the trace down would NOT produce empty bins --
    // the bins are laid out between the observed min and max, so the extremes are occupied
    // by construction and only the middle can be starved.
    const sighed: SurrogateSample[] = trace(6).map((s, i) => ({
      ...s,
      amplitude: i >= 250 && i < 253 ? 30 : s.amplitude,
    }));
    const result = binByAmplitude(sighed, 20);
    expect(result.emptyBins.length).toBeGreaterThan(0);
    expect(result.warnings.join(' ')).toMatch(/interpolar dos vizinhos inventa anatomia/);
  });

  it('refuses a trace where the surrogate never moved', () => {
    const flat = Array.from({ length: 50 }, (_, i) => ({ time: i * 0.05, amplitude: 3 }));
    expect(binByAmplitude(flat, 10).reason).toMatch(/surrogate não se moveu/);
  });

  it('refuses a trace with fewer than two samples', () => {
    expect(binByAmplitude([{ time: 0, amplitude: 1 }], 10).ok).toBe(false);
  });
});

describe('respiratoryBinning — choosing the method', () => {
  it('picks phase for a regular trace and says why', () => {
    const result = bin(trace(6));
    expect(result.method).toBe('phase');
    expect(result.warnings[0]).toMatch(/Método escolhido automaticamente: por fase/);
  });

  it('picks amplitude for an irregular one', () => {
    expect(bin(trace(6, { jitter: 0.4 })).method).toBe('amplitude');
  });

  it('honours an explicit method without adding the note', () => {
    const result = bin(trace(6, { jitter: 0.4 }), 10, 'phase');
    expect(result.method).toBe('phase');
    expect(result.warnings[0]).not.toMatch(/escolhido automaticamente/);
  });

  it('labels both methods', () => {
    expect(BINNING_LABELS.phase).toBe('por fase');
    expect(BINNING_LABELS.amplitude).toBe('por amplitude');
  });
});

describe('respiratoryBinning — the ITV consequence', () => {
  // The reason the irregularity number matters more than the bins.
  it('says an irregular acquisition gives an ITV that under-covers', () => {
    const note = itvReliability(assessRegularity(trace(6, { jitter: 0.4 })));
    expect(note.reliable).toBe(false);
    expect(note.message).toMatch(/não a que o paciente vai fazer ao longo do tratamento/);
    expect(note.message).toMatch(/coaching respiratório ou uma margem maior/);
  });

  it('is quiet on a regular one', () => {
    const note = itvReliability(assessRegularity(trace(6)));
    expect(note.reliable).toBe(true);
    expect(note.message).toBe('');
  });

  it('refuses on too few cycles', () => {
    expect(itvReliability(assessRegularity(trace(1))).reliable).toBe(false);
  });
});

describe('respiratoryBinning — the readout', () => {
  it('reports filled bins and cycles', () => {
    expect(describeBinning(binByPhase(trace(6), 10))).toMatch(
      /^Binagem por fase: 10\/10 bins preenchidos, \d+ ciclos\./
    );
  });

  it('shows the reason when it refused', () => {
    expect(describeBinning(binByPhase([], 10))).toMatch(/Nenhum ciclo respiratório/);
  });
});
