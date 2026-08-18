/**
 * RTV-227 -- Review Queue: pure core for comparing two versions of a radiology report.
 *
 * This module is the part a peer reviewer's eyes actually depend on. It is framework-free:
 * no imports, no DOM, no clock, no randomness. Time always arrives as an epoch-ms `number`
 * parameter, and every refusal is RETURNED as a value ({ ok: false, code, reason }) so that
 * the UI has something concrete to render instead of an empty panel.
 *
 * Every guard below exists because of a named, concrete way a real reviewer signs off on a
 * report that says something different from what they believe they read:
 *
 * FM-1 "O decimal engolido" (the swallowed decimal). Generic text diffs normalise whitespace
 *      and punctuation to suppress noise. Under that normalisation "1,5 cm" and "15 cm" both
 *      reduce to "15cm" -- the diff reports NOTHING, or reports it as a punctuation tweak
 *      painted the same pale colour as a comma the transcriptionist moved. A 1,5 cm pulmonary
 *      nodule (follow-up in 6-12 months) becomes a 15 cm mass (urgent oncology referral), or
 *      the reverse, which is worse. It is hard to notice because it is a one-character span on
 *      a page where the reviewer's attention has been captured by a fully rewritten paragraph.
 *      Guard: numeric runs are tokenised WHOLE, including their decimal comma, and compared
 *      byte-exactly. Case/accent folding is applied to words only, never to digits.
 *
 * FM-2 "O nao perdido" (the dropped negation, the missing "não"). "Não há sinais de pneumotórax" -> "Há sinais
 *      de pneumotórax" is a three-letter deletion that inverts the report. Rendered by span size
 *      it is the smallest mark on the screen; rendered by risk it is the largest. Guard: risk
 *      is classified by CLASS (measurement, negation, laterality, category/grade), never by
 *      the number of characters touched.
 *
 * FM-3 "A troca de lado" (the laterality flip). "rim direito" -> "rim esquerdo" survives every
 *      spell check, reads perfectly, and can send a patient to surgery on the healthy kidney.
 *      Same guard as FM-2: laterality is its own high-risk class.
 *
 * FM-4 "A impressão silenciosa" (the silent impression). A count such as "4 alterações" tells
 *      the reviewer nothing about WHERE. The referring physician typically reads only the
 *      impression and the recommendation; a reviewer who assumes the edits were typo fixes in
 *      the findings can approve a changed impression without ever looking at it. Guard: the
 *      comparison is reported per section, and impression/recommendation/addendum are flagged
 *      as actionable sections, separately from the findings.
 *
 * FM-5 "O painel branco" (the blank panel). An empty diff list is visually identical to a diff
 *      that failed to load, timed out, or was computed against the wrong pair of versions. A
 *      reviewer reading "nothing here" as "nothing changed" approves text they never saw.
 *      Guard: "identical" is an explicit verdict with its own message, oversized inputs are an
 *      explicit refusal, and a version that arrives with no content at all is refused rather
 *      than rendered as "everything was deleted".
 *
 * FM-6 "O adendo fantasma" (the phantom addendum). Diffing v1 against v3 silently hides
 *      everything v2 said. The classic loss is an addendum added in v2 ("suspeita de embolia
 *      pulmonar, contatar o médico assistente") and removed again in v3: it never appears on
 *      either side of the comparison, so no reviewer ever reads it, yet it was a released
 *      version of the report. Guard: non-adjacent comparisons are detected, the skipped
 *      versions are named, and section kinds that existed ONLY in the skipped versions are
 *      listed explicitly.
 *
 * FM-7 "A aprovação por procuração" (approval by proxy). Approving a diff is not approving a
 *      report. If the reviewer studied v2 -> v3 while the resident saved v4, an approval that
 *      records only "approved" stamps unreviewed text as peer-reviewed. Guard: an approval
 *      carries the two reviewed version ids and is refused when the reviewed target is no
 *      longer the current version; the record states its own scope in words.
 *
 * FM-8 "A revisão pelo próprio autor" (self-review): peer review by the author of the version
 *      under review is not peer review. Refused.
 *
 * FM-9 "A rejeição muda" (the mute rejection): a rejection with no justification returns to the
 *      author with no idea of what to change, and the discrepancy is re-released unchanged.
 *      Refused.
 *
 * Naming: every exported identifier is prefixed diff / Diff / DIFF_ because this module joins a
 * barrel with 18 other modules and a duplicate exported name breaks it at runtime.
 *
 * Compile note: this repo's tsconfig has `strictNullChecks` OFF, so TypeScript does not narrow a
 * union keyed on a boolean literal. Every result union therefore declares the absent members
 * explicitly (`reason?: undefined`, `value?: undefined`).
 */

/* ------------------------------------------------------------------ *
 * Risk model
 * ------------------------------------------------------------------ */

export type DiffRiskClass = 'measurement' | 'negation' | 'laterality' | 'category' | 'wording';

export type DiffRiskLevel = 'high' | 'low' | 'none';

/**
 * Precedence used to pick the single headline class of a span. Negation and laterality come
 * first because they invert meaning; a measurement change scales it; a category change changes
 * management. `riskClasses` on the span keeps ALL matched classes so nothing is lost.
 */
export const DIFF_RISK_CLASS_PRECEDENCE: readonly DiffRiskClass[] = [
  'negation',
  'laterality',
  'measurement',
  'category',
  'wording',
];

export const DIFF_HIGH_RISK_CLASSES: readonly DiffRiskClass[] = [
  'measurement',
  'negation',
  'laterality',
  'category',
];

/** FM-2: negation lexicon, accent-folded and lower-cased. */
export const DIFF_NEGATION_TERMS: readonly string[] = [
  'nao',
  'sem',
  'ausencia',
  'ausente',
  'ausentes',
  'nega',
  'negado',
  'negativo',
  'negativa',
  'nenhum',
  'nenhuma',
  'descartado',
  'descartada',
  'descarta',
  'excluido',
  'excluida',
  'inexistente',
  'improvavel',
];

/** FM-3: laterality lexicon, accent-folded and lower-cased. */
export const DIFF_LATERALITY_TERMS: readonly string[] = [
  'direito',
  'direita',
  'direitos',
  'direitas',
  'esquerdo',
  'esquerda',
  'esquerdos',
  'esquerdas',
  'bilateral',
  'bilaterais',
  'unilateral',
  'contralateral',
  'ipsilateral',
];

/** Category / grade lexicon: changes here change management, not prose. */
export const DIFF_CATEGORY_TERMS: readonly string[] = [
  'birads',
  'bi-rads',
  'pirads',
  'pi-rads',
  'lirads',
  'li-rads',
  'tirads',
  'ti-rads',
  'lung-rads',
  'rads',
  'bosniak',
  'fleischner',
  'gleason',
  'aspects',
  'grau',
  'graus',
  'categoria',
  'estadio',
  'classificacao',
  'classe',
  'benigno',
  'benigna',
  'maligno',
  'maligna',
  'suspeito',
  'suspeita',
  'indeterminado',
  'indeterminada',
];

/** Unit lexicon: "1,5 cm" -> "1,5 mm" keeps the digits and changes the size tenfold. */
export const DIFF_UNIT_TERMS: readonly string[] = [
  'mm',
  'cm',
  'm',
  'ml',
  'cc',
  'l',
  'mg',
  'g',
  'kg',
  'hu',
  'ui',
  'msv',
  'mgy',
  'bpm',
  'mmhg',
  'seg',
  's',
  'min',
  'h',
];

/* ------------------------------------------------------------------ *
 * Report shape
 * ------------------------------------------------------------------ */

