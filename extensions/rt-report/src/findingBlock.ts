/**
 * RTV-226 -- Structured Findings core: CDE/RADS blocks bound to report prose.
 *
 * A radiology report is rich text. Inside it live structured finding blocks backed by
 * Common Data Elements (RadElement / ACR-RSNA CDEs): a lesion diameter, a laterality,
 * a RADS category. Two surfaces describe the same fact -- the prose the human reads and
 * the coded value the machines read. This module owns the binding between them and the
 * refusals that keep the two surfaces from telling different stories.
 *
 * This file is deliberately pure: no imports, no DOM, no React, no clock, no randomness.
 * Time always arrives as an epoch-milliseconds parameter. Refusals are returned as values
 * (`{ ok: false, ... }`), never thrown, because a thrown error in a report editor is either
 * swallowed by a boundary (the radiologist sees nothing and assumes the edit landed) or
 * blows up the editor and takes the unsaved dictation with it.
 *
 * NAMED CLINICAL FAILURE MODES THIS MODULE EXISTS TO STOP
 *
 * FM-1 "Silent size drift at sign-off" (guards: findingCompareBlock, findingValidateForSignature)
 *   The radiologist re-measures and edits the sentence from "nódulo de 8 mm" to
 *   "nódulo de 18 mm", but the bound CDE still holds 8 mm. The signed PDF -- the only
 *   artifact the referring physician and the patient ever read -- says 18 mm. The registry,
 *   the Lung-RADS follow-up rule and the FHIR Observation all receive 8 mm. 8 mm and 18 mm
 *   sit on opposite sides of the follow-up interval: one gets a 12-month CT, the other a
 *   PET/CT or biopsy. Nothing looks wrong on either surface: the prose reads correctly and
 *   the sidebar chip reads correctly; only the pair is wrong, and no single screen shows
 *   the pair. So we render the structure back to prose, diff it against the edited prose,
 *   and refuse to sign while they disagree -- naming, in the message, which audience reads
 *   which number.
 *
 * FM-2 "Coerced value set" (guard: findingBindEnumerated)
 *   Free text can say "moderadamente aumentado"; an enumerated CDE cannot -- it has a
 *   closed value set. Snapping the phrase to the nearest allowed member fabricates an
 *   assertion the radiologist never made, and it is unfalsifiable afterwards: the block
 *   shows a legitimate-looking coded value with no trace of the guess. Downstream, a
 *   fabricated category is indistinguishable from a dictated one. We refuse to coerce and
 *   keep the block as free text with the CDE left EMPTY, which is honest and visibly
 *   incomplete, instead of filled and quietly wrong.
 *
 * FM-3 "Unitless magnitude" (guard: findingBindMeasurement, status 'prose-value-without-unit')
 *   A size CDE carries a unit; prose often does not. "1,5" is 1,5 mm or 1,5 cm depending on
 *   nothing at all -- a factor of ten, and the difference between a nodule to ignore and a
 *   nodule to work up. The failure is invisible because both readings are plausible for the
 *   same organ. A numeric binding without an explicit unit is therefore refused, and prose
 *   carrying a bare number is treated as disagreement rather than as agreement.
 *
 * FM-4 "Orphan structured finding" (guard: findingDetectOrphans)
 *   The radiologist deletes the sentence during a rewrite, but the block survives in the
 *   document model. The exported study then carries a machine-readable finding that appears
 *   nowhere in the readable text: the patient's record contains an assertion no human ever
 *   wrote, and it cannot be audited against the report because the report does not mention
 *   it. It is hard to notice precisely because the visible artifact -- the prose -- is
 *   clean. We detect orphans both from the block's own anchor flag and by scanning the
 *   current document text.
 *
 * FM-5 "Unconfirmed proposal exported as a radiologist's assertion" (guards:
 *   findingCanExportCodedValue, findingConfirmProposal)
 *   A block value may be typed by a human or proposed by software (AI pre-fill, prior-report
 *   carry-forward). Once serialised, provenance disappears: a proposal nobody looked at
 *   exports byte-identical to a dictated measurement and inherits the radiologist's
 *   signature and liability. Export of coded values is gated on human authorship, and
 *   confirmation itself is refused while the proposal disagrees with the prose -- otherwise
 *   "confirm" would launder the guess into a human assertion.
 */

/* -------------------------------------------------------------------------- */
/* Result / refusal plumbing                                                  */
/* -------------------------------------------------------------------------- */

