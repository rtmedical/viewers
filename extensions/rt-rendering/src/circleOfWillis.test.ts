import {
  acomAneurysmNote,
  assessCollateral,
  classifyVariant,
  describeWillis,
  NON_FUNCTIONAL,
  SegmentState,
  VARIANT_LABELS,
  WillisSegments,
} from './circleOfWillis';

const normal = (): WillisSegments => ({
  acom: 'normal',
  a1: { left: 'normal', right: 'normal' },
  pcom: { left: 'normal', right: 'normal' },
  p1: { left: 'normal', right: 'normal' },
});

const withSegment = (
  path: (s: WillisSegments) => void
): WillisSegments => {
  const segments = normal();
  path(segments);
  return segments;
};

describe('circleOfWillis — an incomplete circle is not a finding', () => {
  it('a complete circle says so, briefly', () => {
    expect(classifyVariant(normal()).complete).toBe(true);
    expect(describeWillis(normal())).toBe('Círculo de Willis completo.');
  });

  // A textbook-complete circle exists in under half of people; reporting "incompleto" as an
  // abnormality is a normal variant reported as pathology.
  it('an absent PComA with a working P1 is dictated and closed, not alarmed about', () => {
    const segments = withSegment(s => {
      s.pcom.left = 'absent';
    });
    const text = describeWillis(segments);
    expect(text).toMatch(/PComA esquerda ausente/);
    expect(text).toMatch(/não há via colateral da circulação anterior para a posterior/);
  });

  it('names the variant only as a step toward the consequence', () => {
    const segments = withSegment(s => {
      s.p1.left = 'absent';
    });
    expect(classifyVariant(segments).variant).toBe('fetalPca');
    expect(assessCollateral(segments).actionable).toBe(true);
  });

  it('labels every variant', () => {
    for (const key of Object.keys(VARIANT_LABELS)) {
      expect(VARIANT_LABELS[key as keyof typeof VARIANT_LABELS].length).toBeGreaterThan(3);
    }
  });
});

describe('circleOfWillis — hypoplastic counts as non-functional', () => {
  // A 0.8 mm A1 is visible on the angiogram and carries nothing useful under load.
  it('treats hypoplastic like absent for collateral purposes', () => {
    expect(NON_FUNCTIONAL).toEqual(expect.arrayContaining(['hypoplastic', 'absent', 'occluded']));
    const hypo = withSegment(s => {
      s.a1.left = 'hypoplastic';
    });
    expect(assessCollateral(hypo).actionable).toBe(true);
  });

  it('distinguishes them in the wording, since they are not the same anatomy', () => {
    const absent = describeWillis(withSegment(s => { s.p1.left = 'absent'; }));
    const hypo = describeWillis(withSegment(s => { s.p1.left = 'hypoplastic'; }));
    expect(absent).toMatch(/P1 esquerdo ausente/);
    expect(hypo).toMatch(/P1 esquerdo hipoplásico/);
    expect(hypo).toMatch(/predominantemente suprida/);
  });

  it('a not-assessed segment is not a variant', () => {
    const partial = withSegment(s => { s.pcom.right = 'notAssessed'; });
    expect(classifyVariant(partial).notAssessed).toEqual(['PComA right']);
    expect(classifyVariant(partial).findings).toEqual([]);
  });

  it('refuses to classify when most of the circle was not assessed', () => {
    const blind: WillisSegments = {
      acom: 'notAssessed',
      a1: { left: 'notAssessed', right: 'notAssessed' },
      pcom: { left: 'notAssessed', right: 'normal' },
      p1: { left: 'normal', right: 'normal' },
    };
    expect(classifyVariant(blind).variant).toBe('notAssessable');
    expect(describeWillis(blind)).toMatch(/não avaliável/);
  });
});

