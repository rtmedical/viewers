/**
 * RTV-227 -- tests for the Review Queue version-comparison core.
 *
 * Each non-obvious case names the clinical failure mode it pins. Fixed epoch constants only:
 * the module never reads a clock, and neither do these tests.
 */

import type {
  DiffApprovalInput,
  DiffReportSection,
  DiffReportVersion,
  DiffSectionComparison,
} from './versionDiff';
import {
  DIFF_ACCENT_TABLE_SIZE,
  DIFF_APPROVAL_SCOPE_TEXT,
  DIFF_MAX_TOKENS_PER_SECTION,
  DIFF_VERDICT_IDENTICAL,
  DIFF_VERDICT_SIGNIFICANT,
  DIFF_VERDICT_WORDING_ONLY,
  diffApproveComparison,
  diffClassifySpan,
  diffCompareSectionText,
  diffCompareVersions,
  diffFoldWord,
  diffHighestRiskLevel,
  diffParseNumber,
  diffSignificantTokens,
  diffTokenDiff,
  diffTokenize,
} from './versionDiff';

/** Fixed epochs: 2026-08-14T12:00:00Z and later. */
const DIFF_T1 = 1786910400000;
const DIFF_T2 = 1786914000000;
const DIFF_T3 = 1786917600000;
const DIFF_T_NOW = 1786921200000;

function section(kind: string, text: string): DiffReportSection {
  return { kind: kind as DiffReportSection['kind'], text: text };
}

function version(
  id: string,
  ordinal: number,
  savedAt: number,
  authorId: string,
  sections: DiffReportSection[]
): DiffReportVersion {
  return { id: id, ordinal: ordinal, savedAt: savedAt, authorId: authorId, sections: sections };
}

function sectionOf(sections: DiffSectionComparison[], kind: string): DiffSectionComparison {
  for (let i = 0; i < sections.length; i += 1) {
    if (sections[i].kind === kind) {
      return sections[i];
    }
  }
  return null;
}

const DIFF_V1 = version('rep-1', 1, DIFF_T1, 'res-ana', [
  section('findings', 'Nódulo pulmonar no lobo superior direito medindo 1,5 cm. Não há sinais de pneumotórax.'),
  section('impression', 'Nódulo pulmonar de aspecto benigno. Categoria Lung-RADS 2.'),
]);

const DIFF_V2 = version('rep-2', 2, DIFF_T2, 'res-ana', [
  section('findings', 'Nódulo pulmonar no lobo superior direito medindo 1,5 cm. Não há sinais de pneumotórax.'),
  section('impression', 'Nódulo pulmonar de aspecto benigno. Categoria Lung-RADS 2.'),
  section('addendum', 'Suspeita de embolia pulmonar; contatar o médico assistente com urgência.'),
]);

const DIFF_V3 = version('rep-3', 3, DIFF_T3, 'res-ana', [
  section('findings', 'Nódulo pulmonar no lobo superior direito medindo 1,5 cm. Não há sinais de pneumotórax.'),
  section('impression', 'Nódulo pulmonar de aspecto benigno. Categoria Lung-RADS 2.'),
]);

describe('diffTokenize / diffFoldWord / diffParseNumber', () => {
  // FM-1: a numeric run must survive tokenisation whole, decimal comma included; if the comma
  // becomes a separate punctuation token, "1,5" and "15" differ only by discardable noise.
  it('keeps a decimal number as a single token including its comma', () => {
    const tokens = diffTokenize('1,5 cm');
    expect(tokens.length).toBe(3);
    expect(tokens[0].kind).toBe('number');
    expect(tokens[0].text).toBe('1,5');
    expect(tokens[1].kind).toBe('space');
    expect(tokens[2].text).toBe('cm');
  });

  it('keeps hyphenated classifications such as Lung-RADS as one word token', () => {
    const tokens = diffSignificantTokens('Lung-RADS 2');
    expect(tokens.length).toBe(2);
    expect(tokens[0].text).toBe('Lung-RADS');
    expect(tokens[0].kind).toBe('word');
    expect(tokens[1].kind).toBe('number');
  });

  // Folding is safe for prose (nodulo/nódulo is the same claim) and must never reach digits.
  it('folds case and accents for words only', () => {
    expect(diffFoldWord('NÓDULO')).toBe('nodulo');
    expect(diffFoldWord('Impressão')).toBe('impressao');
    expect(DIFF_ACCENT_TABLE_SIZE).toBe(50);
  });

  // FM-1: pt-BR decimal comma and thousands dot must not be confused with each other.
  it('parses Brazilian numerals without inventing magnitudes', () => {
    expect(diffParseNumber('1,5').value).toBe(1.5);
    expect(diffParseNumber('15').value).toBe(15);
    expect(diffParseNumber('1.500').value).toBe(1500);
    expect(diffParseNumber('1.500,25').value).toBe(1500.25);
    expect(diffParseNumber('3.5').value).toBe(3.5);
    expect(diffParseNumber('').valid).toBe(false);
  });
});

