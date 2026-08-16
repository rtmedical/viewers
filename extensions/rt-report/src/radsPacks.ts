/**
 * ACR RADS packs: TI-RADS, PI-RADS, BI-RADS and LI-RADS — pure core (RTV-220).
 *
 * Four reporting systems, each a category plus a recommendation. They look alike from
 * outside and are not: two of them are computed from features, one has a rule about *when*
 * a category may be used at all, and one changes which sequence decides depending on where
 * the lesion is.
 *
 * ## A category without its size is not actionable
 *
 * This is the thing that makes RADS packs worth implementing rather than listing. In
 * TI-RADS, a level 4 nodule at 8 mm is follow-up and the same level 4 at 18 mm is fine-needle
 * aspiration. **Same category, different action.** A viewer that renders "TI-RADS 4" and
 * stops has printed the less useful half.
 *
 * So {@link tiRads} takes the size and returns the recommendation, and the category alone is
 * never the output.
 *
 * ## BI-RADS 3 is only available on a baseline
 *
 * "Probably benign, short-interval follow-up" means *this is the first time I have seen it
 * and I expect it to be stable*. On a follow-up that already showed stability the finding is
 * benign (2); on one that showed change it is suspicious (4). Assigning 3 again on every
 * visit is a way to follow a cancer for three years.
 *
 * {@link biRads} refuses category 3 without a baseline flag.
 *
 * ## PI-RADS changes which sequence decides depending on the zone
 *
 * Peripheral zone is scored on DWI; transition zone on T2. Score the wrong one and the
 * answer is wrong in both directions depending on the lesion. And in the peripheral zone a
 * positive DCE upgrades a 3 to a 4 — which is the only place DCE changes anything, and the
 * reason DCE is acquired at all.
 *
 * ## LI-RADS 5 is a diagnosis, not a suspicion
 *
 * LR-5 means definite HCC; in the right clinical context it justifies treatment **without a
 * biopsy**. The feature combination that reaches it is therefore a table and not a
 * judgement, and it depends on size in a way that is easy to get backwards: a 15 mm lesion
 * needs two additional features, a 20 mm one needs one.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export type RadsSystem = 'TI-RADS' | 'PI-RADS' | 'BI-RADS' | 'LI-RADS';

export interface RadsResult {
  system: RadsSystem;
  category: string;
  /** Published malignancy risk band. */
  risk: string;
  recommendation: string;
  /** Points, for the systems that are scored. */
  points?: number;
  rationale: string;
  warnings: string[];
  ok: boolean;
  error?: string;
}

const fail = (system: RadsSystem, error: string): RadsResult => ({
  system,
  category: '',
  risk: '',
  recommendation: '',
  rationale: '',
  warnings: [],
  ok: false,
  error,
});

/* ------------------------------------------------------------------ TI-RADS */

export type TiComposition = 'cystic' | 'spongiform' | 'mixed' | 'solid';
export type TiEchogenicity = 'anechoic' | 'hyperechoic' | 'isoechoic' | 'hypoechoic' | 'veryHypoechoic';
export type TiShape = 'widerThanTall' | 'tallerThanWide';
export type TiMargin = 'smooth' | 'illDefined' | 'lobulated' | 'extraThyroidal';
export type TiFoci = 'none' | 'comet' | 'macrocalcification' | 'rimCalcification' | 'punctate';

export const TI_POINTS = {
  composition: { cystic: 0, spongiform: 0, mixed: 1, solid: 2 } as Record<TiComposition, number>,
  echogenicity: {
    anechoic: 0, hyperechoic: 1, isoechoic: 1, hypoechoic: 2, veryHypoechoic: 3,
  } as Record<TiEchogenicity, number>,
  shape: { widerThanTall: 0, tallerThanWide: 3 } as Record<TiShape, number>,
  margin: { smooth: 0, illDefined: 0, lobulated: 2, extraThyroidal: 3 } as Record<TiMargin, number>,
  foci: { none: 0, comet: 0, macrocalcification: 1, rimCalcification: 2, punctate: 3 } as Record<TiFoci, number>,
};

export interface TiRadsInput {
  composition: TiComposition;
  echogenicity: TiEchogenicity;
  shape: TiShape;
  margin: TiMargin;
  /** Echogenic foci are additive — more than one adds up. */
  foci: TiFoci[];
  /** Largest dimension, mm. Required: it decides the action, not the category. */
  sizeMm: number;
}

