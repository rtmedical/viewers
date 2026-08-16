import {
  acquireRoadmap,
  applyRoadmap,
  checkRoadmap,
  describeRoadmap,
  FluoroFrame,
  FluoroGeometry,
  geometryChange,
  GEOMETRY_TOLERANCE,
  maskDrift,
  MASK_AGE_ADVISORY_MS,
  RoadmapState,
  shiftedMask,
  shiftMask,
} from './roadmap';

const T0 = 1_700_000_000_000;

const geometry = (over: Partial<FluoroGeometry> = {}): FluoroGeometry => ({
  tableLateralMm: 0,
  tableLongitudinalMm: 0,
  tableHeightMm: 900,
  primaryAngleDeg: 30,
  secondaryAngleDeg: 10,
  sourceToDetectorMm: 1100,
  fieldOfViewMm: 200,
  ...over,
});

const frame = (width: number, height: number, fill: (x: number, y: number) => number): FluoroFrame => {
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data[y * width + x] = fill(x, y);
    }
  }
  return { width, height, data };
};

const state = (over: Partial<RoadmapState> = {}): RoadmapState => ({
  ...acquireRoadmap({
    mask: frame(8, 8, () => 100),
    vesselMap: frame(8, 8, (x, y) => (x === 4 ? -50 : 0)),
    geometry: geometry(),
    acquiredAt: T0,
    offset: 0,
  }),
  ...over,
});

describe('roadmap — what changed, and whether it costs a new mask', () => {
  it('sees nothing when nothing moved', () => {
    expect(geometryChange(geometry(), geometry()).kind).toBe('none');
  });

  it('ignores sub-tolerance jitter in the reported geometry', () => {
    const change = geometryChange(
      geometry(),
      geometry({ tableLateralMm: 0.5, primaryAngleDeg: 30.2 })
    );
    expect(change.kind).toBe('none');
    expect(GEOMETRY_TOLERANCE.translationMm).toBe(1);
  });

  // Correctable by shift: no new contrast, no new dose.
  it('classifies an in-plane table pan as a translation', () => {
    const change = geometryChange(geometry(), geometry({ tableLongitudinalMm: 12 }));
    expect(change.kind).toBe('translation');
    expect(change.correctableByShift).toBe(true);
    expect(change.translationMm).toBeCloseTo(12, 6);
    expect(change.message).toMatch(/sem novo contraste nem nova dose/);
  });

  it.each([
    ['primaryAngleDeg', 35, 'angulação primária'],
    ['secondaryAngleDeg', 20, 'angulação secundária'],
    ['tableHeightMm', 950, 'altura da mesa'],
    ['sourceToDetectorMm', 1050, 'distância foco-detector'],
    ['fieldOfViewMm', 150, 'campo de visão'],
  ])('classifies a change of %s as a change of projection', (field, value, label) => {
    const change = geometryChange(geometry(), geometry({ [field]: value } as never));
    expect(change.kind).toBe('projection');
    expect(change.correctableByShift).toBe(false);
    expect(change.fields).toContain(label);
    expect(change.message).toMatch(/É preciso máscara nova/);
  });

  it('reports a pan combined with a rotation as a change of projection', () => {
    const change = geometryChange(
      geometry(),
      geometry({ tableLateralMm: 20, primaryAngleDeg: 40 })
    );
    expect(change.kind).toBe('projection');
    expect(change.fields).toContain('translação da mesa');
  });

  it('treats missing geometry as untrustworthy rather than unchanged', () => {
    expect(geometryChange(geometry(), null as never).kind).toBe('projection');
  });
});

describe('roadmap — validity is a decision, not a banner', () => {
  it('is valid while the geometry holds', () => {
    expect(checkRoadmap(state(), geometry(), T0 + 1000).valid).toBe(true);
  });

  it('is invalid the moment the C-arm rotates', () => {
    const validity = checkRoadmap(state(), geometry({ primaryAngleDeg: 45 }), T0 + 1000);
    expect(validity.valid).toBe(false);
    expect(validity.reason).toMatch(/máscara nova/);
  });

  // Slow patient motion never shows up in the table geometry.
  it('advises on an old mask without invalidating it', () => {
    const validity = checkRoadmap(state(), geometry(), T0 + MASK_AGE_ADVISORY_MS + 60_000);
    expect(validity.valid).toBe(true);
    expect(validity.advisories.join(' ')).toMatch(/Movimento lento do paciente/);
  });
});