describe('diffTokenDiff', () => {
  // A whitespace-only edit is real noise and must produce no ops other than equality.
  it('ignores pure whitespace and line-break reflow', () => {
    const ops = diffTokenDiff(
      diffSignificantTokens('Achados:  sem   alterações\n\nrelevantes'),
      diffSignificantTokens('Achados: sem alterações relevantes')
    );
    for (let i = 0; i < ops.length; i += 1) {
      expect(ops[i].kind).toBe('equal');
    }
  });

  it('locates a single changed token in the middle of a long sentence', () => {
    const ops = diffTokenDiff(
      diffSignificantTokens('lesão no rim direito sem sinais de obstrução'),
      diffSignificantTokens('lesão no rim esquerdo sem sinais de obstrução')
    );
    let deleted = '';
    let inserted = '';
    for (let i = 0; i < ops.length; i += 1) {
      if (ops[i].kind === 'delete') {
        deleted += ops[i].tokens[0].text;
      }
      if (ops[i].kind === 'insert') {
        inserted += ops[i].tokens[0].text;
      }
    }
    expect(deleted).toBe('direito');
    expect(inserted).toBe('esquerdo');
  });
});

describe('risk classification by class, not by size', () => {
  // FM-1 "O decimal engolido": 1,5 cm nodule -> 15 cm mass. One character, highest risk on the
  // page. A whitespace/punctuation-normalising diff would report this as noise or as nothing.
  it('classifies "1,5 cm" -> "15 cm" as a high-risk measurement change', () => {
    const outcome = diffCompareSectionText('nódulo medindo 1,5 cm', 'nódulo medindo 15 cm');
    expect(outcome.ok).toBe(true);
    expect(outcome.value.changed).toBe(true);
    expect(outcome.value.spans.length).toBe(1);
    const span = outcome.value.spans[0];
    expect(span.riskClass).toBe('measurement');
    expect(span.riskLevel).toBe('high');
    expect(span.removed).toBe('1,5');
    expect(span.added).toBe('15');
    expect(span.message.indexOf('Medida alterada')).toBe(0);
    // The magnitude is spelled out, so the reviewer does not have to do the arithmetic.
    expect(span.message.indexOf('10x')).toBeGreaterThan(0);
  });

  // FM-2 "O nao perdido": the smallest possible span inverts the report.
  it('classifies a dropped "não" as a high-risk negation change', () => {
    const outcome = diffCompareSectionText(
      'Não há sinais de pneumotórax.',
      'Há sinais de pneumotórax.'
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.value.spans.length).toBe(1);
    const span = outcome.value.spans[0];
    expect(span.riskClass).toBe('negation');
    expect(span.riskLevel).toBe('high');
    expect(span.removed).toBe('Não');
    expect(span.added).toBe('');
    expect(span.message.indexOf('Negação removida')).toBe(0);
  });

  // FM-2 in the other direction: an inserted "sem" negates what was previously affirmed.
  it('classifies an inserted negation term as high risk and says which direction', () => {
    const outcome = diffCompareSectionText(
      'Há realce após contraste.',
      'Há realce sem contraste.'
    );
    expect(outcome.value.spans[0].riskClasses).toContain('negation');
    expect(outcome.value.spans[0].message.indexOf('Negação inserida')).toBe(0);
  });

  // FM-3: right kidney -> left kidney reads perfectly and can reach the operating room.
  it('classifies a laterality flip as high risk', () => {
    const outcome = diffCompareSectionText('cisto no rim direito', 'cisto no rim esquerdo');
    const span = outcome.value.spans[0];
    expect(span.riskClass).toBe('laterality');
    expect(span.riskLevel).toBe('high');
  });

  // A category jump changes the recommended management even though only one character moved:
  // BI-RADS 3 means a 6-month follow-up, BI-RADS 5 means a biopsy.
  it('classifies a BI-RADS grade jump as high risk', () => {
    const outcome = diffCompareSectionText('Categoria BI-RADS 3.', 'Categoria BI-RADS 5.');
    const span = outcome.value.spans[0];
    expect(span.riskLevel).toBe('high');
    expect(span.riskClasses).toContain('measurement');
  });

  // The word form of the same idea: benign -> malignant, no digits involved at all.
  it('classifies a benign/malignant swap as a high-risk category change', () => {
    const outcome = diffCompareSectionText('lesão de aspecto benigno', 'lesão de aspecto maligno');
    const span = outcome.value.spans[0];
    expect(span.riskClass).toBe('category');
    expect(span.riskLevel).toBe('high');
    expect(span.message.indexOf('muda a conduta recomendada')).toBeGreaterThan(0);
  });

  // A unit swap keeps every digit identical and changes the size tenfold.
  it('flags a unit change (cm -> mm) even with identical digits', () => {
    const outcome = diffCompareSectionText('lesão de 8 cm', 'lesão de 8 mm');
    expect(outcome.value.spans[0].riskClass).toBe('measurement');
    expect(outcome.value.spans[0].message.indexOf('Unidade de medida alterada')).toBe(0);
  });

  // The inverse guard: a long, entirely rewritten sentence with the same facts is LOW risk. If
  // this were high risk too, the reviewer would learn to ignore the risk badge altogether.
  it('classifies a large pure rewording as low risk', () => {
    const outcome = diffCompareSectionText(
      'Observa-se imagem nodular de contornos regulares medindo 1,5 cm.',
      'Nota-se imagem nodular com contornos regulares, medindo 1,5 cm.'
    );
    expect(outcome.value.changed).toBe(true);
    expect(outcome.value.spans.length).toBeGreaterThan(1);
    expect(outcome.value.riskLevel).toBe('low');
    expect(outcome.value.riskClasses).toContain('wording');
  });

  // Deliberately conservative: when a laterality term is MOVED across the sentence, the token
  // diff cannot prove the side is unchanged, so the change is still reported. A false alarm costs
  // the reviewer a glance; a missed side change costs the wrong kidney (FM-3).
  it('never reports "no change" when a laterality term moves inside the sentence', () => {
    const outcome = diffCompareSectionText(
      'Cisto simples no rim direito, sem realce pelo contraste.',
      'Sem realce pelo contraste no cisto simples do rim direito.'
    );
    expect(outcome.value.changed).toBe(true);
    expect(outcome.value.riskLevel === 'none').toBe(false);
  });

  // Accent-only and case-only rewrites must not be reported at all, or the real spans drown.
  it('reports no change for an accent-only or case-only rewrite', () => {
    const outcome = diffCompareSectionText('Nódulo de 1,5 cm', 'nodulo de 1,5 cm');
    expect(outcome.value.changed).toBe(false);
    expect(outcome.value.riskLevel).toBe('none');
  });

  // Same paragraph, one span: folding words but not digits is exactly what separates these two.
  it('folds the word but not the number in the same comparison', () => {
    const outcome = diffCompareSectionText('Nódulo de 1,5 cm', 'nodulo de 15 cm');
    expect(outcome.value.spans.length).toBe(1);
    expect(outcome.value.spans[0].riskClass).toBe('measurement');
  });

  // A span with both a negation and a measurement change must not lose either class.
  it('keeps every matched class and picks negation as the headline', () => {
    const classification = diffClassifySpan(
      diffSignificantTokens('sem nódulo de 1,5 cm'),
      diffSignificantTokens('nódulo de 15 cm')
    );
    expect(classification.riskClass).toBe('negation');
    expect(classification.riskClasses).toContain('measurement');
    expect(classification.riskLevel).toBe('high');
  });

  it('reports "none" as the highest risk level of an empty span list', () => {
    expect(diffHighestRiskLevel([])).toBe('none');
  });

  // FM-1/FM-5: the span carries its neighbours, so a three-letter mark can still be located in a
  // page of text instead of being hunted for by eye.
  it('carries surrounding context so a tiny span can be located', () => {
    const outcome = diffCompareSectionText(
      'Achados: não há derrame pleural.',
      'Achados: há derrame pleural.'
    );
    const span = outcome.value.spans[0];
    expect(span.contextBefore).toBe(':');
    expect(span.contextAfter).toBe('há');
  });
});