export const FINDING_REFUSAL_CODES = {
  missingBlockId: 'finding/missing-block-id',
  wrongCdeKind: 'finding/wrong-cde-kind',
  invalidMagnitude: 'finding/invalid-magnitude',
  missingUnit: 'finding/missing-unit',
  noValueSet: 'finding/no-value-set',
  enumeratedNoExactMatch: 'finding/enumerated-no-exact-match',
  emptyFreeText: 'finding/empty-free-text',
  cdeEmpty: 'finding/cde-empty',
  notAProposal: 'finding/not-a-proposal',
  unconfirmedProposal: 'finding/unconfirmed-proposal',
  proseStructureDisagreement: 'finding/prose-structure-disagreement',
  orphanStructure: 'finding/orphan-structure',
} as const;

export type FindingRefusalCode =
  (typeof FINDING_REFUSAL_CODES)[keyof typeof FINDING_REFUSAL_CODES];

export interface FindingOk<T> {
  ok: true;
  value: T;
}

export interface FindingRefusal {
  ok: false;
  code: FindingRefusalCode;
  /** User-facing, Brazilian Portuguese. Safe to show verbatim in the editor. */
  reason: string;
  /** Blocks implicated, so the UI can scroll to them instead of making the user hunt. */
  blockIds: string[];
  /** One entry per distinct problem, for lists. Never empty. */
  problems: string[];
}

export type FindingResult<T> = FindingOk<T> | FindingRefusal;

export function findingIsOk<T>(result: FindingResult<T>): result is FindingOk<T> {
  return result.ok === true;
}

function ok<T>(value: T): FindingOk<T> {
  return { ok: true, value };
}

function refuse(
  code: FindingRefusalCode,
  reason: string,
  blockIds: string[],
  problems: string[]
): FindingRefusal {
  return {
    ok: false,
    code,
    reason,
    blockIds,
    problems: problems.length > 0 ? problems : [reason],
  };
}

/* -------------------------------------------------------------------------- */
/* Model                                                                      */
/* -------------------------------------------------------------------------- */

export const FINDING_MM_PER_CM = 10;

export type FindingUnit = 'mm' | 'cm';

/**
 * Provenance is part of the clinical payload, not metadata (FM-5): 'software-proposed'
 * means nobody has asserted the value yet.
 */
export type FindingProvenance = 'human-typed' | 'software-proposed' | 'human-confirmed';

export interface FindingMeasurementValue {
  kind: 'measurement';
  magnitude: number;
  unit: FindingUnit;
}

export interface FindingEnumeratedValue {
  kind: 'enumerated';
  code: string;
  label: string;
}

/**
 * Free text is what a block holds when the prose cannot be expressed by the CDE (FM-2).
 * It is intentionally NOT a coded value: findingIsCdeFilled stays false for it, and
 * findingCanExportCodedValue refuses it.
 */
export interface FindingFreeTextValue {
  kind: 'free-text';
  text: string;
}

export type FindingStructuredValue =
  | FindingMeasurementValue
  | FindingEnumeratedValue
  | FindingFreeTextValue;

export interface FindingAllowedValue {
  code: string;
  label: string;
  /** Accepted verbatim alternatives. Synonyms are matched EXACTLY, never fuzzily. */
  synonyms?: string[];
}

export interface FindingCdeDefinition {
  cdeId: string;
  label: string;
  kind: 'measurement' | 'enumerated';
  /** Closed value set. Required for enumerated CDEs. */
  allowedValues?: FindingAllowedValue[];
}

export interface FindingBlock {
  blockId: string;
  cde: FindingCdeDefinition;
  /** null means the CDE is deliberately empty. Empty is honest; guessed is not. */
  value: FindingStructuredValue | null;
  /** The sentence as it currently reads in the report. This is what humans see. */
  prose: string;
  /** false once the editor loses the anchor for the sentence (deleted paragraph). */
  proseAnchorPresent: boolean;
  provenance: FindingProvenance;
  updatedAt: number;
}

export interface FindingBlockInput {
  blockId: string;
  cde: FindingCdeDefinition;
  prose: string;
  provenance: FindingProvenance;
  magnitude?: number;
  unit?: FindingUnit | null;
  enumeratedText?: string;
}

export type FindingAgreementStatus =
  | 'agree'
  | 'structure-empty'
  | 'free-text-only'
  | 'magnitude-mismatch'
  | 'unit-mismatch'
  | 'prose-value-without-unit'
  | 'prose-has-no-value'
  | 'prose-missing-term'
  | 'prose-deleted';

