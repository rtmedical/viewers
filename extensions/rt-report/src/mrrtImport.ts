/**
 * RadReport / MRRT importer — pure core (RTV-218).
 *
 * MRRT is HTML: `<section data-section-name>` blocks holding prose and form controls, with
 * the coding in an embedded `<script type="text/xml">` block. This module turns that into
 * the canonical {@link ReportTemplate} in `reportTemplate.ts` and stops there.
 *
 * ## The HTML is a transport
 *
 * Keeping it as the stored form is the mistake the ticket already names, and it is worth
 * saying why: the moment both exist, an edit to the canonical model and an edit to the HTML
 * diverge, and no one can say which one a signed report was written from. Re-export
 * regenerates from the model.
 *
 * ## An imported template arrives read-only
 *
 * The importer sets `origin: 'radreport'` and the published identifier, which makes the
 * template unable to be edited in place — see `assertEditable`. That is the point: a
 * locally modified copy that keeps `RPT144` makes a signed report assert it followed a
 * published template it did not follow.
 *
 * ## Codes are read, never inferred
 *
 * An option with no code in the source stays uncoded. Matching "Presente" to a CDE because
 * the string looks right attaches structured meaning the template author never asserted,
 * and produces a report that is machine-readable and wrong.
 *
 * ## What it cannot parse, it reports
 *
 * A silently dropped field is the failure mode of every HTML importer: the template opens,
 * looks complete, and is missing the one control the author cared about. Unrecognised
 * constructs come back in `unsupported` rather than being skipped.
 *
 * ## Scripts are stripped
 *
 * A template is a document. One that ships executable script is one that runs code inside
 * the reporting workspace, so everything but the `text/xml` attribute block is removed and
 * reported.
 *
 * Framework-free, no `@ohif/*` and no DOM — the parser is a tag scanner over the subset
 * MRRT actually uses, so it runs the same in a worker, in Node and in a test.
 * Zero-fork per RTV-114.
 */

import {
  CodedConcept,
  FieldType,
  ReportTemplate,
  TemplateField,
  TemplateOption,
  TemplateSection,
} from './reportTemplate';

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)(\/?)>/g;
const ATTRIBUTE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

function attributes(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  ATTRIBUTE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTRIBUTE.exec(raw)) !== null) {
    const value = match[3] !== undefined ? match[3] : match[4] !== undefined ? match[4] : match[5];
    result[match[1].toLowerCase()] = decode(String(value ?? ''));
  }
  return result;
}

function decode(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function plain(value: string): string {
  return decode(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export interface MrrtImportResult {
  template: ReportTemplate | null;
  ok: boolean;
  reason?: string;
  warnings: string[];
  /** Constructs the parser recognised but does not support, rather than dropped. */
  unsupported: string[];
}

const FIELD_TYPES: Record<string, FieldType> = {
  text: 'text',
  number: 'number',
  date: 'date',
};

/**
 * Parses an MRRT document into the canonical template.
 *
 * Refuses a template with no identifier: without one there is no provenance to record and
 * no way to notice the same template being imported twice under two local names.
 */
export function parseMrrt(
  html: string,
  options: { sourceUrl?: string; importedAt?: number } = {}
): MrrtImportResult {
  const warnings: string[] = [];
  const unsupported: string[] = [];
  const source = String(html ?? '');

  if (!source.trim()) {
    return { template: null, ok: false, reason: 'Documento MRRT vazio.', warnings, unsupported };
  }

  const { body, xml, removedScripts } = extractScripts(source);
  if (removedScripts) {
    warnings.push(
      `${removedScripts} bloco(s) de script removido(s). Um template é um documento; um que traz script executável roda código dentro do workspace de laudo.`
    );
  }

  const meta = readMeta(source);
  const identifier = meta['dcterms.identifier'];
  if (!identifier) {
    return {
      template: null,
      ok: false,
      reason:
        'Template sem dcterms.identifier — sem identificador de origem não há procedência a registrar, ' +
        'nem como perceber o mesmo template importado duas vezes com nomes locais diferentes.',
      warnings,
      unsupported,
    };
  }

  const license = meta['dcterms.rights'] ? meta['dcterms.rights'] : meta['dcterms.license'];
  if (!license) {
    warnings.push(
      'Template sem licença declarada na origem. Importar e distribuir sem a atribuição é um problema de conformidade, não um detalhe.'
    );
  }

  const codes = parseTemplateAttributes(xml);
  const sections = parseSections(body, codes, unsupported, warnings);

  if (!sections.length) {
    warnings.push('Nenhuma seção encontrada — o documento pode não ser MRRT.');
  }

  const version = meta['dcterms.hasversion'] ? meta['dcterms.hasversion'] : meta['dcterms.version'];

  return {
    ok: true,
    warnings,
    unsupported,
    template: {
      id: identifier,
      version: version ? version : '1',
      title: meta['dcterms.title'] ? meta['dcterms.title'] : readTitle(source),
      language: meta['dcterms.language'] ? meta['dcterms.language'] : 'en',
      modality: splitList(meta['dcterms.subject.modality']),
      bodyRegion: splitList(meta['dcterms.subject.anatomy']),
      sections,
      provenance: {
        origin: 'radreport',
        originIdentifier: identifier,
        originVersion: version ? version : '1',
        sourceUrl: options.sourceUrl,
        publisher: meta['dcterms.publisher'],
        license,
        importedAt: Number.isFinite(Number(options.importedAt))
          ? Number(options.importedAt)
          : undefined,
      },
    },
  };
}

function splitList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(/[,;]/)
    .map(v => v.trim())
    .filter(Boolean);
}

function extractScripts(source: string): { body: string; xml: string; removedScripts: number } {
  let xml = '';
  let removedScripts = 0;
  const body = source.replace(
    /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
    (_all, rawAttributes: string, content: string) => {
      const type = String(attributes(rawAttributes).type ?? '').toLowerCase();
      if (type.includes('xml')) {
        xml += content;
      } else {
        removedScripts++;
      }
      return '';
    }
  );
  return { body, xml, removedScripts };
}

function readMeta(source: string): Record<string, string> {
  const result: Record<string, string> = {};
  TAG.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG.exec(source)) !== null) {
    if (match[2].toLowerCase() !== 'meta' || match[1]) {
      continue;
    }
    const attrs = attributes(match[3]);
    const name = String(attrs.name ?? attrs.property ?? '').toLowerCase();
    if (name && attrs.content !== undefined) {
      result[name] = attrs.content;
    }
  }
  return result;
}

