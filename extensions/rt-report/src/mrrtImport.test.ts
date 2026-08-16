import { describeImport, parseMrrt, parseTemplateAttributes } from './mrrtImport';
import {
  assertEditable,
  describeProvenance,
  forkTemplate,
  linkCodes,
  ReportTemplate,
  translateTemplate,
} from './reportTemplate';

const MRRT = `<!DOCTYPE html>
<html><head>
<title>CT Chest Wo Contrast</title>
<meta name="dcterms.title" content="CT Chest Without Contrast" />
<meta name="dcterms.identifier" content="RPT144" />
<meta name="dcterms.hasVersion" content="3" />
<meta name="dcterms.publisher" content="Radiological Society of North America" />
<meta name="dcterms.language" content="en" />
<meta name="dcterms.rights" content="CC BY-NC-SA 4.0" />
<meta name="dcterms.subject.modality" content="CT" />
<meta name="dcterms.subject.anatomy" content="Chest, Thorax" />
<script type="text/javascript">alert('hi');</script>
<script type="text/xml">
  <template_attributes>
    <coding_schemes><coding_scheme name="RADLEX" designator="2.16.840.1.113883.6.256"/></coding_schemes>
    <element id="nodule_size"><code meaning="Nodule diameter" value="RID50149" scheme="RADLEX"/></element>
  </template_attributes>
</script>
</head>
<body>
<section data-section-name="technique" data-section-heading="Technique">
  <p>Axial images were obtained through the chest without intravenous contrast.</p>
</section>
<section data-section-name="findings" data-section-heading="Findings">
  <label for="nodule_size">Maior nodulo (mm)</label>
  <input type="number" id="nodule_size" data-required="true" />
  <label for="laterality">Lateralidade</label>
  <select id="laterality">
    <option value="right" data-code-value="RID5825" data-code-scheme="RADLEX" data-code-meaning="Right">Direita</option>
    <option value="left" data-code-value="RID5824" data-code-scheme="RADLEX" data-code-meaning="Left">Esquerda</option>
    <option value="unknown">Indeterminada</option>
  </select>
  <textarea id="other_findings" data-field-label="Outros achados">Sem outros achados.</textarea>
  <input type="color" id="highlight" />
</section>
<section data-section-name="impression" data-section-heading="Impression">
  <textarea id="impression"></textarea>
</section>
</body></html>`;

describe('mrrtImport — reading the document', () => {
  const result = parseMrrt(MRRT, { sourceUrl: 'https://api3.rsna.org/radreport/v1/templates/144', importedAt: 1000 });

  it('imports the metadata that provenance needs', () => {
    expect(result.ok).toBe(true);
    expect(result.template!.id).toBe('RPT144');
    expect(result.template!.version).toBe('3');
    expect(result.template!.title).toBe('CT Chest Without Contrast');
    expect(result.template!.provenance.license).toBe('CC BY-NC-SA 4.0');
    expect(result.template!.provenance.sourceUrl).toMatch(/radreport/);
    expect(result.template!.modality).toEqual(['CT']);
    expect(result.template!.bodyRegion).toEqual(['Chest', 'Thorax']);
  });

  it('reads the sections and their prose', () => {
    const names = result.template!.sections.map(s => s.name);
    expect(names).toEqual(['technique', 'findings', 'impression']);
    expect(result.template!.sections[0].text.join(' ')).toMatch(/without intravenous contrast/);
  });

  it('reads fields with their labels, types and requiredness', () => {
    const findings = result.template!.sections[1];
    const size = findings.fields.find(f => f.id === 'nodule_size');
    expect(size!.type).toBe('number');
    expect(size!.label).toBe('Maior nodulo (mm)');
    expect(size!.required).toBe(true);
    expect(findings.fields.find(f => f.id === 'other_findings')!.type).toBe('textarea');
    expect(findings.fields.find(f => f.id === 'other_findings')!.defaultValue).toBe('Sem outros achados.');
  });

  it('takes the field code from the template_attributes block', () => {
    const size = result.template!.sections[1].fields.find(f => f.id === 'nodule_size');
    expect(size!.code).toEqual({ scheme: 'RADLEX', value: 'RID50149', meaning: 'Nodule diameter' });
  });

  // Matching "Indeterminada" onto a CDE because the string looks right attaches meaning the
  // template author never asserted.
  it('codes only the options the source coded, and leaves the rest uncoded', () => {
    const laterality = result.template!.sections[1].fields.find(f => f.id === 'laterality');
    expect(laterality!.options!.map(o => o.label)).toEqual(['Direita', 'Esquerda', 'Indeterminada']);
    expect(laterality!.options![0].code!.value).toBe('RID5825');
    expect(laterality!.options![2].code).toBeUndefined();
  });

  // The failure mode of every HTML importer: opens looking complete, missing the one
  // control the author cared about.
  it('reports what it cannot parse instead of dropping it', () => {
    expect(result.unsupported.join(' ')).toMatch(/input type="color".*highlight/);
  });

  // A template is a document; one that ships script runs code in the reporting workspace.
  it('strips executable script and says so', () => {
    expect(result.warnings.join(' ')).toMatch(/script executável roda código dentro do workspace/);
    expect(JSON.stringify(result.template)).not.toMatch(/alert/);
  });
});

