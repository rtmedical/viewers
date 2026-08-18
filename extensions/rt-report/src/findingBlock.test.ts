/**
 * RTV-226 -- tests for the structured findings core.
 *
 * The interesting cases here are not the happy paths: they are the pairs of surfaces that
 * each look correct alone (prose vs coded value) and the refusals that keep a divergent or
 * invented value out of the signed report.
 */

import {
  FINDING_MM_PER_CM,
  FINDING_REFUSAL_CODES,
  FindingBlock,
  FindingCdeDefinition,
  FindingProvenance,
  FindingUnit,
  findingApplyFreeTextFallback,
  findingBindEnumerated,
  findingBindMeasurement,
  findingCanExportCodedValue,
  findingCompareBlock,
  findingConfirmProposal,
  findingCreateBlock,
  findingDescribeBlock,
  findingDetectOrphans,
  findingFormatMagnitude,
  findingIsCdeFilled,
  findingIsOk,
  findingListAllowedValues,
  findingParseProseMeasurements,
  findingRenderStructureAsProse,
  findingValidateForSignature,
} from './findingBlock';

const NOW = 1700000000000;
const LATER = 1700000060000;

const SIZE_CDE: FindingCdeDefinition = {
  cdeId: 'RDE1301',
  label: 'Diametro do nodulo',
  kind: 'measurement',
};

const RADS_CDE: FindingCdeDefinition = {
  cdeId: 'RDE1705',
  label: 'Categoria Lung-RADS',
  kind: 'enumerated',
  allowedValues: [
    { code: 'LR2', label: 'Lung-RADS 2', synonyms: ['categoria 2'] },
    { code: 'LR4A', label: 'Lung-RADS 4A', synonyms: ['categoria 4A'] },
  ],
};

function measurementBlock(
  prose: string,
  magnitude: number,
  unit: FindingUnit,
  provenance: FindingProvenance = 'human-typed',
  blockId = 'b1'
): FindingBlock {
  return {
    blockId,
    cde: SIZE_CDE,
    value: { kind: 'measurement', magnitude, unit },
    prose,
    proseAnchorPresent: true,
    provenance,
    updatedAt: NOW,
  };
}

function radsBlock(
  prose: string,
  code: string,
  label: string,
  provenance: FindingProvenance = 'human-typed',
  blockId = 'b2'
): FindingBlock {
  return {
    blockId,
    cde: RADS_CDE,
    value: { kind: 'enumerated', code, label },
    prose,
    proseAnchorPresent: true,
    provenance,
    updatedAt: NOW,
  };
}

describe('findingParseProseMeasurements', () => {
  it('reads an integer measurement with its unit', () => {
    const found = findingParseProseMeasurements('Nodulo de 8 mm no lobo superior direito.');
    expect(found.length).toBe(1);
    expect(found[0].magnitude).toBe(8);
    expect(found[0].unit).toBe('mm');
    expect(found[0].raw).toBe('8 mm');
  });

  it('reads the Brazilian decimal comma', () => {
    const found = findingParseProseMeasurements('Lesao medindo 1,5 cm no segmento VIII.');
    expect(found.length).toBe(1);
    expect(found[0].magnitude).toBe(1.5);
    expect(found[0].unit).toBe('cm');
  });

  it('reads a unit glued to the number', () => {
    const found = findingParseProseMeasurements('Nodulo de 8mm.');
    expect(found[0].unit).toBe('mm');
    expect(found[0].raw).toBe('8mm');
  });

  // FM-3: a bare number in the prose must be reported as unitless, never defaulted to mm.
  it('reports unit null for a bare number', () => {
    const found = findingParseProseMeasurements('Lesao medindo 1,5 no segmento VIII.');
    expect(found.length).toBe(1);
    expect(found[0].unit).toBe(null);
  });

  // Vertebral levels and CDE ids are digits glued to letters. Reading "T12" as a 12 mm
  // lesion would produce a confident diameter that matches nothing a human wrote.
  it('ignores digits glued to letters (T12, RDE818)', () => {
    expect(findingParseProseMeasurements('Fratura de T12 sem desvio.').length).toBe(0);
    expect(findingParseProseMeasurements('Vinculado ao RDE818.').length).toBe(0);
  });

  it('returns an empty list for prose without numbers', () => {
    expect(findingParseProseMeasurements('Nodulo no lobo superior direito.')).toEqual([]);
    expect(findingParseProseMeasurements('')).toEqual([]);
  });
});

