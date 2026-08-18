/**
 * Voice to structure: entity extraction into confirmable chips, command mode, and the
 * retention decision -- pure core (RTV-225).
 *
 * The ticket's insight is right: "a melhor experiencia nao e transcrever tudo em texto livre;
 * e transformar fala em texto + estrutura". The danger is the second half. Free text is read
 * by a human before it is signed. **Structured data is not read by anybody** -- it goes to the
 * cancer registry, to the RADS category, to the follow-up queue, and the radiologist's only
 * contact with it was the moment a chip appeared on screen while they were looking at the
 * image.
 *
 * So everything extracted here is a **candidate**. {@link voiceExtract} produces chips that
 * carry a confidence and a confirmation state, and {@link voiceCommitChip} refuses to put a
 * value into a CDE or RADS field without an explicit confirmation. This is the same rule as
 * the AI copilot's provenance gate (RTV-224), for the same reason and with the same shape.
 *
 * ## The three things Portuguese dictation gets wrong
 *
 * **Negation.** ASR drops short unstressed words, and "nao" is the shortest clinically
 * decisive word in the language. "nao ha nodulo" becoming "ha nodulo" inverts a report. So a
 * negation token is never inferred from absence: a phrase with no explicit polarity marker
 * comes back as {@link VOICE_POLARITY_UNKNOWN} rather than as an assertion, and that is a
 * refusal at commit time.
 *
 * **Laterality.** "direito" and "esquerdo" are acoustically far apart and rarely confused.
 * The dangerous form is the abbreviation: "D" and "E" spoken as letter names are one phoneme
 * each and routinely swapped, and "lobo superior D" is exactly how radiologists speak. A
 * single-letter laterality token is therefore marked low confidence and never auto-committed,
 * however clean the rest of the utterance looks.
 *
 * **The decimal separator.** An engine configured for en-US emits "1.5" where the speaker
 * said "um virgula cinco", and a downstream parser reading "1.5" with a pt-BR expectation can
 * turn it into 15. This is the same failure the version diff exists to catch (RTV-227),
 * arriving through the microphone instead. {@link voiceParseMeasurement} accepts both
 * separators, and refuses a number with **both** or with a thousands-grouping shape it cannot
 * disambiguate, rather than picking one.
 *
 * A measurement spoken with no unit is refused, not defaulted. "um virgula cinco" is 1.5 cm to
 * a chest radiologist and 1.5 mm to a neuroradiologist reading an aneurysm, and the module has
 * no way to know which one is talking.
 *
 * ## Content must not be able to execute
 *
 * "assinar" is a command. It is also a word that appears in dictated content: "o paciente
 * assinou o termo de consentimento". A parser that scans every utterance for command words
 * will eventually sign a report because somebody described a consent form.
 *
 * Command recognition therefore only happens in {@link VOICE_MODE_COMMAND}, which the caller
 * enters deliberately, and {@link voiceInterpret} never returns a command while in dictation
 * mode -- it returns text. Destructive commands additionally require a confirmation step even
 * inside command mode.
 *
 * ## Dictation lands where the caret was, or nowhere
 *
 * A four-second utterance can outlive the focus it started in. Text that arrives after the
 * radiologist tabbed to the impression, inserted at "the current cursor", lands in the wrong
 * section -- and a findings sentence sitting in the impression is read as the conclusion.
 * {@link voiceInterpret} binds to the field that was focused when the utterance started and
 * refuses on a mismatch.
 *
 * Framework-free, no `@ohif/*`, no Web Speech API, no clock, no randomness, no `throw`.
 * Zero-fork per RTV-114.
 */

/* ------------------------------------------------------------------ */
/* Result type                                                         */
/* ------------------------------------------------------------------ */

export type VoiceRefusalCode =
  | 'empty-utterance'
  | 'focus-changed'
  | 'command-in-dictation-mode'
  | 'unknown-command'
  | 'destructive-unconfirmed'
  | 'chip-unconfirmed'
  | 'chip-low-confidence'
  | 'polarity-unknown'
  | 'laterality-ambiguous'
  | 'measurement-no-unit'
  | 'measurement-ambiguous-separator'
  | 'unknown-category'
  | 'retention-undecided'
  | 'invalid-timestamp'
  | 'unattributed';

/**
 * Refusals travel as values. `value?: undefined` / `reason?: undefined` are required because
 * `strictNullChecks` is off in this repo.
 */