export interface FindingAgreement {
  blockId: string;
  cdeId: string;
  status: FindingAgreementStatus;
  agrees: boolean;
  /** What the prose shows for this fact, or null when it shows nothing. */
  proseShows: string | null;
  /** What the coded side shows, or null when the CDE is empty. */
  structureShows: string | null;
  message: string | null;
}

export interface FindingOrphanReport {
  blockId: string;
  cdeId: string;
  structureShows: string;
  /** true when the orphan would leave the building as a coded value. */
  exportsCodedValue: boolean;
  message: string;
}

export interface FindingSignatureClearance {
  clearedAt: number;
  blockCount: number;
  codedExportCount: number;
}

/* -------------------------------------------------------------------------- */
/* Text helpers                                                               */
/* -------------------------------------------------------------------------- */

const ACCENT_MAP: { [key: string]: string } = {
  á: 'a',
  à: 'a',
  â: 'a',
  ã: 'a',
  ä: 'a',
  é: 'e',
  è: 'e',
  ê: 'e',
  ë: 'e',
  í: 'i',
  ì: 'i',
  î: 'i',
  ï: 'i',
  ó: 'o',
  ò: 'o',
  ô: 'o',
  õ: 'o',
  ö: 'o',
  ú: 'u',
  ù: 'u',
  û: 'u',
  ü: 'u',
  ç: 'c',
  ñ: 'n',
};

function stripAccents(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const lower = text.charAt(i).toLowerCase();
    const mapped = ACCENT_MAP[lower];
    out += mapped === undefined ? lower : mapped;
  }
  return out;
}

/** Lowercase, accent-folded, whitespace-collapsed. Used only for comparison, never stored. */
function normalizeText(text: string): string {
  return stripAccents(text).replace(/\s+/g, ' ').trim();
}

function isBlank(text: string | null | undefined): boolean {
  return typeof text !== 'string' || text.trim().length === 0;
}

/** Rounded to 3 decimals so 1,8 cm and 18 mm compare equal despite binary floats. */
function toMillimetres(magnitude: number, unit: FindingUnit): number {
  const raw = unit === 'cm' ? magnitude * FINDING_MM_PER_CM : magnitude;
  return Math.round(raw * 1000) / 1000;
}

/** Brazilian decimal comma on output: the report is written in pt-BR. */
export function findingFormatMagnitude(magnitude: number): string {
  return String(magnitude).replace('.', ',');
}

export interface FindingProseMeasurement {
  raw: string;
  magnitude: number;
  /** null when the prose gives a bare number -- see FM-3. */
  unit: FindingUnit | null;
  index: number;
}

const PROSE_NUMBER_PATTERN = /(\d+(?:[.,]\d+)?)(\s*)(mm|cm)?/g;

/**
 * Extracts candidate measurements from a sentence.
 *
 * Digits glued to letters are skipped on purpose: "T12", "L5-S1" and "RDE818" are a
 * vertebral level, a disc space and a CDE id, and reading any of them as a lesion size
 * would produce a confident, wrong diameter that agrees with nothing in the report.
 */
export function findingParseProseMeasurements(prose: string): FindingProseMeasurement[] {
  const found: FindingProseMeasurement[] = [];
  if (typeof prose !== 'string' || prose.length === 0) {
    return found;
  }
  const folded = stripAccents(prose);
  PROSE_NUMBER_PATTERN.lastIndex = 0;
  let match = PROSE_NUMBER_PATTERN.exec(folded);
  while (match !== null) {
    const start = match.index;
    const before = start === 0 ? '' : folded.charAt(start - 1);
    const gluedToWord = before.length > 0 && /[a-z0-9]/.test(before);
    if (!gluedToWord) {
      const unitToken = match[3];
      found.push({
        raw: match[0].trim(),
        magnitude: parseFloat(match[1].replace(',', '.')),
        unit: unitToken === undefined ? null : (unitToken as FindingUnit),
        index: start,
      });
    }
    if (PROSE_NUMBER_PATTERN.lastIndex === start) {
      PROSE_NUMBER_PATTERN.lastIndex = start + 1;
    }
    match = PROSE_NUMBER_PATTERN.exec(folded);
  }
  return found;
}

/**
 * Renders the coded side back into prose. This is the only honest way to compare the two
 * surfaces of FM-1: the structure must be able to say, in words, what it claims.
 */
export function findingRenderStructureAsProse(value: FindingStructuredValue | null): string {
  if (value === null) {
    return '';
  }
  if (value.kind === 'measurement') {
    return findingFormatMagnitude(value.magnitude) + ' ' + value.unit;
  }
  if (value.kind === 'enumerated') {
    return value.label;
  }
  return value.text;
}

