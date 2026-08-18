import {
  VOICE_CATEGORY_FAMILIES,
  VOICE_COMMANDS,
  VOICE_MODE_COMMAND,
  VOICE_MODE_DICTATION,
  VOICE_POLARITY_ABSENT,
  VOICE_POLARITY_PRESENT,
  VOICE_POLARITY_UNKNOWN,
  VOICE_STRUCTURED_KINDS,
  voiceCommitChip,
  voiceDecideRetention,
  voiceDescribeChip,
  voiceDetectLaterality,
  voiceDetectPolarity,
  voiceExtract,
  voiceFold,
  voiceInterpret,
  voiceLooksLikeCommand,
  voiceParseCategory,
  voiceParseMeasurement,
  type VoiceChip,
} from './voiceStructure';

const T0 = 1_760_000_000_000;

function chipOfKind(utterance: string, kind: string): VoiceChip {
  const result = voiceExtract({ utterance });
  if (!result.ok) {
    throw new Error('fixture broken: ' + result.reason);
  }
  const chip = result.value.chips.filter(c => c.kind === kind)[0];
  if (!chip) {
    throw new Error('fixture broken: no chip of kind ' + kind);
  }
  return chip;
}

/* ------------------------------------------------------------------ */

describe('voiceFold', () => {
  it('strips the accents an engine may or may not emit', () => {
    expect(voiceFold('Não há nódulo')).toBe('nao ha nodulo');
  });

  it('folds cedilla', () => {
    expect(voiceFold('Ausência')).toBe('ausencia');
  });

  it('collapses whitespace', () => {
    expect(voiceFold('  lobo   superior  ')).toBe('lobo superior');
  });

  it('is empty for empty input', () => {
    expect(voiceFold('   ')).toBe('');
    expect(voiceFold(undefined as never)).toBe('');
  });
});

describe('voiceDetectPolarity never infers presence', () => {
  it('reads an explicit negation', () => {
    const result = voiceDetectPolarity('Não há nódulo pulmonar.');
    expect(result.polarity).toBe(VOICE_POLARITY_ABSENT);
    expect(result.marker).toBe('nao');
  });

  it('reads "sem" as negation', () => {
    expect(voiceDetectPolarity('Sem sinais de pneumotórax.').polarity).toBe(VOICE_POLARITY_ABSENT);
  });

  it('reads "ausência de" as negation', () => {
    expect(voiceDetectPolarity('Ausência de derrame pleural.').polarity).toBe(
      VOICE_POLARITY_ABSENT
    );
  });

  it('reads an explicit affirmation', () => {
    const result = voiceDetectPolarity('Há nódulo no lobo superior.');
    expect(result.polarity).toBe(VOICE_POLARITY_PRESENT);
  });

  it('reads "observa-se" as affirmation', () => {
    expect(voiceDetectPolarity('Observa-se opacidade.').polarity).toBe(VOICE_POLARITY_PRESENT);
  });

  it('returns unknown when no marker was spoken, rather than assuming presence', () => {
    const result = voiceDetectPolarity('Nódulo no lobo superior direito.');
    expect(result.polarity).toBe(VOICE_POLARITY_UNKNOWN);
  });

  it('says why presence is not assumed', () => {
    const result = voiceDetectPolarity('Nódulo no lobo superior.');
    expect(result.message).toContain('mais curta do idioma');
  });

  it('prefers negation when both kinds of marker appear', () => {
    expect(voiceDetectPolarity('Não há evidência de nódulo.').polarity).toBe(
      VOICE_POLARITY_ABSENT
    );
  });

  it('does not match a negation inside another word', () => {
    expect(voiceDetectPolarity('Naomi tem nódulo.').polarity).not.toBe(VOICE_POLARITY_ABSENT);
  });
});

