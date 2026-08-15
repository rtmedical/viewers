/**
 * Lung-RADS v2022 classification — pure core (RTV-68).
 *
 * The detection half of RTV-68 is a MONAI sidecar and is not in this repository. The half
 * that is here — and the half that decides what happens to the patient — is turning a
 * measured nodule into a category and a management recommendation.
 *
 * ## The measurement rule is part of the classification
 *
 * Lung-RADS classifies on the **mean of the long and short axis, rounded to the nearest
 * whole millimetre**. Not the long axis, not the unrounded mean. This is not a display
 * detail: a nodule measuring 7.2 × 4.1 mm has a mean of 5.65, which rounds to 6, which is
 * category 3 — a 6-month CT — while the same nodule compared unrounded stays in category
 * 2 and goes back to annual screening. {@link meanDiameterMm} rounds, and every threshold
 * below is compared against the rounded value, because that is what the standard says and
 * because the two orders disagree exactly at the boundaries where it matters.
 *
 * ## A part-solid nodule is classified by its solid component
 *
 * The total size only sets the floor. A 12 mm part-solid nodule with a 3 mm solid
 * component is 4A; the same total with a 9 mm solid component is 4B — biopsy territory.
 * Classifying part-solid nodules on total size is the single easiest way to under-call a
 * cancer here, and it is what a naive "size → category" table does.
 *
 * ## Baseline, new and growing are three different rule sets
 *
 * The same 5 mm solid nodule is category 2 at baseline and category 3 if it is new. There
 * is no safe default, and the unsafe direction is the tempting one: defaulting to baseline
 * under-calls every new nodule between 4 and 8 mm. So {@link classifyNodule} **refuses**
 * without an explicit exam context rather than assuming one.
 *
 * ## The category without its recommendation is an invitation to guess
 *
 * Nobody manages a patient from a number. Every result carries the follow-up interval and
 * the action, and the 4X modifier carries the reason it was escalated — an unexplained
 * escalation is one a reader will quietly undo.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export type LungRadsCategory = '0' | '1' | '2' | '3' | '4A' | '4B' | '4X';

export type NoduleTexture = 'solid' | 'partSolid' | 'groundGlass';

/** Where this nodule sits in the screening timeline — never inferred. */
export type ExamContext = 'baseline' | 'new' | 'existing';

/** Growth in mean diameter that Lung-RADS counts as growth. */
export const GROWTH_THRESHOLD_MM = 1.5;

export interface NoduleFinding {
  id?: string;
  texture: NoduleTexture;
  longAxisMm: number;
  shortAxisMm: number;
  /** Part-solid only: mean diameter of the solid component, in mm. */
  solidComponentMm?: number;
  context: ExamContext;
  /** Mean diameter at the prior exam, for `existing` nodules. */
  priorMeanDiameterMm?: number;
  /** Solid component at the prior exam, for part-solid `existing` nodules. */
  priorSolidComponentMm?: number;
  /** Benign calcification or fat — category 1 regardless of size. */
  benignFeatures?: boolean;
  /** Juxtapleural / perifissural, triangular, smooth. */
  perifissural?: boolean;
  endobronchial?: boolean;
  /**
   * Features that raise suspicion beyond what the size implies: spiculation, associated
   * lymphadenopathy, an enlarging solid component in a previously stable lesion.
   */
  suspiciousFeatures?: string[];
}

export interface LungRadsResult {
  category: LungRadsCategory;
  /** Malignancy likelihood band, as published. */
  risk: string;
  management: string;
  /** Follow-up in months. Null for categories with no timed follow-up. */
  followUpMonths: number | null;
  meanDiameterMm: number;
  /** Why this category, in the reader's language. */
  rationale: string;
  /** Present when 4X: what escalated it. */
  escalatedBy?: string[];
  /** Set when the input could not be classified. */
  error?: string;
}

const CATEGORY_META: Record<
  LungRadsCategory,
  { risk: string; management: string; followUpMonths: number | null }
