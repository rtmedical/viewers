/**
 * Report document model, CKEditor HTML round-trip and autosave policy -- pure core (RTV-104).
 *
 * The editor component is TipTap; the Connect backend stores CKEditor HTML. So every save and
 * every load crosses a format boundary, and that boundary is where a report loses a sentence
 * without anybody noticing. This module is the boundary, plus the autosave rules, and it is
 * DOM-free on purpose: the same code has to run in a Jest process, in the browser, and
 * eventually in the desktop build.
 *
 * ## The round-trip that eats a sentence
 *
 * A conversion that meets an element it does not model has three honest options: keep it,
 * normalise it to something equivalent, or drop it. Only the third is dangerous, and only
 * when the thing dropped **carried text**. Dropping a `<span>` used for styling costs
 * nothing; dropping a `<td>` costs the measurement that was inside it, and the report still
 * reads as a complete report -- which is what makes it dangerous rather than merely broken.
 *
 * So {@link docRoundTrip} does not compare HTML strings. Comparing HTML would flag every
 * harmless normalisation (attribute order, quote style, a collapsed `<b>` inside `<strong>`)
 * and would still pass a real content loss whenever the loss happened to leave the markup
 * well-formed. It compares **normalised text content**, which is the thing the radiologist
 * actually wrote, and reports structural changes separately as a second, weaker signal.
 *
 * ## Formatting in a radiology report is not always cosmetic
 *
 * Bold in an impression is often how the critical finding is marked. A numbered list is often
 * how findings are referenced later ("achado 3"), so renumbering changes what a later
 * sentence points at. Superscript carries the exponent in `cm3`. These are tracked as marks
 * and structure, and losing them is reported -- not silently accepted as "just styling".
 *
 * ## The autosave that overwrites a real report with an empty one
 *
 * This is the worst failure in the module and it is entirely ordinary: the load fails, the
 * editor renders empty, and thirty seconds later autosave writes that empty document over
 * the report. Nothing errors. The report is gone and the UI looks healthy.
 *
 * {@link docPlanAutosave} therefore refuses to save a document that was never confirmed
 * loaded, and refuses a save that empties a document that had substantial content unless the
 * caller passes an explicit deletion intent. It is the same distinction this codebase draws
 * everywhere between *empty* and *not loaded*.
 *
 * ## The autosave that overwrites a colleague
 *
 * Autosave with last-write-wins is a data-loss machine as soon as two tabs are open -- and
 * two tabs are open constantly, because the same physician opens the worklist twice. Every
 * save carries the revision it was based on, and a server revision that moved on is a
 * **conflict refusal** naming both revisions, never a merge and never an overwrite.
 *
 * ## "Salvo" is a claim about the server
 *
 * A green "salvo" while the network is down is the reason someone closes the tab. `pending`,
 * `saved`, `failed` and `conflict` are four states, and only one of them may render as saved.
 *
 * Framework-free, no `@ohif/*`, no DOM, no clock, no randomness, no `throw`. Zero-fork per
 * RTV-114.
 */

/* ------------------------------------------------------------------ */
/* Result type                                                         */
/* ------------------------------------------------------------------ */

export type DocRefusalCode =
  | 'not-loaded'
  | 'empty-overwrite'
  | 'revision-conflict'
  | 'invalid-revision'
  | 'invalid-timestamp'
  | 'no-changes'
  | 'content-dropped'
  | 'malformed-html'
  | 'too-large'
  | 'signed-document';

/**
 * Refusals travel as values. `value?: undefined` / `reason?: undefined` are required because
 * `strictNullChecks` is off here: without them a boolean-literal union does not narrow.
 */
export type DocResult<T> =
  | { ok: true; value: T; code?: undefined; reason?: undefined }
  | { ok: false; code: DocRefusalCode; reason: string; value?: undefined };

function docOk<T>(value: T): DocResult<T> {
  return { ok: true, value };
}