describe('voiceDetectLaterality distrusts the single letter', () => {
  it('reads the spelled-out right side with high confidence', () => {
    const result = voiceDetectLaterality('lobo superior direito');
    expect(result.laterality).toBe('right');
    expect(result.confidence).toBe('high');
  });

  it('reads the spelled-out left side with high confidence', () => {
    const result = voiceDetectLaterality('rim esquerdo');
    expect(result.laterality).toBe('left');
    expect(result.confidence).toBe('high');
  });

  it('reads the feminine form', () => {
    expect(voiceDetectLaterality('mama direita').laterality).toBe('right');
  });

  it('reads bilateral', () => {
    expect(voiceDetectLaterality('nódulos bilaterais').laterality).toBe('bilateral');
  });

  it('marks the letter D low confidence, naming the surgical consequence', () => {
    const result = voiceDetectLaterality('lobo superior D');
    expect(result.laterality).toBe('right');
    expect(result.confidence).toBe('low');
    expect(result.caution).toContain('pulmao errado');
  });

  it('marks the letter E low confidence', () => {
    const result = voiceDetectLaterality('rim E');
    expect(result.laterality).toBe('left');
    expect(result.confidence).toBe('low');
  });

  it('refuses to resolve a side when both are spelled out', () => {
    const result = voiceDetectLaterality('comparado ao rim esquerdo, o direito e maior');
    expect(result.laterality).toBe('unknown');
    expect(result.confidence).toBe('low');
  });

  it('returns unknown when no side was spoken', () => {
    expect(voiceDetectLaterality('nódulo pulmonar').laterality).toBe('unknown');
  });

  it('does not read a letter inside a word as a side', () => {
    const result = voiceDetectLaterality('derrame pleural');
    expect(result.laterality).toBe('unknown');
  });
});

describe('voiceParseMeasurement', () => {
  it('parses a comma decimal with a spoken unit', () => {
    const result = voiceParseMeasurement('nódulo de 1,5 centímetros');
    expect(result.ok).toBe(true);
    expect(result.value.value).toBe(1.5);
    expect(result.value.unit).toBe('cm');
  });

  it('parses a dot decimal, which is what an en-US engine emits', () => {
    const result = voiceParseMeasurement('nodule of 1.5 centimetros');
    expect(result.ok).toBe(true);
    expect(result.value.value).toBe(1.5);
  });

  it('parses an integer in millimetres', () => {
    const result = voiceParseMeasurement('15 milímetros');
    expect(result.value.value).toBe(15);
    expect(result.value.unit).toBe('mm');
  });

  it('parses a bidirectional measurement', () => {
    const result = voiceParseMeasurement('1,5 por 1,1 centímetros');
    expect(result.value.value).toBe(1.5);
    expect(result.value.secondValue).toBe(1.1);
  });

  it('refuses a number carrying both separators', () => {
    const result = voiceParseMeasurement('1.234,5 centímetros');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('measurement-ambiguous-separator');
    expect(result.reason).toContain('troca 1,5 por 15');
  });

  it('refuses a three-digit group that could be a thousands separator', () => {
    const result = voiceParseMeasurement('1.500 milímetros');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('measurement-ambiguous-separator');
    expect(result.reason).toContain('1500');
  });

  it('refuses a measurement with no unit rather than defaulting', () => {
    const result = voiceParseMeasurement('nódulo de 1,5');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('measurement-no-unit');
    expect(result.reason).toContain('neurorradiologista');
  });

  it('refuses an utterance with no number', () => {
    expect(voiceParseMeasurement('nódulo pequeno em centímetros').ok).toBe(false);
  });

  it('refuses an empty utterance', () => {
    expect(voiceParseMeasurement('  ').code).toBe('empty-utterance');
  });

  it('keeps the raw token so the chip can underline what was said', () => {
    expect(voiceParseMeasurement('1,5 cm').value.rawToken).toBe('1,5');
  });

  it('accepts the abbreviated unit', () => {
    expect(voiceParseMeasurement('12 mm').value.unit).toBe('mm');
  });

  it('parses a volume in millilitres', () => {
    expect(voiceParseMeasurement('45 mililitros').value.unit).toBe('ml');
  });
});

describe('voiceParseCategory', () => {
  it('parses a BI-RADS category', () => {
    const result = voiceParseCategory('BI-RADS 4a');
    expect(result.ok).toBe(true);
    expect(result.value.family).toBe('BI-RADS');
    expect(result.value.category).toBe('4a');
  });

  it('parses a spoken form with a space instead of a hyphen', () => {
    const result = voiceParseCategory('bi rads 2');
    expect(result.ok).toBe(true);
    expect(result.value.category).toBe('2');
  });

  it('parses Lung-RADS 4x', () => {
    expect(voiceParseCategory('lung rads 4x').value.category).toBe('4x');
  });

  it('parses LI-RADS M', () => {
    expect(voiceParseCategory('li rads m').value.category).toBe('m');
  });

  it('refuses a category the family does not have', () => {
    const result = voiceParseCategory('PI-RADS 6');
    expect(result.ok).toBe(false);
    expect(result.code).toBe('unknown-category');
    expect(result.reason).toContain('fila de seguimento');
  });

  it('refuses an utterance with no category', () => {
    expect(voiceParseCategory('nódulo no lobo superior').ok).toBe(false);
  });

  it('lists the RADS families it recognises', () => {
    expect(Object.keys(VOICE_CATEGORY_FAMILIES).length >= 5).toBe(true);
    expect(VOICE_CATEGORY_FAMILIES['BI-RADS'].indexOf('4c') >= 0).toBe(true);
  });
});

