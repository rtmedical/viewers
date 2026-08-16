/**
 * The coronary segment model — pure core (RTV-49).
 *
 * `cadRads.ts` (RTV-50) grades a stenosis. This is the map it grades against: which
 * segments exist, which artery each belongs to, which myocardium each feeds, and where a
 * measurement stops meaning anything.
 *
 * ## A segment number without a model is ambiguous
 *
 * "Segment 4" is the right posterior descending artery in the SCCT 18-segment model and
 * the distal right coronary in the older AHA 15-segment one. Two different vessels, one
 * label, and nothing in a report that carries only the number says which was meant. A
 * comparison across two studies reported under different models silently compares two
 * arteries. {@link SEGMENT_MODELS} makes the model part of the reference.
 *
 * ## Dominance decides which artery owns the posterior descending
 *
 * In right dominance the PDA comes off the right coronary; in left dominance off the
 * circumflex. The territory it feeds — the inferior wall — is the same either way, which is
 * exactly why the mistake is easy: the report reads plausibly and attributes the lesion to
 * the wrong vessel. When a stress test later shows inferior ischaemia, the two studies
 * appear to disagree.
 *
 * ## A stenosis distal to an occlusion is not a stenosis
 *
 * Beyond a total occlusion the vessel fills through collaterals, at low pressure, and it
 * collapses. Measuring a percentage there compares a narrow lumen against a reference that
 * has shrunk with it — the same failure the carotid near-occlusion has in
 * `carotidStenosis.ts` (RTV-54), and it produces the same reassuringly moderate number for
 * the worst vessel in the study. {@link assessSegmentContext} refuses.
 *
 * ## Below a calibre, a percentage is noise that generates a test
 *
 * A severe stenosis in a one-millimetre distal branch is not revascularisable and is at the
 * limit of what CT resolves. Reporting it is not conservative — it produces a downstream
 * investigation for a finding that could not have been measured.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export type SegmentModel = 'scct-18' | 'aha-15';

export const SEGMENT_MODELS: Record<SegmentModel, string> = {
  'scct-18': 'SCCT 18 segmentos',
  'aha-15': 'AHA 15 segmentos',
};

export type Vessel = 'rca' | 'lm' | 'lad' | 'lcx' | 'ramus';

export const VESSEL_LABELS: Record<Vessel, string> = {
  rca: 'coronária direita',
  lm: 'tronco da coronária esquerda',
  lad: 'descendente anterior',
  lcx: 'circunflexa',
  ramus: 'ramo intermédio',
};

export type Territory = 'anterior' | 'septal' | 'apical' | 'lateral' | 'inferior' | 'left-main';

export const TERRITORY_LABELS: Record<Territory, string> = {
  anterior: 'parede anterior',
  septal: 'septo',
  apical: 'ápice',
  lateral: 'parede lateral',
  inferior: 'parede inferior',
  'left-main': 'território do tronco',
};

export type Dominance = 'right' | 'left' | 'codominant';

export const DOMINANCE_LABELS: Record<Dominance, string> = {
  right: 'dominância direita',
  left: 'dominância esquerda',
  codominant: 'codominância',
};

export interface CoronarySegment {
  /** SCCT number. */
  id: number;
  name: string;
  vessel: Vessel;
  /** Segment that feeds this one, when there is one. */
  parent?: number;
  territory: Territory;
  /**
   * Dominance patterns in which the segment exists.
   *
   * The posterior descending and posterolateral branches only exist on the dominant side.
   */
  presentIn: Dominance[];
}

const ALL: Dominance[] = ['right', 'left', 'codominant'];

/** The SCCT 18-segment model. */
export const SCCT_SEGMENTS: CoronarySegment[] = [
  { id: 1, name: 'CD proximal', vessel: 'rca', territory: 'inferior', presentIn: ALL },
  { id: 2, name: 'CD média', vessel: 'rca', parent: 1, territory: 'inferior', presentIn: ALL },
  { id: 3, name: 'CD distal', vessel: 'rca', parent: 2, territory: 'inferior', presentIn: ALL },
  { id: 4, name: 'Descendente posterior direita', vessel: 'rca', parent: 3, territory: 'inferior', presentIn: ['right', 'codominant'] },
  { id: 5, name: 'Tronco da coronária esquerda', vessel: 'lm', territory: 'left-main', presentIn: ALL },
  { id: 6, name: 'DA proximal', vessel: 'lad', parent: 5, territory: 'anterior', presentIn: ALL },
  { id: 7, name: 'DA média', vessel: 'lad', parent: 6, territory: 'anterior', presentIn: ALL },
  { id: 8, name: 'DA distal', vessel: 'lad', parent: 7, territory: 'apical', presentIn: ALL },
  { id: 9, name: 'Primeira diagonal', vessel: 'lad', parent: 6, territory: 'anterior', presentIn: ALL },
  { id: 10, name: 'Segunda diagonal', vessel: 'lad', parent: 7, territory: 'anterior', presentIn: ALL },
  { id: 11, name: 'Circunflexa proximal', vessel: 'lcx', parent: 5, territory: 'lateral', presentIn: ALL },
  { id: 12, name: 'Primeira marginal obtusa', vessel: 'lcx', parent: 11, territory: 'lateral', presentIn: ALL },
  { id: 13, name: 'Circunflexa média-distal', vessel: 'lcx', parent: 11, territory: 'lateral', presentIn: ALL },
  { id: 14, name: 'Segunda marginal obtusa', vessel: 'lcx', parent: 13, territory: 'lateral', presentIn: ALL },
  { id: 15, name: 'Descendente posterior esquerda', vessel: 'lcx', parent: 13, territory: 'inferior', presentIn: ['left', 'codominant'] },
  { id: 16, name: 'Póstero-lateral direita', vessel: 'rca', parent: 3, territory: 'inferior', presentIn: ['right', 'codominant'] },
  { id: 17, name: 'Ramo intermédio', vessel: 'ramus', parent: 5, territory: 'lateral', presentIn: ALL },
  { id: 18, name: 'Póstero-lateral esquerda', vessel: 'lcx', parent: 13, territory: 'lateral', presentIn: ['left', 'codominant'] },
];