function docRefuse<T>(code: DocRefusalCode, reason: string): DocResult<T> {
  return { ok: false, code, reason };
}

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** Autosave interval the panel should use, ms. */
export const DOC_AUTOSAVE_INTERVAL_MS = 30_000;

/**
 * Below this many characters a document is not "substantial", so replacing it with an empty
 * one is allowed without an explicit deletion intent.
 *
 * The number is a judgement call and the reason for having one at all is that the alternative
 * -- refusing every emptying save -- makes it impossible to clear a template the user opened
 * by mistake.
 */
export const DOC_SUBSTANTIAL_CHARS = 40;

/** Ceiling on a single document, characters of text. */
export const DOC_MAX_CHARS = 200_000;

/** Block element names this model round-trips without loss. */
export const DOC_BLOCK_TAGS = [
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'ul',
  'ol',
  'li',
  'blockquote',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'br',
  'hr',
] as const;

/** Inline marks this model round-trips without loss. */
export const DOC_MARK_TAGS = ['strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'code'] as const;

/** Tags whose content is markup-level noise and is dropped on purpose. */
export const DOC_STRIPPED_TAGS = ['script', 'style', 'meta', 'link', 'head'] as const;

/**
 * Tag equivalences applied on parse.
 *
 * `b` to `strong` and `i` to `em` are lossless in meaning and make the round-trip comparison
 * stable -- CKEditor emits one and TipTap the other, and treating that as a change would make
 * every load look like an edit and trigger a save.
 */
export const DOC_TAG_ALIASES: Record<string, string> = {
  b: 'strong',
  i: 'em',
  strike: 's',
  del: 's',
};

export type DocMark = 'strong' | 'em' | 'u' | 's' | 'sub' | 'sup' | 'code';

export const DOC_MARK_LABELS: Record<DocMark, string> = {
  strong: 'negrito',
  em: 'italico',
  u: 'sublinhado',
  s: 'riscado',
  sub: 'subscrito',
  sup: 'sobrescrito',
  code: 'monoespacado',
};

export type DocSaveState = 'pending' | 'saved' | 'failed' | 'conflict';

export const DOC_SAVE_LABELS: Record<DocSaveState, string> = {
  pending: 'alteracoes ainda nao enviadas',
  saved: 'salvo no Connect',
  failed: 'falha ao salvar',
  conflict: 'conflito de versao -- nao salvo',
};

/* ------------------------------------------------------------------ */
/* Model                                                              */
/* ------------------------------------------------------------------ */

/** A run of text carrying zero or more marks. */
export interface DocTextRun {
  text: string;
  marks: DocMark[];
}

/** A block: a paragraph, heading, list item, table cell. */
export interface DocBlock {
  tag: string;
  runs: DocTextRun[];
  /** Nesting depth, for list items and table cells. */
  depth: number;
  /** Ordinal within its parent list, 1-based. Absent outside ordered lists. */
  ordinal?: number;
}

export interface DocReport {
  blocks: DocBlock[];
  /** Tags seen that this model does not represent, with whether they carried text. */
  unsupported: DocUnsupportedTag[];
}

export interface DocUnsupportedTag {
  tag: string;
  /** True when text was inside the element -- the difference between cosmetic and clinical. */
  carriedText: boolean;
  /** The text that was inside, truncated, so the refusal can quote it. */
  sample: string;
}

/* ------------------------------------------------------------------ */
/* Parsing                                                            */
/* ------------------------------------------------------------------ */

const DOC_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '-',
  mdash: '-',
  hellip: '...',
};

