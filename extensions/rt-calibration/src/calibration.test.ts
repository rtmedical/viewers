import {
  auditCalibration,
  Calibration,
  calibrationStillValid,
  deriveCalibration,
  describeCalibration,
  IMPLAUSIBLE_RATIO,
  magnificationCaveat,
  PHANTOMS,
  PROJECTION_MODALITIES,
  resolveCalibration,
  SUSPICIOUS_RATIO,
} from './calibration';

const T0 = 1_700_000_000_000;

const base = {
  id: 'cal-1',
  phantomId: 'ball-25',
  measuredPixels: 100,
  scope: 'sop' as const,
  studyInstanceUid: '1.2.study',
  seriesInstanceUid: '1.2.series',
  sopInstanceUid: '1.2.sop',
  modality: 'XA',
  createdBy: 'tec.silva',
  createdAt: T0,
};

describe('calibration — a wrong known length is unfalsifiable from inside', () => {
  it('derives mm per pixel from a catalogued reference', () => {
    const result = deriveCalibration(base);
    expect(result.ok).toBe(true);
    expect(result.calibration!.mmPerPixel).toBeCloseTo(0.254, 6);
  });

  // The free-text field is where the undetectable error gets typed.
  it('refuses a reference outside the catalogue and says why that matters', () => {
    const result = deriveCalibration({ ...base, phantomId: 'régua do consultório' });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/toda medida exatamente ao dobro, e perfeitamente coerente consigo mesma/);
  });

  // A clean, self-consistent, wildly wrong scale.
  it('refuses a factor no geometry could produce', () => {
    const result = deriveCalibration({ ...base, phantomId: 'ball-50', storedSpacingMm: 0.2 });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Nenhuma geometria real produz esse fator/);
    expect(IMPLAUSIBLE_RATIO).toBe(2);
  });

  it('warns on a factor that is possible but large', () => {
    const result = deriveCalibration({ ...base, storedSpacingMm: 0.254 / 1.5 });
    expect(result.ok).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/possível pela ampliação; fora dela, confira o traço/);
    expect(SUSPICIOUS_RATIO).toBeLessThan(IMPLAUSIBLE_RATIO);
  });

  it('refuses a measurement of zero pixels, no author and no study', () => {
    expect(deriveCalibration({ ...base, measuredPixels: 0 }).ok).toBe(false);
    expect(deriveCalibration({ ...base, createdBy: '' }).ok).toBe(false);
    expect(deriveCalibration({ ...base, studyInstanceUid: '' }).ok).toBe(false);
  });

  it('offers a catalogue with known tolerances', () => {
    expect(PHANTOMS['ball-25'].knownLengthMm).toBeCloseTo(25.4, 6);
    expect(PHANTOMS['grid-100'].tolerance).toBeGreaterThan(0);
  });
});

describe('calibration — overriding a valid spacing', () => {
  // Changing the ruler for every measurement that follows.
  it('warns when a cross-sectional image already had one and no reason was given', () => {
    const result = deriveCalibration({ ...base, modality: 'CT', storedSpacingMm: 0.25 });
    expect(result.warnings.join(' ')).toMatch(/troca a régua de todas as medidas seguintes/);
  });

  it('is quiet once a reason is recorded', () => {
    const result = deriveCalibration({
      ...base,
      modality: 'CT',
      storedSpacingMm: 0.25,
      reason: 'Espaçamento do cabeçalho conflita com o phantom',
    });
    expect(result.warnings.join(' ')).not.toMatch(/troca a régua/);
  });

  it('does not warn for projection imaging, where the stored spacing is at the detector', () => {
    const result = deriveCalibration({ ...base, modality: 'XA', storedSpacingMm: 0.25 });
    expect(result.warnings.join(' ')).not.toMatch(/troca a régua/);
    expect(PROJECTION_MODALITIES).toContain('XA');
  });
});

describe('calibration — one scale is right in one plane', () => {
  // A property of projecting a cone onto a plane, not a defect to be fixed.
  it('states the magnification caveat for projection imaging', () => {
    const note = magnificationCaveat('XA');
    expect(note.applies).toBe(true);
    expect(note.message).toMatch(/é propriedade da projeção, não defeito a corrigir/);
  });

  it('does not apply it to cross-sectional imaging', () => {
    expect(magnificationCaveat('CT').applies).toBe(false);
  });

  it('carries the caveat into the derivation warnings', () => {
    expect(deriveCalibration(base).warnings.join(' ')).toMatch(/vale no plano onde o phantom estava/);
  });
});