/** Level, FNA threshold and follow-up threshold, in mm. */
const TI_LEVELS: Array<{ minPoints: number; level: string; risk: string; fnaMm: number | null; followMm: number | null }> = [
  { minPoints: 7, level: 'TR5', risk: '> 20%', fnaMm: 10, followMm: 5 },
  { minPoints: 4, level: 'TR4', risk: '5–20%', fnaMm: 15, followMm: 10 },
  { minPoints: 3, level: 'TR3', risk: '~5%', fnaMm: 25, followMm: 15 },
  { minPoints: 2, level: 'TR2', risk: '< 2%', fnaMm: null, followMm: null },
  { minPoints: 0, level: 'TR1', risk: '< 2%', fnaMm: null, followMm: null },
];

/**
 * ACR TI-RADS.
 *
 * The size is required, because the category alone does not say what to do — TR4 at 8 mm is
 * follow-up and TR4 at 18 mm is FNA.
 */
export function tiRads(input: TiRadsInput): RadsResult {
  const size = Number(input?.sizeMm);
  if (!Number.isFinite(size) || size <= 0) {
    return fail(
      'TI-RADS',
      'Tamanho do nódulo é obrigatório — a categoria sozinha não diz a conduta (TR4 com 8 mm é seguimento, com 18 mm é PAAF).'
    );
  }

  const points =
    (TI_POINTS.composition[input.composition] ?? 0) +
    (TI_POINTS.echogenicity[input.echogenicity] ?? 0) +
    (TI_POINTS.shape[input.shape] ?? 0) +
    (TI_POINTS.margin[input.margin] ?? 0) +
    (input.foci ?? []).reduce((sum, f) => sum + (TI_POINTS.foci[f] ?? 0), 0);

  const level = TI_LEVELS.find(l => points >= l.minPoints) ?? TI_LEVELS[TI_LEVELS.length - 1];
  const warnings: string[] = [];

  let recommendation: string;
  if (level.fnaMm === null) {
    recommendation = 'Sem PAAF e sem seguimento por imagem.';
  } else if (size >= level.fnaMm) {
    recommendation = `PAAF (nódulo ≥ ${level.fnaMm} mm em ${level.level}).`;
  } else if (level.followMm !== null && size >= level.followMm) {
    recommendation = `Seguimento ultrassonográfico (nódulo ≥ ${level.followMm} mm e < ${level.fnaMm} mm em ${level.level}).`;
  } else {
    recommendation = `Sem conduta adicional (nódulo < ${level.followMm} mm em ${level.level}).`;
  }

  // Cystic and spongiform are benign by composition; a high point total there is a data
  // entry problem, not a finding.
  if ((input.composition === 'cystic' || input.composition === 'spongiform') && points >= 3) {
    warnings.push(
      `Composição ${input.composition} com ${points} pontos — confira as demais características, a combinação é incomum.`
    );
  }

  return {
    system: 'TI-RADS',
    category: level.level,
    risk: level.risk,
    recommendation,
    points,
    rationale: `${points} ponto(s), nódulo de ${size} mm.`,
    warnings,
    ok: true,
  };
}

/* ------------------------------------------------------------------ PI-RADS */

export type ProstateZone = 'peripheral' | 'transition';

export interface PiRadsInput {
  zone: ProstateZone;
  /** DWI score 1–5. Dominant in the peripheral zone. */
  dwi: number;
  /** T2 score 1–5. Dominant in the transition zone. */
  t2: number;
  /** Dynamic contrast enhancement. Only ever changes a peripheral-zone 3. */
  dcePositive?: boolean;
}

const PI_RISK: Record<number, string> = {
  1: 'muito baixa',
  2: 'baixa',
  3: 'intermediária (equívoca)',
  4: 'alta',
  5: 'muito alta',
};

const PI_MANAGEMENT: Record<number, string> = {
  1: 'Câncer clinicamente significativo muito improvável. Sem biópsia dirigida.',
  2: 'Improvável. Sem biópsia dirigida.',
  3: 'Equívoco. Decisão individualizada; considerar biópsia conforme PSA e densidade.',
  4: 'Provável. Biópsia dirigida indicada.',
  5: 'Muito provável. Biópsia dirigida indicada.',
};

/**
 * PI-RADS v2.1.
 *
 * The dominant sequence depends on the zone. Scoring the wrong one is wrong in both
 * directions depending on the lesion, and DCE only ever does anything to a peripheral-zone
 * 3 — which is why it is acquired.
 */