> = {
  '0': {
    risk: 'n/a',
    management: 'Exame incompleto — comparar com exames prévios ou repetir a aquisição.',
    followUpMonths: null,
  },
  '1': {
    risk: '< 1%',
    management: 'Rastreamento anual com TC de baixa dose.',
    followUpMonths: 12,
  },
  '2': {
    risk: '< 1%',
    management: 'Rastreamento anual com TC de baixa dose.',
    followUpMonths: 12,
  },
  '3': {
    risk: '1–2%',
    management: 'TC de baixa dose em 6 meses.',
    followUpMonths: 6,
  },
  '4A': {
    risk: '5–15%',
    management: 'TC de baixa dose em 3 meses; PET/CT se componente sólido ≥ 8 mm.',
    followUpMonths: 3,
  },
  '4B': {
    risk: '> 15%',
    management: 'TC de tórax com ou sem contraste, PET/CT e/ou amostragem tecidual.',
    followUpMonths: null,
  },
  '4X': {
    risk: '> 15%',
    management: 'TC de tórax com ou sem contraste, PET/CT e/ou amostragem tecidual.',
    followUpMonths: null,
  },
};

export function categoryMeta(category: LungRadsCategory) {
  return CATEGORY_META[category];
}

/**
 * Mean of long and short axis, **rounded to the nearest whole millimetre**.
 *
 * The rounding is the standard's, not a display convenience — see the module note.
 */
export function meanDiameterMm(longAxisMm: number, shortAxisMm: number): number {
  const long = Number(longAxisMm);
  const short = Number(shortAxisMm);
  if (!Number.isFinite(long) || !Number.isFinite(short) || long <= 0 || short <= 0) {
    return 0;
  }
  return Math.round((long + short) / 2);
}

/** Whether an existing nodule grew, by the Lung-RADS definition. */
export function hasGrown(currentMeanMm: number, priorMeanMm: number | undefined): boolean {
  const current = Number(currentMeanMm);
  const prior = Number(priorMeanMm);
  if (!Number.isFinite(current) || !Number.isFinite(prior)) {
    return false;
  }
  return current - prior >= GROWTH_THRESHOLD_MM;
}

const result = (
  category: LungRadsCategory,
  meanMm: number,
  rationale: string,
  escalatedBy?: string[]
): LungRadsResult => ({
  category,
  ...CATEGORY_META[category],
  meanDiameterMm: meanMm,
  rationale,
  escalatedBy,
});

/**
 * Classifies one nodule.
 *
 * Returns category `0` with an `error` when the input is unusable — an unclassifiable
 * nodule is an incomplete exam, which is exactly what category 0 means, rather than a
 * silently benign one.
 */
export function classifyNodule(finding: NoduleFinding): LungRadsResult {
  const texture = finding?.texture;
  const context = finding?.context;
  const meanMm = meanDiameterMm(finding?.longAxisMm, finding?.shortAxisMm);

  if (!['solid', 'partSolid', 'groundGlass'].includes(texture as string)) {
    return { ...result('0', meanMm, ''), error: 'Textura do nódulo não informada.' };
  }
  if (!['baseline', 'new', 'existing'].includes(context as string)) {
    // No safe default: assuming baseline under-calls every new 4–8 mm nodule.
    return {
      ...result('0', meanMm, ''),
      error: 'Contexto do exame (baseline / novo / existente) não informado.',
    };
  }
  if (meanMm <= 0) {
    return { ...result('0', meanMm, ''), error: 'Medidas do nódulo ausentes ou inválidas.' };
  }

  if (finding.benignFeatures) {
    return result('1', meanMm, 'Calcificação benigna ou conteúdo gorduroso.');
  }

  const base = classifyByTexture(finding, meanMm);

  // 4X sits on top of 3 / 4A / 4B, never on 1 or 2: escalating a definitely-benign
  // nodule because it looks spiculated is a contradiction the reader should resolve, not
  // something the table should paper over.
  const features = (finding.suspiciousFeatures ?? []).filter(Boolean);
  if (features.length && ['3', '4A', '4B'].includes(base.category)) {
    return {
      ...result('4X', meanMm, `${base.rationale} Escalonado por achados adicionais.`, features),
    };
  }
  return base;
}

