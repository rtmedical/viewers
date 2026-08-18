import {
  DOC_AUTOSAVE_INTERVAL_MS,
  DOC_MAX_CHARS,
  DOC_SUBSTANTIAL_CHARS,
  docApplySaveOutcome,
  docAssertLoadable,
  docDecodeEntities,
  docDescribeSaveState,
  docEncodeEntities,
  docIsPersisted,
  docListOrdinals,
  docMarkProfile,
  docParseHtml,
  docPlanAutosave,
  docRoundTrip,
  docSerializeHtml,
  docTextContent,
  type DocEditorState,
} from './reportDocument';

const T0 = 1_760_000_000_000;

function parsed(html: string) {
  const result = docParseHtml(html);
  if (!result.ok) {
    throw new Error('fixture broken: ' + result.reason);
  }
  return result.value;
}

function editor(over: Partial<DocEditorState> = {}): DocEditorState {
  return {
    reportId: 'LAU-77',
    load: 'loaded',
    baseRevision: 4,
    loadedChars: 500,
    ...over,
  };
}

describe('docDecodeEntities / docEncodeEntities', () => {
  it('decodes the named entities CKEditor emits', () => {
    expect(docDecodeEntities('a &amp; b &lt;c&gt; &quot;d&quot;')).toBe('a & b <c> "d"');
  });

  it('decodes nbsp to a plain space so whitespace normalisation can see it', () => {
    expect(docDecodeEntities('1,5&nbsp;cm')).toBe('1,5 cm');
  });

  it('decodes decimal and hex numeric entities', () => {
    expect(docDecodeEntities('&#67;T &#x43;T')).toBe('CT CT');
  });

  it('leaves an unterminated ampersand alone instead of eating the next word', () => {
    expect(docDecodeEntities('AT&T e outro')).toBe('AT&T e outro');
  });

  it('leaves an unknown entity intact', () => {
    expect(docDecodeEntities('&naoexiste;')).toBe('&naoexiste;');
  });

  it('encodes only the three characters that break markup', () => {
    expect(docEncodeEntities('a & b < c > d "e"')).toBe('a &amp; b &lt; c &gt; d "e"');
  });

  it('round-trips a measurement through encode and decode', () => {
    expect(docDecodeEntities(docEncodeEntities('nodulo 1,5 cm & 2,0 cm'))).toBe(
      'nodulo 1,5 cm & 2,0 cm'
    );
  });
});