function readTitle(source: string): string {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(source);
  return match ? plain(match[1]) : '';
}

/**
 * Per-field codes from the `template_attributes` block.
 *
 * Only explicit `<code>` elements are read. Everything else in the block is left alone: a
 * parser that guesses at attributes it does not understand produces a template that looks
 * richer than the source.
 */
export function parseTemplateAttributes(xml: string): Record<string, CodedConcept[]> {
  const result: Record<string, CodedConcept[]> = {};
  if (!xml) {
    return result;
  }
  const elementPattern = /<element\b([^>]*)>([\s\S]*?)<\/element\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = elementPattern.exec(xml)) !== null) {
    const id = attributes(match[1]).id;
    if (!id) {
      continue;
    }
    result[id] = readCodes(match[2]);
  }
  return result;
}

function readCodes(fragment: string): CodedConcept[] {
  const codes: CodedConcept[] = [];
  const codePattern = /<code\b([^>]*?)\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = codePattern.exec(fragment)) !== null) {
    const attrs = attributes(match[1]);
    const value = attrs.value;
    const scheme = attrs.scheme ? attrs.scheme : attrs.codingscheme;
    if (!value || !scheme) {
      continue;
    }
    codes.push({ scheme, value, meaning: attrs.meaning ? attrs.meaning : '' });
  }
  return codes;
}