describe('findingRenderStructureAsProse / findingFormatMagnitude', () => {
  it('renders the coded value with a comma decimal and its unit', () => {
    expect(findingFormatMagnitude(1.5)).toBe('1,5');
    expect(findingRenderStructureAsProse({ kind: 'measurement', magnitude: 1.5, unit: 'cm' })).toBe(
      '1,5 cm'
    );
  });

  it('renders an enumerated label and an empty CDE', () => {
    expect(
      findingRenderStructureAsProse({ kind: 'enumerated', code: 'LR4A', label: 'Lung-RADS 4A' })
    ).toBe('Lung-RADS 4A');
    expect(findingRenderStructureAsProse(null)).toBe('');
  });

  it('exposes the cm to mm factor used for cross-unit comparison', () => {
    expect(FINDING_MM_PER_CM).toBe(10);
  });
});

describe('findingBindMeasurement', () => {
  it('binds a measurement that carries its unit', () => {
    const bound = findingBindMeasurement(SIZE_CDE, 8, 'mm');
    expect(findingIsOk(bound)).toBe(true);
    if (findingIsOk(bound)) {
      expect(bound.value).toEqual({ kind: 'measurement', magnitude: 8, unit: 'mm' });
    }
  });

  // FM-3: "1,5" with no unit is 1,5 mm or 1,5 cm depending on nothing. Refuse, do not guess.
  it('refuses a numeric binding without a unit and names the tenfold ambiguity', () => {
    const bound = findingBindMeasurement(SIZE_CDE, 1.5, null);
    expect(bound.ok).toBe(false);
    if (!bound.ok) {
      expect(bound.code).toBe(FINDING_REFUSAL_CODES.missingUnit);
      expect(bound.reason).toContain('unidade');
      expect(bound.reason).toContain('1,5 mm');
      expect(bound.reason).toContain('1,5 cm');
    }
  });

  // A negative or non-finite magnitude is always a parsing accident; stored, it becomes a
  // lesion size that no future measurement can ever match.
  it('refuses a non-positive or non-finite magnitude', () => {
    const negative = findingBindMeasurement(SIZE_CDE, -8, 'mm');
    const notANumber = findingBindMeasurement(SIZE_CDE, NaN, 'mm');
    expect(negative.ok).toBe(false);
    expect(notANumber.ok).toBe(false);
    if (!negative.ok) {
      expect(negative.code).toBe(FINDING_REFUSAL_CODES.invalidMagnitude);
    }
  });

  it('refuses a numeric binding on an enumerated CDE', () => {
    const bound = findingBindMeasurement(RADS_CDE, 4, 'mm');
    expect(bound.ok).toBe(false);
    if (!bound.ok) {
      expect(bound.code).toBe(FINDING_REFUSAL_CODES.wrongCdeKind);
    }
  });
});