describe('per-section reporting', () => {
  const target = version('rep-2', 2, DIFF_T2, 'res-ana', [
    section('findings', 'Nódulo pulmonar no lobo superior direito medindo 1,5 cm. Não há sinais de pneumotórax.'),
    section('impression', 'Nódulo pulmonar de aspecto suspeito. Categoria Lung-RADS 4A.'),
  ]);

  // FM-4: a change confined to the impression is the change the referring physician acts on.
  it('flags an impression-only change as an actionable change', () => {
    const outcome = diffCompareVersions({
      history: [DIFF_V1, target],
      baseVersionId: 'rep-1',
      targetVersionId: 'rep-2',
      comparedAt: DIFF_T_NOW,
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.value.impressionChanged).toBe(true);
    expect(outcome.value.actionableChanged).toBe(true);
    expect(outcome.value.findingsOnly).toBe(false);
    expect(outcome.value.changedSectionKinds).toEqual(['impression']);
    expect(sectionOf(outcome.value.sections, 'findings').changed).toBe(false);
    expect(sectionOf(outcome.value.sections, 'impression').actionable).toBe(true);
    expect(outcome.value.impressionMessage.indexOf('médico solicitante')).toBeGreaterThan(0);
  });

  // FM-4 mirrored: the same span count in the findings is NOT the same event, and the reviewer is
  // told the impression did not follow the change.
  it('reports a findings-only change as non-actionable and warns the impression did not follow', () => {
    const findingsOnlyTarget = version('rep-2', 2, DIFF_T2, 'res-ana', [
      section('findings', 'Nódulo pulmonar no lobo superior direito medindo 15 cm. Não há sinais de pneumotórax.'),
      section('impression', 'Nódulo pulmonar de aspecto benigno. Categoria Lung-RADS 2.'),
    ]);
    const outcome = diffCompareVersions({
      history: [DIFF_V1, findingsOnlyTarget],
      baseVersionId: 'rep-1',
      targetVersionId: 'rep-2',
      comparedAt: DIFF_T_NOW,
    });
    expect(outcome.value.impressionChanged).toBe(false);
    expect(outcome.value.findingsOnly).toBe(true);
    expect(outcome.value.changedSectionKinds).toEqual(['findings']);
    expect(outcome.value.warnings.length).toBeGreaterThan(0);
    expect(outcome.value.verdict).toBe(DIFF_VERDICT_SIGNIFICANT);
    expect(outcome.value.highRiskSpanCount).toBe(1);
  });

  // A section that disappears is high risk whatever its wording: a removed addendum takes its
  // alert with it, and a span-by-span diff of an absent section shows nothing to compare.
  it('treats an added or removed section as a high-risk structural change', () => {
    const outcome = diffCompareVersions({
      history: [DIFF_V1, DIFF_V2],
      baseVersionId: 'rep-1',
      targetVersionId: 'rep-2',
      comparedAt: DIFF_T_NOW,
    });
    const addendum = sectionOf(outcome.value.sections, 'addendum');
    expect(addendum.presence).toBe('only-after');
    expect(addendum.changed).toBe(true);
    expect(addendum.riskLevel).toBe('high');
    expect(outcome.value.verdict).toBe(DIFF_VERDICT_SIGNIFICANT);
  });

  it('reports sections in canonical report order', () => {
    const outcome = diffCompareVersions({
      history: [DIFF_V1, DIFF_V2],
      baseVersionId: 'rep-1',
      targetVersionId: 'rep-2',
      comparedAt: DIFF_T_NOW,
    });
    const kinds: string[] = [];
    for (let i = 0; i < outcome.value.sections.length; i += 1) {
      kinds.push(outcome.value.sections[i].kind);
    }
    expect(kinds).toEqual(['findings', 'impression', 'addendum']);
  });

  it('classifies a wording-only version bump as wording-only', () => {
    const reworded = version('rep-2', 2, DIFF_T2, 'res-ana', [
      section('findings', 'Nódulo pulmonar em lobo superior direito, medindo 1,5 cm. Não há sinais de pneumotórax.'),
      section('impression', 'Nódulo pulmonar de aspecto benigno. Categoria Lung-RADS 2.'),
    ]);
    const outcome = diffCompareVersions({
      history: [DIFF_V1, reworded],
      baseVersionId: 'rep-1',
      targetVersionId: 'rep-2',
      comparedAt: DIFF_T_NOW,
    });
    expect(outcome.value.verdict).toBe(DIFF_VERDICT_WORDING_ONLY);
    expect(outcome.value.highRiskSpanCount).toBe(0);
    expect(outcome.value.totalSpanCount).toBeGreaterThan(0);
  });
});

describe('nothing-changed is an explicit verdict', () => {
  // FM-5 "O painel branco": an empty span list is indistinguishable from a diff that failed to
  // load. The verdict must say, in words, that the versions are equal.
  it('returns an identical verdict with a message, not just an empty list', () => {
    const twin = version('rep-2', 2, DIFF_T2, 'res-ana', DIFF_V1.sections);
    const outcome = diffCompareVersions({
      history: [DIFF_V1, twin],
      baseVersionId: 'rep-1',
      targetVersionId: 'rep-2',
      comparedAt: DIFF_T_NOW,
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.value.verdict).toBe(DIFF_VERDICT_IDENTICAL);
    expect(outcome.value.totalSpanCount).toBe(0);
    expect(outcome.value.changedSectionKinds.length).toBe(0);
    expect(outcome.value.verdictMessage.length).toBeGreaterThan(0);
    expect(outcome.value.verdictMessage.indexOf('não porque a comparação falhou')).toBeGreaterThan(0);
    // Still one row per section, so the panel is never blank.
    expect(outcome.value.sections.length).toBe(2);
    expect(outcome.value.sections[0].message).toBe('Sem alterações nesta seção.');
  });

  // FM-5: an oversized section refuses with a code instead of silently rendering nothing.
  it('refuses an oversized section instead of returning an empty diff', () => {
    const words: string[] = [];
    for (let i = 0; i < DIFF_MAX_TOKENS_PER_SECTION + 10; i += 1) {
      words.push('achado');
    }
    const outcome = diffCompareSectionText(words.join(' '), 'achado');
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('section-too-large');
    expect(outcome.reason.indexOf('não significa que nada mudou')).toBeGreaterThan(0);
  });

  // FM-5: a version that arrives empty is a load failure, not a report that was wiped. Rendering
  // it would invite the reviewer to approve the deletion of the whole report.
  it('refuses a version that arrived with no content', () => {
    const empty = version('rep-2', 2, DIFF_T2, 'res-ana', [section('findings', '   ')]);
    const outcome = diffCompareVersions({
      history: [DIFF_V1, empty],
      baseVersionId: 'rep-1',
      targetVersionId: 'rep-2',
      comparedAt: DIFF_T_NOW,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('empty-version-content');
  });
});

describe('non-adjacent comparison', () => {
  // FM-6 "O adendo fantasma": v1 vs v3 hides the addendum that v2 added and v3 removed. It was a
  // released version of the report and no reviewer ever sees it in this panel.
  it('detects skipped versions and names the sections that existed only in them', () => {
    const outcome = diffCompareVersions({
      history: [DIFF_V1, DIFF_V2, DIFF_V3],
      baseVersionId: 'rep-1',
      targetVersionId: 'rep-3',
      comparedAt: DIFF_T_NOW,
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.value.adjacency.adjacent).toBe(false);
    expect(outcome.value.adjacency.skipped.length).toBe(1);
    expect(outcome.value.adjacency.skipped[0].id).toBe('rep-2');
    expect(outcome.value.adjacency.hiddenSectionKinds).toEqual(['addendum']);
    expect(outcome.value.adjacency.message.indexOf('não adjacente')).toBeGreaterThan(0);
    // Two warnings: the skipped version, and the section that lived only inside it.
    expect(outcome.value.warnings.length).toBe(2);
    // The content-level verdict is still "identical" -- which is exactly why the adjacency
    // warning has to exist: v1 and v3 match, yet something real happened in between.
    expect(outcome.value.verdict).toBe(DIFF_VERDICT_IDENTICAL);
  });

  it('states adjacency positively when no version was skipped', () => {
    const outcome = diffCompareVersions({
      history: [DIFF_V1, DIFF_V2, DIFF_V3],
      baseVersionId: 'rep-2',
      targetVersionId: 'rep-3',
      comparedAt: DIFF_T_NOW,
    });
    expect(outcome.value.adjacency.adjacent).toBe(true);
    expect(outcome.value.adjacency.skipped.length).toBe(0);
    expect(outcome.value.adjacency.hiddenSectionKinds.length).toBe(0);
    expect(outcome.value.adjacency.message.indexOf('adjacentes')).toBeGreaterThan(0);
  });

  it('detects skipped versions even when the history array is out of order', () => {
    const outcome = diffCompareVersions({
      history: [DIFF_V3, DIFF_V1, DIFF_V2],
      baseVersionId: 'rep-1',
      targetVersionId: 'rep-3',
      comparedAt: DIFF_T_NOW,
    });
    expect(outcome.value.adjacency.skipped.length).toBe(1);
    expect(outcome.value.adjacency.skipped[0].ordinal).toBe(2);
  });
});

describe('diffCompareVersions refusals', () => {
  it('refuses an unknown base or target version id', () => {
    const unknownBase = diffCompareVersions({
      history: [DIFF_V1, DIFF_V2],
      baseVersionId: 'rep-999',
      targetVersionId: 'rep-2',
      comparedAt: DIFF_T_NOW,
    });
    expect(unknownBase.ok).toBe(false);
    expect(unknownBase.code).toBe('unknown-base-version');
    const unknownTarget = diffCompareVersions({
      history: [DIFF_V1, DIFF_V2],
      baseVersionId: 'rep-1',
      targetVersionId: 'rep-999',
      comparedAt: DIFF_T_NOW,
    });
    expect(unknownTarget.code).toBe('unknown-target-version');
  });

  // A selection slip that compares a version with itself always answers "identical", and the
  // reviewer reads that as "the two versions I picked are equal".
  it('refuses comparing a version with itself', () => {
    const outcome = diffCompareVersions({
      history: [DIFF_V1, DIFF_V2],
      baseVersionId: 'rep-2',
      targetVersionId: 'rep-2',
      comparedAt: DIFF_T_NOW,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('same-version');
  });

  // A backwards pair inverts every span: a finding deleted in v3 is painted as newly added.
  it('refuses a backwards pair instead of inverting every span', () => {
    const outcome = diffCompareVersions({
      history: [DIFF_V1, DIFF_V2],
      baseVersionId: 'rep-2',
      targetVersionId: 'rep-1',
      comparedAt: DIFF_T_NOW,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('reversed-order');
    expect(outcome.reason.indexOf('remoção apareceria como inclusão')).toBeGreaterThan(0);
  });

  // Two sections of the same kind: one of them would win silently and the reviewer would compare
  // text that is not the text the referring physician will read.
  it('refuses a version with a duplicated section kind', () => {
    const doubled = version('rep-2', 2, DIFF_T2, 'res-ana', [
      section('findings', 'Nódulo de 1,5 cm.'),
      section('findings', 'Nódulo de 15 cm.'),
      section('impression', 'Aspecto benigno.'),
    ]);
    const outcome = diffCompareVersions({
      history: [DIFF_V1, doubled],
      baseVersionId: 'rep-1',
      targetVersionId: 'rep-2',
      comparedAt: DIFF_T_NOW,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('duplicate-section');
    expect(outcome.reason.indexOf('ignorada em silêncio')).toBeGreaterThan(0);
  });

  // Duplicated ordinals break "which one is v2", and with it the FM-6 adjacency check.
  it('refuses a history with duplicated version numbers or ids', () => {
    const clash = version('rep-9', 2, DIFF_T3, 'res-ana', DIFF_V2.sections);
    const duplicateOrdinal = diffCompareVersions({
      history: [DIFF_V1, DIFF_V2, clash],
      baseVersionId: 'rep-1',
      targetVersionId: 'rep-2',
      comparedAt: DIFF_T_NOW,
    });
    expect(duplicateOrdinal.code).toBe('duplicate-ordinal');
    const sameId = version('rep-2', 4, DIFF_T3, 'res-ana', DIFF_V2.sections);
    const duplicateId = diffCompareVersions({
      history: [DIFF_V1, DIFF_V2, sameId],
      baseVersionId: 'rep-1',
      targetVersionId: 'rep-2',
      comparedAt: DIFF_T_NOW,
    });
    expect(duplicateId.code).toBe('duplicate-version-id');
  });

  it('refuses an empty history and an invalid comparison timestamp', () => {
    const emptyHistory = diffCompareVersions({
      history: [],
      baseVersionId: 'rep-1',
      targetVersionId: 'rep-2',
      comparedAt: DIFF_T_NOW,
    });
    expect(emptyHistory.code).toBe('empty-history');
    // An unorderable timestamp makes "which review came first" unanswerable in the audit trail.
    const badTime = diffCompareVersions({
      history: [DIFF_V1, DIFF_V2],
      baseVersionId: 'rep-1',
      targetVersionId: 'rep-2',
      comparedAt: NaN,
    });
    expect(badTime.code).toBe('invalid-timestamp');
  });
});

describe('diffApproveComparison', () => {
  const history = [DIFF_V1, DIFF_V2, DIFF_V3];

  // FM-7: the record must carry WHAT was reviewed and say that its scope is the comparison only.
  it('records the reviewed version ids and states its own scope', () => {
    const outcome = diffApproveComparison({
      history: history,
      reviewerId: 'staff-bruno',
      decision: 'approved',
      reviewedBaseVersionId: 'rep-2',
      reviewedTargetVersionId: 'rep-3',
      currentVersionId: 'rep-3',
      decidedAt: DIFF_T_NOW,
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.value.reviewedBaseVersionId).toBe('rep-2');
    expect(outcome.value.reviewedTargetVersionId).toBe('rep-3');
    expect(outcome.value.reviewedBaseOrdinal).toBe(2);
    expect(outcome.value.reviewedTargetOrdinal).toBe(3);
    expect(outcome.value.decidedAt).toBe(DIFF_T_NOW);
    expect(outcome.value.scope).toBe('comparison-only');
    expect(outcome.value.scopeMessage).toBe(DIFF_APPROVAL_SCOPE_TEXT);
    expect(outcome.value.message.indexOf('não é aprovação do conteúdo integral')).toBeGreaterThan(0);
  });

  // FM-7: without the ids, the approval is a bare "approved" that later reads as approval of the
  // whole report, including text the reviewer never opened.
  it('refuses an approval that does not name both reviewed versions', () => {
    const outcome = diffApproveComparison({
      history: history,
      reviewerId: 'staff-bruno',
      decision: 'approved',
      reviewedBaseVersionId: 'rep-2',
      reviewedTargetVersionId: '',
      currentVersionId: 'rep-3',
      decidedAt: DIFF_T_NOW,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('missing-reviewed-versions');
  });

  // FM-7: the resident saved v3 while the reviewer was reading v1 vs v2. Approving now would
  // stamp v3 as peer-reviewed although nobody read it.
  it('refuses an approval whose reviewed version is no longer the current one', () => {
    const outcome = diffApproveComparison({
      history: history,
      reviewerId: 'staff-bruno',
      decision: 'approved',
      reviewedBaseVersionId: 'rep-1',
      reviewedTargetVersionId: 'rep-2',
      currentVersionId: 'rep-3',
      decidedAt: DIFF_T_NOW,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('stale-review');
    expect(outcome.reason.indexOf('não é mais a versão atual')).toBeGreaterThan(0);
  });

  it('refuses an approval when the current version is unknown to the history', () => {
    const outcome = diffApproveComparison({
      history: history,
      reviewerId: 'staff-bruno',
      decision: 'approved',
      reviewedBaseVersionId: 'rep-2',
      reviewedTargetVersionId: 'rep-3',
      currentVersionId: 'rep-404',
      decidedAt: DIFF_T_NOW,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('stale-review');
  });

  // FM-8: the author signing off on their own version is not peer review, however the queue
  // happened to assign it.
  it('refuses self-review by the author of the reviewed version', () => {
    const outcome = diffApproveComparison({
      history: history,
      reviewerId: 'res-ana',
      decision: 'approved',
      reviewedBaseVersionId: 'rep-2',
      reviewedTargetVersionId: 'rep-3',
      currentVersionId: 'rep-3',
      decidedAt: DIFF_T_NOW,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('self-review');
  });

  // FM-9: a rejection with no reason goes back to the author with nothing to act on, and the same
  // discrepancy is released again.
  it('refuses a rejection with no written justification', () => {
    const blank = diffApproveComparison({
      history: history,
      reviewerId: 'staff-bruno',
      decision: 'rejected',
      reviewedBaseVersionId: 'rep-2',
      reviewedTargetVersionId: 'rep-3',
      currentVersionId: 'rep-3',
      decidedAt: DIFF_T_NOW,
      note: '   ',
    });
    expect(blank.ok).toBe(false);
    expect(blank.code).toBe('missing-rejection-note');
    const justified = diffApproveComparison({
      history: history,
      reviewerId: 'staff-bruno',
      decision: 'rejected',
      reviewedBaseVersionId: 'rep-2',
      reviewedTargetVersionId: 'rep-3',
      currentVersionId: 'rep-3',
      decidedAt: DIFF_T_NOW,
      note: '  Medida do nódulo divergente da imagem.  ',
    });
    expect(justified.ok).toBe(true);
    expect(justified.value.note).toBe('Medida do nódulo divergente da imagem.');
    expect(justified.value.decision).toBe('rejected');
  });

  it('refuses a decision without a reviewer, with an unknown decision, or with a bad timestamp', () => {
    const noReviewer = diffApproveComparison({
      history: history,
      reviewerId: '',
      decision: 'approved',
      reviewedBaseVersionId: 'rep-2',
      reviewedTargetVersionId: 'rep-3',
      currentVersionId: 'rep-3',
      decidedAt: DIFF_T_NOW,
    });
    expect(noReviewer.code).toBe('missing-reviewer');
    const malformed = {
      history: history,
      reviewerId: 'staff-bruno',
      decision: 'maybe',
      reviewedBaseVersionId: 'rep-2',
      reviewedTargetVersionId: 'rep-3',
      currentVersionId: 'rep-3',
      decidedAt: DIFF_T_NOW,
    } as unknown as DiffApprovalInput;
    const badDecision = diffApproveComparison(malformed);
    expect(badDecision.code).toBe('invalid-decision');
    const badTime = diffApproveComparison({
      history: history,
      reviewerId: 'staff-bruno',
      decision: 'approved',
      reviewedBaseVersionId: 'rep-2',
      reviewedTargetVersionId: 'rep-3',
      currentVersionId: 'rep-3',
      decidedAt: Infinity,
    });
    expect(badTime.code).toBe('invalid-timestamp');
  });

  it('refuses an approval whose two reviewed versions are the same version', () => {
    const outcome = diffApproveComparison({
      history: history,
      reviewerId: 'staff-bruno',
      decision: 'approved',
      reviewedBaseVersionId: 'rep-3',
      reviewedTargetVersionId: 'rep-3',
      currentVersionId: 'rep-3',
      decidedAt: DIFF_T_NOW,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('same-version');
  });
});