/** Decodes the entity set CKEditor actually emits. Numeric forms included. */
export function docDecodeEntities(text: string): string {
  if (typeof text !== 'string' || text.indexOf('&') < 0) {
    return typeof text === 'string' ? text : '';
  }
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text.charAt(i);
    if (ch !== '&') {
      out += ch;
      i += 1;
      continue;
    }
    const end = text.indexOf(';', i + 1);
    if (end < 0 || end - i > 10) {
      out += ch;
      i += 1;
      continue;
    }
    const body = text.slice(i + 1, end);
    if (body.charAt(0) === '#') {
      const isHex = body.charAt(1) === 'x' || body.charAt(1) === 'X';
      const digits = isHex ? body.slice(2) : body.slice(1);
      const code = parseInt(digits, isHex ? 16 : 10);
      if (isFinite(code) && code > 0 && code < 0x110000) {
        out += String.fromCharCode(code);
        i = end + 1;
        continue;
      }
      out += ch;
      i += 1;
      continue;
    }
    const named = DOC_ENTITIES[body.toLowerCase()];
    if (named !== undefined) {
      out += named;
      i = end + 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

export function docEncodeEntities(text: string): string {
  if (typeof text !== 'string') {
    return '';
  }
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (ch === '&') {
      out += '&amp;';
    } else if (ch === '<') {
      out += '&lt;';
    } else if (ch === '>') {
      out += '&gt;';
    } else {
      out += ch;
    }
  }
  return out;
}

interface DocTag {
  name: string;
  closing: boolean;
  selfClosing: boolean;
}

function docReadTag(html: string, at: number): { tag: DocTag; next: number } | null {
  const end = html.indexOf('>', at);
  if (end < 0) {
    return null;
  }
  let body = html.slice(at + 1, end).trim();
  const closing = body.charAt(0) === '/';
  if (closing) {
    body = body.slice(1).trim();
  }
  const selfClosing = body.charAt(body.length - 1) === '/';
  if (selfClosing) {
    body = body.slice(0, -1).trim();
  }
  const space = body.search(/[\s]/);
  const name = (space < 0 ? body : body.slice(0, space)).toLowerCase();
  if (!name || !/^[a-z][a-z0-9]*$/.test(name)) {
    return null;
  }
  return { tag: { name, closing, selfClosing }, next: end + 1 };
}

function docCanonicalTag(name: string): string {
  return DOC_TAG_ALIASES[name] ?? name;
}

function docIsBlock(name: string): boolean {
  return (DOC_BLOCK_TAGS as readonly string[]).indexOf(name) >= 0;
}

function docMarkOf(name: string): DocMark | null {
  const canonical = docCanonicalTag(name);
  if ((DOC_MARK_TAGS as readonly string[]).indexOf(name) < 0 && !DOC_TAG_ALIASES[name]) {
    return null;
  }
  const known: DocMark[] = ['strong', 'em', 'u', 's', 'sub', 'sup', 'code'];
  return known.indexOf(canonical as DocMark) >= 0 ? (canonical as DocMark) : null;
}

/**
 * Parses CKEditor-flavoured HTML into the model.
 *
 * A tolerant scanner rather than a parser: the input is whatever a decade of CKEditor
 * versions produced, including unclosed `<p>` and stray `<br/>`. A strict parser would refuse
 * documents that a radiologist can currently open and edit, which is a worse outcome than a
 * lenient one that reports what it could not represent.
 */
export function docParseHtml(html: string): DocResult<DocReport> {
  if (typeof html !== 'string') {
    return docRefuse('malformed-html', 'Conteudo do laudo nao e texto.');
  }

  const blocks: DocBlock[] = [];
  const unsupported: DocUnsupportedTag[] = [];
  const markStack: DocMark[] = [];
  const listStack: { ordered: boolean; count: number }[] = [];
  const unknownStack: string[] = [];
  let depth = 0;
  let current: DocBlock | null = null;
  let textChars = 0;

  const pushText = (raw: string) => {
    const text = docDecodeEntities(raw);
    if (!text) {
      return;
    }
    textChars += text.length;
    if (unknownStack.length) {
      // Text inside an element we cannot model: this is the clinical case, and it is the
      // reason `carriedText` exists rather than a flat list of unknown tags.
      const tag = unknownStack[unknownStack.length - 1];
      const seen = unsupported.filter(u => u.tag === tag)[0];
      if (seen) {
        seen.carriedText = true;
        if (seen.sample.length < 80) {
          seen.sample = (seen.sample + text).slice(0, 80);
        }
      } else {
        unsupported.push({ tag, carriedText: true, sample: text.slice(0, 80) });
      }
      return;
    }
    if (!current) {
      current = { tag: 'p', runs: [], depth };
      blocks.push(current);
    }
    current.runs.push({ text, marks: markStack.slice() });
  };

  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) {
      pushText(html.slice(i));
      break;
    }
    if (lt > i) {
      pushText(html.slice(i, lt));
    }

    if (html.startsWith('<!--', lt)) {
      const close = html.indexOf('-->', lt);
      i = close < 0 ? html.length : close + 3;
      continue;
    }
    if (html.charAt(lt + 1) === '!') {
      const close = html.indexOf('>', lt);
      i = close < 0 ? html.length : close + 1;
      continue;
    }

    const read = docReadTag(html, lt);
    if (!read) {
      // A stray '<' that is not a tag is literal text in practice.
      pushText('<');
      i = lt + 1;
      continue;
    }

    const { tag } = read;
    i = read.next;
    const name = tag.name;

    if ((DOC_STRIPPED_TAGS as readonly string[]).indexOf(name) >= 0) {
      if (!tag.closing && !tag.selfClosing) {
        const close = html.toLowerCase().indexOf('</' + name, i);
        i = close < 0 ? html.length : html.indexOf('>', close) + 1;
      }
      continue;
    }

    const mark = docMarkOf(name);
    if (mark) {
      if (tag.closing) {
        const at = markStack.lastIndexOf(mark);
        if (at >= 0) {
          markStack.splice(at, 1);
        }
      } else if (!tag.selfClosing) {
        markStack.push(mark);
      }
      continue;
    }

    if (docIsBlock(name)) {
      if (name === 'br') {
        if (current) {
          current.runs.push({ text: '\n', marks: [] });
        }
        continue;
      }
      if (name === 'hr') {
        blocks.push({ tag: 'hr', runs: [], depth });
        current = null;
        continue;
      }
      if (name === 'ul' || name === 'ol') {
        if (tag.closing) {
          listStack.pop();
          depth = Math.max(0, depth - 1);
        } else {
          listStack.push({ ordered: name === 'ol', count: 0 });
          depth += 1;
        }
        current = null;
        continue;
      }
      if (tag.closing) {
        current = null;
        continue;
      }
      const list = listStack[listStack.length - 1];
      let ordinal: number | undefined;
      if (name === 'li' && list) {
        list.count += 1;
        ordinal = list.ordered ? list.count : undefined;
      }
      current = { tag: name, runs: [], depth, ordinal };
      blocks.push(current);
      continue;
    }

    // Anything else. `span` and `div` are the common cosmetic wrappers; everything else is
    // recorded so the round-trip check can decide whether text was lost.
    if (tag.closing) {
      const at = unknownStack.lastIndexOf(name);
      if (at >= 0) {
        unknownStack.splice(at, 1);
      }
      continue;
    }
    if (name === 'span' || name === 'div' || name === 'font') {
      // Transparent: content passes through, structure is not preserved. Recorded as
      // normalised rather than dropped, because nothing the reader sees is lost.
      if (!unsupported.some(u => u.tag === name)) {
        unsupported.push({ tag: name, carriedText: false, sample: '' });
      }
      continue;
    }
    if (!tag.selfClosing) {
      unknownStack.push(name);
    }
    if (!unsupported.some(u => u.tag === name)) {
      unsupported.push({ tag: name, carriedText: false, sample: '' });
    }
  }

  if (textChars > DOC_MAX_CHARS) {
    return docRefuse(
      'too-large',
      'Laudo com ' +
        textChars +
        ' caracteres, acima do limite de ' +
        DOC_MAX_CHARS +
        ' -- um documento desse tamanho e quase sempre conteudo duplicado por um erro de colagem.'
    );
  }

  return docOk({
    blocks: blocks.filter(b => b.tag === 'hr' || b.runs.some(r => r.text.trim())),
    unsupported,
  });
}

