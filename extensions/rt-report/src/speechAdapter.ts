/**
 * Pluggable speech recognition: the provider contract and the risk scan — pure core
 * (RTV-112).
 *
 * The capture itself is Web Audio (RTV-111) and the providers are network services. What
 * belongs here is the contract a provider has to satisfy, and the part that decides which
 * pieces of a dictated report a human has to look at before it can be signed.
 *
 * ## Recognition confidence is calibrated on sound, not on consequence
 *
 * This is the observation the module is built around, and it is why a confidence threshold
 * is not a safety mechanism. An engine that hears "esquerda" clearly and transcribes
 * "esquerda" reports high confidence — and if the radiologist said "direita", the number
 * says nothing at all. The errors that matter in a report are not the mumbled ones; they
 * are the crisp, confident, wrong ones.
 *
 * So four classes of token demand a human look **regardless of the provider's score**:
 *
 * - **Negation.** A dropped "não" inverts the finding. "Não há sinais de pneumotórax" and
 *   "Há sinais de pneumotórax" differ by one short unstressed syllable and by everything
 *   else.
 * - **Laterality.** The wrong-side error, and dictation is one of the ways it enters the
 *   record.
 * - **Measurements.** "1,5 cm" and "15 cm" are the same digits; a decimal separator lost
 *   in transcription changes a follow-up interval into a biopsy.
 * - **Doses.** Same failure with a drug attached.
 *
 * {@link scanRisk} finds them and {@link acceptDictation} refuses while any is unreviewed.
 *
 * ## An unrecognised command becomes text, never nothing
 *
 * "Ponto final" is a command; it is also a phrase a radiologist can say. A command parser
 * that silently drops what it cannot match deletes dictated content, which is the worst
 * available outcome — the reader has no way to notice an absence. Unmatched candidates are
 * inserted verbatim and reported.
 *
 * ## Dictated text is machine-origin until someone touches it
 *
 * The same rule as the pre-filled normal templates in `templateLibrary.ts` (RTV-105), for
 * the same reason: fluent text that nobody read is indistinguishable from fluent text that
 * somebody wrote.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export interface SpeechProvider {
  id: string;
  name: string;
  /** BCP-47 tags the provider is trained for. */
  languages: string[];
  /** Whether it understands spoken punctuation and editing commands. */
  supportsCommands: boolean;
  /** Whether it has a radiology lexicon. */
  supportsMedicalVocabulary: boolean;
  /** Whether it returns a per-token confidence at all. */
  reportsTokenConfidence: boolean;
  /** Whether partial results arrive during speech. */
  streaming: boolean;
  /** Where the audio goes. Relevant because dictation is patient data. */
  processing: 'on-device' | 'cloud';
}

export interface ProviderRequirement {
  language: string;
  /** Whether audio may leave the institution. */
  allowCloud: boolean;
  requireMedicalVocabulary?: boolean;
}

export interface ProviderSelection {
  provider: SpeechProvider | null;
  reason: string;
  warnings: string[];
}

const text = (value: unknown): string => String(value ?? '').trim();

/**
 * Picks a provider, or explains why none fits.
 *
 * A language mismatch is a rejection rather than a warning: a pt-PT engine transcribing
 * pt-BR dictation does not fail loudly, it produces plausible Portuguese with the wrong
 * words in it.
 */
export function selectProvider(
  providers: SpeechProvider[],
  requirement: ProviderRequirement
): ProviderSelection {
  const language = text(requirement?.language).toLowerCase();
  const warnings: string[] = [];

  if (!language) {
    return { provider: null, reason: 'Idioma de ditado não informado.', warnings };
  }

  const candidates = (providers ?? []).filter(p => p && p.languages.some(l => l.toLowerCase() === language));
  if (!candidates.length) {
    return {
      provider: null,
      reason:
        `Nenhum provedor treinado em ${requirement.language}. Um motor de pt-PT transcrevendo ditado pt-BR ` +
        'não falha alto: produz português plausível com as palavras erradas dentro.',
      warnings,
    };
  }

  const allowed = requirement.allowCloud ? candidates : candidates.filter(p => p.processing === 'on-device');
  if (!allowed.length) {
    return {
      provider: null,
      reason:
        'Todos os provedores disponíveis processam na nuvem, e o ditado contém dados do paciente. ' +
        'Enviar áudio clínico para fora exige base legal e contrato de operador.',
      warnings,
    };
  }

  const withVocabulary = allowed.filter(p => p.supportsMedicalVocabulary);
  if (requirement.requireMedicalVocabulary && !withVocabulary.length) {
    return {
      provider: null,
      reason: 'Nenhum provedor com vocabulário médico, e ele foi exigido.',
      warnings,
    };
  }

  const chosen = (withVocabulary.length ? withVocabulary : allowed)[0];
  if (!chosen.supportsMedicalVocabulary) {
    warnings.push(
      'Provedor sem vocabulário radiológico: termos anatômicos e nomes de achados vão sair como as palavras comuns mais próximas.'
    );
  }
  if (!chosen.reportsTokenConfidence) {
    warnings.push(
      'Provedor não devolve confiança por token. A varredura de risco continua valendo — ela nunca dependeu da confiança.'
    );
  }
  if (chosen.processing === 'cloud') {
    warnings.push('Áudio processado na nuvem: o ditado é dado do paciente.');
  }

  return { provider: chosen, reason: '', warnings };
}

