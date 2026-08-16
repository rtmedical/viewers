import {
  buildImagingEvents,
  classifyImagingSeries,
  courseImagingTimeline,
  describeEvent,
  displayRules,
  doseAttribution,
  ImagingSeries,
  KIND_LABELS,
  KV_MAX_KVP,
  perFraction,
} from './imagingTimeline';

const T0 = 1_700_000_000_000;

const s = (over: Partial<ImagingSeries> = {}): ImagingSeries => ({
  seriesInstanceUid: `uid-${Math.abs(JSON.stringify(over).length)}-${over.acquiredAt ?? 0}`,
  modality: 'RTIMAGE',
  acquiredAt: T0,
  ...over,
});

describe('imagingTimeline — classify from attributes, never from the description', () => {
  it('reads a kV portal image from the tube voltage', () => {
    expect(classifyImagingSeries(s({ kvp: 120 })).kind).toBe('kv');
    expect(KV_MAX_KVP).toBe(160);
  });

  it('reads an MV portal image from the beam energy', () => {
    expect(classifyImagingSeries(s({ beamEnergyMv: 6 })).kind).toBe('mv');
  });

  it('reads a portal dose image from its dose units', () => {
    const result = classifyImagingSeries(s({ doseUnits: 'GY', beamEnergyMv: 6 }));
    expect(result.kind).toBe('portal-dose');
    expect(result.reason).toMatch(/mapa dosimétrico, não anatômico/);
  });

  it('reads a cine acquisition from its frame count', () => {
    expect(classifyImagingSeries(s({ numberOfFrames: 30, kvp: 120 })).kind).toBe('movie');
  });

  it('reads a CBCT from the cone-beam flag and a planning CT from its absence', () => {
    expect(classifyImagingSeries(s({ modality: 'CT', coneBeam: true })).kind).toBe('cbct');
    expect(classifyImagingSeries(s({ modality: 'CT', coneBeam: false })).kind).toBe('simulation');
  });

  it('honours a declared simulation intent above everything else', () => {
    expect(classifyImagingSeries(s({ kvp: 120, intent: 'simulation' })).kind).toBe('simulation');
  });

  // A site calling its protocol "Volume View" produces the same images as one calling it
  // "CBCT Pelve"; a classifier keyed on the string finds one and loses the other.
  it('ignores the series description entirely', () => {
    expect(classifyImagingSeries(s({ modality: 'CT', seriesDescription: 'CBCT Pelve' })).kind).toBe(
      'unknown'
    );
    expect(classifyImagingSeries(s({ kvp: 120, seriesDescription: 'CBCT setup' })).kind).toBe('kv');
  });

  // Defaulting into the most common bucket hides it somewhere plausible.
  it('returns unknown rather than guessing, and says what was missing', () => {
    const ct = classifyImagingSeries(s({ modality: 'CT' }));
    expect(ct.kind).toBe('unknown');
    expect(ct.reason).toMatch(/reportar uma aquisição volumétrica que não houve/);

    const rt = classifyImagingSeries(s({}));
    expect(rt.kind).toBe('unknown');
    expect(rt.reason).toMatch(/se a dose veio do tubo ou do acelerador/);
  });

  it('does not treat a plan or a record as verification imaging', () => {
    expect(classifyImagingSeries(s({ modality: 'RTPLAN' })).kind).toBe('unknown');
    expect(classifyImagingSeries(null as never).kind).toBe('unknown');
  });
});

describe('imagingTimeline — kV and MV are not two settings of one thing', () => {
  // Summing them produces a number that describes neither.
  it('attributes MV imaging to the treatment beam', () => {
    const result = doseAttribution('mv');
    expect(result.source).toBe('treatment-beam');
    expect(result.message).toMatch(/em energia terapêutica e no eixo do feixe/);
  });

  it('attributes kV and CBCT to the imaging burden', () => {
    expect(doseAttribution('kv').source).toBe('imaging-only');
    expect(doseAttribution('cbct').source).toBe('imaging-only');
  });

  it('attributes portal dose to the treatment beam as well', () => {
    expect(doseAttribution('portal-dose').source).toBe('treatment-beam');
  });

  it('attributes nothing for simulation or unknown', () => {
    expect(doseAttribution('simulation').source).toBe('none');
    expect(doseAttribution('unknown').message).toMatch(/somá-la a qualquer um dos lados seria inventar/);
  });
});

describe('imagingTimeline — a portal dose image is not a picture', () => {
  it('forbids an anatomical window and measurement on it', () => {
    const rules = displayRules('portal-dose');
    expect(rules.anatomicalWindow).toBe(false);
    expect(rules.measurable).toBe(false);
    expect(rules.note).toMatch(/parece apenas uma imagem portal mal janelada/);
  });

  it('allows both on an ordinary portal image', () => {
    expect(displayRules('mv')).toEqual({ anatomicalWindow: true, measurable: true, note: '' });
  });

  it('allows neither on an unknown one', () => {
    expect(displayRules('unknown').anatomicalWindow).toBe(false);
  });
});