function classifyByTexture(finding: NoduleFinding, meanMm: number): LungRadsResult {
  if (finding.endobronchial) {
    return result('4A', meanMm, 'Nódulo endobrônquico.');
  }
  switch (finding.texture) {
    case 'solid':
      return classifySolid(finding, meanMm);
    case 'partSolid':
      return classifyPartSolid(finding, meanMm);
    default:
      return classifyGroundGlass(finding, meanMm);
  }
}

function classifySolid(finding: NoduleFinding, meanMm: number): LungRadsResult {
  // Perifissural nodules are intrapulmonary lymph nodes below 10 mm.
  if (finding.perifissural && meanMm < 10) {
    return result('2', meanMm, 'Nódulo perifissural < 10 mm — linfonodo intrapulmonar.');
  }

  if (finding.context === 'new') {
    if (meanMm < 4) {
      return result('2', meanMm, `Novo nódulo sólido de ${meanMm} mm (< 4 mm).`);
    }
    if (meanMm < 6) {
      return result('3', meanMm, `Novo nódulo sólido de ${meanMm} mm (4 a < 6 mm).`);
    }
    if (meanMm < 8) {
      return result('4A', meanMm, `Novo nódulo sólido de ${meanMm} mm (6 a < 8 mm).`);
    }
    return result('4B', meanMm, `Novo nódulo sólido de ${meanMm} mm (≥ 8 mm).`);
  }

  if (finding.context === 'existing' && hasGrown(meanMm, finding.priorMeanDiameterMm)) {
    return meanMm < 8
      ? result('4A', meanMm, `Nódulo sólido em crescimento, agora ${meanMm} mm (< 8 mm).`)
      : result('4B', meanMm, `Nódulo sólido em crescimento, agora ${meanMm} mm (≥ 8 mm).`);
  }

  // Baseline, and existing-but-stable, share the size bands.
  if (meanMm < 6) {
    return result('2', meanMm, `Nódulo sólido de ${meanMm} mm (< 6 mm).`);
  }
  if (meanMm < 8) {
    return result('3', meanMm, `Nódulo sólido de ${meanMm} mm (6 a < 8 mm).`);
  }
  if (meanMm < 15) {
    return result('4A', meanMm, `Nódulo sólido de ${meanMm} mm (8 a < 15 mm).`);
  }
  return result('4B', meanMm, `Nódulo sólido de ${meanMm} mm (≥ 15 mm).`);
}

/**
 * Part-solid: the **solid component** drives 4A and 4B; the total size only sets the
 * floor. See the module note — classifying these on total size is how a cancer gets
 * under-called.
 */
function classifyPartSolid(finding: NoduleFinding, meanMm: number): LungRadsResult {
  const solid = Number(finding.solidComponentMm);
  const hasSolid = Number.isFinite(solid) && solid > 0;

  if (meanMm < 6) {
    return result('2', meanMm, `Nódulo parcialmente sólido de ${meanMm} mm no total (< 6 mm).`);
  }

  if (!hasSolid) {
    return {
      ...result('0', meanMm, ''),
      error:
        'Nódulo parcialmente sólido ≥ 6 mm sem medida do componente sólido — a categoria depende dele.',
    };
  }

  const grewSolid =
    finding.context === 'existing' && hasGrown(solid, finding.priorSolidComponentMm);
  if (grewSolid) {
    return solid < 4
      ? result('4A', meanMm, `Componente sólido em crescimento (${solid} mm, < 4 mm).`)
      : result('4B', meanMm, `Componente sólido em crescimento (${solid} mm, ≥ 4 mm).`);
  }

  if (solid < 6) {
    return result(
      '3',
      meanMm,
      `Parcialmente sólido de ${meanMm} mm com componente sólido de ${solid} mm (< 6 mm).`
    );
  }
  if (solid < 8) {
    return result(
      '4A',
      meanMm,
      `Parcialmente sólido de ${meanMm} mm com componente sólido de ${solid} mm (6 a < 8 mm).`
    );
  }
  return result(
    '4B',
    meanMm,
    `Parcialmente sólido de ${meanMm} mm com componente sólido de ${solid} mm (≥ 8 mm).`
  );
}