/* -------------------------------------------------------------------------- */
/* Binding: prose -> coded value                                              */
/* -------------------------------------------------------------------------- */

/**
 * FM-3: a size without a unit is not a size. Refuse the binding instead of assuming the
 * modality default -- "1,5" read as mm when the radiologist meant cm understates a lesion
 * by a factor of ten, and both readings look reasonable on screen.
 */
export function findingBindMeasurement(
  cde: FindingCdeDefinition,
  magnitude: number,
  unit: FindingUnit | null
): FindingResult<FindingMeasurementValue> {
  if (cde.kind !== 'measurement') {
    return refuse(
      FINDING_REFUSAL_CODES.wrongCdeKind,
      'O CDE ' + cde.cdeId + ' (' + cde.label + ') não aceita medida numérica.',
      [],
      []
    );
  }
  // A non-finite or non-positive diameter is always a parsing accident (a vertebral level,
  // a date, a negative delta). Stored, it becomes a lesion that no measurement can match.
  if (typeof magnitude !== 'number' || !isFinite(magnitude) || magnitude <= 0) {
    return refuse(
      FINDING_REFUSAL_CODES.invalidMagnitude,
      'Valor numérico inválido para ' + cde.label + ': informe uma medida maior que zero.',
      [],
      []
    );
  }
  if (unit !== 'mm' && unit !== 'cm') {
    return refuse(
      FINDING_REFUSAL_CODES.missingUnit,
      'Informe a unidade da medida (mm ou cm) para ' +
        cde.label +
        '. Sem unidade, "' +
        findingFormatMagnitude(magnitude) +
        '" pode ser lido como ' +
        findingFormatMagnitude(magnitude) +
        ' mm ou ' +
        findingFormatMagnitude(magnitude) +
        ' cm, uma diferença de dez vezes que muda a conduta e o intervalo de seguimento.',
      [],
      []
    );
  }
  return ok({ kind: 'measurement', magnitude, unit } as FindingMeasurementValue);
}

/** Allowed labels of an enumerated CDE, for the UI to offer as an explicit choice. */
export function findingListAllowedValues(cde: FindingCdeDefinition): string[] {
  const allowed = cde.allowedValues;
  if (allowed === undefined) {
    return [];
  }
  return allowed.map(entry => entry.label);
}

/**
 * FM-2: exact match or nothing. No nearest-neighbour, no stemming, no "contains".
 * A coerced category is indistinguishable from a dictated one after export, so the only
 * safe answer to "moderadamente aumentado" is to refuse and leave the CDE empty.
 */
export function findingBindEnumerated(
  cde: FindingCdeDefinition,
  proseText: string
): FindingResult<FindingEnumeratedValue> {
  if (cde.kind !== 'enumerated') {
    return refuse(
      FINDING_REFUSAL_CODES.wrongCdeKind,
      'O CDE ' + cde.cdeId + ' (' + cde.label + ') não possui conjunto de valores.',
      [],
      []
    );
  }
  const allowed = cde.allowedValues;
  if (allowed === undefined || allowed.length === 0) {
    return refuse(
      FINDING_REFUSAL_CODES.noValueSet,
      'O CDE ' + cde.cdeId + ' está sem conjunto de valores; nada pode ser codificado.',
      [],
      []
    );
  }
  if (isBlank(proseText)) {
    return refuse(
      FINDING_REFUSAL_CODES.emptyFreeText,
      'Nada a vincular: o texto do achado está vazio.',
      [],
      []
    );
  }
  const needle = normalizeText(proseText);
  for (let i = 0; i < allowed.length; i += 1) {
    const entry = allowed[i];
    const candidates = [entry.label, entry.code].concat(
      entry.synonyms === undefined ? [] : entry.synonyms
    );
    for (let j = 0; j < candidates.length; j += 1) {
      if (normalizeText(candidates[j]) === needle) {
        return ok({ kind: 'enumerated', code: entry.code, label: entry.label });
      }
    }
  }
  const labels = findingListAllowedValues(cde);
  return refuse(
    FINDING_REFUSAL_CODES.enumeratedNoExactMatch,
    '"' +
      proseText.trim() +
      '" não corresponde a nenhum valor permitido do CDE ' +
      cde.cdeId +
      ' (' +
      labels.join('; ') +
      '). O texto foi mantido como texto livre e o CDE segue vazio: escolher o valor mais parecido criaria uma afirmação que o radiologista não fez.',
    [],
    labels
  );
}