export type VoiceResult<T> =
  | { ok: true; value: T; code?: undefined; reason?: undefined }
  | { ok: false; code: VoiceRefusalCode; reason: string; value?: undefined };

function voiceOk<T>(value: T): VoiceResult<T> {
  return { ok: true, value };
}

function voiceRefuse<T>(code: VoiceRefusalCode, reason: string): VoiceResult<T> {
  return { ok: false, code, reason };
}

function voiceText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function voiceIsEpochMs(value: unknown): boolean {
  return typeof value === 'number' && isFinite(value) && value > 0 && Math.floor(value) === value;
}

/** Lowercases and strips the accents an ASR engine may or may not emit. */
export function voiceFold(text: string): string {
  const source = voiceText(text).toLowerCase();
  let out = '';
  for (let i = 0; i < source.length; i += 1) {
    const ch = source.charAt(i);
    const code = source.charCodeAt(i);
    if (code >= 0xe0 && code <= 0xe5) {
      out += 'a';
    } else if (code >= 0xe8 && code <= 0xeb) {
      out += 'e';
    } else if (code >= 0xec && code <= 0xef) {
      out += 'i';
    } else if (code >= 0xf2 && code <= 0xf6) {
      out += 'o';
    } else if (code >= 0xf9 && code <= 0xfc) {
      out += 'u';
    } else if (code === 0xe7) {
      out += 'c';
    } else {
      out += ch;
    }
  }
  return out.replace(/\s+/g, ' ').trim();
}

/* ------------------------------------------------------------------ */
/* Modes                                                              */
/* ------------------------------------------------------------------ */

export const VOICE_MODE_DICTATION = 'dictation';
export const VOICE_MODE_COMMAND = 'command';

export type VoiceMode = typeof VOICE_MODE_DICTATION | typeof VOICE_MODE_COMMAND;

export const VOICE_MODE_LABELS: Record<VoiceMode, string> = {
  dictation: 'ditado -- tudo vira texto',
  command: 'comando -- a fala e interpretada como acao',
};

/* ------------------------------------------------------------------ */
/* Entity chips                                                       */
/* ------------------------------------------------------------------ */

export const VOICE_POLARITY_PRESENT = 'present';
export const VOICE_POLARITY_ABSENT = 'absent';
export const VOICE_POLARITY_UNKNOWN = 'unknown';

export type VoicePolarity =
  | typeof VOICE_POLARITY_PRESENT
  | typeof VOICE_POLARITY_ABSENT
  | typeof VOICE_POLARITY_UNKNOWN;

export const VOICE_POLARITY_LABELS: Record<VoicePolarity, string> = {
  present: 'presente',
  absent: 'ausente',
  unknown: 'polaridade nao dita',
};

export type VoiceLaterality = 'right' | 'left' | 'bilateral' | 'unknown';

export const VOICE_LATERALITY_LABELS: Record<VoiceLaterality, string> = {
  right: 'direito',
  left: 'esquerdo',
  bilateral: 'bilateral',
  unknown: 'lado nao dito',
};

export type VoiceChipKind =
  | 'polarity'
  | 'laterality'
  | 'location'
  | 'measurement'
  | 'category';

export type VoiceConfidence = 'high' | 'low';

export interface VoiceChip {
  chipId: string;
  kind: VoiceChipKind;
  /** The span of transcript the chip came from, so the UI can underline it. */
  sourceText: string;
  /** Machine value. Shape depends on `kind`. */
  value: string | number;
  /** Second dimension of a measurement, when one was spoken. */
  secondValue?: number;
  unit?: string;
  laterality?: VoiceLaterality;
  polarity?: VoicePolarity;
  confidence: VoiceConfidence;
  /** Why the confidence is low, shown next to the chip. */
  caution?: string;
  /** CDE element the chip would fill, when it is bound to one. */
  cdeElementId?: string;
  confirmed: boolean;
}

/** Chips whose commit changes structured data nobody re-reads. */
export const VOICE_STRUCTURED_KINDS: VoiceChipKind[] = [
  'polarity',
  'laterality',
  'measurement',
  'category',
];

/* ------------------------------------------------------------------ */
/* Polarity                                                           */
/* ------------------------------------------------------------------ */

