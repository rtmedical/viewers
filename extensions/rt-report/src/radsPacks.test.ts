import {
  biRads,
  describeRads,
  liRads,
  piRads,
  TI_POINTS,
  tiRads,
  TiRadsInput,
} from './radsPacks';

const benignNodule = (over: Partial<TiRadsInput> = {}): TiRadsInput => ({
  composition: 'cystic',
  echogenicity: 'anechoic',
  shape: 'widerThanTall',
  margin: 'smooth',
  foci: ['none'],
  sizeMm: 12,
  ...over,
});

const suspiciousNodule = (over: Partial<TiRadsInput> = {}): TiRadsInput => ({
  composition: 'solid',           // 2
  echogenicity: 'veryHypoechoic', // 3
  shape: 'tallerThanWide',        // 3
  margin: 'lobulated',            // 2
  foci: ['punctate'],             // 3  => 13 points
  sizeMm: 12,
  ...over,
});

describe('radsPacks — TI-RADS: a category without its size is not actionable', () => {
  // TR4 at 8 mm is follow-up; TR4 at 18 mm is FNA. Same category, different action.
  it('REQUIRES the size, saying why', () => {
    const result = tiRads(suspiciousNodule({ sizeMm: NaN }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/TR4 com 8 mm é seguimento, com 18 mm é PAAF/);
  });

  it('the same category gives different actions at different sizes', () => {
    // Solid 2 + iso 1 + wider 0 + lobulated 2 + none 0 = 5 points => TR4.
    const tr4 = (sizeMm: number) =>
      tiRads({
        composition: 'solid',
        echogenicity: 'isoechoic',
        shape: 'widerThanTall',
        margin: 'lobulated',
        foci: ['none'],
        sizeMm,
      });
    expect(tr4(8).category).toBe('TR4');
    expect(tr4(18).category).toBe('TR4');
    expect(tr4(8).recommendation).toMatch(/Sem conduta adicional/);
    expect(tr4(12).recommendation).toMatch(/Seguimento/);
    expect(tr4(18).recommendation).toMatch(/PAAF/);
  });

  it('adds the points from every feature, foci included and additive', () => {
    const result = tiRads(suspiciousNodule());
    expect(result.points).toBe(13);
    expect(result.category).toBe('TR5');
    expect(result.recommendation).toMatch(/PAAF/);
  });

  it('sums multiple echogenic foci', () => {
    const one = tiRads(suspiciousNodule({ foci: ['punctate'] })).points as number;
    const two = tiRads(suspiciousNodule({ foci: ['punctate', 'macrocalcification'] })).points as number;
    expect(two - one).toBe(TI_POINTS.foci.macrocalcification);
  });

  it('a purely cystic nodule is TR1 with nothing to do', () => {
    const result = tiRads(benignNodule());
    expect(result.points).toBe(0);
    expect(result.category).toBe('TR1');
    expect(result.recommendation).toMatch(/Sem PAAF e sem seguimento/);
  });

  // A high point total on a cystic nodule is a data entry problem, not a finding.
  it('warns about an implausible combination', () => {
    const result = tiRads(benignNodule({ shape: 'tallerThanWide', margin: 'lobulated' }));
    expect(result.warnings.join(' ')).toMatch(/combinação é incomum/);
  });

  it('renders the readout with points and action', () => {
    expect(describeRads(tiRads(suspiciousNodule()))).toMatch(
      /^TI-RADS TR5 \(13 pt\) · risco > 20% · PAAF/
    );
  });
});

describe('radsPacks — PI-RADS: the zone decides the dominant sequence', () => {
  it('peripheral zone scores on DWI', () => {
    const result = piRads({ zone: 'peripheral', dwi: 4, t2: 2 });
    expect(result.category).toBe('4');
    expect(result.rationale).toMatch(/DWI 4 é dominante/);
  });

  it('transition zone scores on T2', () => {
    const result = piRads({ zone: 'transition', dwi: 4, t2: 2 });
    expect(result.category).toBe('2');
    expect(result.rationale).toMatch(/T2 2 é dominante/);
  });

  // Scoring the wrong one is wrong in both directions depending on the lesion.
  it('and the same lesion lands in different categories in the two zones', () => {
    const peripheral = piRads({ zone: 'peripheral', dwi: 4, t2: 2 }).category;
    const transition = piRads({ zone: 'transition', dwi: 4, t2: 2 }).category;
    expect(peripheral).not.toBe(transition);
  });

  // The only place DCE changes anything, and the reason it is acquired.
  it('DCE upgrades a peripheral-zone 3 to a 4', () => {
    expect(piRads({ zone: 'peripheral', dwi: 3, t2: 3 }).category).toBe('3');
    const upgraded = piRads({ zone: 'peripheral', dwi: 3, t2: 3, dcePositive: true });
    expect(upgraded.category).toBe('4');
    expect(upgraded.rationale).toMatch(/DCE positivo eleva 3 para 4/);
  });

  it('DCE does nothing to a peripheral 4', () => {
    expect(piRads({ zone: 'peripheral', dwi: 4, t2: 3, dcePositive: true }).category).toBe('4');
  });

  it('DCE in the transition zone is ignored, and said so', () => {
    const result = piRads({ zone: 'transition', dwi: 5, t2: 3, dcePositive: true });
    expect(result.category).toBe('3');
    expect(result.warnings.join(' ')).toMatch(/não altera escore na zona de transição/);
  });

  it('refuses without a zone or with an out-of-range score', () => {
    expect(piRads({ zone: 'x' as never, dwi: 3, t2: 3 }).error).toMatch(/Zona não informada/);
    expect(piRads({ zone: 'peripheral', dwi: 0, t2: 3 }).error).toMatch(/entre 1 e 5/);
  });
});

describe('radsPacks — BI-RADS 3 is only available on a baseline', () => {
  // Assigning 3 again on every visit is a way to follow a cancer for three years.
  it('REFUSES category 3 on a follow-up, saying what to use instead', () => {
    const result = biRads({ category: '3' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/estável vira 2, alterado vira 4/);
  });

  it('allows it on a baseline', () => {
    const result = biRads({ category: '3', isBaseline: true });
    expect(result.ok).toBe(true);
    expect(result.recommendation).toMatch(/6 meses/);
  });

  it('nudges toward 2 when the finding proved stable', () => {
    const result = biRads({ category: '3', isBaseline: true, stableOnFollowUp: true });
    expect(result.warnings.join(' ')).toMatch(/considere categoria 2/);
  });

  it('carries the risk band and management for the other categories', () => {
    expect(biRads({ category: '4B' }).risk).toMatch(/10%/);
    expect(biRads({ category: '5' }).recommendation).toMatch(/Altamente sugestivo/);
    expect(biRads({ category: '6' }).risk).toMatch(/comprovada/);
  });

  it('notes that category 0 demands completion, not follow-up', () => {
    expect(biRads({ category: '0' }).warnings.join(' ')).toMatch(/exige uma conduta de completar/);
  });

  it('refuses an invalid category', () => {
    expect(biRads({ category: '7' as never }).ok).toBe(false);
  });
});

describe('radsPacks — LI-RADS: LR-5 is a diagnosis, not a suspicion', () => {
  const observation = (over = {}) => ({ atRisk: true, aphe: true, sizeMm: 25, washout: true, ...over });

  it('only applies to a patient at risk', () => {
    const result = liRads(observation({ atRisk: false }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/não têm o significado publicado/);
  });

  // At 10-19 mm it takes TWO additional features; at >= 20 mm it takes ONE.
  it('needs two additional features under 20 mm and one at or above', () => {
    expect(liRads(observation({ sizeMm: 15, washout: true })).category).toBe('LR-4');
    expect(liRads(observation({ sizeMm: 15, washout: true, capsule: true })).category).toBe('LR-5');
    expect(liRads(observation({ sizeMm: 25, washout: true })).category).toBe('LR-5');
  });

  it('LR-5 says treatment may proceed without biopsy', () => {
    expect(liRads(observation()).recommendation).toMatch(/sem biópsia/);
  });

  it('no arterial hyperenhancement cannot reach LR-4 or LR-5', () => {
    const result = liRads(observation({ aphe: false, sizeMm: 30, washout: true, capsule: true }));
    expect(['LR-2', 'LR-3']).toContain(result.category);
  });

  it('arterial hyperenhancement alone in a small observation is LR-3', () => {
    const result = liRads({ atRisk: true, aphe: true, sizeMm: 12 });
    expect(result.category).toBe('LR-3');
    expect(result.recommendation).toMatch(/3–6 meses/);
  });

  it('tumour in vein overrides everything', () => {
    expect(liRads(observation({ tumourInVein: true })).category).toBe('LR-TIV');
  });

  it('a targetoid observation is LR-M, not HCC', () => {
    const result = liRads(observation({ targetoid: true }));
    expect(result.category).toBe('LR-M');
    expect(result.recommendation).toMatch(/colangiocarcinoma ou metástase/);
  });

  it('counts threshold growth as an additional feature', () => {
    expect(liRads(observation({ sizeMm: 15, washout: true, thresholdGrowth: true })).category).toBe('LR-5');
  });

  it('refuses without a size', () => {
    expect(liRads(observation({ sizeMm: 0 })).ok).toBe(false);
  });
});

describe('radsPacks — the readout', () => {
  it('carries system, category, risk and recommendation', () => {
    expect(describeRads(piRads({ zone: 'peripheral', dwi: 5, t2: 4 }))).toMatch(
      /^PI-RADS 5 · risco muito alta · Muito provável/
    );
  });

  it('shows the refusal instead', () => {
    expect(describeRads(biRads({ category: '3' }))).toMatch(/só se aplica a achado caracterizado/);
    expect(describeRads(undefined as never)).toBe('');
  });
});