export function piRads(input: PiRadsInput): RadsResult {
  const zone = input?.zone;
  const dwi = Number(input?.dwi);
  const t2 = Number(input?.t2);
  const warnings: string[] = [];

  if (zone !== 'peripheral' && zone !== 'transition') {
    return fail('PI-RADS', 'Zona não informada — ela decide qual sequência é dominante.');
  }
  if (![dwi, t2].every(v => Number.isInteger(v) && v >= 1 && v <= 5)) {
    return fail('PI-RADS', 'Escores DWI e T2 devem estar entre 1 e 5.');
  }

  let category = zone === 'peripheral' ? dwi : t2;
  let rationale =
    zone === 'peripheral'
      ? `Zona periférica: DWI ${dwi} é dominante (T2 ${t2}).`
      : `Zona de transição: T2 ${t2} é dominante (DWI ${dwi}).`;

  if (zone === 'peripheral' && category === 3 && input?.dcePositive) {
    category = 4;
    rationale += ' DCE positivo eleva 3 para 4.';
  } else if (zone === 'transition' && input?.dcePositive) {
    // The single most common misapplication.
    warnings.push('DCE não altera escore na zona de transição — foi ignorado.');
  }

  return {
    system: 'PI-RADS',
    category: String(category),
    risk: PI_RISK[category],
    recommendation: PI_MANAGEMENT[category],
    rationale,
    warnings,
    ok: true,
  };
}

/* ------------------------------------------------------------------ BI-RADS */

export type BiRadsCategory = '0' | '1' | '2' | '3' | '4A' | '4B' | '4C' | '5' | '6';

const BI_RISK: Record<BiRadsCategory, string> = {
  '0': 'n/a',
  '1': '~0%',
  '2': '~0%',
  '3': '> 0% e ≤ 2%',
  '4A': '> 2% e ≤ 10%',
  '4B': '> 10% e ≤ 50%',
  '4C': '> 50% e < 95%',
  '5': '≥ 95%',
  '6': 'malignidade comprovada',
};

const BI_MANAGEMENT: Record<BiRadsCategory, string> = {
  '0': 'Incompleto. Necessita avaliação adicional por imagem ou comparação com exames prévios.',
  '1': 'Negativo. Rastreamento de rotina.',
  '2': 'Achado benigno. Rastreamento de rotina.',
  '3': 'Provavelmente benigno. Seguimento por imagem em intervalo curto (6 meses).',
  '4A': 'Suspeita baixa. Biópsia indicada.',
  '4B': 'Suspeita moderada. Biópsia indicada.',
  '4C': 'Suspeita alta. Biópsia indicada.',
  '5': 'Altamente sugestivo de malignidade. Conduta apropriada.',
  '6': 'Malignidade comprovada por biópsia. Conduta apropriada.',
};

export interface BiRadsInput {
  category: BiRadsCategory;
  /** True when this is the first time the finding is being characterised. */
  isBaseline?: boolean;
  /** True when a prior showed the finding unchanged over the follow-up interval. */
  stableOnFollowUp?: boolean;
}

/**
 * BI-RADS, with the rule about category 3.
 *
 * "Probably benign, short-interval follow-up" means *this is the first time I have seen it*.
 * Assigning 3 again on every visit is a way to follow a cancer for three years.
 */
export function biRads(input: BiRadsInput): RadsResult {
  const category = input?.category;
  if (!BI_MANAGEMENT[category]) {
    return fail('BI-RADS', 'Categoria BI-RADS inválida.');
  }

  const warnings: string[] = [];
  if (category === '3' && !input?.isBaseline) {
    return fail(
      'BI-RADS',
      'Categoria 3 só se aplica a achado caracterizado pela primeira vez. Em seguimento: estável vira 2, alterado vira 4.'
    );
  }
  if (category === '3' && input?.stableOnFollowUp) {
    warnings.push(
      'Achado estável em seguimento — considere categoria 2 em vez de repetir a 3.'
    );
  }
  if (category === '0') {
    warnings.push('Categoria 0 é incompleta: ela exige uma conduta de completar, não de seguir.');
  }

  return {
    system: 'BI-RADS',
    category,
    risk: BI_RISK[category],
    recommendation: BI_MANAGEMENT[category],
    rationale: `Categoria ${category}.`,
    warnings,
    ok: true,
  };
}

/* ------------------------------------------------------------------ LI-RADS */