describe('voiceExtract produces candidates, never committed values', () => {
  it('extracts polarity, laterality, measurement and category', () => {
    const result = voiceExtract({
      utterance: 'Há nódulo de 1,5 centímetros no lobo superior direito, BI-RADS 3.',
    });
    expect(result.ok).toBe(true);
    const kinds = result.value.chips.map(c => c.kind);
    expect(kinds.indexOf('polarity') >= 0).toBe(true);
    expect(kinds.indexOf('laterality') >= 0).toBe(true);
    expect(kinds.indexOf('measurement') >= 0).toBe(true);
    expect(kinds.indexOf('category') >= 0).toBe(true);
  });

  it('leaves every chip unconfirmed', () => {
    const result = voiceExtract({ utterance: 'Há nódulo de 1,5 cm à direita.' });
    expect(result.value.chips.every(c => c.confirmed === false)).toBe(true);
  });

  it('lists every structured chip as needing confirmation', () => {
    const result = voiceExtract({ utterance: 'Há nódulo de 1,5 cm direito, BI-RADS 3.' });
    expect(result.value.needsConfirmation.length).toBe(result.value.chips.length);
  });

  it('omits a measurement chip when the unit was not spoken', () => {
    const result = voiceExtract({ utterance: 'Há nódulo de 1,5 no lobo direito.' });
    expect(result.value.chips.filter(c => c.kind === 'measurement').length).toBe(0);
  });

  it('omits a category chip when none was spoken', () => {
    const result = voiceExtract({ utterance: 'Há nódulo de 1,5 cm direito.' });
    expect(result.value.chips.filter(c => c.kind === 'category').length).toBe(0);
  });

  it('binds a chip to a CDE element when a binding is given', () => {
    const result = voiceExtract({
      utterance: 'lobo superior direito',
      cdeBindings: { laterality: 'RDE1234' },
    });
    expect(result.value.chips.filter(c => c.kind === 'laterality')[0].cdeElementId).toBe(
      'RDE1234'
    );
  });

  it('gives each chip a distinct id', () => {
    const result = voiceExtract({ utterance: 'Há nódulo de 1,5 cm direito, BI-RADS 3.' });
    const ids = result.value.chips.map(c => c.chipId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('refuses an empty utterance', () => {
    expect(voiceExtract({ utterance: '   ' }).code).toBe('empty-utterance');
  });

  it('names the structured kinds that reach a registry without a reader', () => {
    expect(VOICE_STRUCTURED_KINDS.indexOf('category') >= 0).toBe(true);
    expect(VOICE_STRUCTURED_KINDS.indexOf('laterality') >= 0).toBe(true);
  });
});

describe('voiceCommitChip', () => {
  it('commits a high-confidence laterality chip', () => {
    const chip = chipOfKind('lobo superior direito', 'laterality');
    const result = voiceCommitChip({ chip, confirmedBy: 'CRM-1', confirmedAt: T0 });
    expect(result.ok).toBe(true);
    expect(result.value.confirmed).toBe(true);
    expect(result.value.laterality).toBe('right');
  });

  it('refuses to commit an abbreviated laterality even with a confirmation', () => {
    const chip = chipOfKind('lobo superior D', 'laterality');
    const result = voiceCommitChip({ chip, confirmedBy: 'CRM-1', confirmedAt: T0 });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('laterality-ambiguous');
    expect(result.reason).toContain('confirmar o palpite');
  });

  it('accepts an abbreviated laterality once the human corrected it', () => {
    const chip = chipOfKind('lobo superior D', 'laterality');
    const result = voiceCommitChip({
      chip,
      confirmedBy: 'CRM-1',
      confirmedAt: T0,
      correctedValue: 'left',
    });
    expect(result.ok).toBe(true);
    expect(result.value.laterality).toBe('left');
    expect(result.value.confidence).toBe('high');
  });

  it('refuses to commit an unknown polarity', () => {
    const chip = chipOfKind('Nódulo no lobo superior direito.', 'polarity');
    const result = voiceCommitChip({ chip, confirmedBy: 'CRM-1', confirmedAt: T0 });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('polarity-unknown');
    expect(result.reason).toContain('ninguem fez');
  });

  it('accepts a corrected polarity', () => {
    const chip = chipOfKind('Nódulo no lobo direito.', 'polarity');
    const result = voiceCommitChip({
      chip,
      confirmedBy: 'CRM-1',
      confirmedAt: T0,
      correctedValue: 'present',
    });
    expect(result.ok).toBe(true);
    expect(result.value.polarity).toBe('present');
  });

  it('commits a clear negation without correction', () => {
    const chip = chipOfKind('Não há nódulo.', 'polarity');
    expect(voiceCommitChip({ chip, confirmedBy: 'CRM-1', confirmedAt: T0 }).ok).toBe(true);
  });

  it('commits a measurement chip', () => {
    const chip = chipOfKind('nódulo de 1,5 centímetros', 'measurement');
    const result = voiceCommitChip({ chip, confirmedBy: 'CRM-1', confirmedAt: T0 });
    expect(result.ok).toBe(true);
    expect(result.value.value).toBe(1.5);
    expect(result.value.unit).toBe('cm');
  });

  it('refuses an unattributed confirmation', () => {
    const chip = chipOfKind('lobo superior direito', 'laterality');
    expect(voiceCommitChip({ chip, confirmedBy: '  ', confirmedAt: T0 }).code).toBe(
      'unattributed'
    );
  });

  it('refuses an invalid timestamp', () => {
    const chip = chipOfKind('lobo superior direito', 'laterality');
    expect(voiceCommitChip({ chip, confirmedBy: 'CRM-1', confirmedAt: 0 }).code).toBe(
      'invalid-timestamp'
    );
  });

  it('refuses with no chip', () => {
    expect(
      voiceCommitChip({ chip: undefined as never, confirmedBy: 'CRM-1', confirmedAt: T0 }).code
    ).toBe('chip-unconfirmed');
  });
});

describe('voiceInterpret keeps content from executing', () => {
  it('inserts dictated text in dictation mode', () => {
    const result = voiceInterpret({
      utterance: 'Nódulo de 1,5 cm no lobo superior direito.',
      mode: VOICE_MODE_DICTATION,
      fieldIdAtStart: 'achados',
      fieldIdNow: 'achados',
    });
    expect(result.ok).toBe(true);
    expect(result.value.text).toContain('Nódulo');
    expect(result.value.command).toBe(undefined);
  });

  it('does not sign the report when the word appears in dictated content', () => {
    const result = voiceInterpret({
      utterance: 'O paciente assinou o termo de consentimento.',
      mode: VOICE_MODE_DICTATION,
      fieldIdAtStart: 'tecnica',
      fieldIdNow: 'tecnica',
    });
    expect(result.ok).toBe(true);
    expect(result.value.command).toBe(undefined);
    expect(result.value.text).toContain('consentimento');
  });

  it('does not treat a bare command phrase as a command in dictation mode', () => {
    const result = voiceInterpret({
      utterance: 'assinar laudo',
      mode: VOICE_MODE_DICTATION,
      fieldIdAtStart: 'achados',
      fieldIdNow: 'achados',
    });
    expect(result.value.command).toBe(undefined);
    expect(result.value.text).toBe('assinar laudo');
  });

  it('refuses when the focus moved during the utterance', () => {
    const result = voiceInterpret({
      utterance: 'Nódulo de 1,5 cm.',
      mode: VOICE_MODE_DICTATION,
      fieldIdAtStart: 'achados',
      fieldIdNow: 'impressao',
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('focus-changed');
    expect(result.reason).toContain('lida como a conclusao');
  });

  it('recognises a non-destructive command in command mode', () => {
    const result = voiceInterpret({ utterance: 'próximo campo', mode: VOICE_MODE_COMMAND });
    expect(result.ok).toBe(true);
    expect(result.value.command.commandId).toBe('next-field');
    expect(result.value.requiresConfirmation).toBe(false);
  });

  it('refuses a destructive command without confirmation', () => {
    const result = voiceInterpret({ utterance: 'assinar laudo', mode: VOICE_MODE_COMMAND });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('destructive-unconfirmed');
  });

  it('runs a destructive command once confirmed', () => {
    const result = voiceInterpret({
      utterance: 'assinar laudo',
      mode: VOICE_MODE_COMMAND,
      destructiveConfirmed: true,
    });
    expect(result.ok).toBe(true);
    expect(result.value.command.commandId).toBe('sign-report');
    expect(result.value.requiresConfirmation).toBe(true);
  });

  it('treats deleting a finding as destructive', () => {
    const result = voiceInterpret({ utterance: 'apagar achado', mode: VOICE_MODE_COMMAND });
    expect(result.code).toBe('destructive-unconfirmed');
  });

  it('treats marking a critical finding as destructive', () => {
    const result = voiceInterpret({ utterance: 'achado crítico', mode: VOICE_MODE_COMMAND });
    expect(result.code).toBe('destructive-unconfirmed');
  });

  it('refuses an unrecognised command instead of inserting it as text', () => {
    const result = voiceInterpret({ utterance: 'faz o laudo pra mim', mode: VOICE_MODE_COMMAND });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('unknown-command');
    expect(result.reason).toContain('nunca execute uma acao');
  });

  it('refuses an empty utterance', () => {
    expect(voiceInterpret({ utterance: '', mode: VOICE_MODE_COMMAND }).code).toBe(
      'empty-utterance'
    );
  });

  it('accepts dictation when only the start field is known', () => {
    const result = voiceInterpret({
      utterance: 'texto',
      mode: VOICE_MODE_DICTATION,
      fieldIdAtStart: 'achados',
    });
    expect(result.ok).toBe(true);
    expect(result.value.targetFieldId).toBe('achados');
  });

  it('classifies every destructive command in the table', () => {
    const destructive = VOICE_COMMANDS.filter(c => c.destructive).map(c => c.commandId);
    expect(destructive.indexOf('sign-report') >= 0).toBe(true);
    expect(destructive.indexOf('delete-finding') >= 0).toBe(true);
    expect(destructive.indexOf('next-field')).toBe(-1);
  });

  it('voiceLooksLikeCommand lets the UI hint without acting', () => {
    expect(voiceLooksLikeCommand('assinar laudo').commandId).toBe('sign-report');
    expect(voiceLooksLikeCommand('O paciente assinou o termo.')).toBe(null);
    expect(voiceLooksLikeCommand('')).toBe(null);
  });
});

describe('voiceDecideRetention', () => {
  const base = {
    action: 'keep' as const,
    retainDays: 30,
    transcriptLeavesInstitution: false,
    decidedBy: 'ADM-1',
    decidedAt: T0,
    justification: 'Politica do servico.',
  };

  it('accepts a keep decision with a period', () => {
    expect(voiceDecideRetention(base).ok).toBe(true);
  });

  it('refuses keep with no period', () => {
    const result = voiceDecideRetention({ ...base, retainDays: undefined });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('para sempre');
  });

  it('drops the period for a discard action', () => {
    const result = voiceDecideRetention({ ...base, action: 'discard-on-signature' });
    expect(result.value.retainDays).toBe(undefined);
  });

  it('requires the provider when the transcript leaves the institution', () => {
    const result = voiceDecideRetention({ ...base, transcriptLeavesInstitution: true });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('onde isso foi processado');
  });

  it('accepts an external transcript with the provider named', () => {
    const result = voiceDecideRetention({
      ...base,
      transcriptLeavesInstitution: true,
      providerId: 'asr-cloud-1',
    });
    expect(result.ok).toBe(true);
    expect(result.value.providerId).toBe('asr-cloud-1');
  });

  it('refuses an unattributed decision', () => {
    expect(voiceDecideRetention({ ...base, decidedBy: '' }).code).toBe('unattributed');
  });

  it('refuses a decision with no justification', () => {
    expect(voiceDecideRetention({ ...base, justification: '  ' }).code).toBe(
      'retention-undecided'
    );
  });

  it('refuses an unknown action', () => {
    expect(voiceDecideRetention({ ...base, action: 'arquivar' as never }).ok).toBe(false);
  });

  it('refuses a fractional retention period', () => {
    expect(voiceDecideRetention({ ...base, retainDays: 1.5 }).ok).toBe(false);
  });

  it('refuses an invalid timestamp', () => {
    expect(voiceDecideRetention({ ...base, decidedAt: 0 }).code).toBe('invalid-timestamp');
  });
});

describe('voiceDescribeChip', () => {
  it('names the kind, value and unit', () => {
    const chip = chipOfKind('nódulo de 1,5 centímetros', 'measurement');
    const text = voiceDescribeChip(chip);
    expect(text).toContain('measurement');
    expect(text).toContain('cm');
  });

  it('says when the confidence is low and why', () => {
    const chip = chipOfKind('lobo superior D', 'laterality');
    const text = voiceDescribeChip(chip);
    expect(text).toContain('confianca baixa');
    expect(text).toContain('pulmao errado');
  });

  it('is empty for no chip', () => {
    expect(voiceDescribeChip(undefined as never)).toBe('');
  });
});