describe('calibration — scope is a decision, never a default', () => {
  it('requires the identifier the scope refers to', () => {
    const result = deriveCalibration({ ...base, scope: 'series', seriesInstanceUid: '' });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/exige o identificador correspondente/);
  });

  // It was only ever measured on one image.
  it('warns loudly about a study-wide calibration', () => {
    const result = deriveCalibration({ ...base, scope: 'study' });
    expect(result.warnings.join(' ')).toMatch(/outra distância, outro campo de visão ou outro detector/);
  });

  const store: Calibration[] = [
    deriveCalibration({ ...base, id: 'study-cal', scope: 'study' }).calibration!,
    deriveCalibration({ ...base, id: 'series-cal', scope: 'series' }).calibration!,
    deriveCalibration({ ...base, id: 'sop-cal', scope: 'sop' }).calibration!,
  ];

  it('prefers the narrowest calibration that covers the image', () => {
    const result = resolveCalibration(store, {
      studyInstanceUid: '1.2.study',
      seriesInstanceUid: '1.2.series',
      sopInstanceUid: '1.2.sop',
    });
    expect(result.calibration!.id).toBe('sop-cal');
    expect(result.via).toBe('sop');
  });

  it('falls back to series, then study', () => {
    expect(
      resolveCalibration(store, { studyInstanceUid: '1.2.study', seriesInstanceUid: '1.2.series' }).via
    ).toBe('series');
    expect(resolveCalibration(store, { studyInstanceUid: '1.2.study' }).via).toBe('study');
  });

  it('says out loud when a study-level one is being used', () => {
    expect(resolveCalibration(store, { studyInstanceUid: '1.2.study' }).message).toMatch(
      /aplicada a todas, incluindo as de outra geometria/
    );
  });

  it('prefers the newest at the same scope', () => {
    const newer = deriveCalibration({ ...base, id: 'sop-newer', createdAt: T0 + 1000 }).calibration!;
    expect(
      resolveCalibration([...store, newer], { studyInstanceUid: '1.2.study', sopInstanceUid: '1.2.sop' })
        .calibration!.id
    ).toBe('sop-newer');
  });

  it('finds nothing when nothing covers the image', () => {
    expect(resolveCalibration(store, { studyInstanceUid: 'outro' }).calibration).toBeNull();
  });
});

describe('calibration — the geometry it was measured at is part of it', () => {
  const withGeometry = deriveCalibration({
    ...base,
    geometry: { sourceToDetectorMm: 1000, tableHeightMm: 900, fieldOfViewMm: 200 },
  }).calibration!;

  it('is valid at the same geometry', () => {
    expect(
      calibrationStillValid(withGeometry, { sourceToDetectorMm: 1002, tableHeightMm: 901, fieldOfViewMm: 200 })
        .valid
    ).toBe(true);
  });

  // A plausible wrong ruler is used without question.
  it('refuses after the field of view changed', () => {
    const check = calibrationStillValid(withGeometry, { fieldOfViewMm: 150 });
    expect(check.valid).toBe(false);
    expect(check.message).toMatch(/descreve uma cena que não existe mais/);
  });

  it('names every field that moved', () => {
    const check = calibrationStillValid(withGeometry, { sourceToDetectorMm: 1100, tableHeightMm: 950 });
    expect(check.changed).toEqual(['distância foco-detector', 'altura da mesa']);
  });

  it('says so when no geometry was recorded', () => {
    const bare = deriveCalibration(base).calibration!;
    expect(calibrationStillValid(bare, { fieldOfViewMm: 100 }).message).toMatch(
      /não há como saber se ela ainda vale/
    );
  });
});

describe('calibration — the audit', () => {
  // Only re-checkable if both rulers are on record.
  it('records the spacing that was replaced, not only the new one', () => {
    const calibration = deriveCalibration({ ...base, storedSpacingMm: 0.3 }).calibration!;
    const audit = auditCalibration(calibration);
    expect(audit.replacedSpacingMm).toBeCloseTo(0.3, 6);
    expect(audit.message).toMatch(/substituindo 0\.3000 mm\/px/);
  });

  it('names who, what scope and which phantom', () => {
    const audit = auditCalibration(deriveCalibration(base).calibration!);
    expect(audit.message).toMatch(/^tec\.silva calibrou esta imagem em 0\.2540 mm\/px com Esfera de 25,4 mm\./);
  });
});

describe('calibration — the dialog line', () => {
  it('states the scale, the scope and the caveats', () => {
    const line = describeCalibration(deriveCalibration(base));
    expect(line).toMatch(/^0\.2540 mm\/px para esta imagem\./);
    expect(line).toMatch(/plano onde o phantom estava/);
  });

  it('shows the refusal when there was one', () => {
    expect(describeCalibration(deriveCalibration({ ...base, phantomId: 'x' }))).toMatch(/fora do catálogo/);
  });
});
