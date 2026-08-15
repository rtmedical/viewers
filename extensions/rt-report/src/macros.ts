/**
 * Report macros: shortcut-triggered phrases with fill-in fields — pure core (RTV-106).
 *
 * A radiologist types `;normaltorax` and gets four sentences. That is a large productivity
 * win and a large safety surface, and the two are the same mechanism.
 *
 * ## An unfilled placeholder must never reach a signed report
 *
 * This is the failure this module is built around. A macro like
 * `Nódulo em [LOBO] medindo [N] mm` expands instantly, the radiologist keeps typing at the
 * end of it, and the report goes out saying "Nódulo em [LOBO] medindo [N] mm" — or worse,
 * with a *default* left in place that happens to be wrong for this patient.
 *
 * So placeholders are first-class: {@link expandMacro} reports where every one of them
 * landed, the caret goes to the **first** one rather than to the end of the insertion, and
 * {@link findUnfilledPlaceholders} exists so the signing step can refuse. A macro system
 * without that check is a machine for producing confident wrong sentences.
 *
 * ## The expansion has to be visible
 *
 * {@link expandMacro} returns the inserted range, not just the new text. A macro that drops
 * a paragraph of clinical assertions into the document with no visual trace is text the
 * radiologist signs without having read — the editor is expected to select or highlight the
 * range so it is looked at once.
 *
 * ## Triggers: longest match, and never inside a word
 *
 * With `;n` and `;nod` both registered, typing `;nod` must not fire `;n` and leave `od`
 * behind. Longest match wins. And a trigger only fires at a word boundary, so a sigil that
 * appears mid-token is left alone.
 *
 * Registration rejects duplicate triggers rather than letting the later one shadow the
 * earlier: two macros on the same shortcut means one of them silently never fires, and the
 * radiologist who wrote it will not find out until a report is wrong.
 *
 * Framework-free, no editor, no `@ohif/*`. Zero-fork per RTV-114.
 */

/** Default sigil. Configurable, because habits differ between services. */
export const DEFAULT_SIGIL = ';';

/** Placeholder syntax: `[NOME]`. Uppercase-only so prose in brackets is not eaten. */
export const PLACEHOLDER_PATTERN = /\[([A-Z0-9_ÀÁÂÃÉÊÍÓÔÕÚÇ][A-Z0-9_ÀÁÂÃÉÊÍÓÔÕÚÇ ]{0,30})\]/g;

export interface Macro {
  id: string;
  /** Typed after the sigil, e.g. `normaltorax`. */
  trigger: string;
  /** The text inserted. May contain `[PLACEHOLDER]` fields. */
  body: string;
  label?: string;
  /** Restrict to a modality, e.g. 'CT'. Empty means all. */
  modalities?: string[];
  /** Owner id; absent means shared. */
  ownerId?: string;
}

export interface MacroIssue {
  macroId: string;
  problem: 'duplicateTrigger' | 'emptyTrigger' | 'emptyBody' | 'invalidTrigger';
  message: string;
}

const cleanTrigger = (value: unknown): string => String(value ?? '').trim().toLowerCase();

/**
 * Validates a macro set, rejecting duplicates instead of shadowing.
 *
 * A trigger containing whitespace is refused: it can never fire, because the matcher
 * looks backwards from the caret at a single token, and a macro that can never fire is
 * worse than an error message.
 */
export function validateMacros(macros: Macro[]): MacroIssue[] {
  const issues: MacroIssue[] = [];
  const seen = new Map<string, string>();

  for (const macro of macros ?? []) {
    const trigger = cleanTrigger(macro?.trigger);
    if (!trigger) {
      issues.push({
        macroId: macro?.id ?? '',
        problem: 'emptyTrigger',
        message: 'Macro sem atalho.',
      });
      continue;
    }
    if (/\s/.test(trigger)) {
      issues.push({
        macroId: macro.id,
        problem: 'invalidTrigger',
        message: `Atalho "${trigger}" contém espaço e nunca dispararia.`,
      });
      continue;
    }
    if (!String(macro?.body ?? '').trim()) {
      issues.push({ macroId: macro.id, problem: 'emptyBody', message: 'Macro sem texto.' });
      continue;
    }
    const previous = seen.get(trigger);
    if (previous) {
      issues.push({
        macroId: macro.id,
        problem: 'duplicateTrigger',
        message: `Atalho "${trigger}" já usado por ${previous} — um dos dois nunca dispararia.`,
      });
      continue;
    }
    seen.set(trigger, macro.id);
  }
  return issues;
}

export interface MacroScope {
  modality?: string;
  userId?: string;
}

/** The macros usable in this context: shared plus the user's, filtered by modality. */
export function scopedMacros(macros: Macro[], scope: MacroScope = {}): Macro[] {
  const modality = String(scope.modality ?? '').trim().toUpperCase();
  const userId = String(scope.userId ?? '').trim();
  return (macros ?? []).filter(macro => {
    if (macro.ownerId && userId && macro.ownerId !== userId) {
      return false;
    }
    const list = (macro.modalities ?? []).map(m => String(m).trim().toUpperCase()).filter(Boolean);
    return !list.length || !modality || list.includes(modality);
  });
}

export interface TriggerMatch {
  macro: Macro;
  /** Index in the text where the sigil starts. */
  start: number;
  /** Index just past the typed trigger. */
  end: number;
}

/**
 * Finds the macro the caret is sitting after.
 *
 * Scans backwards from `caret` to the sigil, takes the token, and resolves it. Longest
 * match is automatic because the token is delimited — but the test suite pins it anyway,
 * since a future prefix-matching implementation would break exactly there.
 */