describe('docParseHtml', () => {
  it('parses paragraphs into blocks', () => {
    const doc = parsed('<p>Primeiro</p><p>Segundo</p>');
    expect(doc.blocks.length).toBe(2);
    expect(doc.blocks[0].tag).toBe('p');
    expect(docTextContent(doc)).toBe('Primeiro\nSegundo');
  });

  it('collects marks onto runs', () => {
    const doc = parsed('<p>normal <strong>negrito</strong> normal</p>');
    expect(doc.blocks[0].runs.length).toBe(3);
    expect(doc.blocks[0].runs[1].marks).toEqual(['strong']);
    expect(doc.blocks[0].runs[0].marks).toEqual([]);
  });

  it('normalises b to strong and i to em so a load does not look like an edit', () => {
    const withB = docMarkProfile(parsed('<p><b>x</b></p>'));
    const withStrong = docMarkProfile(parsed('<p><strong>x</strong></p>'));
    expect(withB).toEqual(withStrong);
    expect(docMarkProfile(parsed('<p><i>y</i></p>'))).toEqual(
      docMarkProfile(parsed('<p><em>y</em></p>'))
    );
  });

  it('nests marks', () => {
    const doc = parsed('<p><strong><em>ambos</em></strong></p>');
    expect(doc.blocks[0].runs[0].marks).toEqual(['strong', 'em']);
  });

  it('keeps superscript, which carries the exponent in a volume', () => {
    const doc = parsed('<p>volume 12 cm<sup>3</sup></p>');
    const sup = doc.blocks[0].runs.filter(r => r.marks.indexOf('sup') >= 0);
    expect(sup.length).toBe(1);
    expect(sup[0].text).toBe('3');
  });

  it('numbers ordered list items and leaves unordered ones without an ordinal', () => {
    const ordered = parsed('<ol><li>um</li><li>dois</li><li>tres</li></ol>');
    expect(docListOrdinals(ordered)).toEqual([1, 2, 3]);
    const unordered = parsed('<ul><li>a</li><li>b</li></ul>');
    expect(docListOrdinals(unordered)).toEqual([]);
  });

  it('records span and div as normalised, not as losses', () => {
    const doc = parsed('<p><span style="color:red">vermelho</span></p>');
    expect(docTextContent(doc)).toBe('vermelho');
    expect(doc.unsupported.filter(u => u.tag === 'span')[0].carriedText).toBe(false);
  });

  it('marks an unmodelled tag that carried text as carrying text', () => {
    const doc = parsed('<p>antes</p><figcaption>medida 1,5 cm</figcaption>');
    const figcaption = doc.unsupported.filter(u => u.tag === 'figcaption')[0];
    expect(figcaption.carriedText).toBe(true);
    expect(figcaption.sample).toContain('1,5 cm');
  });

  it('strips script content entirely', () => {
    const doc = parsed('<p>antes</p><script>alert("x")</script><p>depois</p>');
    expect(docTextContent(doc)).toBe('antes\ndepois');
  });

  it('strips style content entirely', () => {
    const doc = parsed('<style>p{color:red}</style><p>texto</p>');
    expect(docTextContent(doc)).toBe('texto');
  });

  it('drops comments', () => {
    expect(docTextContent(parsed('<p>a<!-- nota interna -->b</p>'))).toBe('ab');
  });

  it('drops a doctype', () => {
    expect(docTextContent(parsed('<!DOCTYPE html><p>x</p>'))).toBe('x');
  });

  it('tolerates unclosed paragraphs, which a decade of CKEditor produced', () => {
    const doc = parsed('<p>um<p>dois<p>tres');
    expect(doc.blocks.length).toBe(3);
    expect(docTextContent(doc)).toBe('um\ndois\ntres');
  });

  it('treats a stray less-than as literal text rather than failing', () => {
    const doc = parsed('<p>valor < 5 mm</p>');
    expect(docTextContent(doc)).toContain('< 5 mm');
  });

  it('turns br into a newline inside the block', () => {
    const doc = parsed('<p>linha1<br />linha2</p>');
    expect(docTextContent(doc)).toBe('linha1\nlinha2');
  });

  it('keeps text that appears with no surrounding block', () => {
    expect(docTextContent(parsed('texto solto'))).toBe('texto solto');
  });

  it('drops blocks that are only whitespace', () => {
    const doc = parsed('<p>real</p><p>   </p><p>&nbsp;</p>');
    expect(doc.blocks.length).toBe(1);
  });

  it('keeps an hr even though it has no text', () => {
    const doc = parsed('<p>a</p><hr /><p>b</p>');
    expect(doc.blocks.filter(b => b.tag === 'hr').length).toBe(1);
  });

  it('refuses a non-string input', () => {
    const result = docParseHtml(undefined as unknown as string);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('malformed-html');
  });

  it('refuses a document past the character ceiling', () => {
    const result = docParseHtml('<p>' + 'a'.repeat(DOC_MAX_CHARS + 1) + '</p>');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('too-large');
  });

  it('accepts a document exactly at the ceiling', () => {
    expect(docParseHtml('<p>' + 'a'.repeat(DOC_MAX_CHARS) + '</p>').ok).toBe(true);
  });
});