/** Explicit negation markers. Portuguese has several and ASR drops the shortest. */
export const VOICE_NEGATION_TERMS = [
  'nao',
  'sem',
  'ausencia',
  'ausente',
  'nega',
  'negativo',
  'inexistente',
  'nenhum',
  'nenhuma',
];

export const VOICE_AFFIRMATION_TERMS = [
  'ha',
  'presenca',
  'presente',
  'observa',
  'observado',
  'nota',
  'notado',
  'evidencia',
  'identificado',
  'positivo',
];

/**
 * Reads polarity from an utterance, refusing to infer it from absence.
 *
 * "nao" is the shortest clinically decisive word in Portuguese, and short unstressed words are
 * exactly what an ASR engine drops. If a dropped "nao" defaulted to `present`, a normal chest
 * would be reported as having a nodule -- so a phrase with no explicit marker comes back
 * `unknown`, which cannot be committed.
 */
export function voiceDetectPolarity(utterance: string): {
  polarity: VoicePolarity;
  marker: string;
  message: string;
} {
  const folded = voiceFold(utterance);
  const words = folded.split(/[^a-z0-9]+/).filter(Boolean);

  for (const term of VOICE_NEGATION_TERMS) {
    if (words.indexOf(term) >= 0) {
      return {
        polarity: VOICE_POLARITY_ABSENT,
        marker: term,
        message: 'Negacao explicita: "' + term + '".',
      };
    }
  }
  for (const term of VOICE_AFFIRMATION_TERMS) {
    if (words.indexOf(term) >= 0) {
      return {
        polarity: VOICE_POLARITY_PRESENT,
        marker: term,
        message: 'Afirmacao explicita: "' + term + '".',
      };
    }
  }
  return {
    polarity: VOICE_POLARITY_UNKNOWN,
    marker: '',
    message:
      'Nenhum marcador de polaridade dito -- nao se assume presenca, porque "nao" e a palavra clinicamente decisiva mais curta do idioma e e a que o reconhecedor perde.',
  };
}

/* ------------------------------------------------------------------ */
/* Laterality                                                         */
/* ------------------------------------------------------------------ */

const VOICE_RIGHT_TERMS = ['direito', 'direita'];
const VOICE_LEFT_TERMS = ['esquerdo', 'esquerda'];
const VOICE_BILATERAL_TERMS = ['bilateral', 'bilaterais', 'ambos', 'ambas'];

/**
 * Reads laterality, marking the single-letter form low confidence.
 *
 * "direito" and "esquerdo" are acoustically far apart and rarely confused. The dangerous form
 * is the abbreviation: "D" and "E" spoken as letter names are one phoneme each, routinely
 * swapped by an engine, and "lobo superior D" is exactly how radiologists dictate. Side is the
 * one field where a swap sends a surgeon to the wrong lung, so the abbreviated form never
 * auto-commits.
 */
export function voiceDetectLaterality(utterance: string): {
  laterality: VoiceLaterality;
  confidence: VoiceConfidence;
  caution?: string;
} {
  const folded = voiceFold(utterance);
  const words = folded.split(/[^a-z0-9]+/).filter(Boolean);

  for (const term of VOICE_BILATERAL_TERMS) {
    if (words.indexOf(term) >= 0) {
      return { laterality: 'bilateral', confidence: 'high' };
    }
  }
  const hasRightWord = VOICE_RIGHT_TERMS.some(t => words.indexOf(t) >= 0);
  const hasLeftWord = VOICE_LEFT_TERMS.some(t => words.indexOf(t) >= 0);

  if (hasRightWord && hasLeftWord) {
    return {
      laterality: 'unknown',
      confidence: 'low',
      caution: 'A frase menciona os dois lados -- o lado nao pode ser resolvido automaticamente.',
    };
  }
  if (hasRightWord) {
    return { laterality: 'right', confidence: 'high' };
  }
  if (hasLeftWord) {
    return { laterality: 'left', confidence: 'high' };
  }

  const hasRightLetter = words.indexOf('d') >= 0;
  const hasLeftLetter = words.indexOf('e') >= 0;
  if (hasRightLetter && !hasLeftLetter) {
    return {
      laterality: 'right',
      confidence: 'low',
      caution:
        'Lado dito como a letra "D" -- uma letra e um fonema, o reconhecedor troca "D" e "E" com frequencia, e uma troca de lado manda o cirurgiao ao pulmao errado.',
    };
  }
  if (hasLeftLetter && !hasRightLetter) {
    return {
      laterality: 'left',
      confidence: 'low',
      caution:
        'Lado dito como a letra "E" -- uma letra e um fonema, o reconhecedor troca "D" e "E" com frequencia, e uma troca de lado manda o cirurgiao ao pulmao errado.',
    };
  }
  return { laterality: 'unknown', confidence: 'low', caution: 'Lado nao dito.' };
}

