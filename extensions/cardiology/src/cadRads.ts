/**
 * Coronary stenosis and CAD-RADS 2.0 — pure core (RTV-50).
 *
 * Turning a measured coronary narrowing into a category and a recommendation. The
 * measurement is a ratio of two diameters; the category is a lookup table. Three things
 * between them decide whether the answer is right.
 *
 * ## Diameter stenosis and area stenosis differ by a square
 *
 * A 50% **diameter** stenosis is a 75% **area** stenosis. CAD-RADS is defined on diameter,
 * and quoting an area reduction into a diameter table moves the patient up two categories —
 * from "mild, no further testing" to "severe, consider invasive angiography".
 *
 * The two are one line apart in code and indistinguishable once they are a bare number, so
 * {@link StenosisMeasurement} carries which one it is and {@link diameterStenosis}
 * converts rather than assuming.
 *
 * ## The reference diameter is a choice, and it changes the answer
 *
 * Percent stenosis is `1 − minimal / reference`, and "reference" can be the proximal
 * segment, the distal segment, or an interpolation between them. In a diffusely diseased
 * vessel the proximal reference is itself narrowed, and using it **under-reports** the
 * stenosis — in exactly the patients with the most disease.
 *
 * The choice is recorded, and a proximal-only reference in a diffusely diseased vessel is
 * flagged.
 *
 * ## Calcium blooming inflates stenosis, and the honest answer is often "cannot say"
 *
 * Dense calcium blooms on CT and makes a lumen look narrower than it is. Past a certain
 * burden the segment is simply not assessable, and CAD-RADS has a letter for that: **N**.
 * Reporting a confident 70% through a heavily calcified segment is the characteristic CTA
 * error, and it sends patients to catheterisation.
 *
 * {@link assessSegment} returns `nonDiagnostic` rather than a percentage when the
 * calcification says so — a refusal that is itself the clinically correct output.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export type StenosisBasis = 'diameter' | 'area';

export type CadRadsCategory = '0' | '1' | '2' | '3' | '4A' | '4B' | '5' | 'N';

export type CadRadsModifier = 'N' | 'S' | 'G' | 'V' | 'E' | 'HRP';

/** Agatston-like per-segment calcification grade. */
export type CalcificationGrade = 'none' | 'mild' | 'moderate' | 'severe';

/** Above this grade a segment is not assessable by CTA. */
export const NON_DIAGNOSTIC_CALCIFICATION: CalcificationGrade = 'severe';

export interface StenosisMeasurement {
  /** Narrowest lumen dimension. */
  minimal: number;
  /** Reference dimension at the same basis. */
  reference: number;
  /** Whether these are diameters or areas — see the module note. */
  basis: StenosisBasis;
}

export type ReferenceChoice = 'proximal' | 'distal' | 'interpolated' | 'unrecorded';

/**
 * Percent **diameter** stenosis, converting from area when needed.
 *
 * `1 − d_min/d_ref` for diameter; for area the diameters are the square roots, so the
 * conversion is `1 − sqrt(a_min/a_ref)`. Doing it the other way — treating an area ratio as
 * a diameter ratio — is the two-category error described in the module note.
 */
export function diameterStenosis(measurement: StenosisMeasurement): number {
  const minimal = Number(measurement?.minimal);
  const reference = Number(measurement?.reference);
  if (!Number.isFinite(minimal) || !Number.isFinite(reference) || reference <= 0 || minimal < 0) {
    return NaN;
  }
  const ratio = Math.min(1, minimal / reference);
  const diameterRatio = measurement.basis === 'area' ? Math.sqrt(ratio) : ratio;
  return 1 - diameterRatio;
}

/** The area stenosis a given diameter stenosis corresponds to. For the report, not the table. */
export function areaStenosisFromDiameter(diameterFraction: number): number {
  const d = Number(diameterFraction);
  if (!Number.isFinite(d) || d < 0 || d > 1) {
    return NaN;
  }
  return 1 - (1 - d) ** 2;
}

export interface SegmentInput {
  segmentId: string;
  measurement: StenosisMeasurement;
  calcification: CalcificationGrade;
  referenceChoice?: ReferenceChoice;
  /** True when the vessel is diffusely diseased, so a proximal reference is suspect. */
  diffuseDisease?: boolean;
  /** Stented segment — the stent, not the vessel, may be the limiting factor. */
  stented?: boolean;
  /** Bypass graft. */
  graft?: boolean;
  /** High-risk plaque features: low attenuation, positive remodelling, napkin-ring, spotty calcium. */
  highRiskPlaque?: boolean;
  /** Total occlusion — no distal opacification. */
  occluded?: boolean;
}