describe('docSerializeHtml', () => {
  it('emits paragraphs', () => {
    expect(docSerializeHtml(parsed('<p>a</p><p>b</p>'))).toBe('<p>a</p><p>b</p>');
  });

  it('emits marks in a canonical order so the round-trip is stable', () => {
    const a = docSerializeHtml(parsed('<p><em><strong>x</strong></em></p>'));
    const b = docSerializeHtml(parsed('<p><strong><em>x</em></strong></p>'));
    expect(a).toBe(b);
  });

  it('rebuilds an ordered list', () => {
    const html = docSerializeHtml(parsed('<ol><li>um</li><li>dois</li></ol>'));
    expect(html).toBe('<ol><li>um</li><li>dois</li></ol>');
  });

  it('rebuilds an unordered list as ul', () => {
    const html = docSerializeHtml(parsed('<ul><li>a</li></ul>'));
    expect(html).toBe('<ul><li>a</li></ul>');
  });

  it('escapes markup characters in text', () => {
    const html = docSerializeHtml(parsed('<p>valor &lt; 5 &amp; &gt; 1</p>'));
    expect(html).toBe('<p>valor &lt; 5 &amp; &gt; 1</p>');
  });

  it('emits br for a newline run', () => {
    expect(docSerializeHtml(parsed('<p>a<br />b</p>'))).toBe('<p>a<br />b</p>');
  });

  it('emits hr', () => {
    expect(docSerializeHtml(parsed('<hr />'))).toBe('<hr />');
  });

  it('returns an empty string for a missing document', () => {
    expect(docSerializeHtml(undefined as never)).toBe('');
  });

  // Regression. The open/wanted mark stacks were compared as joined strings, and 's' is a
  // string prefix of 'strong', 'sub' and 'sup'. Strikethrough followed by bold therefore
  // neither closed <s> nor opened <strong>, producing '<s>risneg</s>': the bold silently
  // gone and the strikethrough silently extended over text that was never struck.
  it('closes a mark whose name is a string prefix of the next mark', () => {
    expect(docSerializeHtml(parsed('<p><s>ris</s><strong>neg</strong></p>'))).toBe(
      '<p><s>ris</s><strong>neg</strong></p>'
    );
  });

  it('does not extend strikethrough over the following bold run', () => {
    const html = docSerializeHtml(parsed('<p><s>ris</s><strong>neg</strong></p>'));
    expect(html).not.toContain('risneg');
  });

  it('closes s before sub and sup, which share its prefix', () => {
    expect(docSerializeHtml(parsed('<p><s>a</s><sub>b</sub></p>'))).toBe(
      '<p><s>a</s><sub>b</sub></p>'
    );
    expect(docSerializeHtml(parsed('<p><s>a</s><sup>b</sup></p>'))).toBe(
      '<p><s>a</s><sup>b</sup></p>'
    );
  });

  it('preserves both marks across every ordered pair of marks', () => {
    const marks = ['strong', 'em', 'u', 's', 'sub', 'sup', 'code'];
    for (const first of marks) {
      for (const second of marks) {
        if (first === second) {
          continue;
        }
        const html = '<p><' + first + '>a</' + first + '><' + second + '>b</' + second + '></p>';
        const trip = docRoundTrip(html);
        expect(trip.value.markChanges).toEqual([]);
        expect(trip.value.textPreserved).toBe(true);
      }
    }
  });
});

describe('docTextContent', () => {
  it('collapses runs of spaces because HTML whitespace is not meaningful', () => {
    expect(docTextContent(parsed('<p>a     b</p>'))).toBe('a b');
  });

  it('does not touch a decimal separator', () => {
    expect(docTextContent(parsed('<p>nodulo de 1,5 cm</p>'))).toBe('nodulo de 1,5 cm');
  });

  it('separates blocks with a single newline', () => {
    expect(docTextContent(parsed('<p>a</p><p>b</p><p>c</p>'))).toBe('a\nb\nc');
  });

  it('is empty for an empty document', () => {
    expect(docTextContent(parsed(''))).toBe('');
  });

  it('is empty for a missing document', () => {
    expect(docTextContent(undefined as never)).toBe('');
  });
});