describe('roadmap — refusing to render is the point', () => {
  const live = frame(8, 8, () => 120);

  it('subtracts the mask from the live frame', () => {
    const result = applyRoadmap(state(), live, geometry(), T0 + 1000);
    expect(result.ok).toBe(true);
    expect(result.frame!.data[0]).toBeCloseTo(20, 6);
  });

  // A banner over a plausible overlay is read after the wire has already gone somewhere.
  it('returns no image at all once the geometry changed', () => {
    const result = applyRoadmap(state(), live, geometry({ tableHeightMm: 940 }), T0 + 1000);
    expect(result.ok).toBe(false);
    expect(result.frame).toBeNull();
    expect(result.reason).toMatch(/a projeção em si mudou/);
  });

  it('burns the vessel map into the unsubtracted live frame in overlay mode', () => {
    const result = applyRoadmap(state(), live, geometry(), T0 + 1000, 'overlay');
    expect(result.ok).toBe(true);
    // Column 4 is opacified by 50; everywhere else the live frame is untouched.
    expect(result.frame!.data[4]).toBeCloseTo(70, 6);
    expect(result.frame!.data[0]).toBeCloseTo(120, 6);
  });

  it('honours overlay strength', () => {
    const result = applyRoadmap(state(), live, geometry(), T0 + 1000, 'overlay', {
      overlayStrength: 0.5,
    });
    expect(result.frame!.data[4]).toBeCloseTo(95, 6);
  });

  it('refuses overlay without a captured vessel map', () => {
    const result = applyRoadmap(
      state({ vesselMap: null }),
      live,
      geometry(),
      T0 + 1000,
      'overlay'
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Sem mapa vascular capturado/);
  });

  it('negates the subtracted frame about the offset', () => {
    const plain = applyRoadmap(state(), live, geometry(), T0 + 1000);
    const negated = applyRoadmap(state(), live, geometry(), T0 + 1000, 'subtracted', {
      negate: true,
    });
    expect(negated.frame!.data[0]).toBeCloseTo(-plain.frame!.data[0], 6);
  });

  it('refuses mismatched dimensions', () => {
    expect(applyRoadmap(state(), frame(4, 4, () => 1), geometry(), T0).ok).toBe(false);
  });
});

describe('roadmap — re-registration by shift, and where it must not be used', () => {
  it('translates the mask', () => {
    const shifted = shiftedMask({ ...state(), shift: [2, 0], mask: frame(4, 2, x => x) });
    // Row 0 was 0,1,2,3; shifted right by two it is offset,offset,0,1.
    expect(Array.from(shifted.data.slice(0, 4))).toEqual([0, 0, 0, 1]);
  });

  it('records the shift on the state', () => {
    const change = geometryChange(geometry(), geometry({ tableLateralMm: 8 }));
    const result = shiftMask(state(), change, 3, -2);
    expect(result.ok).toBe(true);
    expect(result.state.shift).toEqual([3, -2]);
  });

  // Locally convincing, globally wrong — more dangerous than an obviously stale overlay.
  it('refuses to shift over a change of projection', () => {
    const change = geometryChange(geometry(), geometry({ primaryAngleDeg: 45 }));
    const result = shiftMask(state(), change, 3, -2);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/alinha uma região e desalinha o resto/);
  });

  it('leaves the mask untouched at zero shift', () => {
    const s = state();
    expect(shiftedMask(s)).toBe(s.mask);
  });
});

describe('roadmap — image drift is a secondary check and says so', () => {
  it('correlates perfectly with itself', () => {
    const s = state({ mask: frame(8, 8, (x, y) => x * y) });
    expect(maskDrift(s, s.mask).correlation).toBeCloseTo(1, 10);
  });

  it('drops when the scene shifts', () => {
    const s = state({ mask: frame(16, 16, x => (x < 8 ? 0 : 100)) });
    const moved = frame(16, 16, x => (x < 12 ? 0 : 100));
    const drift = maskDrift(s, moved);
    expect(drift.correlation).toBeLessThan(1);
    expect(drift.suspected).toBe(true);
  });

  // A guidewire crossing the field lowers it without any patient motion.
  it('labels itself weak and defers to the geometry', () => {
    const s = state({ mask: frame(16, 16, x => (x < 8 ? 0 : 100)) });
    const moved = frame(16, 16, x => (x < 12 ? 0 : 100));
    expect(maskDrift(s, moved).message).toMatch(/Sinal fraco.*Confirme pela geometria/s);
  });

  it('refuses a frame with no variation rather than dividing by zero', () => {
    const s = state();
    expect(Number.isNaN(maskDrift(s, frame(8, 8, () => 5)).correlation)).toBe(true);
  });

  it('refuses mismatched frames', () => {
    expect(maskDrift(state(), frame(4, 4, () => 1)).message).toMatch(/incomparáveis/);
  });
});

describe('roadmap — the readout', () => {
  it('says active when it is', () => {
    expect(describeRoadmap(checkRoadmap(state(), geometry(), T0 + 1))).toBe('Roadmap ativo.');
  });

  it('says why it was invalidated', () => {
    expect(
      describeRoadmap(checkRoadmap(state(), geometry({ fieldOfViewMm: 150 }), T0 + 1))
    ).toMatch(/^Roadmap invalidado: Mudou campo de visão/);
  });
});
