import {
  CORRECTION_REASONS,
  Course,
  correctedTotal,
  CourseContext,
  DERIVED_LABELS,
  describeCourseContext,
  DoseCorrection,
  initialContext,
  INTENT_LABELS,
  recordDoseCorrection,
  reloadPatient,
  resolveActiveCourse,
  staleDerivations,
  switchCourse,
} from './courseContext';

const T0 = new Date('2026-03-01T09:00:00Z').getTime();
const DAY = 86_400_000;

const course = (over: Partial<Course> = {}): Course => ({
  courseId: 'C-1',
  patientId: 'P-1',
  label: 'Curso 1',
  intent: 'curative',
  site: 'Próstata',
  startedAt: T0 - 30 * DAY,
  ...over,
});

const contextWith = (courseId: string, derivedFor: string): CourseContext => ({
  ...initialContext('P-1', T0),
  courseId,
  derived: {
    'cumulative-dose': { courseId: derivedFor, computedAt: T0 },
    dvh: { courseId: derivedFor, computedAt: T0 },
  },
});

describe('courseContext — a patient can have more than one course open', () => {
  it('picks the single open course', () => {
    const result = resolveActiveCourse([course(), course({ courseId: 'C-0', completedAt: T0 - DAY })], 'P-1');
    expect(result.ok).toBe(true);
    expect(result.course!.courseId).toBe('C-1');
  });

  // Arbitrary is worse than absent because it looks decided.
  it('refuses to choose between two open courses', () => {
    const result = resolveActiveCourse(
      [course(), course({ courseId: 'C-2', site: 'Mama esquerda', intent: 'palliative' })],
      'P-1'
    );
    expect(result.ok).toBe(false);
    expect(result.course).toBeNull();
    expect(result.candidates).toHaveLength(2);
    expect(result.message).toMatch(/arbitrário é pior que ausente porque parece decidido/);
  });

  it('names the sites and intents so the two can be told apart', () => {
    const result = resolveActiveCourse(
      [course(), course({ courseId: 'C-2', site: 'Mama esquerda', intent: 'palliative' })],
      'P-1'
    );
    expect(result.message).toMatch(/Próstata/);
    expect(result.message).toMatch(new RegExp(INTENT_LABELS.palliative));
  });

  it('asks for an explicit choice when every course is closed', () => {
    const result = resolveActiveCourse([course({ completedAt: T0 - DAY })], 'P-1');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/escolha explicitamente qual revisar/);
  });

  it('says so for a patient with no course, and ignores other patients', () => {
    expect(resolveActiveCourse([], 'P-1').message).toMatch(/sem curso registrado/);
    expect(resolveActiveCourse([course({ patientId: 'P-9' })], 'P-1').ok).toBe(false);
  });
});

describe('courseContext — switching course clears what was derived from the old one', () => {
  // A cumulative dose of 50 Gy is plausible for either course, so no value can be inspected
  // and kept.
  it('drops every derived value that belonged to the previous course', () => {
    const result = switchCourse(contextWith('C-1', 'C-1'), 'C-2', T0 + 1000);
    expect(result.dropped.sort()).toEqual(['cumulative-dose', 'dvh']);
    expect(result.context.derived).toEqual({});
    expect(result.context.courseId).toBe('C-2');
  });

  it('keeps a derived value that already belonged to the target course', () => {
    const result = switchCourse(contextWith('C-1', 'C-2'), 'C-2', T0 + 1000);
    expect(result.dropped).toEqual([]);
    expect(result.context.derived['cumulative-dose']).toBeDefined();
  });

  it('is a no-op on an empty context', () => {
    const result = switchCourse(initialContext('P-1', T0), 'C-1', T0);
    expect(result.dropped).toEqual([]);
  });
});

describe('courseContext — a panel that cached its own number is where this survives', () => {
  it('names a derived value that belongs to another course', () => {
    const stale = staleDerivations(contextWith('C-2', 'C-1'));
    expect(stale.map(s => s.kind).sort()).toEqual(['cumulative-dose', 'dvh']);
    expect(stale[0].message).toMatch(/É um número correto sobre outro tratamento, e nada nele parece velho/);
  });

  it('is quiet when everything belongs to the current course', () => {
    expect(staleDerivations(contextWith('C-1', 'C-1'))).toEqual([]);
  });

  it('labels each kind for the message', () => {
    expect(DERIVED_LABELS['cumulative-dose']).toBe('dose acumulada');
    expect(DERIVED_LABELS.dvh).toBe('DVH');
  });
});

describe('courseContext — reload', () => {
  it('reloads and clears the derived values', () => {
    const result = reloadPatient(contextWith('C-1', 'C-1'), { at: T0 + 1000 });
    expect(result.ok).toBe(true);
    expect(result.context.derived).toEqual({});
    expect(result.context.loadedAt).toBe(T0 + 1000);
  });

  // A discard that looks successful is how the same note gets written twice, differently.
  it('refuses while there is unsaved work', () => {
    const result = reloadPatient(contextWith('C-1', 'C-1'), {
      at: T0,
      unsavedWork: ['laudo em rascunho'],
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/escrita duas vezes, diferente/);
  });

  it('discards on an explicit force and says how much it dropped', () => {
    const result = reloadPatient(contextWith('C-1', 'C-1'), {
      at: T0,
      unsavedWork: ['laudo em rascunho', 'medida não salva'],
      force: true,
    });
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/descartando 2 item\(ns\) não salvo\(s\), a pedido explícito/);
  });
});

