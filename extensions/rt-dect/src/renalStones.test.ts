import {
  characteriseStone,
  INTERVENTION_LIKELY_MM,
  passageLikelihood,
  rankStones,
  SOFT_TISSUE_WINDOW_BLOOM_MM,
  SPONTANEOUS_PASSAGE_MM,
  stoneBurden,
  StoneInput,
  SWL_RESISTANT_HU,
} from './renalStones';

/** HU pair with a given ratio and mean attenuation. */
const withRatio = (ratio: number, meanHu: number) => {
  const high = (2 * (meanHu + 1000)) / (1 + ratio) - 1000;
  return { huLow: ratio * (high + 1000) - 1000, huHigh: high };
};

const URIC = withRatio(1.1, 450);
const CALCIC = withRatio(1.45, 1400);

const stone = (over: Partial<StoneInput> = {}): StoneInput => ({
  measuredSizeMm: 7,
  window: 'bone',
  ...CALCIC,
  ...over,
});

describe('renalStones — size drives management, and size is window-dependent', () => {
  it('trusts a bone-window measurement as given', () => {
    const report = characteriseStone(stone({ measuredSizeMm: 7, window: 'bone' }));
    expect(report.sizeMm).toBe(7);
    expect(report.sizeCorrectionMm).toBe(0);
  });

  // 1 mm at the 5 mm boundary moves the patient between "hydrate and wait" and "refer".
  it('corrects a soft-tissue-window measurement onto the bone-window reference', () => {
    const report = characteriseStone(stone({ measuredSizeMm: 6, window: 'softTissue' }));
    expect(report.sizeMm).toBeCloseTo(6 - SOFT_TISSUE_WINDOW_BLOOM_MM, 6);
    expect(report.sizeCorrectionMm).toBe(-SOFT_TISSUE_WINDOW_BLOOM_MM);
  });

  it('and that correction can change the management band', () => {
    const uncorrected = characteriseStone(stone({ measuredSizeMm: 6, window: 'bone' }));
    const corrected = characteriseStone(stone({ measuredSizeMm: 6, window: 'softTissue' }));
    expect(uncorrected.passage).toBe('uncertain');
    expect(corrected.passage).toBe('likely');
  });

  // Rather than silently accepting a number whose provenance nobody wrote down.
  it('warns when the window was not recorded', () => {
    const report = characteriseStone(stone({ window: 'unknown' }));
    expect(report.sizeCorrectionMm).toBe(0);
    expect(report.warnings.join(' ')).toMatch(/Janela de medida não registrada/);
  });

  it('never produces a negative size', () => {
    expect(characteriseStone(stone({ measuredSizeMm: 0.5, window: 'softTissue' })).sizeMm).toBe(0);
  });

  it('bands passage likelihood', () => {
    expect(passageLikelihood(4)).toBe('likely');
    expect(passageLikelihood(SPONTANEOUS_PASSAGE_MM)).toBe('uncertain');
    expect(passageLikelihood(INTERVENTION_LIKELY_MM + 1)).toBe('unlikely');
    expect(passageLikelihood(NaN)).toBe('uncertain');
  });
});

describe('renalStones — composition, and what it refuses to say', () => {
  it('calls a uric acid stone uric acid and names the therapy', () => {
    const report = characteriseStone(stone({ ...URIC, measuredSizeMm: 8 }));
    expect(report.composition).toBe('uricAcid');
    expect(report.summary).toMatch(/alcalinização urinária/);
  });

  // The refusal from RTV-88 survives all the way into the report sentence.
  it('says "not uric acid" and never guesses the mineral', () => {
    const report = characteriseStone(stone({ measuredSizeMm: 8 }));
    expect(report.composition).toBe('nonUricAcid');
    expect(report.summary).toMatch(/não separa oxalato de fosfato de cálcio/);
    expect(report.summary).not.toMatch(/oxalato de cálcio monoidratado/);
  });

  it('leaves composition indeterminate for a stone too small to classify, with the reason', () => {
    const report = characteriseStone(stone({ measuredSizeMm: 2 }));
    expect(report.composition).toBe('indeterminate');
    expect(report.warnings.join(' ')).toMatch(/volume parcial/i);
  });

  // A sentence with a confident-sounding gap in it is worse than a shorter sentence.
  it('produces a summary about size only when the chemistry is unknown', () => {
    const report = characteriseStone(stone({ measuredSizeMm: 2 }));
    expect(report.summary).toMatch(/Cálculo de 2\.0 mm/);
    expect(report.summary).not.toMatch(/ácido úrico|alcalinização/i);
  });
});

