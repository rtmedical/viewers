import {
  acceptDictation,
  applyCommands,
  DEFAULT_COMMANDS,
  describeDraft,
  draftFromTranscript,
  joinTranscript,
  RISK_LABELS,
  scanRisk,
  selectProvider,
  SpeechProvider,
  Token,
  Transcript,
} from './speechAdapter';

const provider = (over: Partial<SpeechProvider> = {}): SpeechProvider => ({
  id: 'p1',
  name: 'Provedor',
  languages: ['pt-BR'],
  supportsCommands: true,
  supportsMedicalVocabulary: true,
  reportsTokenConfidence: true,
  streaming: true,
  processing: 'on-device',
  ...over,
});

const transcribe = (sentence: string, confidence?: number): Transcript => ({
  tokens: sentence.split(' ').map<Token>(t => ({ text: t, confidence })),
  language: 'pt-BR',
  providerId: 'p1',
});

describe('speechAdapter — choosing a provider', () => {
  it('picks one that speaks the language', () => {
    const result = selectProvider([provider()], { language: 'pt-BR', allowCloud: false });
    expect(result.provider!.id).toBe('p1');
  });

  // A pt-PT engine does not fail loudly on pt-BR; it produces plausible Portuguese with
  // the wrong words in it.
  it('rejects a language mismatch instead of warning', () => {
    const result = selectProvider([provider({ languages: ['pt-PT'] })], {
      language: 'pt-BR',
      allowCloud: true,
    });
    expect(result.provider).toBeNull();
    expect(result.reason).toMatch(/não falha alto: produz português plausível com as palavras erradas/);
  });

  it('refuses a cloud provider when audio may not leave', () => {
    const result = selectProvider([provider({ processing: 'cloud' })], {
      language: 'pt-BR',
      allowCloud: false,
    });
    expect(result.provider).toBeNull();
    expect(result.reason).toMatch(/base legal e contrato de operador/);
  });

  it('warns when the audio does go to the cloud', () => {
    const result = selectProvider([provider({ processing: 'cloud' })], {
      language: 'pt-BR',
      allowCloud: true,
    });
    expect(result.warnings.join(' ')).toMatch(/o ditado é dado do paciente/);
  });

  it('prefers a provider with a radiology lexicon', () => {
    const result = selectProvider(
      [provider({ id: 'plain', supportsMedicalVocabulary: false }), provider({ id: 'medical' })],
      { language: 'pt-BR', allowCloud: false }
    );
    expect(result.provider!.id).toBe('medical');
  });

  it('warns when it had to settle for one without', () => {
    const result = selectProvider([provider({ supportsMedicalVocabulary: false })], {
      language: 'pt-BR',
      allowCloud: false,
    });
    expect(result.warnings.join(' ')).toMatch(/as palavras comuns mais próximas/);
  });

  // The scan never depended on confidence in the first place.
  it('accepts a provider with no confidence scores and says the scan still applies', () => {
    const result = selectProvider([provider({ reportsTokenConfidence: false })], {
      language: 'pt-BR',
      allowCloud: false,
    });
    expect(result.provider).not.toBeNull();
    expect(result.warnings.join(' ')).toMatch(/nunca dependeu da confiança/);
  });

  it('refuses with no language and with no candidates', () => {
    expect(selectProvider([provider()], { language: '', allowCloud: true }).provider).toBeNull();
    expect(selectProvider([], { language: 'pt-BR', allowCloud: true }).provider).toBeNull();
  });
});

describe('speechAdapter — the four classes that flip meaning', () => {
  it('flags a negation', () => {
    const flags = scanRisk(transcribe('não há sinais de pneumotórax'));
    expect(flags.some(f => f.kind === 'negation' && f.match === 'não')).toBe(true);
    expect(flags[0].reason).toMatch(/uma sílaba curta e átona/);
  });

  it('flags "sem" and "ausência" as negations too', () => {
    const kinds = scanRisk(transcribe('sem derrame e ausência de consolidação')).map(f => f.match);
    expect(kinds).toContain('sem');
    expect(kinds).toContain('ausência');
  });

  it('flags laterality', () => {
    const flags = scanRisk(transcribe('nódulo no lobo superior direito'));
    expect(flags.some(f => f.kind === 'laterality' && f.match === 'direito')).toBe(true);
    expect(flags.find(f => f.kind === 'laterality')!.reason).toMatch(/Lado errado/);
  });

  // The same digits; a lost comma turns a follow-up into a biopsy.
  it('flags a measurement', () => {
    const flags = scanRisk(transcribe('nódulo de 1,5 cm no ápice'));
    expect(flags.some(f => f.kind === 'measurement' && f.match === '1,5 cm')).toBe(true);
  });

  it('flags a dose without confusing mg for a measurement in metres', () => {
    const flags = scanRisk(transcribe('administrados 500 mg de contraste'));
    expect(flags.filter(f => f.kind === 'dose')).toHaveLength(1);
    expect(flags.some(f => f.kind === 'measurement')).toBe(false);
  });

  // The errors that matter are the crisp, confident, wrong ones.
  it('flags a perfectly confident token just the same', () => {
    const flags = scanRisk(transcribe('lesão à esquerda', 0.99));
    expect(flags.some(f => f.kind === 'laterality')).toBe(true);
    expect(flags.find(f => f.kind === 'laterality')!.confidence).toBeCloseTo(0.99, 6);
  });

  it('reports the lowest confidence across a multi-token match', () => {
    const transcript: Transcript = {
      tokens: [{ text: '1,5', confidence: 0.9 }, { text: 'cm', confidence: 0.4 }],
      language: 'pt-BR',
      providerId: 'p1',
    };
    expect(scanRisk(transcript)[0].confidence).toBeCloseTo(0.4, 6);
  });

  it('leaves confidence undefined when the provider reports none', () => {
    expect(scanRisk(transcribe('lesão à direita'))[0].confidence).toBeUndefined();
  });

  it('finds nothing in prose with none of the four', () => {
    expect(scanRisk(transcribe('exame realizado conforme protocolo'))).toEqual([]);
  });

  it('returns the flags in reading order', () => {
    const flags = scanRisk(transcribe('sem nódulos à direita medindo 3 mm'));
    expect(flags.map(f => f.start)).toEqual([...flags.map(f => f.start)].sort((a, b) => a - b));
  });
});