/**
 * Segment numbers whose meaning differs between the two models.
 *
 * Kept as data rather than prose because a comparison across studies is the moment the
 * ambiguity does damage, and a comparison is code.
 */
export const MODEL_CONFLICTS: Record<number, { scct: string; aha: string }> = {
  4: { scct: 'Descendente posterior direita', aha: 'CD distal' },
  15: { scct: 'Descendente posterior esquerda', aha: 'não existe' },
  16: { scct: 'Póstero-lateral direita', aha: 'não existe' },
  17: { scct: 'Ramo intermédio', aha: 'não existe' },
  18: { scct: 'Póstero-lateral esquerda', aha: 'não existe' },
};

/** SCCT minimum assessable diameter, millimetres. */
export const MIN_ASSESSABLE_MM = 1.5;

export function findSegment(id: number): CoronarySegment | undefined {
  return SCCT_SEGMENTS.find(s => s.id === Number(id));
}

/** Segments that exist under a given dominance. */
export function segmentsFor(dominance: Dominance): CoronarySegment[] {
  return SCCT_SEGMENTS.filter(s => s.presentIn.includes(dominance));
}

/** The chain from a segment back to its ostium, nearest first. */
export function parentChain(id: number): CoronarySegment[] {
  const chain: CoronarySegment[] = [];
  let current = findSegment(id);
  const seen = new Set<number>();
  while (current?.parent !== undefined && !seen.has(current.parent)) {
    seen.add(current.parent);
    const parent = findSegment(current.parent);
    if (!parent) {
      break;
    }
    chain.push(parent);
    current = parent;
  }
  return chain;
}

export interface ModelCheck {
  ambiguous: boolean;
  message: string;
}

/**
 * Whether a bare segment number is safe to carry between studies.
 *
 * A report holding only "segment 4" describes the right posterior descending under one
 * model and the distal right coronary under the other, and a comparison across the two
 * silently compares two arteries.
 */
export function checkModelAmbiguity(id: number, model: SegmentModel): ModelCheck {
  const conflict = MODEL_CONFLICTS[Number(id)];
  if (!conflict) {
    return { ambiguous: false, message: '' };
  }
  return {
    ambiguous: true,
    message:
      `Segmento ${id} é "${conflict.scct}" no ${SEGMENT_MODELS['scct-18']} e "${conflict.aha}" no ${SEGMENT_MODELS['aha-15']}. ` +
      `Este laudo usa ${SEGMENT_MODELS[model]} — sem o modelo registrado, uma comparação entre exames compara duas artérias diferentes.`,
  };
}

export interface TerritoryResult {
  territory: Territory;
  vessel: Vessel;
  message: string;
}

/**
 * Which myocardium a segment feeds, given the dominance.
 *
 * The territory of the posterior descending is the inferior wall whichever artery it comes
 * off, which is why attributing it to the wrong vessel reads plausibly — and then a stress
 * test showing inferior ischaemia appears to disagree with the angiogram.
 */
export function territoryOf(id: number, dominance: Dominance): TerritoryResult | null {
  const segment = findSegment(id);
  if (!segment) {
    return null;
  }
  const present = segment.presentIn.includes(dominance);
  const isPda = id === 4 || id === 15;

  return {
    territory: segment.territory,
    vessel: segment.vessel,
    message: present
      ? isPda
        ? `${segment.name} irriga a ${TERRITORY_LABELS[segment.territory]} e nasce da ${VESSEL_LABELS[segment.vessel]} nesta ${DOMINANCE_LABELS[dominance]}.`
        : ''
      : `${segment.name} não existe em ${DOMINANCE_LABELS[dominance]} — o território inferior vem do outro lado.`,
  };
}

