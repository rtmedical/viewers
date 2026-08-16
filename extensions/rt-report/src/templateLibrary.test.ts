import { assertEditable, forkTemplate } from './reportTemplate';
import {
  builtinTemplates,
  describeSuggestion,
  suggestTemplates,
  templatesForModality,
  unconfirmedAssertions,
} from './templateLibrary';

describe('templateLibrary — coverage', () => {
  const templates = builtinTemplates();

  it('ships at least thirty templates', () => {
    expect(templates.length).toBeGreaterThanOrEqual(30);
  });

  it.each([['CT', 5], ['MR', 5], ['MG', 2], ['US', 5], ['CR', 5]])(
    'covers %s with at least %i templates',
    (modality, minimum) => {
      expect(templatesForModality(modality as string).length).toBeGreaterThanOrEqual(minimum as number);
    }
  );

  it('gives every template a unique id', () => {
    const ids = templates.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every template technique, findings and impression', () => {
    for (const template of templates) {
      expect(template.sections.map(s => s.name)).toEqual(['technique', 'findings', 'impression']);
      expect(template.sections[1].fields.length).toBeGreaterThan(2);
    }
  });

  it('gives every field a unique id within its template', () => {
    for (const template of templates) {
      const ids = template.sections.flatMap(s => s.fields.map(f => f.id));
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('is in Portuguese and marked local, so the editor may fork it', () => {
    for (const template of templates) {
      expect(template.language).toBe('pt-BR');
      expect(assertEditable(template).ok).toBe(true);
    }
  });

  it('forks like any other template', () => {
    const forked = forkTemplate(builtinTemplates()[0], { id: 'X', reason: 'protocolo local' });
    expect(forked.ok).toBe(true);
    expect(forked.template!.provenance.derivedFrom).toBe(builtinTemplates()[0].id);
  });
});

describe('templateLibrary — a pre-filled normal is the dangerous part', () => {
  const template = builtinTemplates().find(t => t.id === 'RTV-CT-TORAX')!;

  it('marks the normal statement and the technique as assertive', () => {
    const findings = template.sections[1].fields.find(f => f.id === 'normal_statement')!;
    expect(findings.assertive).toBe(true);
    expect(findings.defaultValue).toMatch(/sem consolidações/);
    expect(template.sections[0].fields[0].assertive).toBe(true);
  });

  it('every template carries a normal statement, and every one is assertive', () => {
    for (const t of builtinTemplates()) {
      const normal = t.sections[1].fields.find(f => f.id === 'normal_statement');
      expect(normal).toBeDefined();
      expect(normal!.assertive).toBe(true);
      expect(String(normal!.defaultValue).length).toBeGreaterThan(20);
    }
  });

  // Signed, in the record, indistinguishable from a finding that was actually excluded.
  it('refuses to call the report complete while a default is untouched', () => {
    const check = unconfirmedAssertions(template, {});
    expect(check.ok).toBe(false);
    expect(check.unconfirmed.map(u => u.id)).toContain('normal_statement');
    expect(check.message).toMatch(/um achado que ninguém procurou/);
  });

  it('accepts a default the reader explicitly confirmed', () => {
    const values = {
      technique: { value: 'x', touched: true },
      normal_statement: { value: 'irrelevante', touched: true },
    };
    expect(unconfirmedAssertions(template, values).ok).toBe(true);
  });

  // Confirming by editing counts; leaving the text and clicking nothing does not.
  it('counts an unedited default as unconfirmed even when the value is present', () => {
    const normal = template.sections[1].fields.find(f => f.id === 'normal_statement')!;
    const values = {
      technique: { value: 'x', touched: true },
      normal_statement: { value: String(normal.defaultValue), touched: false },
    };
    expect(unconfirmedAssertions(template, values).ok).toBe(false);
  });

  it('ignores non-assertive fields', () => {
    const values = { technique: { value: 'x', touched: true }, normal_statement: { value: 'y', touched: true } };
    const check = unconfirmedAssertions(template, values);
    expect(check.unconfirmed).toEqual([]);
  });
});

describe('templateLibrary — suggesting is not applying', () => {
  // A mis-coded study would otherwise load a technique paragraph describing an examination
  // that was not performed.
  it('never auto-applies', () => {
    const result = suggestTemplates({ modality: 'CT', studyDescription: 'TC DE TORAX' });
    expect(result.autoApply).toBe(false);
    expect(result.suggestions.length).toBeGreaterThan(1);
  });

  it('ranks the description match above the modality match', () => {
    const result = suggestTemplates({ modality: 'CT', studyDescription: 'TC DE TORAX ALTA RESOLUCAO' });
    expect(result.suggestions[0].template.id).toBe('RTV-CT-TORAX');
    expect(result.suggestions[0].confidence).toBe('high');
  });

  it('matches through accents and case', () => {
    const result = suggestTemplates({ modality: 'US', studyDescription: 'Ultrassom de Tireóide' });
    expect(result.suggestions[0].template.id).toBe('RTV-US-TIREOIDE');
  });

  it('never suggests a template of the wrong modality', () => {
    const result = suggestTemplates({ modality: 'MG', studyDescription: 'MAMOGRAFIA BILATERAL' });
    expect(result.suggestions.every(s => s.template.modality.includes('MG'))).toBe(true);
  });

  // Free text, often absent, and vendor conventions disagree.
  it('lets BodyPartExamined contribute a point without deciding', () => {
    const withPart = suggestTemplates({ modality: 'CT', bodyPartExamined: 'ABDOME' });
    expect(withPart.suggestions.length).toBeGreaterThan(0);
    expect(withPart.suggestions[0].confidence).not.toBe('high');
  });

  it('labels a modality-only match as weak and says to check', () => {
    const result = suggestTemplates({ modality: 'MR' });
    expect(result.suggestions[0].confidence).toBe('low');
    expect(result.message).toMatch(/Sugestão fraca.*Confira antes de carregar/);
  });

  it('refuses to guess with no context at all', () => {
    const result = suggestTemplates({});
    expect(result.suggestions).toEqual([]);
    expect(result.message).toMatch(/nada em que basear uma sugestão/);
  });

  it('says so when nothing in the library matches', () => {
    const result = suggestTemplates({ modality: 'XA', studyDescription: 'ANGIOPLASTIA' });
    expect(result.suggestions).toEqual([]);
    expect(result.message).toMatch(/Nenhum template da biblioteca corresponde/);
  });

  it('honours the limit', () => {
    expect(suggestTemplates({ modality: 'CT' }, undefined, 2).suggestions).toHaveLength(2);
  });

  it('reads out title, modality, confidence and why', () => {
    const result = suggestTemplates({ modality: 'US', studyDescription: 'US ABDOME TOTAL' });
    expect(describeSuggestion(result.suggestions[0])).toMatch(
      /US de abdome total · US · confiança high \(modalidade US, descrição contém/
    );
  });
});