describe('findingBindEnumerated', () => {
  it('binds an exact allowed label regardless of case and accents', () => {
    const bound = findingBindEnumerated(RADS_CDE, 'lung-rads 4a');
    expect(findingIsOk(bound)).toBe(true);
    if (findingIsOk(bound)) {
      expect(bound.value.code).toBe('LR4A');
      expect(bound.value.label).toBe('Lung-RADS 4A');
    }
  });

  it('binds a declared synonym and the raw code', () => {
    const bySynonym = findingBindEnumerated(RADS_CDE, 'categoria 2');
    const byCode = findingBindEnumerated(RADS_CDE, 'LR2');
    expect(findingIsOk(bySynonym)).toBe(true);
    expect(findingIsOk(byCode)).toBe(true);
    if (findingIsOk(bySynonym) && findingIsOk(byCode)) {
      expect(bySynonym.value.code).toBe('LR2');
      expect(byCode.value.label).toBe('Lung-RADS 2');
    }
  });

  // FM-2: coercing free prose into the nearest member of a closed value set invents a
  // category the radiologist never asserted, and the guess is untraceable after export.
  it('refuses to coerce free prose into the nearest allowed value', () => {
    const bound = findingBindEnumerated(RADS_CDE, 'moderadamente aumentado');
    expect(bound.ok).toBe(false);
    if (!bound.ok) {
      expect(bound.code).toBe(FINDING_REFUSAL_CODES.enumeratedNoExactMatch);
      expect(bound.reason).toContain('texto livre');
      expect(bound.reason).toContain('Lung-RADS 4A');
      expect(bound.problems).toEqual(['Lung-RADS 2', 'Lung-RADS 4A']);
    }
  });

  // Partial overlap must not be treated as a match: "Lung-RADS" alone is not a category.
  it('refuses a prefix that is not a complete allowed value', () => {
    const bound = findingBindEnumerated(RADS_CDE, 'Lung-RADS');
    expect(bound.ok).toBe(false);
  });

  it('refuses when the CDE has no value set at all', () => {
    const broken: FindingCdeDefinition = {
      cdeId: 'RDE9999',
      label: 'Sem conjunto',
      kind: 'enumerated',
    };
    const bound = findingBindEnumerated(broken, 'qualquer coisa');
    expect(bound.ok).toBe(false);
    if (!bound.ok) {
      expect(bound.code).toBe(FINDING_REFUSAL_CODES.noValueSet);
    }
  });

  it('lists the allowed labels so the UI can offer an explicit choice', () => {
    expect(findingListAllowedValues(RADS_CDE)).toEqual(['Lung-RADS 2', 'Lung-RADS 4A']);
    expect(findingListAllowedValues(SIZE_CDE)).toEqual([]);
  });
});

describe('findingCreateBlock', () => {
  it('creates a bound measurement block stamped with the injected time', () => {
    const created = findingCreateBlock(
      {
        blockId: 'b1',
        cde: SIZE_CDE,
        prose: 'Nodulo de 8 mm no lobo superior direito.',
        provenance: 'human-typed',
        magnitude: 8,
        unit: 'mm',
      },
      NOW
    );
    expect(findingIsOk(created)).toBe(true);
    if (findingIsOk(created)) {
      expect(created.value.updatedAt).toBe(NOW);
      expect(created.value.value).toEqual({ kind: 'measurement', magnitude: 8, unit: 'mm' });
      expect(created.value.proseAnchorPresent).toBe(true);
    }
  });

  // The unit guard must not be bypassable through the block factory.
  it('propagates the missing-unit refusal and points at the block', () => {
    const created = findingCreateBlock(
      {
        blockId: 'b1',
        cde: SIZE_CDE,
        prose: 'Nodulo de 1,5 no lobo medio.',
        provenance: 'human-typed',
        magnitude: 1.5,
      },
      NOW
    );
    expect(created.ok).toBe(false);
    if (!created.ok) {
      expect(created.code).toBe(FINDING_REFUSAL_CODES.missingUnit);
      expect(created.blockIds).toEqual(['b1']);
    }
  });

  it('refuses a block without an identifier', () => {
    const created = findingCreateBlock(
      { blockId: '   ', cde: SIZE_CDE, prose: 'Nodulo.', provenance: 'human-typed' },
      NOW
    );
    expect(created.ok).toBe(false);
    if (!created.ok) {
      expect(created.code).toBe(FINDING_REFUSAL_CODES.missingBlockId);
    }
  });

  it('leaves the CDE empty when no value is supplied', () => {
    const created = findingCreateBlock(
      { blockId: 'b3', cde: RADS_CDE, prose: 'Nodulo indeterminado.', provenance: 'human-typed' },
      NOW
    );
    expect(findingIsOk(created)).toBe(true);
    if (findingIsOk(created)) {
      expect(created.value.value).toBe(null);
      expect(findingIsCdeFilled(created.value)).toBe(false);
    }
  });
});

