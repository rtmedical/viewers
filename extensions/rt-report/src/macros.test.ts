import {
  DEFAULT_SIGIL,
  describeMacro,
  expandMacro,
  findPlaceholders,
  findUnfilledPlaceholders,
  guardBeforeSigning,
  Macro,
  matchTrigger,
  nextPlaceholder,
  scopedMacros,
  suggestMacros,
  validateMacros,
} from './macros';

const MACROS: Macro[] = [
  { id: 'm1', trigger: 'n', body: 'Normal.', label: 'Normal' },
  { id: 'm2', trigger: 'nod', body: 'Nódulo em [LOBO] medindo [N] mm.', label: 'Nódulo' },
  {
    id: 'm3',
    trigger: 'normaltorax',
    body: 'Pulmões expandidos.\nSem consolidações.',
    label: 'Tórax normal',
    modalities: ['CT'],
  },
];

describe('macros — registration refuses shadowing', () => {
  it('accepts a clean set', () => {
    expect(validateMacros(MACROS)).toEqual([]);
  });

  // Two macros on one shortcut means one silently never fires, and its author finds out
  // when a report is wrong.
  it('rejects a duplicate trigger instead of letting the later one win', () => {
    const issues = validateMacros([...MACROS, { id: 'm4', trigger: 'NOD', body: 'outro' }]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ macroId: 'm4', problem: 'duplicateTrigger' });
    expect(issues[0].message).toMatch(/nunca dispararia/);
  });

  it('rejects a trigger with a space, which could never fire', () => {
    const issues = validateMacros([{ id: 'x', trigger: 'sem consolidacao', body: 'texto' }]);
    expect(issues[0].problem).toBe('invalidTrigger');
  });

  it('rejects empty triggers and empty bodies', () => {
    const issues = validateMacros([
      { id: 'a', trigger: '  ', body: 'x' },
      { id: 'b', trigger: 'b', body: '   ' },
    ]);
    expect(issues.map(i => i.problem)).toEqual(['emptyTrigger', 'emptyBody']);
  });
});

describe('macros — trigger matching', () => {
  const at = (text: string) => matchTrigger(text, text.length, MACROS);

  it('matches a trigger at the caret', () => {
    const match = at('Achados: ;nod');
    expect(match!.macro.id).toBe('m2');
    expect(match!.start).toBe(9);
    expect(match!.end).toBe(13);
  });

  it('is case-insensitive', () => {
    expect(at('Achados: ;NOD')!.macro.id).toBe('m2');
  });

  // With ';n' and ';nod' both registered, typing ';nod' must not fire ';n'.
  it('takes the whole token, not a prefix', () => {
    expect(at(';nod')!.macro.id).toBe('m2');
    expect(at(';n')!.macro.id).toBe('m1');
  });

  it('does not fire mid-word', () => {
    expect(at('matriz;nod')).toBeNull();
  });

  it('fires at the start of the document and after an opening bracket', () => {
    expect(at(';n')!.macro.id).toBe('m1');
    expect(at('(;n')!.macro.id).toBe('m1');
  });

  it('does not fire across whitespace', () => {
    expect(at('; nod')).toBeNull();
    expect(at(';nod outro')).toBeNull();
  });

  it('returns null for an unknown trigger', () => {
    expect(at(';zzz')).toBeNull();
  });

  it('respects a custom sigil', () => {
    expect(matchTrigger('texto /n', 8, MACROS, '/')!.macro.id).toBe('m1');
    expect(matchTrigger('texto /n', 8, MACROS, ';')).toBeNull();
    expect(DEFAULT_SIGIL).toBe(';');
  });

  it('matches from a caret inside the document, not only at the end', () => {
    const text = 'Achados: ;n mais texto';
    expect(matchTrigger(text, 11, MACROS)!.macro.id).toBe('m1');
  });

  it('is defensive about a caret out of range', () => {
    expect(matchTrigger(';n', 999, MACROS)!.macro.id).toBe('m1');
    expect(matchTrigger('', 0, MACROS)).toBeNull();
  });
});