export function matchTrigger(
  text: string,
  caret: number,
  macros: Macro[],
  sigil = DEFAULT_SIGIL
): TriggerMatch | null {
  const source = String(text ?? '');
  const position = Math.max(0, Math.min(source.length, Math.floor(Number(caret) || 0)));
  const mark = String(sigil || DEFAULT_SIGIL);

  const start = source.lastIndexOf(mark, position - 1);
  if (start < 0) {
    return null;
  }
  // Only fires at a word boundary: a sigil in the middle of a token is not a trigger.
  const before = start > 0 ? source[start - 1] : ' ';
  if (!/[\s(\[]/.test(before)) {
    return null;
  }

  const typed = source.slice(start + mark.length, position);
  if (!typed || /\s/.test(typed)) {
    return null;
  }

  const wanted = typed.toLowerCase();
  const macro = (macros ?? []).find(m => cleanTrigger(m.trigger) === wanted);
  return macro ? { macro, start, end: position } : null;
}

export interface PlaceholderSpan {
  name: string;
  start: number;
  end: number;
}

/** Every `[PLACEHOLDER]` in the text, with its position. */
export function findPlaceholders(text: string): PlaceholderSpan[] {
  const source = String(text ?? '');
  const spans: PlaceholderSpan[] = [];
  const pattern = new RegExp(PLACEHOLDER_PATTERN.source, 'g');
  let match = pattern.exec(source);
  while (match) {
    spans.push({ name: match[1], start: match.index, end: match.index + match[0].length });
    match = pattern.exec(source);
  }
  return spans;
}

export interface ExpansionResult {
  text: string;
  /** Where the inserted body starts and ends, so the editor can highlight it. */
  insertedStart: number;
  insertedEnd: number;
  /** Placeholders inside the inserted body, in document coordinates. */
  placeholders: PlaceholderSpan[];
  /**
   * Where the caret should go: the first placeholder if there is one, otherwise the end
   * of the insertion.
   */
  caret: number;
  /** Selection the editor should make, so the reader sees what was inserted. */
  selection: { start: number; end: number };
}

/**
 * Replaces the trigger with the macro body.
 *
 * The caret lands on the **first placeholder**, not at the end. Landing at the end is what
 * produces reports containing `[LOBO]`: the radiologist keeps typing from where the cursor
 * is, and never goes back.
 */
export function expandMacro(
  text: string,
  match: TriggerMatch,
  indent = ''
): ExpansionResult {
  const source = String(text ?? '');
  const body = String(match?.macro?.body ?? '').replace(/\n/g, `\n${indent}`);
  const before = source.slice(0, match.start);
  const after = source.slice(match.end);
  const result = before + body + after;

  const placeholders = findPlaceholders(body).map(span => ({
    name: span.name,
    start: span.start + match.start,
    end: span.end + match.start,
  }));

  const insertedStart = match.start;
  const insertedEnd = match.start + body.length;
  const first = placeholders[0];

  return {
    text: result,
    insertedStart,
    insertedEnd,
    placeholders,
    caret: first ? first.start : insertedEnd,
    // Selecting the first placeholder lets the reader type over it directly; with no
    // placeholder, the whole insertion is selected so it is at least seen once.
    selection: first
      ? { start: first.start, end: first.end }
      : { start: insertedStart, end: insertedEnd },
  };
}

/** Moves to the next placeholder after `caret`, wrapping to the first. */
export function nextPlaceholder(text: string, caret: number): PlaceholderSpan | null {
  const spans = findPlaceholders(text);
  if (!spans.length) {
    return null;
  }
  const position = Number(caret) || 0;
  return spans.find(s => s.start >= position) ?? spans[0];
}

/**
 * Placeholders still sitting in the document.
 *
 * The signing step calls this. A report going out with `[LOBO]` in it is the concrete
 * failure — see the module note.
 */
export function findUnfilledPlaceholders(text: string): string[] {
  return findPlaceholders(text).map(s => s.name);
}

export interface SignGuard {
  ok: boolean;
  unfilled: string[];
  message?: string;
}

/**
 * Pre-sign check.
 *
 * Refuses rather than warns: a warning on a signing dialog is dismissed by muscle memory,
 * and the whole cost of being wrong here lands on the patient rather than on the
 * radiologist.
 */
export function guardBeforeSigning(text: string): SignGuard {
  const unfilled = findUnfilledPlaceholders(text);
  if (!unfilled.length) {
    return { ok: true, unfilled: [] };
  }
  const list = [...new Set(unfilled)].map(name => `[${name}]`).join(', ');
  return {
    ok: false,
    unfilled,
    message: `Há campos de macro não preenchidos: ${list}.`,
  };
}

/** Suggestions for an autocomplete popup, given what has been typed after the sigil. */
export function suggestMacros(macros: Macro[], typed: string, limit = 8): Macro[] {
  const prefix = cleanTrigger(typed);
  const pool = (macros ?? []).filter(m => cleanTrigger(m.trigger));
  const matches = prefix
    ? pool.filter(m => cleanTrigger(m.trigger).startsWith(prefix))
    : pool;
  return matches
    .slice()
    .sort((a, b) => cleanTrigger(a.trigger).localeCompare(cleanTrigger(b.trigger)))
    .slice(0, Math.max(0, Math.floor(Number(limit) || 0)));
}

/** Menu label: `;normaltorax — Tórax normal`. */
export function describeMacro(macro: Macro, sigil = DEFAULT_SIGIL): string {
  if (!macro) {
    return '';
  }
  const label = String(macro.label ?? '').trim();
  const head = `${sigil}${cleanTrigger(macro.trigger)}`;
  return label ? `${head} — ${label}` : head;
}