describe('findingApplyFreeTextFallback', () => {
  // FM-2: the radiologist's words survive, the CDE stays empty. Empty is visibly
  // incomplete downstream; a guessed category is invisibly wrong.
  it('keeps the prose as free text and leaves the CDE unfilled', () => {
    const block = radsBlock('Baco moderadamente aumentado.', 'LR2', 'Lung-RADS 2');
    const patched = findingApplyFreeTextFallback(block, 'moderadamente aumentado', LATER);
    expect(findingIsOk(patched)).toBe(true);
    if (findingIsOk(patched)) {
      expect(patched.value.value).toEqual({ kind: 'free-text', text: 'moderadamente aumentado' });
      expect(findingIsCdeFilled(patched.value)).toBe(false);
      expect(patched.value.provenance).toBe('human-typed');
      expect(patched.value.updatedAt).toBe(LATER);
    }
  });

  it('refuses an empty free-text fallback', () => {
    const block = radsBlock('Baco aumentado.', 'LR2', 'Lung-RADS 2');
    const patched = findingApplyFreeTextFallback(block, '  ', LATER);
    expect(patched.ok).toBe(false);
    if (!patched.ok) {
      expect(patched.code).toBe(FINDING_REFUSAL_CODES.emptyFreeText);
    }
  });
});

describe('findingCompareBlock', () => {
  it('agrees when the prose repeats the coded measurement', () => {
    const agreement = findingCompareBlock(
      measurementBlock('Nodulo de 8 mm no lobo superior direito.', 8, 'mm')
    );
    expect(agreement.status).toBe('agree');
    expect(agreement.agrees).toBe(true);
    expect(agreement.message).toBe(null);
    expect(agreement.proseShows).toBe('8 mm');
  });

  // FM-1, the core case: the prose was edited to 18 mm, the CDE still holds 8 mm. The
  // signed report says 18, the registry and the follow-up rule receive 8, and neither
  // surface looks wrong on its own.
  it('detects the edited-prose divergence and names both audiences', () => {
    const agreement = findingCompareBlock(
      measurementBlock('Nodulo de 18 mm no lobo superior direito.', 8, 'mm')
    );
    expect(agreement.status).toBe('magnitude-mismatch');
    expect(agreement.agrees).toBe(false);
    expect(agreement.proseShows).toBe('18 mm');
    expect(agreement.structureShows).toBe('8 mm');
    expect(String(agreement.message)).toContain('18 mm');
    expect(String(agreement.message)).toContain('8 mm');
    expect(String(agreement.message)).toContain('FHIR');
    expect(String(agreement.message)).toContain('solicitante');
  });

  // Same digits, different unit: the pair passes a skim because the number matches.
  it('detects a unit-only divergence (8 mm vs 8 cm)', () => {
    const agreement = findingCompareBlock(measurementBlock('Nodulo de 8 cm no figado.', 8, 'mm'));
    expect(agreement.status).toBe('unit-mismatch');
    expect(agreement.agrees).toBe(false);
  });

  // Cross-unit equality is real agreement: 1,8 cm and 18 mm are the same lesion, and
  // flagging it would train the radiologist to click through the warning.
  it('agrees across units when the sizes are equal', () => {
    const agreement = findingCompareBlock(measurementBlock('Nodulo de 1,8 cm no LSD.', 18, 'mm'));
    expect(agreement.status).toBe('agree');
    expect(agreement.agrees).toBe(true);
  });

  // FM-3 from the prose side: matching magnitude, missing unit. Assuming the CDE unit is
  // exactly what would hide a tenfold error.
  it('refuses to accept a bare number in the prose as agreement', () => {
    const agreement = findingCompareBlock(measurementBlock('Nodulo de 8 no lobo medio.', 8, 'mm'));
    expect(agreement.status).toBe('prose-value-without-unit');
    expect(agreement.agrees).toBe(false);
    expect(String(agreement.message)).toContain('sem unidade');
  });

  // The coded value would be exported although the readable report states no size at all.
  it('flags a coded measurement that the prose never states', () => {
    const agreement = findingCompareBlock(
      measurementBlock('Nodulo no lobo superior direito.', 8, 'mm')
    );
    expect(agreement.status).toBe('prose-has-no-value');
    expect(agreement.agrees).toBe(false);
    expect(agreement.proseShows).toBe(null);
    expect(String(agreement.message)).toContain('seguimento');
  });

  it('agrees when the prose mentions the enumerated category', () => {
    const agreement = findingCompareBlock(
      radsBlock('Nodulo solido, categoria Lung-RADS 4A.', 'LR4A', 'Lung-RADS 4A')
    );
    expect(agreement.status).toBe('agree');
    expect(agreement.agrees).toBe(true);
  });

  it('agrees when the prose uses a declared synonym of the category', () => {
    const agreement = findingCompareBlock(
      radsBlock('Nodulo solido, categoria 4A pelo criterio vigente.', 'LR4A', 'Lung-RADS 4A')
    );
    expect(agreement.agrees).toBe(true);
  });

  // The report reads "Lung-RADS 2" while the exported category is 4A: two different
  // recommendations for the same patient, both looking plausible in their own panel.
  it('flags a category that contradicts the category written in the prose', () => {
    const agreement = findingCompareBlock(
      radsBlock('Nodulo solido de 8 mm, categoria Lung-RADS 2.', 'LR4A', 'Lung-RADS 4A')
    );
    expect(agreement.status).toBe('prose-missing-term');
    expect(agreement.agrees).toBe(false);
    expect(String(agreement.message)).toContain('Lung-RADS 4A');
  });

  it('treats free text present in the prose as agreement', () => {
    const block = radsBlock('Baco moderadamente aumentado.', 'LR2', 'Lung-RADS 2');
    const patched = findingApplyFreeTextFallback(block, 'moderadamente aumentado', LATER);
    if (!findingIsOk(patched)) {
      throw new Error('fixture');
    }
    const agreement = findingCompareBlock(patched.value);
    expect(agreement.status).toBe('free-text-only');
    expect(agreement.agrees).toBe(true);
  });

  // Free text that no longer appears in the report is a panel telling a story the document
  // does not contain, even though nothing coded would be exported.
  it('flags free text that drifted away from the prose', () => {
    const block: FindingBlock = {
      blockId: 'b4',
      cde: RADS_CDE,
      value: { kind: 'free-text', text: 'moderadamente aumentado' },
      prose: 'Baco de dimensoes normais.',
      proseAnchorPresent: true,
      provenance: 'human-typed',
      updatedAt: NOW,
    };
    const agreement = findingCompareBlock(block);
    expect(agreement.status).toBe('prose-missing-term');
    expect(agreement.agrees).toBe(false);
  });

  it('does not complain about an empty CDE', () => {
    const block: FindingBlock = {
      blockId: 'b5',
      cde: SIZE_CDE,
      value: null,
      prose: 'Nodulo de 8 mm no lobo superior direito.',
      proseAnchorPresent: true,
      provenance: 'human-typed',
      updatedAt: NOW,
    };
    const agreement = findingCompareBlock(block);
    expect(agreement.status).toBe('structure-empty');
    expect(agreement.agrees).toBe(true);
    expect(agreement.structureShows).toBe(null);
  });
});