describe('speechAdapter — commands', () => {
  it('applies punctuation', () => {
    const result = applyCommands('achado normal [[ponto final]] segundo achado [[vírgula]] enfim');
    expect(result.text).toBe('achado normal. segundo achado, enfim');
    expect(result.applied).toContain('ponto final');
  });

  it('applies line and paragraph breaks', () => {
    expect(applyCommands('um [[nova linha]] dois').text).toBe('um\ndois');
    expect(applyCommands('um [[novo parágrafo]] dois').text).toBe('um\n\ndois');
  });

  // An absence is the one kind of error a reader cannot notice by reading.
  it('inserts an unrecognised command as text instead of dropping it', () => {
    const result = applyCommands('o paciente refere [[dor no ponto]] final');
    expect(result.text).toMatch(/dor no ponto/);
    expect(result.unrecognised).toEqual(['dor no ponto']);
  });

  it('leaves text with no command markers alone', () => {
    expect(applyCommands('sem marcadores aqui').text).toBe('sem marcadores aqui');
  });

  it('accepts a custom command table', () => {
    const result = applyCommands('bloco [[fim de laudo]]', [
      ...DEFAULT_COMMANDS,
      { phrase: 'fim de laudo', insert: '.' },
    ]);
    expect(result.applied).toContain('fim de laudo');
  });
});

describe('speechAdapter — joining and drafting', () => {
  it('joins tokens without a space before punctuation', () => {
    expect(joinTranscript([{ text: 'nódulo' }, { text: 'apical' }, { text: '.' }]).text).toBe(
      'nódulo apical.'
    );
  });

  it('produces a machine-origin draft with its flags', () => {
    const draft = draftFromTranscript(transcribe('sem nódulos à direita [[ponto final]]'));
    expect(draft.machineOrigin).toBe(true);
    expect(draft.flags.length).toBeGreaterThanOrEqual(2);
    expect(draft.text).toMatch(/direita\./);
  });
});

describe('speechAdapter — nothing enters the report unreviewed', () => {
  const draft = draftFromTranscript(transcribe('sem nódulo de 1,5 cm à direita'));

  it('refuses while any flag is unreviewed', () => {
    const result = acceptDictation(draft, []);
    expect(result.ok).toBe(false);
    expect(result.pending).toHaveLength(draft.flags.length);
    expect(result.reason).toMatch(/calibrada em som, não em consequência/);
  });

  // Per flag, so the reader confirms the laterality they actually said.
  it('still refuses when only some were reviewed', () => {
    const result = acceptDictation(draft, [draft.flags[0]]);
    expect(result.ok).toBe(false);
    expect(result.pending).toHaveLength(draft.flags.length - 1);
  });

  it('accepts once every flag is reviewed', () => {
    expect(acceptDictation(draft, draft.flags).ok).toBe(true);
  });

  it('accepts a draft with nothing to review', () => {
    expect(acceptDictation(draftFromTranscript(transcribe('exame de rotina')), []).ok).toBe(true);
  });
});

describe('speechAdapter — the readout', () => {
  it('counts characters, risks by class and dropped commands', () => {
    const draft = draftFromTranscript(transcribe('sem nódulo à direita [[apagar tudo]]'));
    const line = describeDraft(draft);
    expect(line).toMatch(/caractere\(s\) ditado\(s\)/);
    expect(line).toMatch(new RegExp(`1 ${RISK_LABELS.laterality}`));
    expect(line).toMatch(/não reconhecido\(s\) inserido\(s\) como texto: apagar tudo/);
  });
});