export type DiffSectionKind =
  | 'clinicalHistory'
  | 'technique'
  | 'comparison'
  | 'findings'
  | 'impression'
  | 'recommendation'
  | 'addendum'
  | 'other';

export const DIFF_SECTION_ORDER: readonly DiffSectionKind[] = [
  'clinicalHistory',
  'technique',
  'comparison',
  'findings',
  'impression',
  'recommendation',
  'addendum',
  'other',
];

export const DIFF_SECTION_LABELS: { [kind: string]: string } = {
  clinicalHistory: 'História clínica',
  technique: 'Técnica',
  comparison: 'Comparação com exames anteriores',
  findings: 'Achados',
  impression: 'Impressão diagnóstica',
  recommendation: 'Conduta e recomendações',
  addendum: 'Adendo',
  other: 'Outra seção',
};

/**
 * FM-4: sections the referring physician reads and acts on. A change here is never "cosmetic",
 * whatever its risk class, because it is the text that turns into a phone call or a referral.
 */
export const DIFF_ACTIONABLE_SECTION_KINDS: readonly DiffSectionKind[] = [
  'impression',
  'recommendation',
  'addendum',
];

export interface DiffReportSection {
  kind: DiffSectionKind;
  text: string;
}

export interface DiffReportVersion {
  id: string;
  /** Monotonic version number within the report (v1, v2, v3 ...). */
  ordinal: number;
  /** Epoch ms, supplied by the caller. Never read from a clock inside this module. */
  savedAt: number;
  authorId: string;
  sections: DiffReportSection[];
}

/* ------------------------------------------------------------------ *
 * Tokens, spans, results
 * ------------------------------------------------------------------ */

export type DiffTokenKind = 'word' | 'number' | 'punct' | 'space';

export interface DiffToken {
  text: string;
  kind: DiffTokenKind;
  /** Index of the first character in the source text; lets the UI paint the exact span. */
  start: number;
}

export type DiffOpKind = 'equal' | 'delete' | 'insert';

export interface DiffTokenOp {
  kind: DiffOpKind;
  tokens: DiffToken[];
}

export interface DiffSpanClassification {
  riskClass: DiffRiskClass;
  riskLevel: DiffRiskLevel;
  riskClasses: DiffRiskClass[];
  message: string;
}

export interface DiffChangeSpan {
  removed: string;
  added: string;
  riskClass: DiffRiskClass;
  riskLevel: DiffRiskLevel;
  riskClasses: DiffRiskClass[];
  message: string;
  /** Nearest unchanged token on each side, so a tiny span such as "nao" can still be located. */
  contextBefore: string;
  contextAfter: string;
  beforeTokenIndex: number;
  afterTokenIndex: number;
}

export type DiffSectionPresence = 'both' | 'only-before' | 'only-after';

export interface DiffSectionTextResult {
  changed: boolean;
  spans: DiffChangeSpan[];
  riskLevel: DiffRiskLevel;
  riskClasses: DiffRiskClass[];
}

export interface DiffSectionComparison {
  kind: DiffSectionKind;
  label: string;
  presence: DiffSectionPresence;
  actionable: boolean;
  changed: boolean;
  spans: DiffChangeSpan[];
  riskLevel: DiffRiskLevel;
  riskClasses: DiffRiskClass[];
  message: string;
}

export interface DiffSkippedVersion {
  id: string;
  ordinal: number;
  savedAt: number;
  authorId: string;
}

export interface DiffAdjacency {
  adjacent: boolean;
  skipped: DiffSkippedVersion[];
  /** FM-6: section kinds that existed only in the skipped versions -- invisible in this diff. */
  hiddenSectionKinds: DiffSectionKind[];
  message: string;
}

export type DiffVerdictKind = 'identical' | 'wording-only' | 'significant';

export const DIFF_VERDICT_IDENTICAL: DiffVerdictKind = 'identical';
export const DIFF_VERDICT_WORDING_ONLY: DiffVerdictKind = 'wording-only';
export const DIFF_VERDICT_SIGNIFICANT: DiffVerdictKind = 'significant';

export interface DiffComparison {
  baseVersionId: string;
  targetVersionId: string;
  baseOrdinal: number;
  targetOrdinal: number;
  comparedAt: number;
  verdict: DiffVerdictKind;
  /** Always a non-empty sentence, including when nothing changed (FM-5). */
  verdictMessage: string;
  sections: DiffSectionComparison[];
  changedSectionKinds: DiffSectionKind[];
  impressionChanged: boolean;
  actionableChanged: boolean;
  /** True when there are changes but none of them touch an actionable section. */
  findingsOnly: boolean;
  impressionMessage: string;
  highRiskSpanCount: number;
  totalSpanCount: number;
  adjacency: DiffAdjacency;
  warnings: string[];
}

export type DiffRefusalCode =
  | 'invalid-timestamp'
  | 'empty-history'
  | 'invalid-version-entry'
  | 'duplicate-version-id'
  | 'duplicate-ordinal'
  | 'unknown-base-version'
  | 'unknown-target-version'
  | 'same-version'
  | 'reversed-order'
  | 'duplicate-section'
  | 'empty-version-content'
  | 'section-too-large'
  | 'missing-reviewer'
  | 'missing-reviewed-versions'
  | 'stale-review'
  | 'self-review'
  | 'invalid-decision'
  | 'missing-rejection-note';

export type DiffSectionTextOutcome =
  | { ok: true; value: DiffSectionTextResult; code?: undefined; reason?: undefined }
  | { ok: false; code: DiffRefusalCode; reason: string; value?: undefined };

export type DiffCompareOutcome =
  | { ok: true; value: DiffComparison; code?: undefined; reason?: undefined }
  | { ok: false; code: DiffRefusalCode; reason: string; value?: undefined };

export interface DiffCompareInput {
  /** Full known history of the report. Needed to detect skipped versions (FM-6). */
  history: DiffReportVersion[];
  baseVersionId: string;
  targetVersionId: string;
  /** Epoch ms supplied by the caller. */
  comparedAt: number;
}

/**
 * FM-5: hard ceiling per section. Above it the DP diff would take long enough that the UI
 * renders an empty panel, which a reviewer reads as "no changes". An explicit refusal is safe;
 * a slow blank panel is not.
 */
export const DIFF_MAX_TOKENS_PER_SECTION = 1200;

/* ------------------------------------------------------------------ *
 * Character helpers (no imports: accent folding is an explicit table)
 * ------------------------------------------------------------------ */

const DIFF_ACCENT_SOURCE = 'áàâãäéèêëíìîïóòôõöúùûüçñý' + 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑÝ';
const DIFF_ACCENT_TARGET = 'aaaaaeeeeiiiiooooouuuucny' + 'AAAAAEEEEIIIIOOOOOUUUUCNY';

function diffFoldChar(ch: string): string {
  const at = DIFF_ACCENT_SOURCE.indexOf(ch);
  if (at < 0) {
    return ch;
  }
  return DIFF_ACCENT_TARGET.charAt(at);
}

/**
 * Case- and accent-folding for WORDS ONLY. "nodulo" and "nódulo" are the same clinical claim, so
 * folding them removes noise. Applying the same folding to digits is exactly FM-1, so
 * `diffTokenKey` never folds a numeric token.
 */
export function diffFoldWord(text: string): string {
  const source = typeof text === 'string' ? text : '';
  let out = '';
  for (let i = 0; i < source.length; i += 1) {
    out += diffFoldChar(source.charAt(i));
  }
  return out.toLowerCase();
}

function diffIsSpaceChar(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v';
}