describe('docRoundTrip', () => {
  it('reports no loss for plain prose', () => {
    const trip = docRoundTrip('<p>Nodulo no lobo superior direito medindo 1,5 cm.</p>');
    expect(trip.ok).toBe(true);
    expect(trip.value.textPreserved).toBe(true);
    expect(trip.value.marksPreserved).toBe(true);
    expect(trip.value.structurePreserved).toBe(true);
    expect(trip.value.message).toBe('Round-trip sem perda.');
  });

  it('reports no loss when CKEditor used b instead of strong', () => {
    const trip = docRoundTrip('<p><b>ACHADO CRITICO</b> no lobo inferior.</p>');
    expect(trip.value.textPreserved).toBe(true);
    expect(trip.value.marksPreserved).toBe(true);
  });

  it('reports text lost inside an unmodelled element, and says the report still reads whole', () => {
    const trip = docRoundTrip('<p>Achados.</p><figcaption>Massa de 4,2 cm</figcaption>');
    expect(trip.value.textPreserved).toBe(false);
    expect(trip.value.droppedWithText.length).toBe(1);
    expect(trip.value.droppedWithText[0].tag).toBe('figcaption');
    expect(trip.value.message).toContain('laudo completo');
  });

  it('lists cosmetic wrappers as normalised without calling them losses', () => {
    const trip = docRoundTrip('<div><p><span>texto</span></p></div>');
    expect(trip.value.textPreserved).toBe(true);
    expect(trip.value.normalised.indexOf('span') >= 0).toBe(true);
    expect(trip.value.normalised.indexOf('div') >= 0).toBe(true);
  });

  it('preserves numbering so a later "achado 3" still points at the same item', () => {
    const trip = docRoundTrip('<ol><li>um</li><li>dois</li><li>tres</li></ol>');
    expect(trip.value.structurePreserved).toBe(true);
  });

  it('preserves nested marks', () => {
    const trip = docRoundTrip('<p><strong>a <em>b</em></strong> c</p>');
    expect(trip.value.marksPreserved).toBe(true);
    expect(trip.value.textPreserved).toBe(true);
  });

  it('preserves superscript in a volume', () => {
    const trip = docRoundTrip('<p>12 cm<sup>3</sup></p>');
    expect(trip.value.marksPreserved).toBe(true);
    expect(trip.value.textPreserved).toBe(true);
  });

  it('preserves a table because a cell holds a measurement', () => {
    const trip = docRoundTrip(
      '<table><tbody><tr><td>lesao 1</td><td>1,5 cm</td></tr></tbody></table>'
    );
    expect(trip.value.textPreserved).toBe(true);
  });

  it('propagates a parse refusal instead of reporting a clean trip', () => {
    const trip = docRoundTrip('<p>' + 'a'.repeat(DOC_MAX_CHARS + 1) + '</p>');
    expect(trip.ok).toBe(false);
    expect(trip.code).toBe('too-large');
  });
});

describe('docAssertLoadable', () => {
  it('allows a report whose text survives', () => {
    expect(docAssertLoadable('<p>Laudo normal.</p>').ok).toBe(true);
  });

  it('refuses a report whose text would be lost, naming the silent deletion', () => {
    const result = docAssertLoadable('<p>a</p><figcaption>medida 3,1 cm</figcaption>');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('content-dropped');
    expect(result.reason).toContain('sem aviso');
  });

  it('allows a report that only loses cosmetic wrappers', () => {
    expect(docAssertLoadable('<div><p><span>x</span></p></div>').ok).toBe(true);
  });

  it('reports mark changes without blocking, so old reports stay openable', () => {
    const result = docAssertLoadable('<p><strong>x</strong></p>');
    expect(result.ok).toBe(true);
  });
});