describe('courseContext — a dose correction is a separate attributable entry', () => {
  const base = {
    id: 'DC-1',
    courseId: 'C-1',
    referencePointId: 'RP-PRESC',
    referencePointName: 'Ponto de prescrição',
    deltaGy: 2,
    reason: 'accounting-error' as const,
    enteredBy: 'fis.costa',
    authorisedBy: 'dr.souza',
    at: T0,
    currentCumulativeGy: 48,
  };

  it('records the correction and what it does to the total', () => {
    const result = recordDoseCorrection(base);
    expect(result.ok).toBe(true);
    expect(result.impact).toEqual({ beforeGy: 48, afterGy: 50, deltaGy: 2 });
    expect(result.message).toMatch(/passa de 48\.00 para 50\.00 Gy/);
  });

  it('accepts a negative correction for dose counted twice', () => {
    const result = recordDoseCorrection({ ...base, deltaGy: -2 });
    expect(result.impact!.afterGy).toBeCloseTo(46, 6);
  });

  // Adding to "the dose" silently picks one of two different quantities.
  it('refuses a correction with no reference point', () => {
    const result = recordDoseCorrection({ ...base, referencePointId: '' });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/somar "à dose" escolhe uma em silêncio/);
  });

  // The number decides whether the prescription is complete.
  it('requires an authoriser, and not the same person who entered it', () => {
    expect(recordDoseCorrection({ ...base, authorisedBy: '' }).reason).toMatch(
      /decidir se a prescrição está completa/
    );
    expect(recordDoseCorrection({ ...base, authorisedBy: 'FIS.COSTA' }).ok).toBe(false);
  });

  it('refuses a zero correction, a missing reason and a missing course', () => {
    expect(recordDoseCorrection({ ...base, deltaGy: 0 }).ok).toBe(false);
    expect(recordDoseCorrection({ ...base, reason: 'porque' as never }).ok).toBe(false);
    expect(recordDoseCorrection({ ...base, courseId: '' }).ok).toBe(false);
  });

  it('refuses when the current cumulative dose is unknown', () => {
    const result = recordDoseCorrection({ ...base, currentCumulativeGy: NaN });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/não pode mostrar o que faz ao total/);
  });

  it('offers a closed list of reasons', () => {
    expect(Object.keys(CORRECTION_REASONS)).toContain('external-treatment');
    expect(CORRECTION_REASONS['machine-record-missing']).toMatch(/reconstruído/);
  });
});

describe('courseContext — corrections stay visible in the total', () => {
  const corrections = [
    recordDoseCorrection({
      id: 'DC-1',
      courseId: 'C-1',
      referencePointId: 'RP-PRESC',
      referencePointName: 'Ponto de prescrição',
      deltaGy: 2,
      reason: 'accounting-error',
      enteredBy: 'a',
      authorisedBy: 'b',
      at: T0,
      currentCumulativeGy: 48,
    }).correction as DoseCorrection,
    recordDoseCorrection({
      id: 'DC-2',
      courseId: 'C-1',
      referencePointId: 'RP-OAR',
      referencePointName: 'Reto',
      deltaGy: -1,
      reason: 'transcription-error',
      enteredBy: 'a',
      authorisedBy: 'b',
      at: T0,
      currentCumulativeGy: 30,
    }).correction as DoseCorrection,
  ];

  // A folded correction produces a number nobody can reconcile against the records.
  it('reports the correction apart from the delivered dose', () => {
    const total = correctedTotal(48, corrections, 'RP-PRESC');
    expect(total.deliveredGy).toBe(48);
    expect(total.correctionGy).toBeCloseTo(2, 6);
    expect(total.totalGy).toBeCloseTo(50, 6);
    expect(total.message).toMatch(/ninguém consegue reconciliar contra os registros de tratamento/);
  });

  it('only applies corrections for the reference point asked about', () => {
    expect(correctedTotal(30, corrections, 'RP-OAR').correctionGy).toBeCloseTo(-1, 6);
  });

  it('says so when there are no corrections', () => {
    expect(correctedTotal(48, [], 'RP-PRESC').message).toMatch(/sem correções/);
  });
});

describe('courseContext — the header line', () => {
  it('names the course, the site and the intent', () => {
    const context = contextWith('C-1', 'C-1');
    expect(describeCourseContext(context, [course()])).toBe('Curso 1 — Próstata, curativo.');
  });

  it('appends a stale derivation', () => {
    const line = describeCourseContext(contextWith('C-2', 'C-1'), [course({ courseId: 'C-2' })]);
    expect(line).toMatch(/nada nele parece velho/);
  });

  it('says when no course is selected', () => {
    expect(describeCourseContext(initialContext('P-1', T0), [])).toBe('Nenhum curso selecionado.');
  });
});