function diffIsDigitChar(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function diffIsLetterChar(ch: string): boolean {
  if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) {
    return true;
  }
  // Latin-1 letters, excluding the multiplication and division signs.
  const code = ch.charCodeAt(0);
  if (code >= 0x00c0 && code <= 0x00ff && code !== 0x00d7 && code !== 0x00f7) {
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * Tokenisation
 * ------------------------------------------------------------------ */

/**
 * Splits text into words, whole numeric runs, punctuation and whitespace.
 *
 * FM-1: a numeric run keeps its internal separators ("1,5", "1.500,25", "3.5") as ONE token, so
 * a lost decimal comma can never be reported as punctuation noise; it becomes a different token
 * and therefore a measurement change.
 */
export function diffTokenize(text: string): DiffToken[] {
  const source = typeof text === 'string' ? text : '';
  const tokens: DiffToken[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source.charAt(i);
    const start = i;
    if (diffIsSpaceChar(ch)) {
      let run = '';
      while (i < source.length && diffIsSpaceChar(source.charAt(i))) {
        run += source.charAt(i);
        i += 1;
      }
      tokens.push({ text: run, kind: 'space', start: start });
      continue;
    }
    if (diffIsDigitChar(ch)) {
      let run = '';
      while (i < source.length) {
        const cur = source.charAt(i);
        if (diffIsDigitChar(cur)) {
          run += cur;
          i += 1;
          continue;
        }
        // A separator stays inside the number only when a digit follows it.
        if ((cur === ',' || cur === '.') && i + 1 < source.length && diffIsDigitChar(source.charAt(i + 1))) {
          run += cur;
          i += 1;
          continue;
        }
        break;
      }
      tokens.push({ text: run, kind: 'number', start: start });
      continue;
    }
    if (diffIsLetterChar(ch)) {
      let run = '';
      while (i < source.length) {
        const cur = source.charAt(i);
        if (diffIsLetterChar(cur) || diffIsDigitChar(cur)) {
          run += cur;
          i += 1;
          continue;
        }
        // Keep "BI-RADS" and "Lung-RADS" together, but only when a letter follows the hyphen.
        if (cur === '-' && i + 1 < source.length && diffIsLetterChar(source.charAt(i + 1))) {
          run += cur;
          i += 1;
          continue;
        }
        break;
      }
      tokens.push({ text: run, kind: 'word', start: start });
      continue;
    }
    tokens.push({ text: ch, kind: 'punct', start: start });
    i += 1;
  }
  return tokens;
}

/** Tokens that carry meaning: whitespace is dropped, everything else is kept. */
export function diffSignificantTokens(text: string): DiffToken[] {
  const all = diffTokenize(text);
  const out: DiffToken[] = [];
  for (let i = 0; i < all.length; i += 1) {
    if (all[i].kind !== 'space') {
      out.push(all[i]);
    }
  }
  return out;
}

/**
 * Equality key for the diff. Words are folded (case + accents), numbers and punctuation are NOT
 * (FM-1). The `n:` / `w:` / `p:` prefixes keep a word from ever matching a number.
 */
export function diffTokenKey(token: DiffToken): string {
  if (!token) {
    return '';
  }
  if (token.kind === 'number') {
    return 'n:' + token.text;
  }
  if (token.kind === 'punct') {
    return 'p:' + token.text;
  }
  return 'w:' + diffFoldWord(token.text);
}

export interface DiffNumericValue {
  valid: boolean;
  value: number;
  /** Canonical dot-decimal form, for display and for factor arithmetic. */
  canonical: string;
}

/**
 * Parses a Brazilian numeric literal. "1,5" -> 1.5; "1.500" -> 1500; "1.500,25" -> 1500.25;
 * "3.5" -> 3.5. Never throws: an unparseable token comes back with valid === false, and callers
 * fall back to a plain textual "x -> y" message rather than inventing a magnitude.
 */
export function diffParseNumber(raw: string): DiffNumericValue {
  const text = typeof raw === 'string' ? raw : '';
  if (text.length === 0) {
    return { valid: false, value: 0, canonical: '' };
  }
  const hasComma = text.indexOf(',') >= 0;
  const dotCount = text.split('.').length - 1;
  let normalised = text;
  if (hasComma) {
    // Comma is the decimal separator; any dots are thousands separators.
    normalised = text.split('.').join('');
    normalised = normalised.split(',').join('.');
  } else if (dotCount === 1) {
    const parts = text.split('.');
    if (parts[1].length === 3 && parts[0].length <= 3 && parts[0].charAt(0) !== '0') {
      // "1.500" is one thousand five hundred, not one point five.
      normalised = parts[0] + parts[1];
    }
  } else if (dotCount > 1) {
    normalised = text.split('.').join('');
  }
  const value = Number(normalised);
  if (typeof value !== 'number' || !isFinite(value)) {
    return { valid: false, value: 0, canonical: '' };
  }
  return { valid: true, value: value, canonical: normalised };
}

function diffFormatFactor(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return String(rounded).split('.').join(',');
}

/* ------------------------------------------------------------------ *
 * Token-level diff (self-contained, no libraries)
 * ------------------------------------------------------------------ */

const DIFF_MAX_DP_CELLS = DIFF_MAX_TOKENS_PER_SECTION * DIFF_MAX_TOKENS_PER_SECTION;

/**
 * Longest-common-subsequence diff over significant tokens. Common prefix and suffix are trimmed
 * first, then a DP matrix over the middle. If the middle is still too large the whole middle is
 * reported as one delete + one insert: coarse, but never silently empty (FM-5). The section-level
 * entry point refuses oversized input before it ever gets here.
 */
export function diffTokenDiff(before: DiffToken[], after: DiffToken[]): DiffTokenOp[] {
  const a: DiffToken[] = [];
  const b: DiffToken[] = [];
  const sourceA = before || [];
  const sourceB = after || [];
  for (let i = 0; i < sourceA.length; i += 1) {
    if (sourceA[i] && sourceA[i].kind !== 'space') {
      a.push(sourceA[i]);
    }
  }
  for (let i = 0; i < sourceB.length; i += 1) {
    if (sourceB[i] && sourceB[i].kind !== 'space') {
      b.push(sourceB[i]);
    }
  }

  const keyA: string[] = [];
  const keyB: string[] = [];
  for (let i = 0; i < a.length; i += 1) {
    keyA.push(diffTokenKey(a[i]));
  }
  for (let i = 0; i < b.length; i += 1) {
    keyB.push(diffTokenKey(b[i]));
  }

  let head = 0;
  while (head < a.length && head < b.length && keyA[head] === keyB[head]) {
    head += 1;
  }
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    keyA[a.length - 1 - tail] === keyB[b.length - 1 - tail]
  ) {
    tail += 1;
  }

  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  const midKeyA = keyA.slice(head, keyA.length - tail);
  const midKeyB = keyB.slice(head, keyB.length - tail);

  const ops: DiffTokenOp[] = [];
  if (head > 0) {
    ops.push({ kind: 'equal', tokens: a.slice(0, head) });
  }

  if (midA.length === 0 && midB.length > 0) {
    ops.push({ kind: 'insert', tokens: midB });
  } else if (midB.length === 0 && midA.length > 0) {
    ops.push({ kind: 'delete', tokens: midA });
  } else if (midA.length > 0 && midB.length > 0) {
    if (midA.length * midB.length > DIFF_MAX_DP_CELLS) {
      ops.push({ kind: 'delete', tokens: midA });
      ops.push({ kind: 'insert', tokens: midB });
    } else {
      const rows: Int32Array[] = [];
      for (let i = 0; i <= midA.length; i += 1) {
        rows.push(new Int32Array(midB.length + 1));
      }
      for (let i = midA.length - 1; i >= 0; i -= 1) {
        for (let j = midB.length - 1; j >= 0; j -= 1) {
          if (midKeyA[i] === midKeyB[j]) {
            rows[i][j] = rows[i + 1][j + 1] + 1;
          } else {
            rows[i][j] = rows[i + 1][j] >= rows[i][j + 1] ? rows[i + 1][j] : rows[i][j + 1];
          }
        }
      }
      let i = 0;
      let j = 0;
      while (i < midA.length && j < midB.length) {
        if (midKeyA[i] === midKeyB[j]) {
          diffPushOp(ops, 'equal', midA[i]);
          i += 1;
          j += 1;
        } else if (rows[i + 1][j] >= rows[i][j + 1]) {
          diffPushOp(ops, 'delete', midA[i]);
          i += 1;
        } else {
          diffPushOp(ops, 'insert', midB[j]);
          j += 1;
        }
      }
      while (i < midA.length) {
        diffPushOp(ops, 'delete', midA[i]);
        i += 1;
      }
      while (j < midB.length) {
        diffPushOp(ops, 'insert', midB[j]);
        j += 1;
      }
    }
  }

  if (tail > 0) {
    ops.push({ kind: 'equal', tokens: a.slice(a.length - tail) });
  }
  return ops;
}

function diffPushOp(ops: DiffTokenOp[], kind: DiffOpKind, token: DiffToken): void {
  const last = ops.length > 0 ? ops[ops.length - 1] : null;
  if (last && last.kind === kind) {
    last.tokens.push(token);
    return;
  }
  ops.push({ kind: kind, tokens: [token] });
}

/** Renders a token run back into readable text (no space before punctuation). */
export function diffJoinTokens(tokens: DiffToken[]): string {
  const list = tokens || [];
  let out = '';
  for (let i = 0; i < list.length; i += 1) {
    const token = list[i];
    if (!token) {
      continue;
    }
    if (out.length > 0 && token.kind !== 'punct') {
      out += ' ';
    }
    out += token.text;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Risk classification over spans
 * ------------------------------------------------------------------ */

function diffBuildLookup(terms: readonly string[]): { [key: string]: boolean } {
  const map: { [key: string]: boolean } = {};
  for (let i = 0; i < terms.length; i += 1) {
    map[terms[i]] = true;
  }
  return map;
}

const DIFF_NEGATION_LOOKUP = diffBuildLookup(DIFF_NEGATION_TERMS);
const DIFF_LATERALITY_LOOKUP = diffBuildLookup(DIFF_LATERALITY_TERMS);
const DIFF_CATEGORY_LOOKUP = diffBuildLookup(DIFF_CATEGORY_TERMS);
const DIFF_UNIT_LOOKUP = diffBuildLookup(DIFF_UNIT_TERMS);

function diffCollectNumbers(tokens: DiffToken[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].kind === 'number') {
      out.push(tokens[i].text);
    }
  }
  out.sort();
  return out;
}

function diffCollectTerms(tokens: DiffToken[], lookup: { [key: string]: boolean }): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.kind !== 'word') {
      continue;
    }
    const folded = diffFoldWord(token.text);
    if (lookup[folded]) {
      out.push(folded);
    }
  }
  out.sort();
  return out;
}

