import {
  analyseSpectrum,
  assessQuality,
  classifyLactateLipid,
  describeSpectrum,
  linewidth,
  MAX_LINEWIDTH_PPM,
  MIN_SNR,
  NAA_PPM,
  noiseLevel,
  peakArea,
  PEAK_WINDOWS,
  referenceAxis,
  Spectrum,
} from './spectroscopy';

/** Lorentzian peak. */
const peak = (x: number, centre: number, height: number, fwhm: number) =>
  height / (1 + ((2 * (x - centre)) / fwhm) ** 2);

interface Component {
  centre: number;
  height: number;
  fwhm?: number;
}

/** Builds a spectrum from 0.5 to 12 ppm with the given peaks. */
const build = (components: Component[], fwhm = 0.05, noise = 0): Spectrum => {
  const ppm: number[] = [];
  const intensity: number[] = [];
  for (let x = 0.5; x <= 12; x += 0.005) {
    ppm.push(x);
    let y = 0;
    for (const c of components) {
      y += peak(x, c.centre, c.height, c.fwhm ?? fwhm);
    }
    // Deterministic pseudo-noise so tests do not flake.
    y += noise * Math.sin(x * 977.13);
    intensity.push(y);
  }
  return { ppm, intensity };
};

const NORMAL: Component[] = [
  { centre: 2.02, height: 100 },
  { centre: 3.03, height: 60 },
  { centre: 3.22, height: 45 },
  { centre: 3.56, height: 25 },
];

describe('spectroscopy — quality comes first', () => {
  it('measures the NAA linewidth', () => {
    expect(linewidth(build(NORMAL, 0.05))).toBeGreaterThan(0.04);
    expect(linewidth(build(NORMAL, 0.05))).toBeLessThan(0.08);
  });

  it('measures SNR against an empty region of the spectrum', () => {
    const quality = assessQuality(build(NORMAL, 0.05, 1));
    expect(quality.snr).toBeGreaterThan(MIN_SNR);
    expect(noiseLevel(build(NORMAL, 0.05, 1))).toBeGreaterThan(0);
  });

  // Estimating noise from the whole spectrum would fold the peaks into it and make every
  // SNR look fine.
  it('takes the noise from beyond 8 ppm, where a brain spectrum is empty', () => {
    const noisy = noiseLevel(build(NORMAL, 0.05, 2));
    const quiet = noiseLevel(build(NORMAL, 0.05, 0));
    expect(noisy).toBeGreaterThan(quiet * 10);
  });

  // The spectrum still looks like a spectrum, which is why the check runs first.
  it('REFUSES a badly shimmed spectrum, naming the linewidth', () => {
    const broad = build(NORMAL, 0.35);
    const quality = assessQuality(broad);
    expect(quality.usable).toBe(false);
    expect(quality.reasons.join(' ')).toMatch(/shim insuficiente/);
    expect(quality.linewidthPpm).toBeGreaterThan(MAX_LINEWIDTH_PPM);
  });

  it('refuses a spectrum that is mostly noise', () => {
    const quality = assessQuality(build([{ centre: 2.02, height: 2 }], 0.05, 3));
    expect(quality.usable).toBe(false);
    expect(quality.reasons.join(' ')).toMatch(/sinal-ruído/);
  });

  it('accepts a clean one', () => {
    expect(assessQuality(build(NORMAL, 0.05, 0.5)).usable).toBe(true);
  });

  it('honours site-specific thresholds', () => {
    expect(assessQuality(build(NORMAL, 0.05), 0.01).usable).toBe(false);
  });
});