export interface SegmentAssessment {
  segmentId: string;
  /** Percent diameter stenosis, 0..1. Null when non-diagnostic. */
  stenosis: number | null;
  category: CadRadsCategory;
  modifiers: CadRadsModifier[];
  assessable: boolean;
  warnings: string[];
  rationale: string;
}

const STENOSIS_BANDS: Array<{ max: number; category: CadRadsCategory; label: string }> = [
  { max: 0.0001, category: '0', label: 'sem estenose' },
  { max: 0.25, category: '1', label: 'estenose mínima (1–24%)' },
  { max: 0.5, category: '2', label: 'estenose leve (25–49%)' },
  { max: 0.7, category: '3', label: 'estenose moderada (50–69%)' },
  { max: 0.9, category: '4A', label: 'estenose grave (70–99%)' },
  { max: 1.0001, category: '4A', label: 'estenose grave (70–99%)' },
];

/**
 * CAD-RADS for one segment.
 *
 * Occlusion and non-diagnostic calcification are decided before the arithmetic, because
 * both make the percentage meaningless — a number computed through a segment that cannot
 * be assessed is a number, and it will be read.
 */
export function assessSegment(input: SegmentInput): SegmentAssessment {
  const warnings: string[] = [];
  const modifiers: CadRadsModifier[] = [];
  const segmentId = String(input?.segmentId ?? '');

  if (input?.stented) {
    modifiers.push('S');
  }
  if (input?.graft) {
    modifiers.push('G');
  }
  if (input?.highRiskPlaque) {
    modifiers.push('HRP');
  }

  if (input?.occluded) {
    return {
      segmentId,
      stenosis: 1,
      category: '5',
      modifiers,
      assessable: true,
      warnings,
      rationale: 'Oclusão total.',
    };
  }

  // The characteristic CTA error is a confident 70% through a heavily calcified segment.
  if (input?.calcification === NON_DIAGNOSTIC_CALCIFICATION) {
    modifiers.push('N');
    return {
      segmentId,
      stenosis: null,
      category: 'N',
      modifiers,
      assessable: false,
      warnings,
      rationale:
        'Calcificação grave — o florescimento infla a estenose aparente e o segmento não é avaliável por angio-TC.',
    };
  }
  if (input?.calcification === 'moderate') {
    warnings.push(
      'Calcificação moderada — o florescimento tende a superestimar a estenose neste segmento.'
    );
  }

  const stenosis = diameterStenosis(input?.measurement);
  if (!Number.isFinite(stenosis)) {
    return {
      segmentId,
      stenosis: null,
      category: 'N',
      modifiers: [...modifiers, 'N'],
      assessable: false,
      warnings,
      rationale: 'Medidas ausentes ou inválidas.',
    };
  }

  const reference = input?.referenceChoice ?? 'unrecorded';
  if (reference === 'unrecorded') {
    warnings.push(
      'Referência de diâmetro não registrada — proximal, distal e interpolada dão respostas diferentes.'
    );
  }
  // In a diffusely diseased vessel the proximal reference is itself narrowed, so the
  // stenosis is under-reported — in exactly the patients with the most disease.
  if (reference === 'proximal' && input?.diffuseDisease) {
    warnings.push(
      'Referência proximal em vaso difusamente doente — a própria referência está estreitada e a estenose sai subestimada.'
    );
  }

  const band = STENOSIS_BANDS.find(b => stenosis < b.max) ?? STENOSIS_BANDS[STENOSIS_BANDS.length - 1];

  return {
    segmentId,
    stenosis,
    category: band.category,
    modifiers,
    assessable: true,
    warnings,
    rationale: `${(stenosis * 100).toFixed(0)}% de estenose de diâmetro — ${band.label}.`,
  };
}

const CATEGORY_RANK: Record<CadRadsCategory, number> = {
  '0': 0,
  '1': 1,
  '2': 2,
  '3': 3,
  '4A': 4,
  '4B': 5,
  '5': 6,
  N: 7,
};

