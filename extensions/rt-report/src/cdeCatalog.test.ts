import {
  CdeCatalogue,
  CdeElement,
  convertToElementUnit,
  describeIssues,
  findElement,
  ObservationLike,
  validateCardinality,
  validateCatalogue,
  validateObservation,
} from './cdeCatalog';

const SIZE: CdeElement = {
  id: 'RDE1301',
  system: 'http://radelement.org',
  version: '2024-01',
  name: 'Diâmetro do nódulo',
  valueType: 'quantity',
  unit: 'mm',
  cardinality: { min: 1, max: 1 },
  range: { min: 0, max: 200 },
};

const TEXTURE: CdeElement = {
  id: 'RDE1302',
  system: 'http://radelement.org',
  version: '2024-01',
  name: 'Textura do nódulo',
  valueType: 'coded',
  permittedValues: [
    { code: 'solid', display: 'Sólido' },
    { code: 'partSolid', display: 'Parcialmente sólido' },
    { code: 'ggo', display: 'Vidro fosco' },
    { code: 'calcified', display: 'Calcificado', retired: true },
  ],
  cardinality: { min: 1, max: 1 },
};

const LESION: CdeElement = {
  id: 'RDE9001',
  system: 'http://radelement.org',
  version: '2024-01',
  name: 'Lesão',
  valueType: 'text',
  cardinality: { min: 0, max: 10 },
};

const CATALOGUE: CdeCatalogue = { elements: [SIZE, TEXTURE, LESION] };

const quantity = (value: number, unit = 'mm', version = '2024-01'): ObservationLike => ({
  concept: { system: SIZE.system, code: SIZE.id, systemVersion: version },
  value: { kind: 'quantity', value, unit },
});

const coded = (code: string): ObservationLike => ({
  concept: { system: TEXTURE.system, code: TEXTURE.id, systemVersion: '2024-01' },
  value: { kind: 'coded', value: { system: TEXTURE.system, code } },
});

describe('cdeCatalog — lookup', () => {
  it('finds an element case-insensitively', () => {
    expect(findElement(CATALOGUE, 'HTTP://RADELEMENT.ORG', 'rde1301')!.name).toBe(SIZE.name);
  });

  it('returns undefined for an unknown element', () => {
    expect(findElement(CATALOGUE, SIZE.system, 'RDE9999')).toBeUndefined();
  });

  it('reports an observation against an element nobody has', () => {
    const issues = validateObservation(
      { concept: { system: 'x', code: 'y' }, value: { kind: 'text', value: 'a' } },
      CATALOGUE
    );
    expect(issues[0].code).toBe('unknownElement');
    expect(issues[0].severity).toBe('error');
  });
});

describe('cdeCatalog — the unit mismatch is the silent one', () => {
  it('accepts a value in the element unit', () => {
    expect(validateObservation(quantity(8), CATALOGUE)).toEqual([]);
  });

  // Both are numbers, both are plausible nodule sizes, and nothing about the record looks
  // broken.
  it('REJECTS centimetres against a millimetre element instead of converting', () => {
    const issues = validateObservation(quantity(0.8, 'cm'), CATALOGUE);
    const issue = issues.find(i => i.code === 'unitMismatch')!;
    expect(issue.severity).toBe('error');
    expect(issue.message).toMatch(/diferença de fator, não de formatação/);
  });

  // A silent unit conversion is the same failure arrived at from the other direction.
  it('converts only when asked, and reports the factor', () => {
    const result = convertToElementUnit(0.8, 'cm', SIZE);
    expect(result.ok).toBe(true);
    expect(result.value).toBeCloseTo(8, 9);
    expect(result.factor).toBe(10);
    expect(result.converted).toBe(true);
  });

  it('reports no conversion when the units already match', () => {
    const result = convertToElementUnit(8, 'mm', SIZE);
    expect(result.converted).toBe(false);
    expect(result.factor).toBe(1);
  });

  // A general converter invites a conversion between units that are not the same physical
  // quantity, and the failure looks like a plausible number.
  it('REFUSES a conversion it does not know', () => {
    const result = convertToElementUnit(8, 'HU', SIZE);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/podem nem ser a mesma grandeza física/);
  });

  it('refuses a non-numeric value or an element with no unit', () => {
    expect(convertToElementUnit(NaN, 'mm', SIZE).ok).toBe(false);
    expect(convertToElementUnit(8, 'mm', { ...SIZE, unit: '' }).ok).toBe(false);
  });
});