/* ------------------------------------------------------------------ */
/* Measurement                                                        */
/* ------------------------------------------------------------------ */

export const VOICE_UNITS = ['mm', 'cm', 'm', 'ml', 'cm3', 'mm2', 'cm2'];

const VOICE_SPOKEN_UNITS: Record<string, string> = {
  milimetro: 'mm',
  milimetros: 'mm',
  mm: 'mm',
  centimetro: 'cm',
  centimetros: 'cm',
  cm: 'cm',
  mililitro: 'ml',
  mililitros: 'ml',
  ml: 'ml',
};

export interface VoiceMeasurement {
  value: number;
  secondValue?: number;
  unit: string;
  /** The numeric token exactly as the engine emitted it. */
  rawToken: string;
}

/**
 * Parses a spoken measurement.
 *
 * Accepts both decimal separators, because an engine configured for en-US emits "1.5" where
 * the speaker said "um virgula cinco". Refuses a token carrying **both** separators, or a
 * shape that could be either a decimal or a thousands grouping, rather than picking one -- this
 * is the version-diff failure (RTV-227) arriving through the microphone, and "1.5" silently
 * read as 15 is a nodule that became a mass.
 *
 * Refuses a number with no unit rather than defaulting. "um virgula cinco" is 1,5 cm to a
 * chest radiologist and 1,5 mm to a neuroradiologist measuring an aneurysm, and this module has
 * no way to know which of them is speaking.
 */
export function voiceParseMeasurement(utterance: string): VoiceResult<VoiceMeasurement> {
  const folded = voiceFold(utterance);
  if (!folded) {
    return voiceRefuse('empty-utterance', 'Nada foi dito.');
  }

  const numberMatches = folded.match(/\d+(?:[.,]\d+)*/g) ?? [];
  if (!numberMatches.length) {
    return voiceRefuse('empty-utterance', 'Nenhum numero na frase.');
  }

  const parseToken = (token: string): VoiceResult<number> => {
    const hasComma = token.indexOf(',') >= 0;
    const hasDot = token.indexOf('.') >= 0;
    if (hasComma && hasDot) {
      return voiceRefuse(
        'measurement-ambiguous-separator',
        'O numero "' +
          token +
          '" tem virgula e ponto -- nao e possivel dizer qual e o separador decimal, e ler errado troca 1,5 por 15.'
      );
    }
    const separator = hasComma ? ',' : hasDot ? '.' : '';
    if (separator) {
      const parts = token.split(separator);
      if (parts.length > 2) {
        return voiceRefuse(
          'measurement-ambiguous-separator',
          'O numero "' + token + '" tem mais de um separador -- forma ambigua.'
        );
      }
      // A three-digit group after the separator is a thousands grouping in pt-BR and a
      // decimal in en-US. Guessing turns 1.500 into either 1,5 or 1500.
      if (parts[1].length === 3) {
        return voiceRefuse(
          'measurement-ambiguous-separator',
          'O numero "' +
            token +
            '" pode ser decimal ou separador de milhar -- adivinhar transforma 1.500 em 1,5 ou em 1500.'
        );
      }
    }
    const normalised = separator ? token.replace(separator, '.') : token;
    const value = Number(normalised);
    if (!isFinite(value)) {
      return voiceRefuse('empty-utterance', 'Numero invalido: "' + token + '".');
    }
    return voiceOk(value);
  };

  const first = parseToken(numberMatches[0]);
  if (!first.ok) {
    return voiceRefuse(first.code, first.reason);
  }

  let secondValue: number | undefined;
  if (numberMatches.length > 1 && /por|x/.test(folded)) {
    const second = parseToken(numberMatches[1]);
    if (!second.ok) {
      return voiceRefuse(second.code, second.reason);
    }
    secondValue = second.value;
  }

  const words = folded.split(/[^a-z0-9]+/).filter(Boolean);
  let unit = '';
  for (const word of words) {
    const mapped = VOICE_SPOKEN_UNITS[word];
    if (mapped) {
      unit = mapped;
      break;
    }
  }
  if (!unit) {
    return voiceRefuse(
      'measurement-no-unit',
      'Medida dita sem unidade -- "um virgula cinco" e 1,5 cm para um radiologista de torax e 1,5 mm para um neurorradiologista medindo um aneurisma, e este modulo nao sabe qual dos dois esta falando.'
    );
  }

  return voiceOk({
    value: first.value,
    secondValue,
    unit,
    rawToken: numberMatches[0],
  });
}