describe('docPlanAutosave', () => {
  const html = '<p>Laudo com conteudo suficiente para nao ser considerado vazio.</p>';

  it('plans a save when the document is loaded and the revision matches', () => {
    const plan = docPlanAutosave({
      state: editor(),
      html,
      serverRevision: 4,
      at: T0,
    });
    expect(plan.ok).toBe(true);
    expect(plan.value.baseRevision).toBe(4);
    expect(plan.value.reportId).toBe('LAU-77');
  });

  it('refuses when the load failed, naming the overwrite of the real report', () => {
    const plan = docPlanAutosave({
      state: editor({ load: 'load-failed' }),
      html: '',
      serverRevision: 4,
      at: T0,
    });
    expect(plan.ok).toBe(false);
    expect(plan.code).toBe('not-loaded');
    expect(plan.reason).toContain('editor vazio sobre o laudo');
  });

  it('refuses while still loading', () => {
    expect(
      docPlanAutosave({ state: editor({ load: 'loading' }), html, serverRevision: 4, at: T0 }).code
    ).toBe('not-loaded');
  });

  it('refuses before any load happened', () => {
    expect(
      docPlanAutosave({ state: editor({ load: 'not-loaded' }), html, serverRevision: 4, at: T0 })
        .code
    ).toBe('not-loaded');
  });

  it('checks the load state before the revision, because only one of them destroys content', () => {
    const plan = docPlanAutosave({
      state: editor({ load: 'load-failed', baseRevision: 4 }),
      html: '',
      serverRevision: 99,
      at: T0,
    });
    expect(plan.code).toBe('not-loaded');
  });

  it('refuses to autosave a signed report', () => {
    const plan = docPlanAutosave({
      state: editor({ signed: true }),
      html,
      serverRevision: 4,
      at: T0,
    });
    expect(plan.ok).toBe(false);
    expect(plan.code).toBe('signed-document');
    expect(plan.reason).toContain('retificacao');
  });

  it('refuses when the server moved on, naming both revisions', () => {
    const plan = docPlanAutosave({
      state: editor({ baseRevision: 4 }),
      html,
      serverRevision: 5,
      at: T0,
    });
    expect(plan.ok).toBe(false);
    expect(plan.code).toBe('revision-conflict');
    expect(plan.reason).toContain('4');
    expect(plan.reason).toContain('5');
    expect(plan.reason).toContain('outra sessao');
  });

  it('refuses an emptying save over a substantial report', () => {
    const plan = docPlanAutosave({
      state: editor({ loadedChars: 500 }),
      html: '<p></p>',
      serverRevision: 4,
      at: T0,
    });
    expect(plan.ok).toBe(false);
    expect(plan.code).toBe('empty-overwrite');
    expect(plan.reason).toContain('ato explicito');
  });

  it('allows an emptying save when the caller declares the intent', () => {
    const plan = docPlanAutosave({
      state: editor({ loadedChars: 500 }),
      html: '<p></p>',
      serverRevision: 4,
      at: T0,
      deliberateClear: true,
    });
    expect(plan.ok).toBe(true);
    expect(plan.value.chars).toBe(0);
  });

  it('allows clearing a document that was never substantial', () => {
    const plan = docPlanAutosave({
      state: editor({ loadedChars: DOC_SUBSTANTIAL_CHARS - 1 }),
      html: '',
      serverRevision: 4,
      at: T0,
    });
    expect(plan.ok).toBe(true);
  });

  it('treats exactly the substantial threshold as substantial', () => {
    const plan = docPlanAutosave({
      state: editor({ loadedChars: DOC_SUBSTANTIAL_CHARS }),
      html: '',
      serverRevision: 4,
      at: T0,
    });
    expect(plan.code).toBe('empty-overwrite');
  });

  it('refuses a save that changes nothing', () => {
    const plan = docPlanAutosave({
      state: editor(),
      html,
      serverRevision: 4,
      at: T0,
      lastSavedHtml: html,
    });
    expect(plan.ok).toBe(false);
    expect(plan.code).toBe('no-changes');
  });

  it('does not treat a b-to-strong difference as a change', () => {
    const plan = docPlanAutosave({
      state: editor(),
      html: '<p><strong>Achado importante no lobo superior direito.</strong></p>',
      serverRevision: 4,
      at: T0,
      lastSavedHtml: '<p><b>Achado importante no lobo superior direito.</b></p>',
    });
    expect(plan.code).toBe('no-changes');
  });

  it('does treat a formatting-only change as a change worth saving', () => {
    const plan = docPlanAutosave({
      state: editor(),
      html: '<p><strong>Achado importante no lobo superior direito.</strong></p>',
      serverRevision: 4,
      at: T0,
      lastSavedHtml: '<p>Achado importante no lobo superior direito.</p>',
    });
    expect(plan.ok).toBe(true);
  });

  it('treats a changed measurement as a change', () => {
    const plan = docPlanAutosave({
      state: editor(),
      html: '<p>Nodulo medindo 15 cm no lobo superior direito.</p>',
      serverRevision: 4,
      at: T0,
      lastSavedHtml: '<p>Nodulo medindo 1,5 cm no lobo superior direito.</p>',
    });
    expect(plan.ok).toBe(true);
  });

  it('refuses an invalid timestamp', () => {
    expect(docPlanAutosave({ state: editor(), html, serverRevision: 4, at: 0 }).code).toBe(
      'invalid-timestamp'
    );
  });

  it('refuses a negative base revision', () => {
    expect(
      docPlanAutosave({ state: editor({ baseRevision: -1 }), html, serverRevision: -1, at: T0 })
        .code
    ).toBe('invalid-revision');
  });

  it('refuses a non-finite server revision', () => {
    expect(
      docPlanAutosave({ state: editor(), html, serverRevision: Number.NaN, at: T0 }).code
    ).toBe('invalid-revision');
  });

  it('refuses with no state at all', () => {
    expect(
      docPlanAutosave({ state: undefined as never, html, serverRevision: 4, at: T0 }).code
    ).toBe('not-loaded');
  });

  it('propagates an oversized document refusal', () => {
    const plan = docPlanAutosave({
      state: editor(),
      html: '<p>' + 'a'.repeat(DOC_MAX_CHARS + 1) + '</p>',
      serverRevision: 4,
      at: T0,
    });
    expect(plan.code).toBe('too-large');
  });

  it('emits canonical html rather than whatever the editor produced', () => {
    const plan = docPlanAutosave({
      state: editor(),
      html: '<p><i><b>texto suficientemente longo para o limite</b></i></p>',
      serverRevision: 4,
      at: T0,
    });
    expect(plan.value.html).toBe(
      '<p><strong><em>texto suficientemente longo para o limite</em></strong></p>'
    );
  });

  it('uses a 30 second interval as the documented cadence', () => {
    expect(DOC_AUTOSAVE_INTERVAL_MS).toBe(30_000);
  });
});