describe('cdeCatalog — value type, value set and range', () => {
  it('rejects the wrong value type and stops there', () => {
    const issues = validateObservation(
      { concept: { system: SIZE.system, code: SIZE.id }, value: { kind: 'text', value: '8 mm' } },
      CATALOGUE
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('wrongValueType');
  });

  it('accepts a permitted code', () => {
    expect(validateObservation(coded('solid'), CATALOGUE)).toEqual([]);
  });

  it('rejects a code outside the value set', () => {
    expect(validateObservation(coded('cavitary'), CATALOGUE)[0].code).toBe('valueNotPermitted');
  });

  it('warns rather than rejecting a retired code, which is still resolvable', () => {
    const issue = validateObservation(coded('calcified'), CATALOGUE)[0];
    expect(issue.code).toBe('retiredValue');
    expect(issue.severity).toBe('warning');
    expect(issue.message).toMatch(/não deve ser selecionado em laudo novo/);
  });

  it('warns about a value outside the plausible range', () => {
    const issue = validateObservation(quantity(900), CATALOGUE).find(i => i.code === 'outOfRange')!;
    expect(issue.severity).toBe('warning');
  });
});

describe('cdeCatalog — a value set has a version', () => {
  // Accepts something that will be rejected downstream, months later, by a system with the
  // current release.
  it('warns when the observation was recorded against another version', () => {
    const issue = validateObservation(quantity(8, 'mm', '2023-06'), CATALOGUE).find(
      i => i.code === 'versionMismatch'
    )!;
    expect(issue.severity).toBe('warning');
    expect(issue.message).toMatch(/Valores permitidos podem ter mudado/);
  });

  it('says nothing when the versions agree', () => {
    expect(validateObservation(quantity(8, 'mm', '2024-01'), CATALOGUE)).toEqual([]);
  });

  it('says nothing when the observation recorded no version', () => {
    expect(
      validateObservation(
        { concept: { system: SIZE.system, code: SIZE.id }, value: { kind: 'quantity', value: 8, unit: 'mm' } },
        CATALOGUE
      )
    ).toEqual([]);
  });
});

describe('cdeCatalog — cardinality', () => {
  // Surfaces as "the last one wins" somewhere unpredictable.
  it('rejects a single-valued element appearing twice', () => {
    const issues = validateCardinality([quantity(8), quantity(9)], CATALOGUE);
    expect(issues[0].code).toBe('cardinalityAboveMax');
    expect(issues[0].message).toMatch(/"a última vence" em silêncio/);
  });

  it('accepts a repeating element repeating', () => {
    const lesion: ObservationLike = {
      concept: { system: LESION.system, code: LESION.id },
      value: { kind: 'text', value: 'a' },
    };
    expect(validateCardinality([lesion, lesion, lesion], CATALOGUE)).toEqual([]);
  });

  it('reports a required element that was not filled', () => {
    const issues = validateCardinality([], CATALOGUE, ['RDE1301']);
    expect(issues[0].code).toBe('cardinalityBelowMin');
    expect(issues[0].message).toMatch(/Diâmetro do nódulo/);
  });

  it('is satisfied when it was', () => {
    expect(validateCardinality([quantity(8)], CATALOGUE, ['RDE1301'])).toEqual([]);
  });

  it('ignores observations against elements the catalogue does not have', () => {
    const stranger: ObservationLike = {
      concept: { system: 'x', code: 'y' },
      value: { kind: 'text', value: 'a' },
    };
    expect(validateCardinality([stranger, stranger], CATALOGUE)).toEqual([]);
  });
});

describe('cdeCatalog — the catalogue itself', () => {
  it('passes a well-formed one', () => {
    expect(validateCatalogue(CATALOGUE)).toEqual([]);
  });

  // Worse than a missing element, which at least fails loudly.
  it('catches a quantity element with no unit, which would validate any number', () => {
    const issues = validateCatalogue({ elements: [{ ...SIZE, unit: '' }] });
    expect(issues[0].message).toMatch(/validaria qualquer número/);
  });

  it('catches a coded element with no value set', () => {
    const issues = validateCatalogue({ elements: [{ ...TEXTURE, permittedValues: [] }] });
    expect(issues[0].message).toMatch(/validaria qualquer código/);
  });

  it('catches a duplicate, a missing version and a broken cardinality', () => {
    const issues = validateCatalogue({
      elements: [SIZE, SIZE, { ...LESION, version: '' }, { ...LESION, id: 'X', cardinality: { min: 3, max: 1 } }],
    });
    expect(issues.some(i => i.message.includes('duplicado'))).toBe(true);
    expect(issues.some(i => i.message.includes('versão'))).toBe(true);
    expect(issues.some(i => i.message.includes('Cardinalidade'))).toBe(true);
  });

  it('summarises errors and warnings separately', () => {
    const text = describeIssues([
      ...validateObservation(quantity(0.8, 'cm'), CATALOGUE),
      ...validateObservation(coded('calcified'), CATALOGUE),
    ]);
    expect(text).toMatch(/1 erro\(s\)/);
    expect(text).toMatch(/1 aviso\(s\)/);
    expect(describeIssues([])).toBe('Sem problemas de validação CDE.');
  });
});