/* ------------------------------------------------------------------ */
/* Categories                                                         */
/* ------------------------------------------------------------------ */

/**
 * RADS categories the extractor recognises, by family.
 *
 * Spoken categories are recognised only against this table. An unrecognised category is a
 * refusal rather than free text put into a structured field, because a category is the field a
 * follow-up queue reads without a human in between.
 */
export const VOICE_CATEGORY_FAMILIES: Record<string, string[]> = {
  'BI-RADS': ['0', '1', '2', '3', '4', '4a', '4b', '4c', '5', '6'],
  'LUNG-RADS': ['1', '2', '3', '4a', '4b', '4x'],
  'PI-RADS': ['1', '2', '3', '4', '5'],
  'TI-RADS': ['1', '2', '3', '4', '5'],
  'LI-RADS': ['1', '2', '3', '4', '5', 'm', 'tiv'],
  'CAD-RADS': ['0', '1', '2', '3', '4a', '4b', '5'],
};

export function voiceParseCategory(
  utterance: string
): VoiceResult<{ family: string; category: string }> {
  const folded = voiceFold(utterance).replace(/\s+/g, ' ');
  const families = Object.keys(VOICE_CATEGORY_FAMILIES);

  for (const family of families) {
    const spoken = voiceFold(family).replace(/-/g, '[ -]?');
    const pattern = new RegExp(spoken + '\\s*([0-9]+[abcx]?|m|tiv)\\b');
    const match = folded.match(pattern);
    if (match) {
      const candidate = match[1];
      const allowed = VOICE_CATEGORY_FAMILIES[family];
      if (allowed.indexOf(candidate) < 0) {
        return voiceRefuse(
          'unknown-category',
          'Categoria "' +
            candidate +
            '" nao existe em ' +
            family +
            ' -- uma categoria e o campo que a fila de seguimento le sem humano no meio.'
        );
      }
      return voiceOk({ family, category: candidate });
    }
  }
  return voiceRefuse('unknown-category', 'Nenhuma categoria RADS reconhecida na frase.');
}

/* ------------------------------------------------------------------ */
/* Extraction                                                         */
/* ------------------------------------------------------------------ */

export interface VoiceExtraction {
  utterance: string;
  chips: VoiceChip[];
  /** Chips that cannot be committed without a human touching them. */
  needsConfirmation: VoiceChip[];
  message: string;
}

/**
 * Extracts candidate chips from one utterance.
 *
 * Everything comes back unconfirmed. Free text is read by a human before signature; structured
 * data is not read by anybody -- it reaches the cancer registry and the follow-up queue
 * directly, and the radiologist's only contact with it was a chip appearing on screen while
 * they were looking at the image.
 */