/**
 * FM-2 fallback: keep the radiologist's words, leave the CDE empty. An empty CDE is
 * visibly incomplete downstream; a guessed CDE is invisibly wrong.
 */
export function findingApplyFreeTextFallback(
  block: FindingBlock,
  text: string,
  at: number
): FindingResult<FindingBlock> {
  if (isBlank(text)) {
    return refuse(
      FINDING_REFUSAL_CODES.emptyFreeText,
      'Texto livre vazio: escreva o achado ou remova o bloco.',
      [block.blockId],
      []
    );
  }
  return ok({
    blockId: block.blockId,
    cde: block.cde,
    value: { kind: 'free-text', text: text.trim() },
    prose: block.prose,
    proseAnchorPresent: block.proseAnchorPresent,
    provenance: 'human-typed',
    updatedAt: at,
  } as FindingBlock);
}

export function findingCreateBlock(
  input: FindingBlockInput,
  at: number
): FindingResult<FindingBlock> {
  if (isBlank(input.blockId)) {
    return refuse(
      FINDING_REFUSAL_CODES.missingBlockId,
      'Bloco sem identificador: não seria possível ligar o achado estruturado à frase do laudo.',
      [],
      []
    );
  }
  let value: FindingStructuredValue | null = null;
  if (input.cde.kind === 'measurement') {
    if (input.magnitude !== undefined) {
      const bound = findingBindMeasurement(
        input.cde,
        input.magnitude,
        input.unit === undefined ? null : input.unit
      );
      if (!findingIsOk(bound)) {
        return refuse(bound.code, bound.reason, [input.blockId], bound.problems);
      }
      value = bound.value;
    }
  } else if (input.enumeratedText !== undefined) {
    const bound = findingBindEnumerated(input.cde, input.enumeratedText);
    if (!findingIsOk(bound)) {
      return refuse(bound.code, bound.reason, [input.blockId], bound.problems);
    }
    value = bound.value;
  }
  return ok({
    blockId: input.blockId,
    cde: input.cde,
    value,
    prose: input.prose,
    proseAnchorPresent: !isBlank(input.prose),
    provenance: input.provenance,
    updatedAt: at,
  } as FindingBlock);
}

/** True only for coded values. Free text is text, not a CDE answer. */
export function findingIsCdeFilled(block: FindingBlock): boolean {
  const value = block.value;
  if (value === null) {
    return false;
  }
  return value.kind === 'measurement' || value.kind === 'enumerated';
}

/* -------------------------------------------------------------------------- */
/* FM-1 / FM-4: agreement and orphans                                         */
/* -------------------------------------------------------------------------- */

function audienceMessage(cdeId: string, proseShows: string, structureShows: string): string {
  return (
    'Divergência no bloco ' +
    cdeId +
    ': o texto do laudo mostra "' +
    proseShows +
    '" e é isso que o médico solicitante e o paciente leem no laudo assinado; o campo estruturado (CDE ' +
    cdeId +
    ') mantém "' +
    structureShows +
    '" e é isso que o registro, a regra de seguimento e a exportação FHIR recebem. Corrija o texto ou o campo antes de assinar.'
  );
}

function proseIsGone(block: FindingBlock): boolean {
  return block.proseAnchorPresent === false || isBlank(block.prose);
}

/**
 * Renders the structure to prose and diffs it against the sentence the radiologist edited.
 * Everything with `agrees === false` blocks the signature (FM-1).
 */
