import {
  assessPrintJob,
  checkIdentity,
  checkPresentation,
  describePrintJob,
  FILM_DIMENSIONS_MM,
  INTENT_LABELS,
  printDisclosure,
  scalePlan,
} from './printScu';

const presentation = {
  presentationLutShape: 'IDENTITY',
  displayCalibrated: true,
  printerCharacterised: true,
  windowCentre: 40,
  windowWidth: 400,
  printWindowCentre: 40,
  printWindowWidth: 400,
};

const identity = {
  patientName: 'Maria Souza',
  patientId: 'P-1',
  studyDate: '20260310',
  institution: 'RT Medical',
  burnedIn: false,
};

describe('printScu — a film that is not 1:1 invites a ruler', () => {
  it('prints true size when the anatomy fits', () => {
    const result = scalePlan({ widthMm: 200, heightMm: 300 }, '14INX17IN', 'true-size');
    expect(result.ok).toBe(true);
    expect(result.scale).toBe(1);
    expect(result.measurable).toBe(true);
    expect(result.message).toMatch(/Régua sobre este filme dá milímetros reais/);
  });

  // Consistently, plausibly, and with no way for the person holding the ruler to know.
  it('refuses true size when it does not fit rather than shrinking quietly', () => {
    const result = scalePlan({ widthMm: 400, heightMm: 500 }, '14INX17IN', 'true-size');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Encolher em silêncio produz exatamente o filme que alguém mede com régua/);
    expect(result.reason).toMatch(/quem segura a régua não tem como saber/);
  });

  it('lets rotation rescue a fit', () => {
    expect(scalePlan({ widthMm: 400, heightMm: 300 }, '14INX17IN', 'true-size').ok).toBe(false);
    expect(
      scalePlan({ widthMm: 400, heightMm: 300 }, '14INX17IN', 'true-size', { rotate: true }).ok
    ).toBe(true);
  });

  it('fits to film and says the film does not carry the scale', () => {
    const result = scalePlan({ widthMm: 400, heightMm: 500 }, '14INX17IN', 'fit-to-film');
    expect(result.ok).toBe(true);
    expect(result.scale).toBeLessThan(1);
    expect(result.measurable).toBe(false);
    expect(result.warnings.join(' ')).toMatch(/O filme não diz isso em lugar nenhum/);
  });

  it('treats a fit that happens to be 1:1 as measurable', () => {
    const sheet = FILM_DIMENSIONS_MM['14INX17IN'];
    const result = scalePlan({ widthMm: sheet.width, heightMm: sheet.height }, '14INX17IN', 'fit-to-film');
    expect(result.scale).toBeCloseTo(1, 10);
    expect(result.measurable).toBe(true);
  });

  it('refuses an unknown film and an image with no physical extent', () => {
    expect(scalePlan({ widthMm: 100, heightMm: 100 }, 'GIANT' as never, 'fit-to-film').ok).toBe(false);
    expect(scalePlan({ widthMm: 0, heightMm: 100 }, 'A4', 'fit-to-film').reason).toMatch(
      /sem ela não há escala a calcular/
    );
  });

  it('names the two intents as different requests', () => {
    expect(INTENT_LABELS['true-size']).toBe('tamanho real (1:1)');
    expect(INTENT_LABELS['fit-to-film']).toBe('ajustar ao filme');
  });
});

describe('printScu — the film and the screen are two greyscales', () => {
  it('accepts a job with a presentation LUT and matched characterisation', () => {
    const result = checkPresentation(presentation);
    expect(result.ok).toBe(true);
    expect(result.matchesDisplay).toBe(true);
  });

  // Both parties believe they are looking at the same image.
  it('refuses a job with no presentation LUT', () => {
    const result = checkPresentation({ ...presentation, presentationLutShape: undefined });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/com as duas partes acreditando que é a mesma/);
  });

  it('warns when the display or the printer is uncharacterised', () => {
    expect(checkPresentation({ ...presentation, printerCharacterised: false }).warnings.join(' ')).toMatch(
      /filme e tela não são a mesma escala de cinza/
    );
  });

  it('warns when the printed window differs from the read window', () => {
    const result = checkPresentation({ ...presentation, printWindowCentre: -600, printWindowWidth: 1500 });
    expect(result.warnings.join(' ')).toMatch(/o filme mostra outro achado que não o que foi lido/);
  });
});

describe('printScu — the film has to be attributable', () => {
  it('accepts an identified film', () => {
    expect(checkIdentity(identity).ok).toBe(true);
  });

  // A sheet with no name turns up in a folder six months later.
  it('refuses a film with no patient identity', () => {
    const result = checkIdentity({ ...identity, patientName: '', patientId: '' });
    expect(result.ok).toBe(false);
    expect(result.refusals.join(' ')).toMatch(/imagem inidentificável que vai aparecer numa pasta daqui a seis meses/);
  });

  it('warns about a missing date or institution', () => {
    expect(checkIdentity({ ...identity, studyDate: '' }).warnings.join(' ')).toMatch(/de qual estudo ele veio/);
    expect(checkIdentity({ ...identity, institution: '' }).warnings.join(' ')).toMatch(/sem instituição/);
  });

  // The trade is unavoidable and belongs to whoever asks for the print.
  it('names the cost of burning the identity in', () => {
    expect(checkIdentity({ ...identity, burnedIn: true }).warnings.join(' ')).toMatch(
      /não pode ser anonimizado depois/
    );
  });
});

describe('printScu — a printed film cannot be recalled', () => {
  it('states what printing commits to', () => {
    const note = printDisclosure({});
    expect(note.recallable).toBe(false);
    expect(note.hasDeliveryConfirmation).toBe(false);
    expect(note.message).toMatch(/uma retificação alcança quem recebeu o laudo mas não alcança um filme numa pasta/);
  });

  it('pins the film to a report version', () => {
    expect(printDisclosure({ reportVersion: 2 }).message).toMatch(/preso à versão 2 do laudo/);
  });

  // Film is an unauthenticated channel that happens to be made of plastic.
  it('says printing does not close a critical-finding loop', () => {
    expect(printDisclosure({ criticalFinding: true }).message).toMatch(
      /canal sem autenticação e sem retorno, do mesmo jeito que o WhatsApp/
    );
  });
});

describe('printScu — the whole job', () => {
  const job = {
    image: { widthMm: 200, heightMm: 300 },
    film: '14INX17IN' as const,
    intent: 'true-size' as const,
    presentation,
    identity,
    disclosure: { reportVersion: 1 },
  };

  it('passes a well-formed true-size job', () => {
    const result = assessPrintJob(job);
    expect(result.ok).toBe(true);
    expect(result.measurable).toBe(true);
    expect(result.message).toMatch(/Régua sobre este filme dá milímetros reais/);
    expect(result.message).toMatch(/não pode ser recolhido/);
  });

  it('collects every blocking problem at once', () => {
    const result = assessPrintJob({
      ...job,
      image: { widthMm: 400, heightMm: 500 },
      presentation: { ...presentation, presentationLutShape: undefined },
      identity: { ...identity, patientId: '' },
    });
    expect(result.ok).toBe(false);
    expect(result.blocking).toHaveLength(3);
  });

  it('passes a fit-to-film job but marks it unmeasurable', () => {
    const result = assessPrintJob({ ...job, image: { widthMm: 400, heightMm: 500 }, intent: 'fit-to-film' });
    expect(result.ok).toBe(true);
    expect(result.measurable).toBe(false);
    expect(describePrintJob(result)).toMatch(/O filme não diz isso em lugar nenhum/);
  });
});