describe('findingDetectOrphans', () => {
  // FM-4: the sentence was deleted, the block survived. The export would carry a coded
  // finding that appears nowhere in the readable report.
  it('detects a coded block whose sentence was deleted', () => {
    const block = measurementBlock('', 8, 'mm');
    block.proseAnchorPresent = false;
    const orphans = findingDetectOrphans([block], null);
    expect(orphans.length).toBe(1);
    expect(orphans[0].exportsCodedValue).toBe(true);
    expect(orphans[0].structureShows).toBe('8 mm');
    expect(orphans[0].message).toContain('nenhum humano escreveu');
  });

  // Editors lose anchors quietly on paste and undo, so the flag alone cannot be trusted:
  // the current document text is the ground truth for what a human can read.
  it('detects a block whose sentence is absent from the current document text', () => {
    const block = measurementBlock('Nodulo de 8 mm no lobo superior direito.', 8, 'mm');
    const orphans = findingDetectOrphans(
      [block],
      'Exame sem alteracoes pleurais. Mediastino de aspecto habitual.'
    );
    expect(orphans.length).toBe(1);
    expect(orphans[0].blockId).toBe('b1');
  });

  it('does not report a block whose sentence is still in the document', () => {
    const block = measurementBlock('Nodulo de 8 mm no lobo superior direito.', 8, 'mm');
    const orphans = findingDetectOrphans(
      [block],
      'Achados: Nodulo de 8 mm no lobo superior direito. Restante sem alteracoes.'
    );
    expect(orphans).toEqual([]);
  });

  it('ignores an empty block with no prose, since nothing would be exported', () => {
    const block: FindingBlock = {
      blockId: 'b6',
      cde: SIZE_CDE,
      value: null,
      prose: '',
      proseAnchorPresent: false,
      provenance: 'human-typed',
      updatedAt: NOW,
    };
    expect(findingDetectOrphans([block], null)).toEqual([]);
  });

  it('marks a free-text orphan as not exporting a coded value', () => {
    const block: FindingBlock = {
      blockId: 'b7',
      cde: RADS_CDE,
      value: { kind: 'free-text', text: 'moderadamente aumentado' },
      prose: '',
      proseAnchorPresent: false,
      provenance: 'human-typed',
      updatedAt: NOW,
    };
    const orphans = findingDetectOrphans([block], null);
    expect(orphans.length).toBe(1);
    expect(orphans[0].exportsCodedValue).toBe(false);
  });

  it('reports the deleted sentence through findingCompareBlock as well', () => {
    const block = measurementBlock('', 8, 'mm');
    block.proseAnchorPresent = false;
    const agreement = findingCompareBlock(block);
    expect(agreement.status).toBe('prose-deleted');
    expect(agreement.agrees).toBe(false);
  });
});

