/**
 * The canonical report template model — pure core (RTV-218 / RTV-105).
 *
 * RadReport publishes templates as MRRT HTML. That HTML is a **transport**, not storage.
 * The moment it becomes the stored form, an edit to the canonical model and an edit to the
 * HTML diverge and nobody can say which one the report was written from. So an import
 * lands here, and any re-export is regenerated from here.
 *
 * ## An edited template is not the template it came from
 *
 * This is the identity rule the module enforces, and it is a compliance question rather
 * than a modelling preference. If a locally edited copy keeps `RPT144` as its identifier,
 * then two different documents claim to be RadReport template RPT144 version 3, and a
 * signed report asserts it followed a published template that it did not follow. The
 * origin identifier is preserved as **provenance** — what this was derived from — and the
 * template's own identifier is forked. {@link forkTemplate} is the only way to get an
 * editable copy, and {@link assertEditable} refuses everything else.
 *
 * Translation counts as an edit. The codes survive a translation because a RadLex concept
 * is not language-dependent; the identifier does not, because the text a radiologist signs
 * is no longer the published text.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export interface CodedConcept {
  /** e.g. RADLEX, LOINC, SNOMEDCT. */
  scheme: string;
  value: string;
  meaning: string;
}

export type FieldType = 'text' | 'textarea' | 'select' | 'number' | 'date';

export interface TemplateOption {
  label: string;
  value: string;
  /** Absent when the source declared no code. Never inferred from the label. */
  code?: CodedConcept;
}

export interface TemplateField {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  options?: TemplateOption[];
  code?: CodedConcept;
  defaultValue?: string;
}

export interface TemplateSection {
  /** Machine name, e.g. `findings`. */
  name: string;
  heading: string;
  /** Static prose between the fields. */
  text: string[];
  fields: TemplateField[];
}

export type TemplateOrigin = 'radreport' | 'local';

export interface TemplateProvenance {
  origin: TemplateOrigin;
  /** Identifier at the source, kept even after a fork. */
  originIdentifier?: string;
  originVersion?: string;
  sourceUrl?: string;
  publisher?: string;
  /** Carrying this is a licensing obligation, not a nicety. */
  license?: string;
  importedAt?: number;
  /** Set on a fork: what this was derived from and why. */
  derivedFrom?: string;
  derivationReason?: string;
}

export interface ReportTemplate {
  id: string;
  version: string;
  title: string;
  /** BCP-47, e.g. `pt-BR`. */
  language: string;
  modality: string[];
  bodyRegion: string[];
  sections: TemplateSection[];
  provenance: TemplateProvenance;
}

const text = (value: unknown): string => String(value ?? '').trim();

export interface EditabilityCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Whether this template may be edited in place.
 *
 * A published template may not. Editing it in place makes two different documents claim
 * the same identifier and version, and a signed report then asserts it followed a
 * published template that it did not follow.
 */
export function assertEditable(template: ReportTemplate): EditabilityCheck {
  if (!template) {
    return { ok: false, reason: 'Template ausente.' };
  }
  if (template.provenance?.origin !== 'local') {
    return {
      ok: false,
      reason:
        `${template.id} veio de ${template.provenance?.publisher || 'uma fonte publicada'} e não pode ser editado no lugar. ` +
        'Duas versões diferentes com o mesmo identificador fazem um laudo assinado afirmar que seguiu um template publicado que não seguiu. Crie uma cópia (fork).',
    };
  }
  return { ok: true };
}

export interface ForkResult {
  template: ReportTemplate | null;
  ok: boolean;
  reason?: string;
}

/**
 * An editable local copy that remembers what it came from.
 *
 * The origin identifier moves into provenance rather than being dropped: the reason to
 * fork is traceability, and a copy that forgets its source is just an untraceable template.
 */
export function forkTemplate(
  template: ReportTemplate,
  input: { id: string; reason: string; at?: number; language?: string }
): ForkResult {
  const id = text(input?.id);
  const reason = text(input?.reason);
  if (!template) {
    return { template: null, ok: false, reason: 'Template ausente.' };
  }
  if (!id) {
    return { template: null, ok: false, reason: 'Fork sem identificador próprio.' };
  }
  if (id === template.id) {
    return {
      template: null,
      ok: false,
      reason: 'O fork precisa de um identificador diferente do original — é o ponto do fork.',
    };
  }
  if (!reason) {
    return {
      template: null,
      ok: false,
      reason: 'Fork sem motivo registrado: quem revisar o template daqui a um ano precisa saber por que ele diverge do publicado.',
    };
  }

  const previous = template.provenance ? template.provenance : ({ origin: 'local' } as TemplateProvenance);
  return {
    ok: true,
    template: {
      ...template,
      id,
      version: '1',
      language: text(input.language) ? text(input.language) : template.language,
      provenance: {
        ...previous,
        origin: 'local',
        // Preserved: the codes and the wording still descend from it.
        originIdentifier: previous.originIdentifier ? previous.originIdentifier : template.id,
        originVersion: previous.originVersion ? previous.originVersion : template.version,
        derivedFrom: template.id,
        derivationReason: reason,
        importedAt: Number.isFinite(Number(input.at)) ? Number(input.at) : previous.importedAt,
      },
    },
  };
}