function parseSections(
  body: string,
  codes: Record<string, CodedConcept[]>,
  unsupported: string[],
  warnings: string[]
): TemplateSection[] {
  const sections: TemplateSection[] = [];
  let current: TemplateSection | null = null;
  const labels: Record<string, string> = {};
  const pendingText: string[] = [];

  const ensure = (): TemplateSection => {
    if (!current) {
      current = { name: 'body', heading: '', text: [], fields: [] };
      sections.push(current);
    }
    return current;
  };

  TAG.lastIndex = 0;
  let match: RegExpExecArray | null;
  let cursor = 0;

  while ((match = TAG.exec(body)) !== null) {
    const between = plain(body.slice(cursor, match.index));
    cursor = TAG.lastIndex;
    if (between) {
      if (current) {
        current.text.push(between);
      } else {
        pendingText.push(between);
      }
    }

    const closing = Boolean(match[1]);
    const name = match[2].toLowerCase();
    const attrs = attributes(match[3]);

    if (name === 'section' && !closing) {
      current = {
        name: attrs['data-section-name'] ? attrs['data-section-name'] : `section-${sections.length + 1}`,
        heading: attrs['data-section-heading'] ? attrs['data-section-heading'] : '',
        text: [],
        fields: [],
      };
      sections.push(current);
      continue;
    }

    if (name === 'label' && !closing) {
      const end = body.indexOf('</label', cursor);
      if (end > 0) {
        const forId = attrs.for;
        if (forId) {
          labels[forId] = plain(body.slice(cursor, end));
        }
        TAG.lastIndex = end;
        cursor = end;
      }
      continue;
    }

    if (name === 'textarea' && !closing) {
      const end = body.indexOf('</textarea', cursor);
      const content = end > 0 ? plain(body.slice(cursor, end)) : '';
      ensure().fields.push(makeField(attrs, 'textarea', labels, codes, content));
      if (end > 0) {
        TAG.lastIndex = end;
        cursor = end;
      }
      continue;
    }

    if (name === 'select' && !closing) {
      const end = body.indexOf('</select', cursor);
      const fragment = end > 0 ? body.slice(cursor, end) : '';
      const field = makeField(attrs, 'select', labels, codes, '');
      field.options = parseOptions(fragment, codes[field.id]);
      ensure().fields.push(field);
      if (end > 0) {
        TAG.lastIndex = end;
        cursor = end;
      }
      continue;
    }

    if (name === 'input' && !closing) {
      const inputType = String(attrs.type ?? 'text').toLowerCase();
      const mapped = FIELD_TYPES[inputType];
      if (!mapped) {
        // Reported, not dropped: a template that opens looking complete and is missing the
        // one control the author cared about is the failure mode of every HTML importer.
        unsupported.push(`<input type="${inputType}"> (id=${attrs.id ? attrs.id : '?'})`);
        continue;
      }
      ensure().fields.push(makeField(attrs, mapped, labels, codes, String(attrs.value ?? '')));
      continue;
    }
  }

  if (pendingText.length && sections.length) {
    sections[0].text.unshift(...pendingText);
  }

  const seen = new Set<string>();
  for (const section of sections) {
    for (const field of section.fields) {
      if (seen.has(field.id)) {
        warnings.push(`Campo com id repetido: ${field.id}. Dois campos com o mesmo id gravam no mesmo lugar.`);
      }
      seen.add(field.id);
    }
  }

  return sections;
}

function makeField(
  attrs: Record<string, string>,
  type: FieldType,
  labels: Record<string, string>,
  codes: Record<string, CodedConcept[]>,
  defaultValue: string
): TemplateField {
  const id = attrs.id ? attrs.id : attrs.name ? attrs.name : `field-${Math.abs(hash(JSON.stringify(attrs)))}`;
  const declared = codes[id];
  return {
    id,
    label: labels[id] ? labels[id] : attrs['data-field-label'] ? attrs['data-field-label'] : id,
    type,
    required:
      attrs['data-required'] === 'true' ||
      attrs['data-field-required'] === 'true' ||
      attrs.required !== undefined,
    code: declared && declared.length ? declared[0] : undefined,
    defaultValue: defaultValue ? defaultValue : undefined,
  };
}

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (h * 31 + value.charCodeAt(i)) | 0;
  }
  return h;
}

function parseOptions(fragment: string, fieldCodes: CodedConcept[] | undefined): TemplateOption[] {
  const options: TemplateOption[] = [];
  const pattern = /<option\b([^>]*)>([\s\S]*?)(?=<option\b|<\/select|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(fragment)) !== null) {
    const attrs = attributes(match[1]);
    const label = plain(match[2].replace(/<\/option\s*>/i, ''));
    const value = attrs.value !== undefined ? attrs.value : label;
    const codeValue = attrs['data-code-value'];
    const scheme = attrs['data-code-scheme'] ? attrs['data-code-scheme'] : attrs['data-code-designator'];
    // Only an explicit code counts. Matching the label against a CDE would attach a meaning
    // the template author never asserted.
    const code =
      codeValue && scheme
        ? {
            scheme,
            value: codeValue,
            meaning: attrs['data-code-meaning'] ? attrs['data-code-meaning'] : label,
          }
        : undefined;
    options.push({ label, value, code });
  }
  void fieldCodes;
  return options;
}

/** Summary line for the import screen. */
export function describeImport(result: MrrtImportResult): string {
  if (!result?.ok || !result.template) {
    return result?.reason ? result.reason : '';
  }
  const fields = result.template.sections.reduce((sum, s) => sum + s.fields.length, 0);
  const parts = [
    `${result.template.title || result.template.id}: ${result.template.sections.length} seção(ões), ${fields} campo(s).`,
  ];
  if (result.unsupported.length) {
    parts.push(`${result.unsupported.length} construção(ões) não suportada(s): ${result.unsupported.join(', ')}.`);
  }
  if (result.warnings.length) {
    parts.push(result.warnings.join(' '));
  }
  return parts.join(' ');
}