describe('mrrtImport — refusals', () => {
  it('refuses an empty document', () => {
    expect(parseMrrt('').ok).toBe(false);
  });

  // Without one there is no provenance and no way to notice a double import.
  it('refuses a template with no identifier', () => {
    const result = parseMrrt('<html><head><meta name="dcterms.title" content="X"/></head><body></body></html>');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/sem identificador de origem não há procedência/);
  });

  it('warns loudly when no licence was declared', () => {
    const result = parseMrrt('<html><head><meta name="dcterms.identifier" content="RPT1"/></head><body></body></html>');
    expect(result.ok).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/conformidade, não um detalhe/);
  });

  it('warns about duplicate field ids', () => {
    const html = `<html><head><meta name="dcterms.identifier" content="RPT2"/><meta name="dcterms.rights" content="x"/></head>
      <body><section data-section-name="a"><textarea id="dup"></textarea><textarea id="dup"></textarea></section></body></html>`;
    expect(parseMrrt(html).warnings.join(' ')).toMatch(/gravam no mesmo lugar/);
  });

  it('reads no codes from an empty attribute block', () => {
    expect(parseTemplateAttributes('')).toEqual({});
  });

  it('ignores a code element with no value or scheme', () => {
    const xml = '<element id="a"><code meaning="only a meaning"/></element>';
    expect(parseTemplateAttributes(xml)).toEqual({ a: [] });
  });
});

describe('reportTemplate — an edited template is not the template it came from', () => {
  const imported = parseMrrt(MRRT, { importedAt: 1000 }).template as ReportTemplate;

  // Two documents claiming RPT144 v3 make a signed report assert it followed a published
  // template that it did not follow.
  it('refuses to edit an imported template in place', () => {
    const check = assertEditable(imported);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/um laudo assinado afirmar que seguiu um template publicado que não seguiu/);
  });

  it('allows editing a local one', () => {
    const forked = forkTemplate(imported, { id: 'RTV-CT-TORAX-1', reason: 'Ajuste ao protocolo do serviço' });
    expect(assertEditable(forked.template!).ok).toBe(true);
  });

  it('keeps the origin as provenance on the fork', () => {
    const forked = forkTemplate(imported, { id: 'RTV-CT-TORAX-1', reason: 'Ajuste local' }).template!;
    expect(forked.id).toBe('RTV-CT-TORAX-1');
    expect(forked.version).toBe('1');
    expect(forked.provenance.originIdentifier).toBe('RPT144');
    expect(forked.provenance.originVersion).toBe('3');
    expect(forked.provenance.derivedFrom).toBe('RPT144');
    expect(forked.provenance.license).toBe('CC BY-NC-SA 4.0');
  });

  it('refuses a fork that reuses the identifier', () => {
    expect(forkTemplate(imported, { id: 'RPT144', reason: 'x' }).ok).toBe(false);
  });

  // Whoever reviews the template in a year needs to know why it diverges.
  it('refuses a fork with no recorded reason', () => {
    const result = forkTemplate(imported, { id: 'X', reason: '' });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/precisa saber por que ele diverge do publicado/);
  });
});