/* ------------------------------------------------------------------ */
/* Serialising                                                        */
/* ------------------------------------------------------------------ */

const DOC_MARK_ORDER: DocMark[] = ['strong', 'em', 'u', 's', 'sub', 'sup', 'code'];

function docSortMarks(marks: DocMark[]): DocMark[] {
  return DOC_MARK_ORDER.filter(m => marks.indexOf(m) >= 0);
}

/**
 * Whether `short` is an element-wise prefix of `long`.
 *
 * Element-wise, and not a comparison of the joined strings. Joining and testing with
 * `indexOf` looks equivalent and is not: `s` is a string prefix of `strong`, `sub` and `sup`,
 * so a run of strikethrough followed by a run of bold read as "the open stack is still a
 * prefix of what I want", and the serialiser then neither closed `<s>` nor opened `<strong>`.
 * The output was `<s>risneg</s>`: the bold silently gone, and the strikethrough silently
 * extended over text that was never struck. Which is precisely the class of loss this module
 * exists to detect, arriving through its own serialiser.
 */
function docIsMarkPrefix(short: DocMark[], long: DocMark[]): boolean {
  if (short.length > long.length) {
    return false;
  }
  for (let k = 0; k < short.length; k += 1) {
    if (short[k] !== long[k]) {
      return false;
    }
  }
  return true;
}