export function findingCompareBlock(block: FindingBlock): FindingAgreement {
  const cdeId = block.cde.cdeId;
  const structureShows = block.value === null ? null : findingRenderStructureAsProse(block.value);

  // FM-4 seen from the block's side: the sentence is gone but the value is still here.
  if (proseIsGone(block) && block.value !== null) {
    return {
      blockId: block.blockId,
      cdeId,
      status: 'prose-deleted',
      agrees: false,
      proseShows: null,
      structureShows,
      message:
        'Bloco ' +
        cdeId +
        ' órfão: a frase foi apagada do laudo, mas o achado "' +
        String(structureShows) +
        '" continua no bloco e seria exportado. O prontuário ficaria com um achado legível por máquina que nenhum humano escreveu.',
    };
  }

  if (block.value === null) {
    return {
      blockId: block.blockId,
      cdeId,
      status: 'structure-empty',
      agrees: true,
      proseShows: isBlank(block.prose) ? null : block.prose.trim(),
      structureShows: null,
      message: null,
    };
  }

  const normalizedProse = normalizeText(block.prose);

  if (block.value.kind === 'free-text') {
    const text = normalizeText(block.value.text);
    if (normalizedProse.indexOf(text) !== -1) {
      return {
        blockId: block.blockId,
        cdeId,
        status: 'free-text-only',
        agrees: true,
        proseShows: block.prose.trim(),
        structureShows,
        message: null,
      };
    }
    return {
      blockId: block.blockId,
      cdeId,
      status: 'prose-missing-term',
      agrees: false,
      proseShows: block.prose.trim(),
      structureShows,
      message: audienceMessage(cdeId, block.prose.trim(), String(structureShows)),
    };
  }

  if (block.value.kind === 'enumerated') {
    const label = normalizeText(block.value.label);
    const synonyms = collectSynonyms(block.cde, block.value.code);
    let mentioned = normalizedProse.indexOf(label) !== -1;
    for (let i = 0; i < synonyms.length && !mentioned; i += 1) {
      mentioned = normalizedProse.indexOf(normalizeText(synonyms[i])) !== -1;
    }
    if (mentioned) {
      return {
        blockId: block.blockId,
        cdeId,
        status: 'agree',
        agrees: true,
        proseShows: block.value.label,
        structureShows,
        message: null,
      };
    }
    return {
      blockId: block.blockId,
      cdeId,
      status: 'prose-missing-term',
      agrees: false,
      proseShows: null,
      structureShows,
      message:
        'Bloco ' +
        cdeId +
        ': o campo estruturado afirma "' +
        String(structureShows) +
        '", mas essa categoria não aparece no texto do laudo. O registro, a regra de seguimento e a exportação FHIR receberiam uma categoria que o laudo lido pelo médico solicitante não contém.',
    };
  }

  const measured = block.value;
  const structureMm = toMillimetres(measured.magnitude, measured.unit);
  const candidates = findingParseProseMeasurements(block.prose);

  if (candidates.length === 0) {
    return {
      blockId: block.blockId,
      cdeId,
      status: 'prose-has-no-value',
      agrees: false,
      proseShows: null,
      structureShows,
      message:
        'Bloco ' +
        cdeId +
        ': o campo estruturado mantém "' +
        String(structureShows) +
        '", mas o texto do laudo não traz nenhuma medida. O valor seria exportado para o registro e para a regra de seguimento sem aparecer no laudo que o médico solicitante lê.',
    };
  }

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (
      candidate.unit !== null &&
      toMillimetres(candidate.magnitude, candidate.unit) === structureMm
    ) {
      return {
        blockId: block.blockId,
        cdeId,
        status: 'agree',
        agrees: true,
        proseShows: candidate.raw,
        structureShows,
        message: null,
      };
    }
  }

  // Same number, different unit: 8 mm vs 8 cm. The magnitude "matches" at a glance, which
  // is exactly why a reviewer skims past it.
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (candidate.unit !== null && candidate.magnitude === measured.magnitude) {
      return {
        blockId: block.blockId,
        cdeId,
        status: 'unit-mismatch',
        agrees: false,
        proseShows: candidate.raw,
        structureShows,
        message: audienceMessage(cdeId, candidate.raw, String(structureShows)),
      };
    }
  }

  // FM-3 from the prose side: bare number in the text. We refuse to assume it means the
  // same unit as the CDE, because that assumption is what hides a tenfold error.
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (candidate.unit === null && candidate.magnitude === measured.magnitude) {
      return {
        blockId: block.blockId,
        cdeId,
        status: 'prose-value-without-unit',
        agrees: false,
        proseShows: candidate.raw,
        structureShows,
        message:
          'Bloco ' +
          cdeId +
          ': o texto do laudo traz "' +
          candidate.raw +
          '" sem unidade, enquanto o campo estruturado afirma "' +
          String(structureShows) +
          '". "' +
          candidate.raw +
          ' mm" e "' +
          candidate.raw +
          ' cm" mudam a conduta; escreva a unidade no texto.',
      };
    }
  }

  const first = candidates[0];
  return {
    blockId: block.blockId,
    cdeId,
    status: 'magnitude-mismatch',
    agrees: false,
    proseShows: first.raw,
    structureShows,
    message: audienceMessage(cdeId, first.raw, String(structureShows)),
  };
}

function collectSynonyms(cde: FindingCdeDefinition, code: string): string[] {
  const allowed = cde.allowedValues;
  if (allowed === undefined) {
    return [];
  }
  for (let i = 0; i < allowed.length; i += 1) {
    if (allowed[i].code === code) {
      const synonyms = allowed[i].synonyms;
      return synonyms === undefined ? [] : synonyms;
    }
  }
  return [];
}