function classifyGroundGlass(finding: NoduleFinding, meanMm: number): LungRadsResult {
  if (meanMm < 30) {
    return result('2', meanMm, `Nódulo em vidro fosco de ${meanMm} mm (< 30 mm).`);
  }
  if (finding.context === 'existing' && !hasGrown(meanMm, finding.priorMeanDiameterMm)) {
    return result('2', meanMm, `Vidro fosco de ${meanMm} mm estável.`);
  }
  return result('3', meanMm, `Vidro fosco de ${meanMm} mm (≥ 30 mm, novo ou no baseline).`);
}

const CATEGORY_RANK: Record<LungRadsCategory, number> = {
  '0': 0,
  '1': 1,
  '2': 2,
  '3': 3,
  '4A': 4,
  '4B': 5,
  '4X': 6,
};

export interface ExamAssessment {
  category: LungRadsCategory;
  risk: string;
  management: string;
  followUpMonths: number | null;
  /** The nodule that set the category. */
  drivingNoduleId?: string;
  rationale: string;
  /** Per-nodule results, in input order. */
  nodules: LungRadsResult[];
  /** Appended to the category, e.g. '4B-S'. */
  modifiers: string[];
  /** Nodules that could not be classified. */
  errors: string[];
}

export interface ExamOptions {
  /** Part of the lung not evaluated, or a prior is needed — forces category 0. */
  incomplete?: boolean;
  /** 'S': clinically significant or potentially significant non-lung-cancer finding. */
  significantOtherFinding?: boolean;
  /** 'C': prior diagnosis of lung cancer returning to screening. */
  priorLungCancer?: boolean;
}

/**
 * The exam category: the **most suspicious nodule wins**.
 *
 * Category 0 is not part of that maximum — it is an override, because "I could not see
 * part of the lung" outranks anything I did see. A 4B in an incomplete exam is still 4B
 * for that nodule, and the code keeps the per-nodule results so the reader can see it,
 * but the exam cannot be reported as complete.
 */
export function assessExam(
  findings: NoduleFinding[],
  options: ExamOptions = {}
): ExamAssessment {
  const nodules = (findings ?? []).map(classifyNodule);
  const errors = nodules.filter(n => n.error).map(n => n.error as string);
  const modifiers: string[] = [];
  if (options.significantOtherFinding) {
    modifiers.push('S');
  }
  if (options.priorLungCancer) {
    modifiers.push('C');
  }

  if (options.incomplete) {
    return {
      ...CATEGORY_META['0'],
      category: '0',
      rationale: 'Exame incompleto.',
      nodules,
      modifiers,
      errors,
    };
  }

  if (errors.length) {
    return {
      ...CATEGORY_META['0'],
      category: '0',
      rationale: 'Há nódulos que não puderam ser classificados.',
      nodules,
      modifiers,
      errors,
    };
  }

  if (!nodules.length) {
    return {
      ...CATEGORY_META['1'],
      category: '1',
      rationale: 'Sem nódulos.',
      nodules,
      modifiers,
      errors,
    };
  }

  let winner = nodules[0];
  let winnerIndex = 0;
  for (let i = 1; i < nodules.length; i++) {
    if (CATEGORY_RANK[nodules[i].category] > CATEGORY_RANK[winner.category]) {
      winner = nodules[i];
      winnerIndex = i;
    }
  }

  return {
    ...CATEGORY_META[winner.category],
    category: winner.category,
    drivingNoduleId: findings?.[winnerIndex]?.id,
    rationale: winner.rationale,
    nodules,
    modifiers,
    errors,
  };
}

/** 'Lung-RADS 4B-S' — the category as it is written in a report. */
export function formatCategory(assessment: ExamAssessment): string {
  if (!assessment) {
    return '';
  }
  const suffix = assessment.modifiers.length ? `-${assessment.modifiers.join('')}` : '';
  return `Lung-RADS ${assessment.category}${suffix}`;
}

/** The full line: category, risk band and what to do about it. */
export function describeAssessment(assessment: ExamAssessment): string {
  if (!assessment) {
    return '';
  }
  return `${formatCategory(assessment)} (risco ${assessment.risk}) — ${assessment.management}`;
}