function docSerializeRuns(runs: DocTextRun[]): string {
  let out = '';
  let open: DocMark[] = [];
  for (const run of runs) {
    if (run.text === '\n') {
      out += '<br />';
      continue;
    }
    const wanted = docSortMarks(run.marks ?? []);
    // Close marks no longer wanted, from the innermost out.
    while (open.length && !docIsMarkPrefix(open, wanted)) {
      out += '</' + open[open.length - 1] + '>';
      open = open.slice(0, -1);
    }
    for (const mark of wanted.slice(open.length)) {
      out += '<' + mark + '>';
      open.push(mark);
    }
    out += docEncodeEntities(run.text);
  }
  for (let k = open.length - 1; k >= 0; k -= 1) {
    out += '</' + open[k] + '>';
  }
  return out;
}

/**
 * Serialises the model back to CKEditor-compatible HTML.
 *
 * Marks are emitted in a fixed order so that a parse-serialise-parse cycle is stable. Without
 * a canonical order, `<strong><em>` and `<em><strong>` alternate between round-trips, every
 * load looks like an edit, and the autosave fires forever on an untouched report.
 */
export function docSerializeHtml(report: DocReport): string {
  if (!report || !Array.isArray(report.blocks)) {
    return '';
  }
  const out: string[] = [];
  let listOpen: string[] = [];

  const closeListsTo = (depth: number) => {
    while (listOpen.length > depth) {
      out.push('</' + listOpen[listOpen.length - 1] + '>');
      listOpen = listOpen.slice(0, -1);
    }
  };

  for (const block of report.blocks) {
    if (block.tag === 'li') {
      const wanted = block.ordinal === undefined ? 'ul' : 'ol';
      closeListsTo(block.depth);
      while (listOpen.length < block.depth) {
        out.push('<' + wanted + '>');
        listOpen.push(wanted);
      }
      out.push('<li>' + docSerializeRuns(block.runs) + '</li>');
      continue;
    }
    closeListsTo(0);
    if (block.tag === 'hr') {
      out.push('<hr />');
      continue;
    }
    out.push('<' + block.tag + '>' + docSerializeRuns(block.runs) + '</' + block.tag + '>');
  }
  closeListsTo(0);
  return out.join('');
}

/* ------------------------------------------------------------------ */
/* Text content and comparison                                        */
/* ------------------------------------------------------------------ */