function diffCountPercent(tokens: DiffToken[]): number {
  let count = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].kind === 'punct' && tokens[i].text === '%') {
      count += 1;
    }
  }
  return count;
}

function diffSameList(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return false;
    }
  }
  return true;
}

function diffQuoteList(items: string[]): string {
  const parts: string[] = [];
  for (let i = 0; i < items.length; i += 1) {
    parts.push('"' + items[i] + '"');
  }
  return parts.join(', ');
}

/**
 * Classifies one changed span by RISK CLASS, never by size (FM-1, FM-2, FM-3).
 *
 * A one-character span ("1,5" -> "15", or a deleted "nao") outranks a fully rewritten paragraph,
 * because the reviewer's job is to catch meaning changes, and a UI that sorts by span length puts
 * exactly the wrong change at the bottom of the list.
 */
export function diffClassifySpan(
  removedTokens: DiffToken[],
  addedTokens: DiffToken[]
): DiffSpanClassification {
  const removed = removedTokens || [];
  const added = addedTokens || [];
  const classes: DiffRiskClass[] = [];
  const notes: string[] = [];

  const removedNumbers = diffCollectNumbers(removed);
  const addedNumbers = diffCollectNumbers(added);
  const removedUnits = diffCollectTerms(removed, DIFF_UNIT_LOOKUP);
  const addedUnits = diffCollectTerms(added, DIFF_UNIT_LOOKUP);
  const numbersDiffer = !diffSameList(removedNumbers, addedNumbers);
  const unitsDiffer = !diffSameList(removedUnits, addedUnits);
  const percentDiffers = diffCountPercent(removed) !== diffCountPercent(added);

  if (numbersDiffer || unitsDiffer || percentDiffers) {
    classes.push('measurement');
    notes.push(diffMeasurementNote(removedNumbers, addedNumbers, removedUnits, addedUnits));
  }

  const removedNeg = diffCollectTerms(removed, DIFF_NEGATION_LOOKUP);
  const addedNeg = diffCollectTerms(added, DIFF_NEGATION_LOOKUP);
  if (!diffSameList(removedNeg, addedNeg)) {
    classes.push('negation');
    if (removedNeg.length > 0 && addedNeg.length === 0) {
      notes.push(
        'Negação removida (' +
          diffQuoteList(removedNeg) +
          '): o laudo passou a afirmar o que antes negava.'
      );
    } else if (addedNeg.length > 0 && removedNeg.length === 0) {
      notes.push(
        'Negação inserida (' +
          diffQuoteList(addedNeg) +
          '): o laudo passou a negar o que antes afirmava.'
      );
    } else {
      notes.push(
        'Termo de negação alterado (' +
          diffQuoteList(removedNeg) +
          ' -> ' +
          diffQuoteList(addedNeg) +
          ').'
      );
    }
  }

  const removedLat = diffCollectTerms(removed, DIFF_LATERALITY_LOOKUP);
  const addedLat = diffCollectTerms(added, DIFF_LATERALITY_LOOKUP);
  if (!diffSameList(removedLat, addedLat)) {
    classes.push('laterality');
    notes.push(
      'Lateralidade alterada (' +
        (removedLat.length > 0 ? diffQuoteList(removedLat) : 'ausente') +
        ' -> ' +
        (addedLat.length > 0 ? diffQuoteList(addedLat) : 'ausente') +
        '): confira o lado contra a imagem.'
    );
  }

  const removedCat = diffCollectTerms(removed, DIFF_CATEGORY_LOOKUP);
  const addedCat = diffCollectTerms(added, DIFF_CATEGORY_LOOKUP);
  if (!diffSameList(removedCat, addedCat)) {
    classes.push('category');
    notes.push(
      'Categoria ou grau alterado (' +
        (removedCat.length > 0 ? diffQuoteList(removedCat) : 'ausente') +
        ' -> ' +
        (addedCat.length > 0 ? diffQuoteList(addedCat) : 'ausente') +
        '): muda a conduta recomendada.'
    );
  }

  if (classes.length === 0) {
    classes.push('wording');
    if (removed.length === 0) {
      notes.push('Trecho acrescentado sem alteração detectada de medida, negação, lado ou categoria.');
    } else if (added.length === 0) {
      notes.push('Trecho removido sem alteração detectada de medida, negação, lado ou categoria.');
    } else {
      notes.push('Alteração de redação sem impacto detectado de medida, negação, lado ou categoria.');
    }
  }

  const ordered: DiffRiskClass[] = [];
  for (let i = 0; i < DIFF_RISK_CLASS_PRECEDENCE.length; i += 1) {
    const candidate = DIFF_RISK_CLASS_PRECEDENCE[i];
    for (let j = 0; j < classes.length; j += 1) {
      if (classes[j] === candidate) {
        ordered.push(candidate);
        break;
      }
    }
  }

  const headline = ordered[0];
  return {
    riskClass: headline,
    riskLevel: diffRiskLevelOfClass(headline),
    riskClasses: ordered,
    message: notes.join(' '),
  };
}