export interface Token {
  text: string;
  /** 0..1 when the provider reports it. */
  confidence?: number;
  startMs?: number;
}

export interface Transcript {
  tokens: Token[];
  language: string;
  providerId: string;
}

export type RiskClass = 'negation' | 'laterality' | 'measurement' | 'dose';

export const RISK_LABELS: Record<RiskClass, string> = {
  negation: 'negação',
  laterality: 'lateralidade',
  measurement: 'medida',
  dose: 'dose',
};

export const RISK_REASONS: Record<RiskClass, string> = {
  negation:
    'Um "não" perdido inverte o achado: "não há sinais de pneumotórax" e "há sinais de pneumotórax" diferem por uma sílaba curta e átona.',
  laterality: 'Lado errado é o erro que o ditado introduz no prontuário.',
  measurement:
    'Uma vírgula perdida transforma 1,5 cm em 15 cm — os mesmos dígitos, e um intervalo de seguimento vira uma biópsia.',
  dose: 'A mesma falha de uma medida, com uma droga junto.',
};

const PATTERNS: Array<{ kind: RiskClass; pattern: RegExp }> = [
  // Dose before measurement: "mg" would otherwise be caught by the unit "m".
  { kind: 'dose', pattern: /\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|g|MBq|mCi|mSv|mGy|UI)\b/gi },
  { kind: 'measurement', pattern: /\b\d+(?:[.,]\d+)?\s*(?:mm|cm|m|ml|mL|cc|%|HU|UH)\b/gi },
  {
    kind: 'negation',
    pattern: /\b(?:n[ãa]o|sem|aus[êe]ncia|ausente|nega|negativo|nenhum|nenhuma|inexist[êe]ncia|exceto|salvo)\b/gi,
  },
  {
    kind: 'laterality',
    pattern: /\b(?:direit[ao]|esquerd[ao]|bilateral|unilateral|ipsilateral|contralateral)\b/gi,
  },
];

export interface RiskFlag {
  kind: RiskClass;
  /** The matched text. */
  match: string;
  /** Character offsets into the joined transcript. */
  start: number;
  end: number;
  /** Lowest token confidence overlapping the match, when the provider reported any. */
  confidence?: number;
  reason: string;
}

export interface JoinedTranscript {
  text: string;
  /** [start, end) per token, into `text`. */
  ranges: Array<[number, number]>;
}

export function joinTranscript(tokens: Token[]): JoinedTranscript {
  const ranges: Array<[number, number]> = [];
  let out = '';
  for (const token of tokens ?? []) {
    const value = String(token?.text ?? '');
    if (out.length && !/^[.,;:!?)\]]/.test(value)) {
      out += ' ';
    }
    const start = out.length;
    out += value;
    ranges.push([start, out.length]);
  }
  return { text: out, ranges };
}

/**
 * The tokens a human has to look at.
 *
 * Deliberately not filtered by confidence. The errors that matter in a report are not the
 * mumbled ones — they are the crisp, confident, wrong ones, and a threshold hides exactly
 * those.
 */
export function scanRisk(transcript: Transcript): RiskFlag[] {
  const joined = joinTranscript(transcript?.tokens ?? []);
  const flags: RiskFlag[] = [];
  const taken: Array<[number, number]> = [];

  for (const { kind, pattern } of PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(joined.text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (taken.some(([a, b]) => start < b && a < end)) {
        continue;
      }
      taken.push([start, end]);
      flags.push({
        kind,
        match: match[0],
        start,
        end,
        confidence: lowestConfidence(transcript.tokens, joined.ranges, start, end),
        reason: RISK_REASONS[kind],
      });
    }
  }

  return flags.sort((a, b) => a.start - b.start);
}

function lowestConfidence(
  tokens: Token[],
  ranges: Array<[number, number]>,
  start: number,
  end: number
): number | undefined {
  let lowest: number | undefined;
  for (let i = 0; i < ranges.length; i++) {
    const [a, b] = ranges[i];
    if (a >= end || b <= start) {
      continue;
    }
    const confidence = Number(tokens[i]?.confidence);
    if (Number.isFinite(confidence)) {
      lowest = lowest === undefined ? confidence : Math.min(lowest, confidence);
    }
  }
  return lowest;
}

export interface CommandDefinition {
  /** Spoken form, lower case. */
  phrase: string;
  /** What it inserts, or empty for an editing action. */
  insert?: string;
  action?: 'newline' | 'newparagraph' | 'undo';
}