/**
 * Normalised text of a document.
 *
 * Whitespace is collapsed because HTML whitespace is not meaningful and a difference in it is
 * not a difference in the report. Everything else is preserved exactly -- in particular
 * digits, decimal separators and units, because that is the family of change that matters
 * most and the one a lenient comparison would swallow.
 */
export function docTextContent(report: DocReport): string {
  if (!report || !Array.isArray(report.blocks)) {
    return '';
  }
  return report.blocks
    .map(b => b.runs.map(r => r.text).join(''))
    .join('\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** Marks present in the document, with a character count for each. */
export function docMarkProfile(report: DocReport): Record<string, number> {
  const profile: Record<string, number> = {};
  if (!report || !Array.isArray(report.blocks)) {
    return profile;
  }
  for (const block of report.blocks) {
    for (const run of block.runs) {
      for (const mark of run.marks ?? []) {
        profile[mark] = (profile[mark] ?? 0) + run.text.length;
      }
    }
  }
  return profile;
}

/** Ordered-list ordinals, so a renumbering is visible. */
export function docListOrdinals(report: DocReport): number[] {
  if (!report || !Array.isArray(report.blocks)) {
    return [];
  }
  return report.blocks
    .filter(b => b.tag === 'li' && b.ordinal !== undefined)
    .map(b => b.ordinal as number);
}

export interface DocRoundTripReport {
  /** Text survived the cycle byte for byte after whitespace normalisation. */
  textPreserved: boolean;
  /** Marks survived with the same character coverage. */
  marksPreserved: boolean;
  /** Ordered-list numbering survived. */
  structurePreserved: boolean;
  /** Tags dropped that had text inside them. The clinical losses. */
  droppedWithText: DocUnsupportedTag[];
  /** Tags normalised away with no visible loss. */
  normalised: string[];
  /** Marks whose coverage changed, with before and after character counts. */
  markChanges: { mark: string; before: number; after: number }[];
  message: string;
}

/**
 * Runs a load-save-load cycle and reports what the format boundary did to the report.
 *
 * The comparison is on text, not on HTML. HTML comparison flags every harmless normalisation
 * and still passes a real content loss whenever the loss leaves well-formed markup -- so it
 * is both noisy and blind, which is the worst combination for a check somebody has to trust.
 */
export function docRoundTrip(html: string): DocResult<DocRoundTripReport> {
  const first = docParseHtml(html);
  if (!first.ok) {
    return docRefuse(first.code, first.reason);
  }
  const second = docParseHtml(docSerializeHtml(first.value));
  if (!second.ok) {
    return docRefuse(second.code, second.reason);
  }

  const textBefore = docTextContent(first.value);
  const textAfter = docTextContent(second.value);
  const profileBefore = docMarkProfile(first.value);
  const profileAfter = docMarkProfile(second.value);

  const markChanges: { mark: string; before: number; after: number }[] = [];
  const marks = Object.keys(profileBefore).concat(
    Object.keys(profileAfter).filter(m => profileBefore[m] === undefined)
  );
  for (const mark of marks) {
    const before = profileBefore[mark] ?? 0;
    const after = profileAfter[mark] ?? 0;
    if (before !== after) {
      markChanges.push({ mark, before, after });
    }
  }

  const droppedWithText = first.value.unsupported.filter(u => u.carriedText);
  const normalised = first.value.unsupported.filter(u => !u.carriedText).map(u => u.tag);
  const ordinalsBefore = docListOrdinals(first.value).join(',');
  const ordinalsAfter = docListOrdinals(second.value).join(',');

  const textPreserved = textBefore === textAfter && !droppedWithText.length;
  const marksPreserved = markChanges.length === 0;
  const structurePreserved = ordinalsBefore === ordinalsAfter;

  const notes: string[] = [];
  if (droppedWithText.length) {
    notes.push(
      'texto perdido em ' +
        droppedWithText.map(d => '<' + d.tag + '>').join(', ') +
        ' -- o laudo continuaria lendo como um laudo completo'
    );
  }
  if (textBefore !== textAfter) {
    notes.push('o texto mudou na conversao');
  }
  if (markChanges.length) {
    notes.push(
      'formatacao alterada: ' +
        markChanges
          .map(c => (DOC_MARK_LABELS[c.mark as DocMark] ?? c.mark) + ' ' + c.before + '->' + c.after)
          .join(', ')
    );
  }
  if (!structurePreserved) {
    notes.push('numeracao de lista alterada -- referencias como "achado 3" passam a apontar para outro item');
  }
  if (normalised.length) {
    notes.push('normalizado sem perda: ' + normalised.join(', '));
  }

  return docOk({
    textPreserved,
    marksPreserved,
    structurePreserved,
    droppedWithText,
    normalised,
    markChanges,
    message: notes.length ? notes.join('; ') + '.' : 'Round-trip sem perda.',
  });
}

/**
 * Whether HTML from Connect may be loaded into the editor.
 *
 * Refuses when text would be lost, because the alternative is opening the report, editing one
 * sentence, and saving back a version that silently lacks a paragraph the previous author
 * wrote. Mark and numbering changes are reported but do not block: they are visible to the
 * person editing, and blocking would make old reports unopenable.
 */
export function docAssertLoadable(html: string): DocResult<DocRoundTripReport> {
  const trip = docRoundTrip(html);
  if (!trip.ok) {
    return trip;
  }
  if (trip.value.droppedWithText.length) {
    return docRefuse(
      'content-dropped',
      'Nao e seguro abrir este laudo no editor: ' +
        trip.value.message +
        ' Editar e salvar apagaria esse trecho sem aviso.'
    );
  }
  return trip;
}

/* ------------------------------------------------------------------ */
/* Autosave                                                           */
/* ------------------------------------------------------------------ */

export type DocLoadState = 'not-loaded' | 'loading' | 'loaded' | 'load-failed';

export interface DocEditorState {
  reportId: string;
  load: DocLoadState;
  /** Revision the editor's content was loaded from. */
  baseRevision: number;
  /** Text length at load, used to detect an emptying save. */
  loadedChars: number;
  signed?: boolean;
}

export interface DocSavePlan {
  reportId: string;
  html: string;
  baseRevision: number;
  chars: number;
  at: number;
  /** True when the caller declared an intentional emptying. */
  deliberateClear?: boolean;
}

/**
 * Decides whether an autosave may fire.
 *
 * The order is deliberate. `not-loaded` is checked first and hardest, because the empty
 * autosave over a real report is the only failure here that destroys clinical content that
 * was already written and accepted, and no later check would catch it -- an empty document is
 * perfectly valid HTML with no conflict and no dropped tags.
 */
export function docPlanAutosave(input: {
  state: DocEditorState;
  html: string;
  serverRevision: number;
  at: number;
  deliberateClear?: boolean;
  lastSavedHtml?: string;
}): DocResult<DocSavePlan> {
  if (!input || !input.state) {
    return docRefuse('not-loaded', 'Nenhum laudo carregado no editor.');
  }
  const state = input.state;

  // FM: the load failed, the editor rendered empty, and thirty seconds later autosave
  // overwrites the report with nothing. No error is raised anywhere.
  if (state.load !== 'loaded') {
    return docRefuse(
      'not-loaded',
      'O laudo nao foi carregado com sucesso (' +
        state.load +
        ') -- salvar agora gravaria o editor vazio sobre o laudo que existe no servidor.'
    );
  }
  if (state.signed) {
    return docRefuse(
      'signed-document',
      'Laudo assinado nao aceita salvamento automatico -- alterar exige retificacao versionada.'
    );
  }
  if (!Number.isFinite(input.at) || input.at <= 0) {
    return docRefuse('invalid-timestamp', 'Horario do salvamento invalido.');
  }
  if (!Number.isFinite(state.baseRevision) || state.baseRevision < 0) {
    return docRefuse('invalid-revision', 'Revisao base do editor invalida.');
  }
  if (!Number.isFinite(input.serverRevision) || input.serverRevision < 0) {
    return docRefuse('invalid-revision', 'Revisao do servidor invalida.');
  }

  // FM: two tabs open, last write wins, and one physician's dictation disappears.
  if (input.serverRevision !== state.baseRevision) {
    return docRefuse(
      'revision-conflict',
      'O laudo mudou no servidor: o editor tem a revisao ' +
        state.baseRevision +
        ' e o servidor esta na ' +
        input.serverRevision +
        '. Salvar sobrescreveria a alteracao de outra sessao.'
    );
  }

  const parsed = docParseHtml(input.html);
  if (!parsed.ok) {
    return docRefuse(parsed.code, parsed.reason);
  }
  const chars = docTextContent(parsed.value).length;

  if (
    chars === 0 &&
    state.loadedChars >= DOC_SUBSTANTIAL_CHARS &&
    !input.deliberateClear
  ) {
    return docRefuse(
      'empty-overwrite',
      'O editor esta vazio e o laudo tinha ' +
        state.loadedChars +
        ' caracteres -- isso e apagar o laudo, e precisa ser um ato explicito.'
    );
  }

  if (typeof input.lastSavedHtml === 'string') {
    const previous = docParseHtml(input.lastSavedHtml);
    if (previous.ok && docTextContent(previous.value) === docTextContent(parsed.value)) {
      const profileEqual =
        JSON.stringify(docMarkProfile(previous.value)) ===
        JSON.stringify(docMarkProfile(parsed.value));
      if (profileEqual) {
        return docRefuse(
          'no-changes',
          'Nada mudou desde o ultimo salvamento -- gravar aqui criaria uma revisao que nao registra nenhuma alteracao.'
        );
      }
    }
  }

  return docOk({
    reportId: state.reportId,
    html: docSerializeHtml(parsed.value),
    baseRevision: state.baseRevision,
    chars,
    at: input.at,
    deliberateClear: input.deliberateClear,
  });
}

export interface DocSaveOutcome {
  state: DocSaveState;
  /** Revision the server assigned. Required for `saved`. */
  revision?: number;
  detail?: string;
}

/**
 * Applies a save outcome to the editor state.
 *
 * `saved` without a revision is refused: it is the state that renders the green "salvo", and
 * without a revision the next save has nothing to base itself on, so the following conflict
 * check silently becomes a no-op.
 */
export function docApplySaveOutcome(
  state: DocEditorState,
  outcome: DocSaveOutcome
): DocResult<DocEditorState> {
  if (!state) {
    return docRefuse('not-loaded', 'Nenhum estado de editor.');
  }
  if (!outcome || !DOC_SAVE_LABELS[outcome.state]) {
    return docRefuse('invalid-revision', 'Resultado de salvamento desconhecido.');
  }
  if (outcome.state === 'saved') {
    if (!Number.isFinite(outcome.revision) || (outcome.revision as number) <= state.baseRevision) {
      return docRefuse(
        'invalid-revision',
        'Salvamento confirmado sem revisao nova -- sem ela a proxima checagem de conflito nao checa nada.'
      );
    }
    return docOk({
      ...state,
      baseRevision: outcome.revision as number,
      loadedChars: state.loadedChars,
    });
  }
  return docOk(state);
}

/** Only `saved` may render as saved. */
export function docIsPersisted(state: DocSaveState): boolean {
  return state === 'saved';
}

/** One line for the editor's status chip. */
export function docDescribeSaveState(state: DocSaveState, at?: number): string {
  const label = DOC_SAVE_LABELS[state] ?? DOC_SAVE_LABELS.pending;
  if (state === 'saved' && Number.isFinite(at)) {
    return label + '.';
  }
  if (state === 'conflict') {
    return label + ' -- recarregue o laudo antes de continuar.';
  }
  return label + '.';
}