export const CADRADS_MANAGEMENT: Record<CadRadsCategory, string> = {
  '0': 'Sem doença coronariana. Considerar causas não coronarianas.',
  '1': 'Doença mínima. Sem investigação adicional; tratar fatores de risco.',
  '2': 'Doença leve, sem estenose obstrutiva. Sem investigação adicional; considerar terapia preventiva.',
  '3': 'Estenose moderada. Considerar teste funcional ou avaliação de isquemia.',
  '4A': 'Estenose grave. Considerar teste funcional ou angiografia invasiva.',
  '4B': 'Doença de tronco de coronária esquerda ou triarterial grave. Angiografia invasiva.',
  '5': 'Oclusão total. Considerar viabilidade e angiografia invasiva.',
  N: 'Exame não diagnóstico. Considerar outro método.',
};

export interface StudyAssessment {
  category: CadRadsCategory;
  modifiers: CadRadsModifier[];
  management: string;
  /** Segment that set the category. */
  drivingSegmentId?: string;
  segments: SegmentAssessment[];
  /** Segments that could not be assessed. */
  nonDiagnosticSegments: string[];
  warnings: string[];
  formatted: string;
}

export interface StudyOptions {
  /** Left main disease or three-vessel severe disease — forces 4B. */
  leftMainOrThreeVessel?: boolean;
  /** Exception: the study could not be completed as intended. */
  exception?: boolean;
}

/**
 * The study category: the most severe segment.
 *
 * `N` outranks everything, exactly as category 0 does in Lung-RADS and for the same
 * reason: "I could not assess a segment" is a stronger statement than anything I could
 * assess, because the unassessed segment might be the worst one. A study with one
 * non-diagnostic proximal LAD and everything else clean is not a normal study.
 */
export function assessStudy(
  segments: SegmentInput[],
  options: StudyOptions = {}
): StudyAssessment {
  const assessed = (segments ?? []).filter(Boolean).map(assessSegment);
  const warnings: string[] = [];
  for (const segment of assessed) {
    for (const warning of segment.warnings) {
      if (!warnings.includes(warning)) {
        warnings.push(warning);
      }
    }
  }

  const modifiers = Array.from(new Set(assessed.flatMap(s => s.modifiers)));
  if (options?.exception) {
    modifiers.push('E');
  }

  const nonDiagnosticSegments = assessed.filter(s => !s.assessable).map(s => s.segmentId);

  if (!assessed.length) {
    return {
      category: 'N',
      modifiers,
      management: CADRADS_MANAGEMENT.N,
      segments: assessed,
      nonDiagnosticSegments,
      warnings,
      formatted: formatCategory('N', modifiers),
    };
  }

  let winner = assessed[0];
  for (const segment of assessed) {
    if (CATEGORY_RANK[segment.category] > CATEGORY_RANK[winner.category]) {
      winner = segment;
    }
  }

  let category = winner.category;
  // Left main or three-vessel severe disease is 4B whatever the individual worst segment
  // scored; the arithmetic on one segment cannot see it.
  if (options?.leftMainOrThreeVessel && CATEGORY_RANK[category] >= CATEGORY_RANK['4A'] && category !== 'N') {
    category = '4B';
  }

  return {
    category,
    modifiers,
    management: CADRADS_MANAGEMENT[category],
    drivingSegmentId: winner.segmentId,
    segments: assessed,
    nonDiagnosticSegments,
    warnings,
    formatted: formatCategory(category, modifiers),
  };
}

/** `CAD-RADS 4A/S/HRP`. */
export function formatCategory(
  category: CadRadsCategory,
  modifiers: CadRadsModifier[] = []
): string {
  const unique = Array.from(new Set(modifiers)).filter(m => m !== 'N' || category !== 'N');
  const suffix = unique.length ? `/${unique.join('/')}` : '';
  return `CAD-RADS ${category}${suffix}`;
}

/** The full line for the report. */
export function describeStudy(assessment: StudyAssessment): string {
  if (!assessment) {
    return '';
  }
  const nonDiagnostic = assessment.nonDiagnosticSegments.length
    ? ` Segmentos não avaliáveis: ${assessment.nonDiagnosticSegments.join(', ')}.`
    : '';
  const warnings = assessment.warnings.length ? ` ${assessment.warnings.join(' ')}` : '';
  return `${assessment.formatted} — ${assessment.management}${nonDiagnostic}${warnings}`;
}