function diffMeasurementNote(
  removedNumbers: string[],
  addedNumbers: string[],
  removedUnits: string[],
  addedUnits: string[]
): string {
  const unitsDiffer = !diffSameList(removedUnits, addedUnits);
  if (removedNumbers.length === 0 && addedNumbers.length === 0) {
    if (unitsDiffer) {
      // "8 cm" -> "8 mm": every digit identical, the lesion ten times smaller.
      return (
        'Unidade de medida alterada (' +
        (removedUnits.length > 0 ? diffQuoteList(removedUnits) : 'ausente') +
        ' -> ' +
        (addedUnits.length > 0 ? diffQuoteList(addedUnits) : 'ausente') +
        '). Confira contra a imagem antes de aprovar.'
      );
    }
    return 'Valor percentual alterado nesta medida. Confira contra a imagem antes de aprovar.';
  }
  const from = removedNumbers.length > 0 ? removedNumbers.join(' ') : 'ausente';
  const to = addedNumbers.length > 0 ? addedNumbers.join(' ') : 'ausente';
  let note = 'Medida alterada: "' + from + '" -> "' + to + '"';
  if (removedNumbers.length === 1 && addedNumbers.length === 1) {
    const before = diffParseNumber(removedNumbers[0]);
    const afterValue = diffParseNumber(addedNumbers[0]);
    if (before.valid && afterValue.valid && before.value > 0 && afterValue.value > 0) {
      if (afterValue.value / before.value >= 1.5) {
        note += ' (aumento de cerca de ' + diffFormatFactor(afterValue.value / before.value) + 'x)';
      } else if (before.value / afterValue.value >= 1.5) {
        note += ' (redução de cerca de ' + diffFormatFactor(before.value / afterValue.value) + 'x)';
      }
    }
  }
  if (unitsDiffer) {
    note +=
      '; unidade alterada (' +
      (removedUnits.length > 0 ? diffQuoteList(removedUnits) : 'ausente') +
      ' -> ' +
      (addedUnits.length > 0 ? diffQuoteList(addedUnits) : 'ausente') +
      ')';
  }
  return note + '. Confira contra a imagem antes de aprovar.';
}

export function diffRiskLevelOfClass(riskClass: DiffRiskClass): DiffRiskLevel {
  for (let i = 0; i < DIFF_HIGH_RISK_CLASSES.length; i += 1) {
    if (DIFF_HIGH_RISK_CLASSES[i] === riskClass) {
      return 'high';
    }
  }
  return 'low';
}

export function diffHighestRiskLevel(spans: DiffChangeSpan[]): DiffRiskLevel {
  const list = spans || [];
  if (list.length === 0) {
    return 'none';
  }
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].riskLevel === 'high') {
      return 'high';
    }
  }
  return 'low';
}

/* ------------------------------------------------------------------ *
 * Section-level comparison
 * ------------------------------------------------------------------ */

/**
 * Diffs the text of one section and classifies every changed span.
 *
 * FM-5: an oversized section is refused with a code, so the panel can say why it is empty
 * instead of looking like a report that did not change.
 */
export function diffCompareSectionText(before: string, after: string): DiffSectionTextOutcome {
  const beforeTokens = diffSignificantTokens(before);
  const afterTokens = diffSignificantTokens(after);
  if (
    beforeTokens.length > DIFF_MAX_TOKENS_PER_SECTION ||
    afterTokens.length > DIFF_MAX_TOKENS_PER_SECTION
  ) {
    return {
      ok: false,
      code: 'section-too-large',
      reason:
        'Seção longa demais para comparação automática (limite de ' +
        DIFF_MAX_TOKENS_PER_SECTION +
        ' termos por seção). Compare manualmente: um painel vazio aqui não significa que nada mudou.',
    };
  }

  const ops = diffTokenDiff(beforeTokens, afterTokens);
  const spans: DiffChangeSpan[] = [];
  let pendingRemoved: DiffToken[] = [];
  let pendingAdded: DiffToken[] = [];
  let lastEqual = '';
  let beforeIndex = 0;
  let afterIndex = 0;
  let spanBeforeIndex = 0;
  let spanAfterIndex = 0;
  let spanOpen = false;

  function flush(contextAfter: string): void {
    if (!spanOpen) {
      return;
    }
    const classification = diffClassifySpan(pendingRemoved, pendingAdded);
    spans.push({
      removed: diffJoinTokens(pendingRemoved),
      added: diffJoinTokens(pendingAdded),
      riskClass: classification.riskClass,
      riskLevel: classification.riskLevel,
      riskClasses: classification.riskClasses,
      message: classification.message,
      contextBefore: lastEqual,
      contextAfter: contextAfter,
      beforeTokenIndex: spanBeforeIndex,
      afterTokenIndex: spanAfterIndex,
    });
    pendingRemoved = [];
    pendingAdded = [];
    spanOpen = false;
  }

  for (let i = 0; i < ops.length; i += 1) {
    const op = ops[i];
    if (op.kind === 'equal') {
      flush(op.tokens.length > 0 ? op.tokens[0].text : '');
      lastEqual = op.tokens.length > 0 ? op.tokens[op.tokens.length - 1].text : lastEqual;
      beforeIndex += op.tokens.length;
      afterIndex += op.tokens.length;
      continue;
    }
    if (!spanOpen) {
      spanOpen = true;
      spanBeforeIndex = beforeIndex;
      spanAfterIndex = afterIndex;
    }
    if (op.kind === 'delete') {
      for (let j = 0; j < op.tokens.length; j += 1) {
        pendingRemoved.push(op.tokens[j]);
      }
      beforeIndex += op.tokens.length;
    } else {
      for (let j = 0; j < op.tokens.length; j += 1) {
        pendingAdded.push(op.tokens[j]);
      }
      afterIndex += op.tokens.length;
    }
  }
  flush('');

  const riskClasses: DiffRiskClass[] = [];
  for (let i = 0; i < DIFF_RISK_CLASS_PRECEDENCE.length; i += 1) {
    const candidate = DIFF_RISK_CLASS_PRECEDENCE[i];
    let found = false;
    for (let j = 0; j < spans.length && !found; j += 1) {
      for (let k = 0; k < spans[j].riskClasses.length; k += 1) {
        if (spans[j].riskClasses[k] === candidate) {
          found = true;
          break;
        }
      }
    }
    if (found) {
      riskClasses.push(candidate);
    }
  }

  return {
    ok: true,
    value: {
      changed: spans.length > 0,
      spans: spans,
      riskLevel: diffHighestRiskLevel(spans),
      riskClasses: riskClasses,
    },
  };
}

export function diffSectionLabel(kind: DiffSectionKind): string {
  const label = DIFF_SECTION_LABELS[kind];
  return label ? label : String(kind);
}