export const DEFAULT_COMMANDS: CommandDefinition[] = [
  { phrase: 'ponto final', insert: '.' },
  { phrase: 'ponto', insert: '.' },
  { phrase: 'vírgula', insert: ',' },
  { phrase: 'dois pontos', insert: ':' },
  { phrase: 'ponto e vírgula', insert: ';' },
  { phrase: 'abre parênteses', insert: '(' },
  { phrase: 'fecha parênteses', insert: ')' },
  { phrase: 'nova linha', action: 'newline' },
  { phrase: 'novo parágrafo', action: 'newparagraph' },
];

export interface CommandResult {
  text: string;
  applied: string[];
  /** Candidates that looked like commands and were not matched. Inserted verbatim. */
  unrecognised: string[];
}

/**
 * Applies spoken punctuation and editing commands.
 *
 * Anything that looks like a command and is not one is inserted as text. A parser that
 * drops what it cannot match deletes dictated content, and an absence is the one kind of
 * error a reader cannot notice by reading.
 */
export function applyCommands(
  source: string,
  commands: CommandDefinition[] = DEFAULT_COMMANDS,
  commandMarker = /\[\[(.+?)\]\]/g
): CommandResult {
  const applied: string[] = [];
  const unrecognised: string[] = [];
  const table = new Map(commands.map(c => [c.phrase.toLowerCase(), c]));

  const out = String(source ?? '').replace(commandMarker, (_all, phrase: string) => {
    const key = String(phrase).trim().toLowerCase();
    const command = table.get(key);
    if (!command) {
      unrecognised.push(String(phrase).trim());
      return String(phrase).trim();
    }
    applied.push(key);
    if (command.action === 'newline') {
      return '\n';
    }
    if (command.action === 'newparagraph') {
      return '\n\n';
    }
    return command.insert ? command.insert : '';
  });

  return { text: tidy(out), applied, unrecognised };
}

function tidy(value: string): string {
  return value
    .replace(/[ \t]+([.,;:)])/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    // Both sides: the marker leaves a space behind it as well as in front of it.
    .replace(/\n[ \t]+/g, '\n')
    .trim();
}

export interface DictationDraft {
  text: string;
  /** Always true until a human edits or confirms it. */
  machineOrigin: boolean;
  flags: RiskFlag[];
  unrecognisedCommands: string[];
}

/** Turns a transcript into a draft, without inserting it anywhere. */
export function draftFromTranscript(
  transcript: Transcript,
  commands: CommandDefinition[] = DEFAULT_COMMANDS
): DictationDraft {
  const joined = joinTranscript(transcript?.tokens ?? []);
  const commanded = applyCommands(joined.text, commands);
  return {
    text: commanded.text,
    machineOrigin: true,
    flags: scanRisk(transcript),
    unrecognisedCommands: commanded.unrecognised,
  };
}

export interface AcceptanceResult {
  ok: boolean;
  /** Flags the reader has not marked reviewed. */
  pending: RiskFlag[];
  reason?: string;
}

/**
 * Whether a dictated draft may go into the report.
 *
 * Refuses while any risk flag is unreviewed. The refusal is per flag rather than per
 * dictation so that the reader confirms the laterality they actually said, not a checkbox
 * covering a paragraph.
 */
export function acceptDictation(
  draft: DictationDraft,
  reviewed: Array<{ start: number; end: number }>
): AcceptanceResult {
  const done = reviewed ?? [];
  const pending = (draft?.flags ?? []).filter(
    flag => !done.some(r => r && r.start === flag.start && r.end === flag.end)
  );

  if (pending.length) {
    return {
      ok: false,
      pending,
      reason:
        `${pending.length} trecho(s) de risco não revisado(s): ${pending.map(f => `${RISK_LABELS[f.kind]} ("${f.match}")`).join(', ')}. ` +
        'A confiança do reconhecedor é calibrada em som, não em consequência: o erro que importa é o nítido e confiante.',
    };
  }

  return { ok: true, pending: [] };
}

/** One line for the dictation panel. */
export function describeDraft(draft: DictationDraft): string {
  const parts = [`${draft.text.length} caractere(s) ditado(s).`];
  if (draft.flags.length) {
    const byKind = draft.flags.reduce<Record<string, number>>((acc, f) => {
      acc[RISK_LABELS[f.kind]] = (acc[RISK_LABELS[f.kind]] || 0) + 1;
      return acc;
    }, {});
    parts.push(
      `Revisar: ${Object.entries(byKind).map(([k, n]) => `${n} ${k}`).join(', ')}.`
    );
  }
  if (draft.unrecognisedCommands.length) {
    parts.push(
      `${draft.unrecognisedCommands.length} comando(s) não reconhecido(s) inserido(s) como texto: ${draft.unrecognisedCommands.join(', ')}.`
    );
  }
  return parts.join(' ');
}