export function voiceExtract(input: {
  utterance: string;
  chipIdPrefix?: string;
  cdeBindings?: Partial<Record<VoiceChipKind, string>>;
}): VoiceResult<VoiceExtraction> {
  const utterance = voiceText(input?.utterance);
  if (!utterance) {
    return voiceRefuse('empty-utterance', 'Nada foi dito.');
  }
  const prefix = voiceText(input?.chipIdPrefix) || 'chip';
  const bindings = input?.cdeBindings ?? {};
  const chips: VoiceChip[] = [];
  let counter = 0;

  const push = (chip: Omit<VoiceChip, 'chipId' | 'confirmed'>) => {
    counter += 1;
    chips.push({ ...chip, chipId: prefix + '-' + counter, confirmed: false });
  };

  const polarity = voiceDetectPolarity(utterance);
  push({
    kind: 'polarity',
    sourceText: polarity.marker || utterance,
    value: polarity.polarity,
    polarity: polarity.polarity,
    confidence: polarity.polarity === VOICE_POLARITY_UNKNOWN ? 'low' : 'high',
    caution: polarity.polarity === VOICE_POLARITY_UNKNOWN ? polarity.message : undefined,
    cdeElementId: bindings.polarity,
  });

  const laterality = voiceDetectLaterality(utterance);
  push({
    kind: 'laterality',
    sourceText: utterance,
    value: laterality.laterality,
    laterality: laterality.laterality,
    confidence: laterality.confidence,
    caution: laterality.caution,
    cdeElementId: bindings.laterality,
  });

  const measurement = voiceParseMeasurement(utterance);
  if (measurement.ok) {
    push({
      kind: 'measurement',
      sourceText: measurement.value.rawToken,
      value: measurement.value.value,
      secondValue: measurement.value.secondValue,
      unit: measurement.value.unit,
      confidence: 'high',
      cdeElementId: bindings.measurement,
    });
  }

  const category = voiceParseCategory(utterance);
  if (category.ok) {
    push({
      kind: 'category',
      sourceText: category.value.family + ' ' + category.value.category,
      value: category.value.family + ' ' + category.value.category,
      confidence: 'high',
      cdeElementId: bindings.category,
    });
  }

  const needsConfirmation = chips.filter(c => VOICE_STRUCTURED_KINDS.indexOf(c.kind) >= 0);

  return voiceOk({
    utterance,
    chips,
    needsConfirmation,
    message:
      chips.length +
      ' entidade(s) reconhecida(s), ' +
      needsConfirmation.length +
      ' exigindo confirmacao antes de entrar em campo estruturado.',
  });
}

/**
 * Commits one chip into a structured field.
 *
 * Refuses an unconfirmed chip, refuses an unknown polarity, and refuses an abbreviated
 * laterality even when the caller passes a confirmation flag -- the abbreviated form has to be
 * corrected or spoken again, because confirming a value the engine guessed from one phoneme is
 * confirming the guess rather than the side.
 */
export function voiceCommitChip(input: {
  chip: VoiceChip;
  confirmedBy: string;
  confirmedAt: number;
  /** Value the human corrected it to, when they did. */
  correctedValue?: string | number;
}): VoiceResult<VoiceChip> {
  if (!input || !input.chip) {
    return voiceRefuse('chip-unconfirmed', 'Nenhuma entidade para confirmar.');
  }
  const chip = input.chip;

  if (!voiceText(input.confirmedBy)) {
    return voiceRefuse('unattributed', 'Confirmacao de entidade sem responsavel identificado.');
  }
  if (!voiceIsEpochMs(input.confirmedAt)) {
    return voiceRefuse('invalid-timestamp', 'Confirmacao de entidade sem horario valido.');
  }

  const corrected = input.correctedValue !== undefined && input.correctedValue !== null;

  if (chip.kind === 'polarity' && !corrected && chip.polarity === VOICE_POLARITY_UNKNOWN) {
    return voiceRefuse(
      'polarity-unknown',
      'A frase nao disse presenca nem ausencia -- confirmar aqui gravaria uma afirmacao que ninguem fez.'
    );
  }
  if (
    chip.kind === 'laterality' &&
    !corrected &&
    chip.confidence === 'low'
  ) {
    return voiceRefuse(
      'laterality-ambiguous',
      (chip.caution ?? 'Lado ambiguo.') +
        ' Corrija o lado ou repita a frase -- confirmar um valor que o reconhecedor adivinhou de um fonema e confirmar o palpite, nao o lado.'
    );
  }

  return voiceOk({
    ...chip,
    value: corrected ? (input.correctedValue as string | number) : chip.value,
    laterality:
      chip.kind === 'laterality' && corrected
        ? (input.correctedValue as VoiceLaterality)
        : chip.laterality,
    polarity:
      chip.kind === 'polarity' && corrected
        ? (input.correctedValue as VoicePolarity)
        : chip.polarity,
    confidence: corrected ? 'high' : chip.confidence,
    confirmed: true,
  });
}

/* ------------------------------------------------------------------ */
/* Commands                                                           */
/* ------------------------------------------------------------------ */

export interface VoiceCommandDef {
  commandId: string;
  /** Folded phrases that trigger it. */
  phrases: string[];
  label: string;
  /** True when the action cannot be undone or has clinical weight. */
  destructive: boolean;
}