describe('spectroscopy — referencing the chemical shift axis', () => {
  it('leaves a correctly referenced spectrum alone', () => {
    const axis = referenceAxis(build(NORMAL));
    expect(Math.abs(axis.correctionPpm)).toBeLessThan(0.01);
    expect(axis.suspicious).toBe(false);
  });

  // An axis off by 0.1 ppm has the choline window sampling creatine.
  it('shifts a mis-referenced axis back onto NAA', () => {
    const shifted = build(NORMAL.map(c => ({ ...c, centre: c.centre - 0.08 })));
    const axis = referenceAxis(shifted);
    expect(axis.correctionPpm).toBeCloseTo(0.08, 2);
    const naaAfter = referenceAxis(axis.spectrum).correctionPpm;
    expect(Math.abs(naaAfter)).toBeLessThan(0.01);
  });

  // A large correction is itself a sign something is wrong.
  it('flags a correction too large to be mere referencing', () => {
    const shifted = build(NORMAL.map(c => ({ ...c, centre: c.centre - 0.25 })));
    const axis = referenceAxis(shifted);
    expect(axis.suspicious).toBe(true);
    expect(axis.message).toMatch(/grande demais/);
  });

  it('says so when there is no NAA at all', () => {
    const axis = referenceAxis({ ppm: [5, 6], intensity: [0, 0] });
    expect(axis.suspicious).toBe(true);
    expect(axis.message).toMatch(/Sem sinal na região do NAA/);
  });

  it('anchors on 2.02 ppm', () => {
    expect(NAA_PPM).toBe(2.02);
  });
});

describe('spectroscopy — peak areas', () => {
  it('scales with peak height', () => {
    const single = peakArea(build([{ centre: 2.02, height: 100 }]), 1.95, 2.1);
    const double = peakArea(build([{ centre: 2.02, height: 200 }]), 1.95, 2.1);
    expect(double / single).toBeCloseTo(2, 1);
  });

  // Without a baseline a rolling background is counted as signal, and counted differently
  // in each window because they are different widths.
  it('subtracts a linear baseline through the window endpoints', () => {
    const clean = build([{ centre: 2.02, height: 100 }]);
    const withOffset: Spectrum = {
      ppm: clean.ppm,
      intensity: clean.intensity.map((y, i) => y + 20 + 0.5 * i),
    };
    expect(peakArea(withOffset, 1.95, 2.1)).toBeCloseTo(peakArea(clean, 1.95, 2.1), 1);
  });

  it('is zero for an empty window', () => {
    // The Lorentzian tails never reach exactly zero, so a far window integrates to a
    // rounding-scale residue rather than to nothing.
    expect(Math.abs(peakArea(build(NORMAL), 6, 6.1))).toBeLessThan(1e-5);
    expect(peakArea({ ppm: [], intensity: [] }, 1, 2)).toBe(0);
  });

  it('has a window for every metabolite it reports', () => {
    expect(PEAK_WINDOWS.map(w => w.metabolite)).toEqual(
      expect.arrayContaining(['naa', 'creatine', 'choline', 'myoInositol', 'lactate', 'lipid'])
    );
    for (const window of PEAK_WINDOWS) {
      expect(window.toPpm).toBeGreaterThan(window.fromPpm);
    }
  });
});

describe('spectroscopy — lactate inverts, lipid does not', () => {
  it('calls an inverted peak at TE 144 lactate', () => {
    expect(classifyLactateLipid(-50, 144).verdict).toBe('lactate');
  });

  it('calls a positive peak at TE 144 lipid', () => {
    const result = classifyLactateLipid(50, 144);
    expect(result.verdict).toBe('lipid');
    expect(result.message).toMatch(/lipídio, não lactato/);
  });

  // Calling a lipid peak lactate is calling necrosis ischaemia.
  it('REFUSES to choose at short TE, where both point up', () => {
    const result = classifyLactateLipid(50, 35);
    expect(result.verdict).toBe('indistinguishable');
    expect(result.message).toMatch(/não é possível separá-los/);
    expect(result.message).toMatch(/Repita em TE 144 ms/);
  });

  it('refuses at long TE outside the inversion window too', () => {
    expect(classifyLactateLipid(-50, 270).verdict).toBe('indistinguishable');
  });

  it('says nothing when there is no peak', () => {
    expect(classifyLactateLipid(0, 144).verdict).toBe('indistinguishable');
    expect(classifyLactateLipid(NaN, 144).message).toMatch(/ausentes/);
  });
});