/**
 * Codes survive a translation; the identifier does not.
 *
 * A RadLex concept is not language-dependent, so the structured meaning carries over. The
 * text a radiologist signs is no longer the published text, so the identifier has to fork.
 */
export function translateTemplate(
  template: ReportTemplate,
  input: { id: string; language: string; labels?: Record<string, string>; at?: number }
): ForkResult {
  const language = text(input?.language);
  if (!language) {
    return { template: null, ok: false, reason: 'Tradução sem idioma de destino.' };
  }
  const forked = forkTemplate(template, {
    id: input.id,
    reason: `Tradução para ${language}`,
    at: input.at,
    language,
  });
  if (!forked.ok || !forked.template) {
    return forked;
  }

  const labels = input.labels ? input.labels : {};
  return {
    ok: true,
    template: {
      ...forked.template,
      sections: forked.template.sections.map(section => ({
        ...section,
        fields: section.fields.map(field => ({
          ...field,
          label: labels[field.id] ? labels[field.id] : field.label,
          // Codes are carried verbatim: translating a label does not change the concept.
          code: field.code,
          options: field.options,
        })),
      })),
    },
  };
}

export interface CodeLinkResult {
  template: ReportTemplate;
  linked: number;
  /** Options left uncoded because the source declared no code. */
  unlinked: Array<{ fieldId: string; option: string }>;
  warnings: string[];
}

/**
 * Attaches CDEs to fields and options through an injected resolver.
 *
 * The resolver is asked about an explicit code from the source. It is never asked to guess
 * from a label: mapping an option called "Presente" onto a CDE because the string looks
 * right attaches structured meaning that the template author never asserted, and the
 * resulting report is machine-readable and wrong — which is worse than not machine-readable.
 */
export function linkCodes(
  template: ReportTemplate,
  resolve: (code: CodedConcept) => CodedConcept | null
): CodeLinkResult {
  const unlinked: Array<{ fieldId: string; option: string }> = [];
  let linked = 0;

  const sections = (template?.sections ?? []).map(section => ({
    ...section,
    fields: section.fields.map(field => {
      const resolvedField = field.code ? resolve(field.code) : null;
      if (resolvedField) {
        linked++;
      }
      const options = field.options
        ? field.options.map(option => {
            if (!option.code) {
              unlinked.push({ fieldId: field.id, option: option.label });
              return option;
            }
            const resolved = resolve(option.code);
            if (resolved) {
              linked++;
              return { ...option, code: resolved };
            }
            unlinked.push({ fieldId: field.id, option: option.label });
            return option;
          })
        : undefined;
      return { ...field, code: resolvedField ? resolvedField : field.code, options };
    }),
  }));

  const warnings: string[] = [];
  if (unlinked.length) {
    warnings.push(
      `${unlinked.length} opção(ões) sem código na origem permanecem como texto livre. ` +
        'Associá-las a um CDE por semelhança de rótulo atribuiria um significado que o autor do template não declarou.'
    );
  }

  return { template: { ...template, sections }, linked, unlinked, warnings };
}

/** Attribution line for the template admin screen. */
export function describeProvenance(template: ReportTemplate): string {
  const p = template?.provenance;
  if (!p) {
    return '';
  }
  if (p.origin === 'radreport') {
    return (
      `RadReport ${p.originIdentifier || template.id} v${p.originVersion || template.version}` +
      (p.publisher ? ` · ${p.publisher}` : '') +
      (p.license ? ` · ${p.license}` : '')
    );
  }
  if (p.derivedFrom) {
    return (
      `Local, derivado de ${p.derivedFrom}${p.originVersion ? ` v${p.originVersion}` : ''}` +
      (p.derivationReason ? ` — ${p.derivationReason}` : '') +
      (p.license ? ` · ${p.license}` : '')
    );
  }
  return 'Local';
}