/**
 * FM-4: a block whose sentence no longer exists in the report. Detected from the anchor
 * flag, from blank prose, and by scanning the current document text -- editors lose
 * anchors quietly during paste and undo, so the flag alone cannot be trusted.
 */
export function findingDetectOrphans(
  blocks: FindingBlock[],
  documentText: string | null
): FindingOrphanReport[] {
  const reports: FindingOrphanReport[] = [];
  const haystack = documentText === null ? null : normalizeText(documentText);
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (block.value === null) {
      continue; // Nothing structured would be exported; not a clinical hazard.
    }
    const anchorLost = proseIsGone(block);
    const missingFromDocument =
      haystack !== null &&
      !isBlank(block.prose) &&
      haystack.indexOf(normalizeText(block.prose)) === -1;
    if (!anchorLost && !missingFromDocument) {
      continue;
    }
    const structureShows = findingRenderStructureAsProse(block.value);
    const exportsCodedValue = findingIsCdeFilled(block);
    reports.push({
      blockId: block.blockId,
      cdeId: block.cde.cdeId,
      structureShows,
      exportsCodedValue,
      message: exportsCodedValue
        ? 'Bloco ' +
          block.cde.cdeId +
          ' órfão: "' +
          structureShows +
          '" não aparece em nenhuma frase do laudo, mas seria exportado como achado estruturado. O prontuário receberia um achado que nenhum humano escreveu.'
        : 'Bloco ' +
          block.cde.cdeId +
          ' órfão: o texto livre "' +
          structureShows +
          '" não aparece no laudo. Nada codificado será exportado, mas o bloco deve ser removido ou a frase reescrita.',
    });
  }
  return reports;
}

/* -------------------------------------------------------------------------- */
/* FM-5: provenance gates                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Turns a software proposal into a human assertion. Refused while the proposal disagrees
 * with the prose: confirming a value that contradicts the sentence would launder the guess
 * into something signed, and the contradiction would survive untraceably.
 */
export function findingConfirmProposal(
  block: FindingBlock,
  at: number
): FindingResult<FindingBlock> {
  if (block.provenance !== 'software-proposed') {
    return refuse(
      FINDING_REFUSAL_CODES.notAProposal,
      'Bloco ' + block.cde.cdeId + ' não é uma proposta de software: nada a confirmar.',
      [block.blockId],
      []
    );
  }
  if (block.value === null) {
    return refuse(
      FINDING_REFUSAL_CODES.cdeEmpty,
      'Bloco ' + block.cde.cdeId + ' está vazio: não há valor proposto para confirmar.',
      [block.blockId],
      []
    );
  }
  const agreement = findingCompareBlock(block);
  if (!agreement.agrees) {
    return refuse(
      FINDING_REFUSAL_CODES.proseStructureDisagreement,
      'Não é possível confirmar o valor proposto para ' +
        block.cde.cdeId +
        ' enquanto ele divergir do texto do laudo. ' +
        String(agreement.message),
      [block.blockId],
      [String(agreement.message)]
    );
  }
  return ok({
    blockId: block.blockId,
    cde: block.cde,
    value: block.value,
    prose: block.prose,
    proseAnchorPresent: block.proseAnchorPresent,
    provenance: 'human-confirmed',
    updatedAt: at,
  } as FindingBlock);
}

/**
 * The single gate for shipping a coded value out of the report (registry, follow-up rule,
 * FHIR). Refuses empty/free-text CDEs (FM-2), orphans (FM-4), disagreements (FM-1) and
 * unconfirmed software proposals (FM-5).
 */
export function findingCanExportCodedValue(
  block: FindingBlock
): FindingResult<FindingMeasurementValue | FindingEnumeratedValue> {
  if (!findingIsCdeFilled(block)) {
    return refuse(
      FINDING_REFUSAL_CODES.cdeEmpty,
      'Bloco ' +
        block.cde.cdeId +
        ' não tem valor codificado (texto livre ou campo vazio). Nada será exportado como CDE, por escolha: um valor aproximado seria uma afirmação que o radiologista não fez.',
      [block.blockId],
      []
    );
  }
  const orphans = findingDetectOrphans([block], null);
  if (orphans.length > 0) {
    return refuse(
      FINDING_REFUSAL_CODES.orphanStructure,
      orphans[0].message,
      [block.blockId],
      [orphans[0].message]
    );
  }
  const agreement = findingCompareBlock(block);
  if (!agreement.agrees) {
    return refuse(
      FINDING_REFUSAL_CODES.proseStructureDisagreement,
      String(agreement.message),
      [block.blockId],
      [String(agreement.message)]
    );
  }
  if (block.provenance === 'software-proposed') {
    return refuse(
      FINDING_REFUSAL_CODES.unconfirmedProposal,
      'Bloco ' +
        block.cde.cdeId +
        ': o valor "' +
        findingRenderStructureAsProse(block.value) +
        '" foi proposto por software e ninguém confirmou. Exportado assim, ele chega ao registro e ao FHIR como afirmação assinada do radiologista. Confirme ou apague o valor.',
      [block.blockId],
      []
    );
  }
  return ok(block.value as FindingMeasurementValue | FindingEnumeratedValue);
}