describe('findingConfirmProposal', () => {
  it('turns an agreeing software proposal into a human assertion', () => {
    const block = measurementBlock(
      'Nodulo de 8 mm no lobo superior direito.',
      8,
      'mm',
      'software-proposed'
    );
    const confirmed = findingConfirmProposal(block, LATER);
    expect(findingIsOk(confirmed)).toBe(true);
    if (findingIsOk(confirmed)) {
      expect(confirmed.value.provenance).toBe('human-confirmed');
      expect(confirmed.value.updatedAt).toBe(LATER);
    }
  });

  // FM-5 + FM-1: confirming a value that contradicts the sentence would launder the guess
  // into a signed human assertion, and the contradiction would survive untraceably.
  it('refuses to confirm a proposal that disagrees with the prose', () => {
    const block = measurementBlock(
      'Nodulo de 18 mm no lobo superior direito.',
      8,
      'mm',
      'software-proposed'
    );
    const confirmed = findingConfirmProposal(block, LATER);
    expect(confirmed.ok).toBe(false);
    if (!confirmed.ok) {
      expect(confirmed.code).toBe(FINDING_REFUSAL_CODES.proseStructureDisagreement);
      expect(confirmed.reason).toContain('18 mm');
      expect(confirmed.blockIds).toEqual(['b1']);
    }
  });

  it('refuses to confirm a value the radiologist typed himself', () => {
    const block = measurementBlock('Nodulo de 8 mm no LSD.', 8, 'mm', 'human-typed');
    const confirmed = findingConfirmProposal(block, LATER);
    expect(confirmed.ok).toBe(false);
    if (!confirmed.ok) {
      expect(confirmed.code).toBe(FINDING_REFUSAL_CODES.notAProposal);
    }
  });

  it('refuses to confirm an empty proposal', () => {
    const block: FindingBlock = {
      blockId: 'b8',
      cde: SIZE_CDE,
      value: null,
      prose: 'Nodulo de 8 mm no LSD.',
      proseAnchorPresent: true,
      provenance: 'software-proposed',
      updatedAt: NOW,
    };
    const confirmed = findingConfirmProposal(block, LATER);
    expect(confirmed.ok).toBe(false);
    if (!confirmed.ok) {
      expect(confirmed.code).toBe(FINDING_REFUSAL_CODES.cdeEmpty);
    }
  });
});