describe('macros — expansion', () => {
  const expandAtEnd = (text: string) =>
    expandMacro(text, matchTrigger(text, text.length, MACROS)!);

  it('replaces the trigger with the body', () => {
    expect(expandAtEnd('Achados: ;n').text).toBe('Achados: Normal.');
  });

  it('keeps the text after the caret', () => {
    const text = 'Achados: ;n resto';
    const result = expandMacro(text, matchTrigger(text, 11, MACROS)!);
    expect(result.text).toBe('Achados: Normal. resto');
  });

  // A paragraph dropped in with no visual trace is text the radiologist signs without
  // having read it.
  it('reports the inserted range so the editor can show it', () => {
    const result = expandAtEnd('Achados: ;n');
    expect(result.insertedStart).toBe(9);
    expect(result.insertedEnd).toBe(16);
    expect(result.text.slice(result.insertedStart, result.insertedEnd)).toBe('Normal.');
  });

  it('selects the whole insertion when there is nothing to fill in', () => {
    const result = expandAtEnd('Achados: ;n');
    expect(result.selection).toEqual({ start: 9, end: 16 });
    expect(result.caret).toBe(16);
  });

  // Landing at the end is exactly what produces reports containing "[LOBO]".
  it('puts the caret on the FIRST placeholder, not at the end', () => {
    const result = expandAtEnd(';nod');
    expect(result.placeholders.map(p => p.name)).toEqual(['LOBO', 'N']);
    expect(result.caret).toBe(result.placeholders[0].start);
    expect(result.selection).toEqual({
      start: result.placeholders[0].start,
      end: result.placeholders[0].end,
    });
    expect(result.text.slice(result.selection.start, result.selection.end)).toBe('[LOBO]');
  });

  it('reports placeholder positions in document coordinates', () => {
    const result = expandAtEnd('Achados: ;nod');
    expect(result.text.slice(result.placeholders[1].start, result.placeholders[1].end)).toBe('[N]');
  });

  it('indents continuation lines when asked', () => {
    const text = ';normaltorax';
    const result = expandMacro(text, matchTrigger(text, text.length, MACROS)!, '  ');
    expect(result.text).toBe('Pulmões expandidos.\n  Sem consolidações.');
  });

  it('walks to the next placeholder and wraps', () => {
    const text = 'Nódulo em [LOBO] medindo [N] mm.';
    expect(nextPlaceholder(text, 0)!.name).toBe('LOBO');
    expect(nextPlaceholder(text, 11)!.name).toBe('N');
    expect(nextPlaceholder(text, 999)!.name).toBe('LOBO');
    expect(nextPlaceholder('sem campos', 0)).toBeNull();
  });
});

describe('macros — placeholders', () => {
  it('finds uppercase bracketed fields', () => {
    expect(findPlaceholders('em [LOBO] de [N] mm').map(p => p.name)).toEqual(['LOBO', 'N']);
  });

  it('accepts accents and underscores in a field name', () => {
    expect(findPlaceholders('[SEGMENTO_HEPÁTICO]').map(p => p.name)).toEqual([
      'SEGMENTO_HEPÁTICO',
    ]);
  });

  // Uppercase-only so ordinary prose in brackets is not treated as a field.
  it('leaves lower-case bracketed prose alone', () => {
    expect(findPlaceholders('[ver imagem 12]')).toEqual([]);
    expect(findPlaceholders('nódulo (ver [figura 3])')).toEqual([]);
  });

  it('ignores an unreasonably long bracket run', () => {
    expect(findPlaceholders(`[${'A'.repeat(60)}]`)).toEqual([]);
  });
});

describe('macros — the pre-sign guard', () => {
  it('passes a filled report', () => {
    expect(guardBeforeSigning('Nódulo em LSD medindo 6 mm.')).toEqual({ ok: true, unfilled: [] });
  });

  // A warning on a signing dialog is dismissed by muscle memory.
  it('REFUSES a report that still has fields, naming them', () => {
    const guard = guardBeforeSigning('Nódulo em [LOBO] medindo [N] mm.');
    expect(guard.ok).toBe(false);
    expect(guard.unfilled).toEqual(['LOBO', 'N']);
    expect(guard.message).toBe('Há campos de macro não preenchidos: [LOBO], [N].');
  });

  it('lists each distinct field once', () => {
    const guard = guardBeforeSigning('[N] e [N] e [LOBO]');
    expect(guard.message).toBe('Há campos de macro não preenchidos: [N], [LOBO].');
  });

  it('findUnfilledPlaceholders is the same check, unwrapped', () => {
    expect(findUnfilledPlaceholders('em [LOBO]')).toEqual(['LOBO']);
    expect(findUnfilledPlaceholders('')).toEqual([]);
  });
});

describe('macros — scope and suggestions', () => {
  const OWNED: Macro[] = [
    ...MACROS,
    { id: 'p1', trigger: 'meu', body: 'pessoal', ownerId: 'ana' },
  ];

  it('hides another user private macros', () => {
    expect(scopedMacros(OWNED, { userId: 'bruno' }).map(m => m.id)).not.toContain('p1');
    expect(scopedMacros(OWNED, { userId: 'ana' }).map(m => m.id)).toContain('p1');
  });

  it('filters by modality, keeping unrestricted macros', () => {
    const mr = scopedMacros(MACROS, { modality: 'MR' }).map(m => m.id);
    expect(mr).toEqual(['m1', 'm2']);
    expect(scopedMacros(MACROS, { modality: 'CT' }).map(m => m.id)).toContain('m3');
  });

  it('shows everything when no scope is given', () => {
    expect(scopedMacros(MACROS)).toHaveLength(3);
  });

  it('suggests by prefix, alphabetically', () => {
    expect(suggestMacros(MACROS, 'n').map(m => m.id)).toEqual(['m1', 'm2', 'm3']);
    expect(suggestMacros(MACROS, 'nod').map(m => m.id)).toEqual(['m2']);
    expect(suggestMacros(MACROS, 'zz')).toEqual([]);
  });

  it('lists everything for an empty prefix, respecting the limit', () => {
    expect(suggestMacros(MACROS, '')).toHaveLength(3);
    expect(suggestMacros(MACROS, '', 2)).toHaveLength(2);
  });

  it('renders a menu label', () => {
    expect(describeMacro(MACROS[1])).toBe(';nod — Nódulo');
    expect(describeMacro({ id: 'x', trigger: 'x', body: 'y' })).toBe(';x');
    expect(describeMacro(undefined as never)).toBe('');
  });
});