describe('renalStones — lithotripsy prediction', () => {
  it('flags a dense stone as SWL-resistant', () => {
    const report = characteriseStone(stone({ measuredSizeMm: 9 }));
    expect(report.attenuationHu).toBeGreaterThan(SWL_RESISTANT_HU);
    expect(report.swlResistant).toBe(true);
    expect(report.summary).toMatch(/resistente a LECO/);
  });

  it('says SWL is plausible for a softer stone', () => {
    const report = characteriseStone(stone({ ...URIC, measuredSizeMm: 9 }));
    expect(report.swlResistant).toBe(false);
    expect(report.summary).toMatch(/LECO plausível/);
  });

  // It inherits the size guard: attenuation on a partial-volumed stone is not the stone's.
  it('gives no prediction at all for a stone too small to measure honestly', () => {
    const report = characteriseStone(stone({ measuredSizeMm: 2 }));
    expect(report.swlResistant).toBeNull();
    expect(report.warnings.join(' ')).toMatch(/não interpretável para prever LECO/);
    expect(report.summary).not.toMatch(/LECO/);
  });
});

describe('renalStones — the VNC caveat travels', () => {
  it('warns when a small stone was only seen on VNC', () => {
    const report = characteriseStone(stone({ measuredSizeMm: 2, seenOnVncOnly: true }));
    expect(report.warnings.join(' ')).toMatch(/ausência não exclui/);
  });

  it('does not warn for a stone large enough to be reliable on VNC', () => {
    const report = characteriseStone(stone({ measuredSizeMm: 8, seenOnVncOnly: true }));
    expect(report.warnings.join(' ')).not.toMatch(/ausência não exclui/);
  });

  it('does not warn when the stone was seen on a true acquisition', () => {
    const report = characteriseStone(stone({ measuredSizeMm: 2 }));
    expect(report.warnings.join(' ')).not.toMatch(/VNC/);
  });
});

describe('renalStones — a burden of stones', () => {
  const reports = () => [
    characteriseStone(stone({ measuredSizeMm: 4, ...URIC })),
    characteriseStone(stone({ measuredSizeMm: 14 })),
    characteriseStone(stone({ measuredSizeMm: 7 })),
  ];

  // The one driving management comes first.
  it('ranks the stone that will not pass at the top', () => {
    expect(rankStones(reports()).map(r => r.sizeMm)).toEqual([14, 7, 4]);
  });

  it('breaks ties within a band by size', () => {
    const ranked = rankStones([
      characteriseStone(stone({ measuredSizeMm: 6 })),
      characteriseStone(stone({ measuredSizeMm: 9 })),
    ]);
    expect(ranked.map(r => r.sizeMm)).toEqual([9, 6]);
  });

  it('summarises the burden for the impression', () => {
    const burden = stoneBurden(reports());
    expect(burden).toEqual({
      count: 3,
      largestMm: 14,
      anyUricAcid: true,
      anySwlResistant: true,
    });
  });

  it('handles an empty burden', () => {
    expect(stoneBurden([])).toEqual({
      count: 0,
      largestMm: 0,
      anyUricAcid: false,
      anySwlResistant: false,
    });
    expect(rankStones(undefined as never)).toEqual([]);
  });
});

describe('renalStones — degenerate input', () => {
  it('reports a stone with no valid measurement without throwing', () => {
    const report = characteriseStone(stone({ measuredSizeMm: NaN }));
    expect(report.summary).toMatch(/sem medida válida/);
    expect(report.passage).toBe('uncertain');
  });

  it('includes the location when there is one', () => {
    expect(
      characteriseStone(stone({ measuredSizeMm: 8, location: 'ureter proximal direito' })).summary
    ).toMatch(/em ureter proximal direito/);
  });
});