/**
 * The commands the ticket names, plus their destructive classification.
 *
 * `assinar` is destructive not because it deletes anything but because it is irreversible and
 * it is the act that turns a draft into a legal document.
 */
export const VOICE_COMMANDS: VoiceCommandDef[] = [
  {
    commandId: 'insert-measurement',
    phrases: ['inserir medida', 'inserir a medida', 'usar medida'],
    label: 'inserir a medida selecionada',
    destructive: false,
  },
  {
    commandId: 'next-field',
    phrases: ['proximo campo', 'campo seguinte'],
    label: 'ir para o proximo campo',
    destructive: false,
  },
  {
    commandId: 'open-priors',
    phrases: ['abrir priors', 'abrir comparativos', 'abrir exames anteriores'],
    label: 'abrir os exames anteriores',
    destructive: false,
  },
  {
    commandId: 'add-nodule',
    phrases: ['adicionar nodulo', 'novo nodulo'],
    label: 'adicionar um achado de nodulo',
    destructive: false,
  },
  {
    commandId: 'critical-finding',
    phrases: ['achado critico', 'marcar achado critico'],
    label: 'marcar como achado critico',
    destructive: true,
  },
  {
    commandId: 'delete-finding',
    phrases: ['apagar achado', 'remover achado', 'excluir achado'],
    label: 'apagar o achado',
    destructive: true,
  },
  {
    commandId: 'sign-report',
    phrases: ['assinar laudo', 'assinar o laudo', 'assinar'],
    label: 'assinar o laudo',
    destructive: true,
  },
];

export interface VoiceInterpretation {
  mode: VoiceMode;
  /** Set when the utterance was a recognised command. */
  command?: VoiceCommandDef;
  /** Text to insert, when the mode was dictation. */
  text?: string;
  targetFieldId?: string;
  requiresConfirmation: boolean;
  message: string;
}

/**
 * Interprets one utterance.
 *
 * In dictation mode this never returns a command, and that is the whole point: "assinar" is a
 * command and also a word that appears in dictated content ("o paciente assinou o termo de
 * consentimento"). A parser that scans every utterance for command words will eventually sign
 * a report because somebody described a consent form.
 *
 * The focus binding is checked first. A four-second utterance can outlive the field it started
 * in, and a findings sentence inserted at "the current cursor" after the radiologist tabbed to
 * the impression is read as the conclusion.
 */
export function voiceInterpret(input: {
  utterance: string;
  mode: VoiceMode;
  /** Field focused when the utterance started. */
  fieldIdAtStart?: string;
  /** Field focused now. */
  fieldIdNow?: string;
  /** Set once the user confirmed a destructive command. */
  destructiveConfirmed?: boolean;
}): VoiceResult<VoiceInterpretation> {
  const utterance = voiceText(input?.utterance);
  if (!utterance) {
    return voiceRefuse('empty-utterance', 'Nada foi dito.');
  }
  const mode: VoiceMode = input.mode === VOICE_MODE_COMMAND ? VOICE_MODE_COMMAND : VOICE_MODE_DICTATION;

  if (mode === VOICE_MODE_DICTATION) {
    const start = voiceText(input.fieldIdAtStart);
    const now = voiceText(input.fieldIdNow);
    if (start && now && start !== now) {
      return voiceRefuse(
        'focus-changed',
        'O foco mudou de "' +
          start +
          '" para "' +
          now +
          '" durante a fala -- inserir no cursor atual poria uma frase de achados na impressao, onde ela e lida como a conclusao.'
      );
    }
    return voiceOk({
      mode,
      text: utterance,
      targetFieldId: start || now || undefined,
      requiresConfirmation: false,
      message: 'Texto ditado inserido em ' + (start || now || 'campo em foco') + '.',
    });
  }

  const folded = voiceFold(utterance);
  const match = VOICE_COMMANDS.filter(command =>
    command.phrases.some(phrase => folded === voiceFold(phrase) || folded.indexOf(voiceFold(phrase)) === 0)
  )[0];

  if (!match) {
    return voiceRefuse(
      'unknown-command',
      'Comando nao reconhecido: "' +
        utterance +
        '". Em modo de comando nada e inserido como texto, para que uma frase ditada nunca execute uma acao.'
    );
  }

  if (match.destructive && input.destructiveConfirmed !== true) {
    return voiceRefuse(
      'destructive-unconfirmed',
      'O comando "' +
        match.label +
        '" nao e reversivel e exige confirmacao explicita antes de executar.'
    );
  }

  return voiceOk({
    mode,
    command: match,
    requiresConfirmation: match.destructive,
    message: 'Comando reconhecido: ' + match.label + '.',
  });
}