export interface SegmentContext {
  id: number;
  /** Reference diameter of the segment, millimetres. */
  diameterMm?: number;
  /** Segments that are totally occluded in this study. */
  occludedSegments?: number[];
  dominance: Dominance;
  model: SegmentModel;
}

export interface ContextAssessment {
  /** Whether a percentage stenosis in this segment means anything. */
  reportable: boolean;
  /** Whether the segment exists at all under this dominance. */
  exists: boolean;
  refusals: string[];
  warnings: string[];
  message: string;
}

/**
 * Whether a stenosis measurement in this segment is worth reporting.
 *
 * Two refusals and one warning, and the first refusal is the one that matters: distal to a
 * total occlusion the reference vessel has collapsed along with the lumen, so the
 * percentage falls for the worst vessel in the study.
 */
export function assessSegmentContext(context: SegmentContext): ContextAssessment {
  const segment = findSegment(context?.id);
  const refusals: string[] = [];
  const warnings: string[] = [];

  if (!segment) {
    return {
      reportable: false,
      exists: false,
      refusals: [`Segmento ${context?.id} não existe no ${SEGMENT_MODELS['scct-18']}.`],
      warnings,
      message: `Segmento ${context?.id} desconhecido.`,
    };
  }

  const exists = segment.presentIn.includes(context.dominance);
  if (!exists) {
    refusals.push(
      `${segment.name} não existe em ${DOMINANCE_LABELS[context.dominance]}.`
    );
  }

  const occluded = new Set((context.occludedSegments ?? []).map(Number));
  const upstream = parentChain(context.id).filter(p => occluded.has(p.id));
  if (occluded.has(context.id)) {
    warnings.push(`${segment.name} está ocluído — oclusão total, não uma porcentagem.`);
  } else if (upstream.length) {
    refusals.push(
      `${segment.name} está distal a uma oclusão total em ${upstream.map(u => u.name).join(', ')}. ` +
        'Além de uma oclusão o vaso enche por colaterais, a baixa pressão, e colaba: medir porcentagem ali compara uma luz estreita ' +
        'com uma referência que encolheu junto. É a mesma falha da quase-oclusão carotídea, e produz o mesmo número tranquilizadoramente ' +
        'moderado para o pior vaso do exame.'
    );
  }

  const diameter = Number(context.diameterMm);
  if (Number.isFinite(diameter) && diameter < MIN_ASSESSABLE_MM) {
    refusals.push(
      `Calibre de referência de ${diameter.toFixed(1)} mm, abaixo de ${MIN_ASSESSABLE_MM} mm. ` +
        'Uma estenose grave num ramo de um milímetro não é revascularizável e está no limite do que a TC resolve — ' +
        'reportá-la não é conservador, gera uma investigação a jusante para um achado que não podia ser medido.'
    );
  }

  const ambiguity = checkModelAmbiguity(context.id, context.model);
  if (ambiguity.ambiguous) {
    warnings.push(ambiguity.message);
  }

  const reportable = refusals.length === 0;
  return {
    reportable,
    exists,
    refusals,
    warnings,
    message: reportable
      ? `${segment.name} (${VESSEL_LABELS[segment.vessel]}, ${TERRITORY_LABELS[segment.territory]}) — mensurável.`
      : refusals.join(' '),
  };
}

export interface CoverageReport {
  assessed: number[];
  notEvaluable: number[];
  missing: number[];
  complete: boolean;
  message: string;
}

/**
 * Which segments the study actually spoke about.
 *
 * A segment left out of the report is not a normal segment. `cadRads.ts` already has the N
 * modifier for one that was looked at and could not be read; this is the other case, where
 * nobody said anything at all.
 */
export function coverage(
  dominance: Dominance,
  assessed: number[],
  notEvaluable: number[] = []
): CoverageReport {
  const expected = segmentsFor(dominance).map(s => s.id);
  const seen = new Set([...(assessed ?? []), ...(notEvaluable ?? [])].map(Number));
  const missing = expected.filter(id => !seen.has(id));

  return {
    assessed: (assessed ?? []).map(Number),
    notEvaluable: (notEvaluable ?? []).map(Number),
    missing,
    complete: missing.length === 0,
    message: missing.length
      ? `${missing.length} segmento(s) sem menção: ${missing.map(id => findSegment(id)?.name ?? id).join(', ')}. ` +
        'Segmento omitido do laudo não é segmento normal — quem lê depois não tem como distinguir "sem lesão" de "não olhado".'
      : `Todos os ${expected.length} segmentos de ${DOMINANCE_LABELS[dominance]} foram mencionados.`,
  };
}

/** One line per segment for the coronary panel. */
export function describeSegment(context: SegmentContext): string {
  const assessment = assessSegmentContext(context);
  const warnings = assessment.warnings.length ? ` ${assessment.warnings.join(' ')}` : '';
  return `${assessment.message}${warnings}`;
}