/**
 * FM-1 at the moment that matters: signing freezes the divergence into the legal document.
 * Collects every problem across the blocks so the radiologist fixes them in one pass
 * instead of discovering them one modal at a time.
 */
export function findingValidateForSignature(
  blocks: FindingBlock[],
  documentText: string | null,
  at: number
): FindingResult<FindingSignatureClearance> {
  const problems: string[] = [];
  const blockIds: string[] = [];
  let codedExportCount = 0;
  let firstCode: FindingRefusalCode = FINDING_REFUSAL_CODES.proseStructureDisagreement;
  let hasCode = false;

  const orphans = findingDetectOrphans(blocks, documentText);
  for (let i = 0; i < orphans.length; i += 1) {
    if (orphans[i].exportsCodedValue) {
      problems.push(orphans[i].message);
      blockIds.push(orphans[i].blockId);
      if (!hasCode) {
        firstCode = FINDING_REFUSAL_CODES.orphanStructure;
        hasCode = true;
      }
    }
  }

  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (proseIsGone(block)) {
      continue; // Already reported as an orphan; do not duplicate the message.
    }
    const agreement = findingCompareBlock(block);
    if (!agreement.agrees && agreement.message !== null) {
      problems.push(agreement.message);
      blockIds.push(block.blockId);
      if (!hasCode) {
        firstCode = FINDING_REFUSAL_CODES.proseStructureDisagreement;
        hasCode = true;
      }
    }
    if (findingIsCdeFilled(block)) {
      if (block.provenance === 'software-proposed') {
        problems.push(
          'Bloco ' +
            block.cde.cdeId +
            ': valor "' +
            findingRenderStructureAsProse(block.value) +
            '" proposto por software e ainda não confirmado. Assinar transformaria a sugestão em afirmação do radiologista.'
        );
        blockIds.push(block.blockId);
        if (!hasCode) {
          firstCode = FINDING_REFUSAL_CODES.unconfirmedProposal;
          hasCode = true;
        }
      } else if (agreement.agrees) {
        codedExportCount += 1;
      }
    }
  }

  if (problems.length > 0) {
    return refuse(
      firstCode,
      'Laudo não pode ser assinado: ' +
        String(problems.length) +
        ' pendência(s) entre o texto e os campos estruturados. ' +
        problems[0],
      blockIds,
      problems
    );
  }

  return ok({
    clearedAt: at,
    blockCount: blocks.length,
    codedExportCount,
  } as FindingSignatureClearance);
}

/* -------------------------------------------------------------------------- */
/* Readout                                                                    */
/* -------------------------------------------------------------------------- */

const PROVENANCE_LABEL: { [key: string]: string } = {
  'human-typed': 'digitado pelo radiologista',
  'software-proposed': 'proposto por software (não confirmado)',
  'human-confirmed': 'confirmado pelo radiologista',
};

/**
 * One line per block, for the sidebar and for the audit log. It always shows BOTH surfaces
 * side by side, because FM-1 is only visible when the pair is on the same line.
 */
export function findingDescribeBlock(block: FindingBlock): string {
  const agreement = findingCompareBlock(block);
  const structureShows = agreement.structureShows === null ? 'vazio' : agreement.structureShows;
  const proseShows = isBlank(block.prose) ? 'frase apagada' : block.prose.trim();
  const verdict = agreement.agrees ? 'OK' : 'DIVERGENTE (' + agreement.status + ')';
  return (
    '[' +
    block.cde.cdeId +
    '] ' +
    block.cde.label +
    ' | estrutura: "' +
    structureShows +
    '" | texto: "' +
    proseShows +
    '" | ' +
    (PROVENANCE_LABEL[block.provenance] === undefined
      ? block.provenance
      : PROVENANCE_LABEL[block.provenance]) +
    ' | ' +
    verdict
  );
}