export interface LiRadsInput {
  /** Only applies to patients at risk for HCC. */
  atRisk: boolean;
  /** Arterial phase hyperenhancement — the entry criterion for LR-4/5. */
  aphe: boolean;
  sizeMm: number;
  /** Non-peripheral washout. */
  washout?: boolean;
  /** Enhancing capsule. */
  capsule?: boolean;
  /** >= 50% growth in <= 6 months. */
  thresholdGrowth?: boolean;
  /** Definite tumour in vein — LR-TIV regardless of anything else. */
  tumourInVein?: boolean;
  /** Targetoid appearance — LR-M, malignant but not specific for HCC. */
  targetoid?: boolean;
}

/**
 * LI-RADS v2018 CT/MRI diagnostic table.
 *
 * LR-5 means definite HCC and, in context, justifies treatment **without a biopsy** — so the
 * combination that reaches it is a table, not a judgement. The size dependence is easy to
 * get backwards: at 10–19 mm with APHE it takes **two** additional features to reach LR-5,
 * at ≥ 20 mm it takes **one**.
 */
export function liRads(input: LiRadsInput): RadsResult {
  const size = Number(input?.sizeMm);
  if (!input?.atRisk) {
    return fail(
      'LI-RADS',
      'LI-RADS só se aplica a paciente de risco para CHC — fora dessa população as categorias não têm o significado publicado.'
    );
  }
  if (!Number.isFinite(size) || size <= 0) {
    return fail('LI-RADS', 'Tamanho do observado é obrigatório.');
  }

  const done = (category: string, risk: string, recommendation: string, rationale: string): RadsResult => ({
    system: 'LI-RADS', category, risk, recommendation, rationale, warnings: [], ok: true,
  });

  if (input.tumourInVein) {
    return done('LR-TIV', 'malignidade com invasão venosa', 'Conduta oncológica; discutir em equipe multidisciplinar.', 'Tumor definitivo em veia.');
  }
  if (input.targetoid) {
    return done('LR-M', 'malignidade provável, não específica para CHC', 'Considerar biópsia — pode ser colangiocarcinoma ou metástase.', 'Aparência targetoide.');
  }

  const additional =
    (input.washout ? 1 : 0) + (input.capsule ? 1 : 0) + (input.thresholdGrowth ? 1 : 0);

  if (!input.aphe) {
    // Without arterial phase hyperenhancement the observation cannot reach LR-4/5.
    const category = additional >= 1 ? 'LR-3' : size < 20 ? 'LR-2' : 'LR-3';
    return done(
      category,
      category === 'LR-2' ? 'provavelmente benigno' : 'probabilidade intermediária',
      category === 'LR-2'
        ? 'Retornar ao rastreamento de rotina.'
        : 'Repetir ou alternar método de imagem em 3–6 meses.',
      `Sem hiperrealce arterial; ${additional} característica(s) adicional(is).`
    );
  }

  // With APHE, the number of additional features needed depends on size.
  const needed = size >= 20 ? 1 : 2;
  if (size >= 10 && additional >= needed) {
    return done(
      'LR-5',
      '≥ 95% (CHC definitivo)',
      'CHC definitivo. Tratamento pode ser indicado sem biópsia, conforme discussão multidisciplinar.',
      `Hiperrealce arterial, ${size} mm, ${additional} característica(s) adicional(is) (necessárias ${needed}).`
    );
  }
  if (additional >= 1 || size >= 20) {
    return done(
      'LR-4',
      '~75% (provavelmente CHC)',
      'Provavelmente CHC. Discussão multidisciplinar; considerar biópsia ou seguimento curto.',
      `Hiperrealce arterial, ${size} mm, ${additional} característica(s) adicional(is) (necessárias ${needed} para LR-5).`
    );
  }
  return done(
    'LR-3',
    'probabilidade intermediária',
    'Repetir ou alternar método de imagem em 3–6 meses.',
    `Hiperrealce arterial isolado em observado de ${size} mm.`
  );
}

/** Readout for whichever system produced the result. */
export function describeRads(result: RadsResult): string {
  if (!result) {
    return '';
  }
  if (!result.ok) {
    return result.error ?? '';
  }
  const points = result.points !== undefined ? ` (${result.points} pt)` : '';
  const warnings = result.warnings.length ? ` ${result.warnings.join(' ')}` : '';
  return `${result.system} ${result.category}${points} · risco ${result.risk} · ${result.recommendation}${warnings}`;
}