export function diffIsActionableSection(kind: DiffSectionKind): boolean {
  for (let i = 0; i < DIFF_ACTIONABLE_SECTION_KINDS.length; i += 1) {
    if (DIFF_ACTIONABLE_SECTION_KINDS[i] === kind) {
      return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * Version comparison
 * ------------------------------------------------------------------ */

function diffSectionMap(
  version: DiffReportVersion
): { ok: boolean; map: { [kind: string]: string }; duplicate: string } {
  const map: { [kind: string]: string } = {};
  const sections = version.sections || [];
  for (let i = 0; i < sections.length; i += 1) {
    const section = sections[i];
    if (!section) {
      continue;
    }
    const kind = String(section.kind);
    if (Object.prototype.hasOwnProperty.call(map, kind)) {
      return { ok: false, map: map, duplicate: kind };
    }
    map[kind] = typeof section.text === 'string' ? section.text : '';
  }
  return { ok: true, map: map, duplicate: '' };
}

function diffHasContent(map: { [kind: string]: string }): boolean {
  const keys = Object.keys(map);
  for (let i = 0; i < keys.length; i += 1) {
    if (diffSignificantTokens(map[keys[i]]).length > 0) {
      return true;
    }
  }
  return false;
}

function diffSortedSectionKinds(
  beforeMap: { [kind: string]: string },
  afterMap: { [kind: string]: string }
): DiffSectionKind[] {
  const seen: { [kind: string]: boolean } = {};
  const ordered: DiffSectionKind[] = [];
  for (let i = 0; i < DIFF_SECTION_ORDER.length; i += 1) {
    const kind = DIFF_SECTION_ORDER[i];
    if (
      Object.prototype.hasOwnProperty.call(beforeMap, kind) ||
      Object.prototype.hasOwnProperty.call(afterMap, kind)
    ) {
      ordered.push(kind);
      seen[kind] = true;
    }
  }
  const extras = Object.keys(beforeMap).concat(Object.keys(afterMap));
  for (let i = 0; i < extras.length; i += 1) {
    if (!seen[extras[i]]) {
      seen[extras[i]] = true;
      ordered.push(extras[i] as DiffSectionKind);
    }
  }
  return ordered;
}

/**
 * Compares two versions of the report.
 *
 * Refuses instead of guessing whenever the inputs cannot support a comparison a reviewer may
 * safely trust: unknown ids, a version compared against itself, a backwards pair (which would
 * paint a deleted finding green as if it had just been added), duplicated section kinds (one of
 * the two would silently win and the reviewer would diff the wrong text), or a version that
 * arrived with no content at all (a partial load rendered as "the whole report was deleted"
 * invites the reviewer to approve a deletion nobody made).
 */
export function diffCompareVersions(input: DiffCompareInput): DiffCompareOutcome {
  const request = input || ({} as DiffCompareInput);

  // Guard: a comparison whose timestamp is not a real epoch cannot be ordered in the audit trail,
  // so a later "which review came first" question has no answer.
  if (typeof request.comparedAt !== 'number' || !isFinite(request.comparedAt)) {
    return {
      ok: false,
      code: 'invalid-timestamp',
      reason: 'Momento da comparação inválido: informe o instante em milissegundos (epoch).',
    };
  }

  const history = request.history || [];
  if (history.length === 0) {
    return {
      ok: false,
      code: 'empty-history',
      reason: 'Histórico de versões vazio: não há o que comparar nesta fila de revisão.',
    };
  }

  const byId: { [id: string]: DiffReportVersion } = {};
  const byOrdinal: { [ordinal: string]: boolean } = {};
  for (let i = 0; i < history.length; i += 1) {
    const version = history[i];
    if (
      !version ||
      typeof version.id !== 'string' ||
      version.id.length === 0 ||
      typeof version.ordinal !== 'number' ||
      !isFinite(version.ordinal)
    ) {
      return {
        ok: false,
        code: 'invalid-version-entry',
        reason: 'Histórico com versão inválida: toda versão precisa de identificador e número.',
      };
    }
    if (Object.prototype.hasOwnProperty.call(byId, version.id)) {
      // Guard: two entries with the same id means the reviewer cannot know which text was shown.
      return {
        ok: false,
        code: 'duplicate-version-id',
        reason: 'Identificador de versão repetido no histórico: ' + version.id + '.',
      };
    }
    const ordinalKey = String(version.ordinal);
    if (byOrdinal[ordinalKey]) {
      // Guard: duplicated version numbers break "which version is v2" and the adjacency check.
      return {
        ok: false,
        code: 'duplicate-ordinal',
        reason: 'Número de versão repetido no histórico: v' + ordinalKey + '.',
      };
    }
    byId[version.id] = version;
    byOrdinal[ordinalKey] = true;
  }

  const base = byId[request.baseVersionId];
  if (!base) {
    return {
      ok: false,
      code: 'unknown-base-version',
      reason: 'Versão base não encontrada no histórico: ' + String(request.baseVersionId) + '.',
    };
  }
  const target = byId[request.targetVersionId];
  if (!target) {
    return {
      ok: false,
      code: 'unknown-target-version',
      reason: 'Versão comparada não encontrada no histórico: ' + String(request.targetVersionId) + '.',
    };
  }

  // Guard: a version compared with itself always reports "identical", which the reviewer reads as
  // "the two versions I picked are equal" -- a wrong conclusion produced by a selection slip.
  if (base.id === target.id) {
    return {
      ok: false,
      code: 'same-version',
      reason: 'Selecione duas versões diferentes: comparar a versão v' + base.ordinal + ' com ela mesma sempre resulta em nenhuma diferença.',
    };
  }

  // Guard: a backwards pair inverts every span -- a removed finding is painted as an addition.
  if (base.ordinal > target.ordinal) {
    return {
      ok: false,
      code: 'reversed-order',
      reason:
        'Ordem invertida: v' +
        base.ordinal +
        ' é posterior a v' +
        target.ordinal +
        '. Comparada assim, uma remoção apareceria como inclusão.',
    };
  }

  const baseSections = diffSectionMap(base);
  if (!baseSections.ok) {
    return {
      ok: false,
      code: 'duplicate-section',
      reason:
        'Versão v' +
        base.ordinal +
        ' tem a seção "' +
        diffSectionLabel(baseSections.duplicate as DiffSectionKind) +
        '" repetida: uma delas seria ignorada em silêncio.',
    };
  }
  const targetSections = diffSectionMap(target);
  if (!targetSections.ok) {
    return {
      ok: false,
      code: 'duplicate-section',
      reason:
        'Versão v' +
        target.ordinal +
        ' tem a seção "' +
        diffSectionLabel(targetSections.duplicate as DiffSectionKind) +
        '" repetida: uma delas seria ignorada em silêncio.',
    };
  }

  if (!diffHasContent(baseSections.map) || !diffHasContent(targetSections.map)) {
    return {
      ok: false,
      code: 'empty-version-content',
      reason:
        'Uma das versões chegou sem conteúdo. Isso costuma ser falha de carregamento, e exibir a comparação mostraria o laudo inteiro como apagado.',
    };
  }

  const kinds = diffSortedSectionKinds(baseSections.map, targetSections.map);
  const sections: DiffSectionComparison[] = [];
  const changedSectionKinds: DiffSectionKind[] = [];
  let highRiskSpanCount = 0;
  let totalSpanCount = 0;
  let impressionChanged = false;
  let actionableChanged = false;

  for (let i = 0; i < kinds.length; i += 1) {
    const kind = kinds[i];
    const inBefore = Object.prototype.hasOwnProperty.call(baseSections.map, kind);
    const inAfter = Object.prototype.hasOwnProperty.call(targetSections.map, kind);
    const beforeText = inBefore ? baseSections.map[kind] : '';
    const afterText = inAfter ? targetSections.map[kind] : '';
    const outcome = diffCompareSectionText(beforeText, afterText);
    if (!outcome.ok) {
      return { ok: false, code: outcome.code, reason: diffSectionLabel(kind) + ': ' + outcome.reason };
    }
    const presence: DiffSectionPresence = inBefore && inAfter ? 'both' : inBefore ? 'only-before' : 'only-after';
    const actionable = diffIsActionableSection(kind);
    const result = outcome.value;
    const changed = result.changed || presence !== 'both';

    let message = '';
    if (!changed) {
      message = 'Sem alterações nesta seção.';
    } else if (presence === 'only-after') {
      message = 'Seção incluída na versão v' + target.ordinal + '.';
    } else if (presence === 'only-before') {
      message = 'Seção removida na versão v' + target.ordinal + ': o texto deixou de existir no laudo.';
    } else {
      message = String(result.spans.length) + ' alteração(ões) nesta seção.';
    }
    if (changed && actionable) {
      // FM-4: the referring physician reads this text; no change here is "cosmetic".
      message += ' Seção lida pelo médico solicitante: revise integralmente.';
    }

    // A section that appears or disappears is high risk regardless of its words: a removed
    // addendum takes an alert with it, and an added one may never have been read by anyone.
    const riskLevel: DiffRiskLevel =
      presence !== 'both' && changed ? 'high' : result.riskLevel;

    sections.push({
      kind: kind,
      label: diffSectionLabel(kind),
      presence: presence,
      actionable: actionable,
      changed: changed,
      spans: result.spans,
      riskLevel: riskLevel,
      riskClasses: result.riskClasses,
      message: message,
    });

    totalSpanCount += result.spans.length;
    for (let j = 0; j < result.spans.length; j += 1) {
      if (result.spans[j].riskLevel === 'high') {
        highRiskSpanCount += 1;
      }
    }
    if (changed) {
      changedSectionKinds.push(kind);
      if (kind === 'impression') {
        impressionChanged = true;
      }
      if (actionable) {
        actionableChanged = true;
      }
    }
  }

  const adjacency = diffBuildAdjacency(history, base, target, baseSections.map, targetSections.map);

  const anyChange = changedSectionKinds.length > 0;
  const structuralChange = diffHasStructuralChange(sections);
  let verdict: DiffVerdictKind = DIFF_VERDICT_IDENTICAL;
  let verdictMessage = '';
  if (!anyChange) {
    // FM-5: nothing changed is a verdict with words, never an empty list.
    verdict = DIFF_VERDICT_IDENTICAL;
    verdictMessage =
      'Nenhuma diferença de conteúdo entre v' +
      base.ordinal +
      ' e v' +
      target.ordinal +
      '. Este painel está vazio porque as versões são iguais, e não porque a comparação falhou.';
  } else if (highRiskSpanCount > 0 || structuralChange) {
    verdict = DIFF_VERDICT_SIGNIFICANT;
    verdictMessage =
      'Alterações de alto risco entre v' +
      base.ordinal +
      ' e v' +
      target.ordinal +
      ': ' +
      String(highRiskSpanCount) +
      ' trecho(s) de medida, negação, lateralidade ou categoria. Revise cada um contra a imagem.';
  } else {
    verdict = DIFF_VERDICT_WORDING_ONLY;
    verdictMessage =
      'Apenas alterações de redação entre v' +
      base.ordinal +
      ' e v' +
      target.ordinal +
      ': nenhuma medida, negação, lateralidade ou categoria mudou.';
  }

  let impressionMessage = '';
  if (impressionChanged) {
    impressionMessage =
      'A Impressão diagnóstica mudou: é o texto que o médico solicitante lê e sobre o qual age.';
  } else if (anyChange) {
    const labels: string[] = [];
    for (let i = 0; i < changedSectionKinds.length; i += 1) {
      labels.push(diffSectionLabel(changedSectionKinds[i]));
    }
    impressionMessage =
      'A Impressão diagnóstica não mudou. As alterações estão em: ' + labels.join(', ') + '.';
  } else {
    impressionMessage = 'A Impressão diagnóstica não mudou.';
  }

  const warnings: string[] = [];
  if (!adjacency.adjacent) {
    warnings.push(adjacency.message);
  }
  if (adjacency.hiddenSectionKinds.length > 0) {
    const hidden: string[] = [];
    for (let i = 0; i < adjacency.hiddenSectionKinds.length; i += 1) {
      hidden.push('"' + diffSectionLabel(adjacency.hiddenSectionKinds[i]) + '"');
    }
    warnings.push(
      'Seções que existiram apenas nas versões intermediárias e não aparecem em nenhum dos lados desta comparação: ' +
        hidden.join(', ') +
        '.'
    );
  }
  if (anyChange && !actionableChanged) {
    warnings.push(
      'Alterações restritas a seções descritivas: confirme se a Impressão diagnóstica deveria ter acompanhado a mudança.'
    );
  }

  return {
    ok: true,
    value: {
      baseVersionId: base.id,
      targetVersionId: target.id,
      baseOrdinal: base.ordinal,
      targetOrdinal: target.ordinal,
      comparedAt: request.comparedAt,
      verdict: verdict,
      verdictMessage: verdictMessage,
      sections: sections,
      changedSectionKinds: changedSectionKinds,
      impressionChanged: impressionChanged,
      actionableChanged: actionableChanged,
      findingsOnly: anyChange && !actionableChanged,
      impressionMessage: impressionMessage,
      highRiskSpanCount: highRiskSpanCount,
      totalSpanCount: totalSpanCount,
      adjacency: adjacency,
      warnings: warnings,
    },
  };
}

function diffHasStructuralChange(sections: DiffSectionComparison[]): boolean {
  for (let i = 0; i < sections.length; i += 1) {
    if (sections[i].changed && sections[i].presence !== 'both') {
      return true;
    }
  }
  return false;
}

/**
 * FM-6: names the versions this comparison jumps over, and the section kinds that lived only in
 * them. v1 against v3 hides everything v2 said, including an addendum added and then removed.
 */
function diffBuildAdjacency(
  history: DiffReportVersion[],
  base: DiffReportVersion,
  target: DiffReportVersion,
  baseMap: { [kind: string]: string },
  targetMap: { [kind: string]: string }
): DiffAdjacency {
  const skipped: DiffSkippedVersion[] = [];
  const between: DiffReportVersion[] = [];
  for (let i = 0; i < history.length; i += 1) {
    const version = history[i];
    if (version.ordinal > base.ordinal && version.ordinal < target.ordinal) {
      between.push(version);
    }
  }
  between.sort(function (left, right) {
    return left.ordinal - right.ordinal;
  });
  const hidden: DiffSectionKind[] = [];
  const hiddenSeen: { [kind: string]: boolean } = {};
  for (let i = 0; i < between.length; i += 1) {
    const version = between[i];
    skipped.push({
      id: version.id,
      ordinal: version.ordinal,
      savedAt: version.savedAt,
      authorId: version.authorId,
    });
    const sections = version.sections || [];
    for (let j = 0; j < sections.length; j += 1) {
      const section = sections[j];
      if (!section) {
        continue;
      }
      const kind = String(section.kind);
      if (diffSignificantTokens(section.text).length === 0) {
        continue;
      }
      const inBase = Object.prototype.hasOwnProperty.call(baseMap, kind) &&
        diffSignificantTokens(baseMap[kind]).length > 0;
      const inTarget = Object.prototype.hasOwnProperty.call(targetMap, kind) &&
        diffSignificantTokens(targetMap[kind]).length > 0;
      if (!inBase && !inTarget && !hiddenSeen[kind]) {
        hiddenSeen[kind] = true;
        hidden.push(kind as DiffSectionKind);
      }
    }
  }

  if (skipped.length === 0) {
    return {
      adjacent: true,
      skipped: [],
      hiddenSectionKinds: [],
      message:
        'Versões adjacentes (v' +
        base.ordinal +
        ' -> v' +
        target.ordinal +
        '): nenhuma versão intermediária ficou de fora.',
    };
  }

  const names: string[] = [];
  for (let i = 0; i < skipped.length; i += 1) {
    names.push('v' + skipped[i].ordinal);
  }
  return {
    adjacent: false,
    skipped: skipped,
    hiddenSectionKinds: hidden,
    message:
      'Comparação não adjacente: ' +
      String(skipped.length) +
      ' versão(ões) intermediária(s) (' +
      names.join(', ') +
      ') não aparecem aqui. Tudo o que foi escrito e desfeito nelas fica invisível nesta tela.',
  };
}

/* ------------------------------------------------------------------ *
 * Approval / rejection of a comparison
 * ------------------------------------------------------------------ */

export type DiffDecision = 'approved' | 'rejected';

export const DIFF_DECISION_APPROVED: DiffDecision = 'approved';
export const DIFF_DECISION_REJECTED: DiffDecision = 'rejected';

/** FM-7: the record says out loud what it does and does not cover. */
export const DIFF_APPROVAL_SCOPE_TEXT =
  'Esta decisão cobre apenas as diferenças entre as duas versões revisadas; não é aprovação do conteúdo integral do laudo.';

export interface DiffApprovalInput {
  history: DiffReportVersion[];
  reviewerId: string;
  decision: DiffDecision;
  /** The two version ids actually shown side by side to the reviewer. */
  reviewedBaseVersionId: string;
  reviewedTargetVersionId: string;
  /** Head of the report at the moment of the decision, as known by the caller. */
  currentVersionId: string;
  decidedAt: number;
  note?: string;
}

export interface DiffApprovalRecord {
  decision: DiffDecision;
  reviewerId: string;
  reviewedBaseVersionId: string;
  reviewedTargetVersionId: string;
  reviewedBaseOrdinal: number;
  reviewedTargetOrdinal: number;
  decidedAt: number;
  note: string;
  scope: 'comparison-only';
  scopeMessage: string;
  message: string;
}

export type DiffApprovalOutcome =
  | { ok: true; value: DiffApprovalRecord; code?: undefined; reason?: undefined }
  | { ok: false; code: DiffRefusalCode; reason: string; value?: undefined };

/**
 * Records a peer-review decision over a comparison.
 *
 * FM-7: the reviewed version ids are mandatory and are stored on the record, and the decision is
 * refused when the reviewed target is no longer the current version -- otherwise a resident's
 * newer save inherits a "peer-reviewed" stamp that nobody gave it.
 * FM-8: the author of the reviewed version cannot be its peer reviewer.
 * FM-9: a rejection without a written reason returns to the author with nothing to act on.
 */
export function diffApproveComparison(input: DiffApprovalInput): DiffApprovalOutcome {
  const request = input || ({} as DiffApprovalInput);

  if (typeof request.decidedAt !== 'number' || !isFinite(request.decidedAt)) {
    return {
      ok: false,
      code: 'invalid-timestamp',
      reason: 'Momento da decisão inválido: informe o instante em milissegundos (epoch).',
    };
  }
  if (typeof request.reviewerId !== 'string' || request.reviewerId.length === 0) {
    return {
      ok: false,
      code: 'missing-reviewer',
      reason: 'Identifique o revisor: uma decisão sem autor não é revisão por pares.',
    };
  }
  if (request.decision !== 'approved' && request.decision !== 'rejected') {
    return {
      ok: false,
      code: 'invalid-decision',
      reason: 'Decisão inválida: use "approved" ou "rejected".',
    };
  }

  const history = request.history || [];
  if (history.length === 0) {
    return {
      ok: false,
      code: 'empty-history',
      reason: 'Histórico de versões vazio: não há comparação a aprovar.',
    };
  }

  // FM-7: without both ids the record cannot say WHAT was reviewed.
  if (
    typeof request.reviewedBaseVersionId !== 'string' ||
    request.reviewedBaseVersionId.length === 0 ||
    typeof request.reviewedTargetVersionId !== 'string' ||
    request.reviewedTargetVersionId.length === 0
  ) {
    return {
      ok: false,
      code: 'missing-reviewed-versions',
      reason:
        'Informe as duas versões revisadas: aprovar uma comparação sem registrar quais versões foram vistas equivale a aprovar o laudo inteiro sem tê-lo lido.',
    };
  }

  let base: DiffReportVersion = null;
  let target: DiffReportVersion = null;
  let current: DiffReportVersion = null;
  for (let i = 0; i < history.length; i += 1) {
    const version = history[i];
    if (!version || typeof version.id !== 'string') {
      continue;
    }
    if (version.id === request.reviewedBaseVersionId) {
      base = version;
    }
    if (version.id === request.reviewedTargetVersionId) {
      target = version;
    }
    if (version.id === request.currentVersionId) {
      current = version;
    }
  }
  if (!base) {
    return {
      ok: false,
      code: 'unknown-base-version',
      reason: 'Versão base revisada não existe no histórico: ' + request.reviewedBaseVersionId + '.',
    };
  }
  if (!target) {
    return {
      ok: false,
      code: 'unknown-target-version',
      reason:
        'Versão comparada revisada não existe no histórico: ' + request.reviewedTargetVersionId + '.',
    };
  }
  if (base.id === target.id) {
    return {
      ok: false,
      code: 'same-version',
      reason: 'As duas versões revisadas são a mesma: nenhuma comparação foi de fato revisada.',
    };
  }

  // FM-7: the head moved while the reviewer was reading.
  if (!current) {
    return {
      ok: false,
      code: 'stale-review',
      reason:
        'Versão atual do laudo desconhecida: sem ela não é possível garantir que a revisão cobre o texto vigente.',
    };
  }
  if (current.id !== target.id) {
    return {
      ok: false,
      code: 'stale-review',
      reason:
        'A versão revisada (v' +
        target.ordinal +
        ') não é mais a versão atual (v' +
        current.ordinal +
        '). Recarregue a comparação: registrar esta decisão marcaria como revisado um texto que ninguém leu.',
    };
  }

  // FM-8: peer review by the author of the version under review is not peer review.
  if (target.authorId === request.reviewerId) {
    return {
      ok: false,
      code: 'self-review',
      reason:
        'Revisão por pares exige outro profissional: o revisor é o autor da versão v' +
        target.ordinal +
        '.',
    };
  }

  const note = typeof request.note === 'string' ? request.note : '';
  const trimmedNote = diffTrim(note);
  // FM-9: a rejection with no reason bounces back and the same discrepancy is released again.
  if (request.decision === 'rejected' && trimmedNote.length === 0) {
    return {
      ok: false,
      code: 'missing-rejection-note',
      reason:
        'Descreva o motivo da rejeição: sem justificativa o autor não sabe o que corrigir e a discrepância volta igual.',
    };
  }

  const verb = request.decision === 'approved' ? 'Aprovadas' : 'Rejeitadas';
  return {
    ok: true,
    value: {
      decision: request.decision,
      reviewerId: request.reviewerId,
      reviewedBaseVersionId: base.id,
      reviewedTargetVersionId: target.id,
      reviewedBaseOrdinal: base.ordinal,
      reviewedTargetOrdinal: target.ordinal,
      decidedAt: request.decidedAt,
      note: trimmedNote,
      scope: 'comparison-only',
      scopeMessage: DIFF_APPROVAL_SCOPE_TEXT,
      message:
        verb +
        ' as diferenças de v' +
        base.ordinal +
        ' para v' +
        target.ordinal +
        '. ' +
        DIFF_APPROVAL_SCOPE_TEXT,
    },
  };
}

function diffTrim(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && diffIsSpaceChar(text.charAt(start))) {
    start += 1;
  }
  while (end > start && diffIsSpaceChar(text.charAt(end - 1))) {
    end -= 1;
  }
  return text.slice(start, end);
}

/** Exported so a barrel consumer can assert the folding table stayed in sync (source vs target). */
export const DIFF_ACCENT_TABLE_SIZE = DIFF_ACCENT_SOURCE.length;