/**
 * Whether a phrase would be a command if it were spoken in command mode.
 *
 * Exported so the UI can show a hint ("isso soa como um comando -- entre em modo de comando")
 * without the dictation path ever acting on it.
 */
export function voiceLooksLikeCommand(utterance: string): VoiceCommandDef | null {
  const folded = voiceFold(utterance);
  if (!folded) {
    return null;
  }
  const match = VOICE_COMMANDS.filter(command =>
    command.phrases.some(phrase => folded === voiceFold(phrase))
  )[0];
  return match ?? null;
}

/* ------------------------------------------------------------------ */
/* Transcript retention                                              */
/* ------------------------------------------------------------------ */

export type VoiceRetentionAction = 'keep' | 'discard-after-confirmation' | 'discard-on-signature';

export const VOICE_RETENTION_LABELS: Record<VoiceRetentionAction, string> = {
  keep: 'manter a transcricao e o audio',
  'discard-after-confirmation': 'descartar apos a transcricao ser conferida',
  'discard-on-signature': 'descartar ao assinar o laudo',
};

export interface VoiceRetentionDecision {
  action: VoiceRetentionAction;
  retainDays?: number;
  /** Whether the transcript may leave the institution to a cloud ASR provider. */
  transcriptLeavesInstitution: boolean;
  providerId?: string;
  decidedBy: string;
  decidedAt: number;
  justification: string;
}

/**
 * Records the retention and residency decision for a transcript.
 *
 * The transcript is a verbatim record of a physician discussing a named patient, so it is
 * personal data of both. It also frequently contains more than the report does -- the aside
 * that was not dictated into the document, the correction spoken aloud. Keeping it needs a
 * period and a reason, and sending it to a cloud recogniser needs the provider named, because
 * "onde isso foi processado" is the first question an audit asks.
 */
export function voiceDecideRetention(
  decision: VoiceRetentionDecision
): VoiceResult<VoiceRetentionDecision> {
  if (!decision) {
    return voiceRefuse('retention-undecided', 'Decisao de retencao ausente.');
  }
  if (!VOICE_RETENTION_LABELS[decision.action]) {
    return voiceRefuse('retention-undecided', 'Acao de retencao desconhecida.');
  }
  if (!voiceText(decision.decidedBy)) {
    return voiceRefuse('unattributed', 'Decisao de retencao sem responsavel identificado.');
  }
  if (!voiceIsEpochMs(decision.decidedAt)) {
    return voiceRefuse('invalid-timestamp', 'Decisao de retencao sem horario valido.');
  }
  if (!voiceText(decision.justification)) {
    return voiceRefuse('retention-undecided', 'Decisao de retencao sem justificativa.');
  }
  if (decision.action === 'keep') {
    const days = Number(decision.retainDays);
    if (!isFinite(days) || days < 1 || Math.floor(days) !== days) {
      return voiceRefuse(
        'retention-undecided',
        'Manter a transcricao exige um prazo em dias -- "manter" sem prazo e manter para sempre.'
      );
    }
  }
  if (decision.transcriptLeavesInstitution === true && !voiceText(decision.providerId)) {
    return voiceRefuse(
      'retention-undecided',
      'Transcricao que sai da instituicao exige o provedor identificado -- "onde isso foi processado" e a primeira pergunta de uma auditoria.'
    );
  }

  return voiceOk({
    ...decision,
    retainDays: decision.action === 'keep' ? decision.retainDays : undefined,
    providerId: voiceText(decision.providerId) || undefined,
    decidedBy: voiceText(decision.decidedBy),
    justification: voiceText(decision.justification),
  });
}

/** One line for a chip. */
export function voiceDescribeChip(chip: VoiceChip): string {
  if (!chip) {
    return '';
  }
  const parts = [chip.kind, String(chip.value)];
  if (chip.unit) {
    parts.push(chip.unit);
  }
  if (chip.confidence === 'low') {
    parts.push('confianca baixa');
  }
  if (chip.caution) {
    parts.push(chip.caution);
  }
  return parts.join(' - ');
}