describe('docApplySaveOutcome', () => {
  it('advances the base revision on a confirmed save', () => {
    const result = docApplySaveOutcome(editor({ baseRevision: 4 }), {
      state: 'saved',
      revision: 5,
    });
    expect(result.ok).toBe(true);
    expect(result.value.baseRevision).toBe(5);
  });

  it('refuses a confirmed save with no revision, naming the dead conflict check', () => {
    const result = docApplySaveOutcome(editor(), { state: 'saved' });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('nao checa nada');
  });

  it('refuses a confirmed save whose revision did not advance', () => {
    expect(
      docApplySaveOutcome(editor({ baseRevision: 4 }), { state: 'saved', revision: 4 }).ok
    ).toBe(false);
  });

  it('leaves the state untouched on failure', () => {
    const result = docApplySaveOutcome(editor({ baseRevision: 4 }), { state: 'failed' });
    expect(result.ok).toBe(true);
    expect(result.value.baseRevision).toBe(4);
  });

  it('leaves the state untouched on conflict', () => {
    const result = docApplySaveOutcome(editor({ baseRevision: 4 }), { state: 'conflict' });
    expect(result.value.baseRevision).toBe(4);
  });

  it('refuses an unknown outcome', () => {
    expect(docApplySaveOutcome(editor(), { state: 'synced' as never }).ok).toBe(false);
  });

  it('refuses with no state', () => {
    expect(docApplySaveOutcome(undefined as never, { state: 'failed' }).code).toBe('not-loaded');
  });
});

describe('docIsPersisted and docDescribeSaveState', () => {
  it('treats only saved as persisted', () => {
    expect(docIsPersisted('saved')).toBe(true);
    expect(docIsPersisted('pending')).toBe(false);
    expect(docIsPersisted('failed')).toBe(false);
    expect(docIsPersisted('conflict')).toBe(false);
  });

  it('tells the user what to do about a conflict', () => {
    expect(docDescribeSaveState('conflict')).toContain('recarregue');
  });

  it('does not claim the server for a pending state', () => {
    expect(docDescribeSaveState('pending')).not.toContain('Connect');
  });

  it('names the server for a saved state', () => {
    expect(docDescribeSaveState('saved', T0)).toContain('Connect');
  });
});