describe('findingCanExportCodedValue', () => {
  // FM-5: once serialised, a proposal nobody read is byte-identical to a dictated
  // measurement and inherits the radiologist's signature.
  it('refuses to export an unconfirmed software proposal', () => {
    const block = measurementBlock(
      'Nodulo de 8 mm no lobo superior direito.',
      8,
      'mm',
      'software-proposed'
    );
    const exported = findingCanExportCodedValue(block);
    expect(exported.ok).toBe(false);
    if (!exported.ok) {
      expect(exported.code).toBe(FINDING_REFUSAL_CODES.unconfirmedProposal);
      expect(exported.reason).toContain('proposto por software');
    }
  });

  it('exports the same value once a human confirms it', () => {
    const block = measurementBlock(
      'Nodulo de 8 mm no lobo superior direito.',
      8,
      'mm',
      'software-proposed'
    );
    const confirmed = findingConfirmProposal(block, LATER);
    if (!findingIsOk(confirmed)) {
      throw new Error('fixture');
    }
    const exported = findingCanExportCodedValue(confirmed.value);
    expect(findingIsOk(exported)).toBe(true);
    if (findingIsOk(exported)) {
      expect(exported.value).toEqual({ kind: 'measurement', magnitude: 8, unit: 'mm' });
    }
  });

  it('refuses to export a free-text block as a coded value', () => {
    const block: FindingBlock = {
      blockId: 'b9',
      cde: RADS_CDE,
      value: { kind: 'free-text', text: 'moderadamente aumentado' },
      prose: 'Baco moderadamente aumentado.',
      proseAnchorPresent: true,
      provenance: 'human-typed',
      updatedAt: NOW,
    };
    const exported = findingCanExportCodedValue(block);
    expect(exported.ok).toBe(false);
    if (!exported.ok) {
      expect(exported.code).toBe(FINDING_REFUSAL_CODES.cdeEmpty);
    }
  });

  it('refuses to export while prose and structure disagree', () => {
    const exported = findingCanExportCodedValue(
      measurementBlock('Nodulo de 18 mm no LSD.', 8, 'mm')
    );
    expect(exported.ok).toBe(false);
    if (!exported.ok) {
      expect(exported.code).toBe(FINDING_REFUSAL_CODES.proseStructureDisagreement);
    }
  });

  it('refuses to export an orphan block', () => {
    const block = measurementBlock('', 8, 'mm');
    block.proseAnchorPresent = false;
    const exported = findingCanExportCodedValue(block);
    expect(exported.ok).toBe(false);
    if (!exported.ok) {
      expect(exported.code).toBe(FINDING_REFUSAL_CODES.orphanStructure);
    }
  });
});