describe('spectroscopy — the full read', () => {
  const analyse = (components = NORMAL, options = {}) =>
    analyseSpectrum(build(components, 0.05, 0.5), { echoTimeMs: 144, ...options });

  it('produces the three ratios', () => {
    const result = analyse();
    expect(result.ok).toBe(true);
    expect(result.ratios.naaCr!).toBeGreaterThan(1.4);
    expect(result.ratios.choCr!).toBeGreaterThan(0.6);
    expect(result.ratios.choCr!).toBeLessThan(0.9);
    expect(result.ratios.miCr).toBeGreaterThan(0);
  });

  it('shows a tumour pattern as a raised Cho/Cr and a fallen NAA/Cr', () => {
    const tumour = analyse([
      { centre: 2.02, height: 40 },
      { centre: 3.03, height: 60 },
      { centre: 3.22, height: 110 },
      { centre: 3.56, height: 25 },
    ]);
    expect(tumour.ratios.choCr!).toBeGreaterThan(analyse().ratios.choCr!);
    expect(tumour.ratios.naaCr!).toBeLessThan(analyse().ratios.naaCr!);
  });

  // A rising Cho/Cr can be a falling Cr, and the ratio cannot tell them apart.
  it('WARNS when creatine has fallen against the reference', () => {
    const result = analyse(
      [
        { centre: 2.02, height: 100 },
        { centre: 3.03, height: 20 },
        { centre: 3.22, height: 45 },
      ],
      { referenceCreatineArea: peakArea(build(NORMAL, 0.05), 2.95, 3.1) }
    );
    expect(result.warnings.join(' ')).toMatch(/queda do denominador e não aumento de colina/);
  });

  it('does not warn when creatine is where it should be', () => {
    const result = analyse(NORMAL, {
      referenceCreatineArea: peakArea(build(NORMAL, 0.05), 2.95, 3.1),
    });
    expect(result.warnings.join(' ')).not.toMatch(/denominador/);
  });

  // A ratio from an unreadable spectrum is a number the reader has no way to distrust.
  it('refuses ratios from a badly shimmed spectrum', () => {
    const result = analyseSpectrum(build(NORMAL, 0.35), { echoTimeMs: 144 });
    expect(result.ok).toBe(false);
    expect(result.ratios).toEqual({});
    expect(result.reason).toMatch(/shim insuficiente/);
  });

  it('REQUIRES the echo time', () => {
    const result = analyseSpectrum(build(NORMAL, 0.05, 0.5), { echoTimeMs: NaN });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/lactato ou lipídio/);
  });

  it('classifies the 1.33 ppm peak at the TE that was used', () => {
    const withLactate = analyseSpectrum(
      build([...NORMAL, { centre: 1.33, height: -30 }], 0.05, 0.5),
      { echoTimeMs: 144 }
    );
    expect(withLactate.lactate.verdict).toBe('lactate');

    const shortTe = analyseSpectrum(
      build([...NORMAL, { centre: 1.33, height: 30 }], 0.05, 0.5),
      { echoTimeMs: 35 }
    );
    expect(shortTe.lactate.verdict).toBe('indistinguishable');
  });

  it('renders a readout with the ratios and the lactate verdict', () => {
    const text = describeSpectrum(
      analyseSpectrum(build([...NORMAL, { centre: 1.33, height: -30 }], 0.05, 0.5), {
        echoTimeMs: 144,
      })
    );
    expect(text).toMatch(/NAA\/Cr \d+\.\d+ · Cho\/Cr \d+\.\d+/);
    expect(text).toMatch(/lactato/);
  });

  it('shows the refusal instead of ratios when it refused', () => {
    expect(describeSpectrum(analyseSpectrum(build(NORMAL, 0.35), { echoTimeMs: 144 }))).toMatch(
      /shim/
    );
    expect(describeSpectrum(undefined as never)).toBe('');
  });
});