describe('reportTemplate — translation', () => {
  const imported = parseMrrt(MRRT, { importedAt: 1000 }).template as ReportTemplate;

  // A RadLex concept is not language-dependent; the signed text is.
  it('carries the codes and forks the identifier', () => {
    const translated = translateTemplate(imported, {
      id: 'RTV-CT-TORAX-PTBR',
      language: 'pt-BR',
      labels: { nodule_size: 'Maior nódulo (mm)' },
    }).template!;
    expect(translated.language).toBe('pt-BR');
    expect(translated.id).not.toBe('RPT144');
    expect(translated.provenance.derivationReason).toMatch(/Tradução para pt-BR/);
    const size = translated.sections[1].fields.find(f => f.id === 'nodule_size');
    expect(size!.label).toBe('Maior nódulo (mm)');
    expect(size!.code!.value).toBe('RID50149');
  });

  it('refuses a translation with no target language', () => {
    expect(translateTemplate(imported, { id: 'X', language: '' }).ok).toBe(false);
  });
});

describe('reportTemplate — codes are resolved, never guessed', () => {
  const imported = parseMrrt(MRRT, { importedAt: 1000 }).template as ReportTemplate;

  it('links the coded options through the injected resolver', () => {
    const result = linkCodes(imported, code => ({ ...code, meaning: `${code.meaning} (CDE)` }));
    expect(result.linked).toBeGreaterThan(0);
    const laterality = result.template.sections[1].fields.find(f => f.id === 'laterality');
    expect(laterality!.options![0].code!.meaning).toMatch(/\(CDE\)$/);
  });

  // Machine-readable and wrong is worse than not machine-readable.
  it('leaves an uncoded option uncoded and explains why', () => {
    const result = linkCodes(imported, code => code);
    expect(result.unlinked.some(u => u.option === 'Indeterminada')).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/significado que o autor do template não declarou/);
  });

  it('leaves a code the resolver does not know', () => {
    const result = linkCodes(imported, () => null);
    expect(result.linked).toBe(0);
  });
});

describe('reportTemplate — attribution', () => {
  const imported = parseMrrt(MRRT, { importedAt: 1000 }).template as ReportTemplate;

  it('shows the published source', () => {
    expect(describeProvenance(imported)).toBe(
      'RadReport RPT144 v3 · Radiological Society of North America · CC BY-NC-SA 4.0'
    );
  });

  it('shows the derivation on a fork', () => {
    const forked = forkTemplate(imported, { id: 'X1', reason: 'Ajuste local' }).template!;
    expect(describeProvenance(forked)).toMatch(/^Local, derivado de RPT144 v3 — Ajuste local/);
  });
});

describe('mrrtImport — the import screen line', () => {
  it('counts sections and fields and lists what it could not parse', () => {
    const line = describeImport(parseMrrt(MRRT));
    // Four fields, not five: the unsupported <input type="color"> is counted as
    // unsupported and NOT as a field, which is the whole point of reporting it separately.
    expect(line).toMatch(/CT Chest Without Contrast: 3 seção\(ões\), 4 campo\(s\)\./);
    expect(line).toMatch(/1 construção\(ões\) não suportada\(s\)/);
  });

  it('shows the refusal when there was one', () => {
    expect(describeImport(parseMrrt(''))).toMatch(/vazio/);
  });
});