describe('imagingTimeline — an image pair is one event', () => {
  const pair = [
    s({ seriesInstanceUid: 'a', kvp: 120, gantryAngleDeg: 0, acquiredAt: T0, fraction: 1 }),
    s({ seriesInstanceUid: 'b', kvp: 120, gantryAngleDeg: 90, acquiredAt: T0 + 20_000, fraction: 1 }),
  ];

  it('joins two orthogonal kV images acquired seconds apart', () => {
    const events = buildImagingEvents(pair);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('image-pair');
    expect(events[0].series).toHaveLength(2);
    expect(events[0].reason).toMatch(/uma única verificação de setup/);
  });

  // Listing them separately doubles the apparent imaging frequency.
  it('would otherwise double the per-fraction count', () => {
    expect(perFraction(buildImagingEvents(pair))[0].events).toBe(1);
  });

  it('does not pair images that are not orthogonal', () => {
    const notOrthogonal = [
      s({ seriesInstanceUid: 'a', kvp: 120, gantryAngleDeg: 0, acquiredAt: T0 }),
      s({ seriesInstanceUid: 'b', kvp: 120, gantryAngleDeg: 20, acquiredAt: T0 + 20_000 }),
    ];
    expect(buildImagingEvents(notOrthogonal)).toHaveLength(2);
  });

  it('does not pair across a long gap', () => {
    const apart = [
      s({ seriesInstanceUid: 'a', kvp: 120, gantryAngleDeg: 0, acquiredAt: T0 }),
      s({ seriesInstanceUid: 'b', kvp: 120, gantryAngleDeg: 90, acquiredAt: T0 + 3_600_000 }),
    ];
    expect(buildImagingEvents(apart)).toHaveLength(2);
  });

  it('does not pair a kV with an MV', () => {
    const mixed = [
      s({ seriesInstanceUid: 'a', kvp: 120, gantryAngleDeg: 0, acquiredAt: T0 }),
      s({ seriesInstanceUid: 'b', beamEnergyMv: 6, gantryAngleDeg: 90, acquiredAt: T0 + 10_000 }),
    ];
    expect(buildImagingEvents(mixed).map(e => e.kind)).toEqual(['kv', 'mv']);
  });

  it('treats 270 and 0 degrees as orthogonal', () => {
    const wrapped = [
      s({ seriesInstanceUid: 'a', kvp: 120, gantryAngleDeg: 270, acquiredAt: T0 }),
      s({ seriesInstanceUid: 'b', kvp: 120, gantryAngleDeg: 0, acquiredAt: T0 + 10_000 }),
    ];
    expect(buildImagingEvents(wrapped)[0].kind).toBe('image-pair');
  });

  it('leaves a CBCT alone', () => {
    const events = buildImagingEvents([s({ modality: 'CT', coneBeam: true, fraction: 3 })]);
    expect(events[0].kind).toBe('cbct');
  });
});

describe('imagingTimeline — simulation is not part of the course', () => {
  const events = buildImagingEvents([
    s({ seriesInstanceUid: 'sim', modality: 'CT', coneBeam: false, acquiredAt: T0 - 20 * 86_400_000 }),
    s({ seriesInstanceUid: 'cb', modality: 'CT', coneBeam: true, acquiredAt: T0, fraction: 1 }),
    s({ seriesInstanceUid: 'x', modality: 'CT', acquiredAt: T0 + 1000 }),
  ]);

  // On the treatment axis it makes the course appear to have started weeks earlier.
  it('keeps planning imaging off the treatment axis', () => {
    const timeline = courseImagingTimeline(events);
    expect(timeline.events.map(e => e.kind)).toEqual(['cbct']);
    expect(timeline.planning).toHaveLength(1);
    expect(timeline.message).toMatch(/semanas antes da primeira fração/);
  });

  it('lists the unclassified separately instead of hiding them', () => {
    const timeline = courseImagingTimeline(events);
    expect(timeline.unclassified).toHaveLength(1);
    expect(timeline.message).toMatch(/em vez de encaixada\(s\) no balde mais comum/);
  });

  it('counts nothing when there is nothing', () => {
    expect(courseImagingTimeline([]).message).toBe('0 evento(s) de imagem no curso.');
  });
});

describe('imagingTimeline — per fraction and the readout', () => {
  it('counts by fraction and by kind', () => {
    const events = buildImagingEvents([
      s({ seriesInstanceUid: 'a', kvp: 120, gantryAngleDeg: 0, acquiredAt: T0, fraction: 1 }),
      s({ seriesInstanceUid: 'b', kvp: 120, gantryAngleDeg: 90, acquiredAt: T0 + 10_000, fraction: 1 }),
      s({ seriesInstanceUid: 'c', modality: 'CT', coneBeam: true, acquiredAt: T0 + 86_400_000, fraction: 2 }),
    ]);
    const stats = perFraction(events);
    expect(stats.map(f => f.fraction)).toEqual([1, 2]);
    expect(stats[0].byKind['image-pair']).toBe(1);
    expect(stats[1].byKind.cbct).toBe(1);
  });

  it('skips events with no fraction', () => {
    expect(perFraction(buildImagingEvents([s({ kvp: 120 })]))).toEqual([]);
  });

  it('names the kind and the fraction', () => {
    const event = buildImagingEvents([s({ modality: 'CT', coneBeam: true, fraction: 4 })])[0];
    expect(describeEvent(event)).toBe(`${KIND_LABELS.cbct} · fração 4 — CT reconstruída de feixe cônico.`);
  });
});