describe('findingValidateForSignature', () => {
  it('clears a report whose blocks all agree and counts the coded exports', () => {
    const blocks = [
      measurementBlock('Nodulo de 8 mm no lobo superior direito.', 8, 'mm'),
      radsBlock('Nodulo solido, categoria Lung-RADS 2.', 'LR2', 'Lung-RADS 2'),
    ];
    const cleared = findingValidateForSignature(
      blocks,
      'Nodulo de 8 mm no lobo superior direito. Nodulo solido, categoria Lung-RADS 2.',
      NOW
    );
    expect(findingIsOk(cleared)).toBe(true);
    if (findingIsOk(cleared)) {
      expect(cleared.value.clearedAt).toBe(NOW);
      expect(cleared.value.blockCount).toBe(2);
      expect(cleared.value.codedExportCount).toBe(2);
    }
  });

  // FM-1 at the moment that matters: signing freezes the divergence into the legal document.
  it('refuses the signature while the prose and the CDE disagree', () => {
    const blocks = [measurementBlock('Nodulo de 18 mm no lobo superior direito.', 8, 'mm')];
    const refusal = findingValidateForSignature(blocks, null, NOW);
    expect(refusal.ok).toBe(false);
    if (!refusal.ok) {
      expect(refusal.code).toBe(FINDING_REFUSAL_CODES.proseStructureDisagreement);
      expect(refusal.blockIds).toEqual(['b1']);
      expect(refusal.problems.length).toBe(1);
      expect(refusal.reason).toContain('Laudo');
      expect(refusal.reason).toContain('18 mm');
    }
  });

  it('refuses the signature when a coded block is orphaned', () => {
    const block = measurementBlock('Nodulo de 8 mm no LSD.', 8, 'mm');
    const refusal = findingValidateForSignature(
      [block],
      'Exame sem nodulos. Mediastino habitual.',
      NOW
    );
    expect(refusal.ok).toBe(false);
    if (!refusal.ok) {
      expect(refusal.code).toBe(FINDING_REFUSAL_CODES.orphanStructure);
    }
  });

  it('refuses the signature while a software proposal is unconfirmed', () => {
    const blocks = [
      measurementBlock('Nodulo de 8 mm no LSD.', 8, 'mm', 'software-proposed'),
    ];
    const refusal = findingValidateForSignature(blocks, 'Nodulo de 8 mm no LSD.', NOW);
    expect(refusal.ok).toBe(false);
    if (!refusal.ok) {
      expect(refusal.code).toBe(FINDING_REFUSAL_CODES.unconfirmedProposal);
      expect(refusal.problems.length).toBe(1);
    }
  });

  // A proposal that also contradicts the prose is two distinct problems, and the
  // radiologist must see both instead of fixing one and being blocked again.
  it('reports the divergence and the unconfirmed provenance as separate problems', () => {
    const blocks = [
      measurementBlock('Nodulo de 18 mm no LSD.', 8, 'mm', 'software-proposed'),
    ];
    const refusal = findingValidateForSignature(blocks, 'Nodulo de 18 mm no LSD.', NOW);
    expect(refusal.ok).toBe(false);
    if (!refusal.ok) {
      expect(refusal.problems.length).toBe(2);
      expect(refusal.blockIds).toEqual(['b1', 'b1']);
    }
  });

  // FM-2 end to end: refusing to code the value must not block the report. Free text with
  // an empty CDE is a legitimate, signable finding; it simply exports nothing coded.
  it('clears a report that kept an uncodable finding as free text', () => {
    const base = radsBlock('Baco moderadamente aumentado.', 'LR2', 'Lung-RADS 2');
    const patched = findingApplyFreeTextFallback(base, 'moderadamente aumentado', LATER);
    if (!findingIsOk(patched)) {
      throw new Error('fixture');
    }
    const cleared = findingValidateForSignature(
      [patched.value],
      'Baco moderadamente aumentado.',
      NOW
    );
    expect(findingIsOk(cleared)).toBe(true);
    if (findingIsOk(cleared)) {
      expect(cleared.value.codedExportCount).toBe(0);
    }
  });

  it('clears an empty report', () => {
    const cleared = findingValidateForSignature([], null, NOW);
    expect(findingIsOk(cleared)).toBe(true);
    if (findingIsOk(cleared)) {
      expect(cleared.value.blockCount).toBe(0);
    }
  });
});

describe('findingDescribeBlock', () => {
  it('puts both surfaces on one line so the divergence is visible at a glance', () => {
    const line = findingDescribeBlock(measurementBlock('Nodulo de 18 mm no LSD.', 8, 'mm'));
    expect(line.indexOf('\n')).toBe(-1);
    expect(line).toContain('[RDE1301]');
    expect(line).toContain('estrutura: "8 mm"');
    expect(line).toContain('Nodulo de 18 mm no LSD.');
    expect(line).toContain('DIVERGENTE (magnitude-mismatch)');
  });

  it('marks an agreeing block as OK and states its provenance', () => {
    const line = findingDescribeBlock(
      measurementBlock('Nodulo de 8 mm no LSD.', 8, 'mm', 'human-confirmed')
    );
    expect(line).toContain('confirmado pelo radiologista');
    expect(line).toContain('OK');
  });

  it('shows a deleted sentence and an empty CDE explicitly', () => {
    const orphan = measurementBlock('', 8, 'mm');
    orphan.proseAnchorPresent = false;
    expect(findingDescribeBlock(orphan)).toContain('frase apagada');

    const empty: FindingBlock = {
      blockId: 'b10',
      cde: SIZE_CDE,
      value: null,
      prose: 'Nodulo de 8 mm no LSD.',
      proseAnchorPresent: true,
      provenance: 'human-typed',
      updatedAt: NOW,
    };
    expect(findingDescribeBlock(empty)).toContain('estrutura: "vazio"');
  });

  it('flags an unconfirmed proposal in the readout', () => {
    const line = findingDescribeBlock(
      measurementBlock('Nodulo de 8 mm no LSD.', 8, 'mm', 'software-proposed')
    );
    expect(line).toContain('proposto por software');
  });
});