describe('circleOfWillis — fetal PCA changes what an ICA occlusion does', () => {
  const fetal = () => withSegment(s => { s.p1.right = 'absent'; });

  // Reporting "P1 hipoplásico" without saying this is reporting the anatomy and withholding
  // the point.
  it('says the occipital lobe is at risk from a CAROTID occlusion', () => {
    const pathway = assessCollateral(fetal()).pathways[0];
    expect(pathway.ifOccluded).toMatch(/carótida interna direita/);
    expect(pathway.territory).toMatch(/occipital/);
    expect(pathway.consequence).toMatch(/muda o planejamento de trombectomia/);
  });

  it('needs the PComA to be patent — without it there is no fetal supply', () => {
    const noSupply = withSegment(s => {
      s.p1.right = 'absent';
      s.pcom.right = 'absent';
    });
    const fetalPathways = assessCollateral(noSupply).pathways.filter(p =>
      p.consequence.includes('configuração fetal')
    );
    expect(fetalPathways).toHaveLength(0);
  });

  it('a partial fetal configuration is named differently', () => {
    expect(classifyVariant(withSegment(s => { s.p1.right = 'hypoplastic'; })).variant).toBe(
      'partialFetalPca'
    );
  });
});

describe('circleOfWillis — an absent A1 makes both frontal lobes depend on one carotid', () => {
  const absentA1 = () => withSegment(s => { s.a1.left = 'absent'; });

  it('names the OTHER carotid as the one that matters', () => {
    const pathway = assessCollateral(absentA1()).pathways.find(p =>
      p.consequence.includes('cerebrais anteriores')
    )!;
    expect(pathway.ifOccluded).toMatch(/carótida interna direita/);
    expect(pathway.consequence).toMatch(/infarto anterior bilateral/);
  });

  it('needs the AComA for the crossover to exist at all', () => {
    const noCrossover = withSegment(s => {
      s.a1.left = 'absent';
      s.acom = 'absent';
    });
    const bilateral = assessCollateral(noCrossover).pathways.filter(p =>
      p.consequence.includes('infarto anterior bilateral')
    );
    expect(bilateral).toHaveLength(0);
  });

  // The whole cross-flow goes through that one vessel.
  it('notes the anterior communicating aneurysm association', () => {
    const note = acomAneurysmNote(absentA1());
    expect(note.present).toBe(true);
    expect(note.message).toMatch(/associação clássica com aneurisma de comunicante anterior/);
  });

  it('says nothing about aneurysms on a symmetric circle', () => {
    expect(acomAneurysmNote(normal()).present).toBe(false);
  });

  it('says nothing when the AComA itself is absent', () => {
    expect(
      acomAneurysmNote(withSegment(s => { s.a1.left = 'absent'; s.acom = 'absent'; })).present
    ).toBe(false);
  });
});

describe('circleOfWillis — an absent AComA isolates the two anterior territories', () => {
  it('says each carotid holds its own side alone', () => {
    const pathway = assessCollateral(withSegment(s => { s.acom = 'absent'; })).pathways.find(p =>
      p.consequence.includes('cada carótida')
    )!;
    expect(pathway.ifOccluded).toMatch(/qualquer carótida/);
  });
});

describe('circleOfWillis — the report line', () => {
  it('stacks the variant, the consequence and the aneurysm note', () => {
    const text = describeWillis(withSegment(s => { s.a1.right = 'hypoplastic'; }));
    expect(text).toMatch(/A1 ausente ou hipoplásico/);
    expect(text).toMatch(/infarto anterior bilateral/);
    expect(text).toMatch(/aneurisma de comunicante anterior/);
  });

  it('reports multiple variants together', () => {
    const segments = withSegment(s => {
      s.p1.left = 'absent';
      s.a1.right = 'absent';
    });
    expect(classifyVariant(segments).variant).toBe('multipleVariants');
    expect(classifyVariant(segments).findings.length).toBeGreaterThan(1);
  });

  it('stays quiet on a complete circle', () => {
    expect(describeWillis(normal())).not.toMatch(/oclusão/);
  });
});
