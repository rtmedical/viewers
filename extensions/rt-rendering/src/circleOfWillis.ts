/**
 * Circle of Willis: variant classification and what it means for collateral flow — pure
 * core (RTV-53).
 *
 * The circle is the brain's anastomotic ring. Describing which segments are present is easy
 * and, on its own, almost useless. The reason to report it is the next sentence: **what
 * happens to this patient if a vessel occludes.**
 *
 * ## An incomplete circle is not a finding
 *
 * A textbook-complete circle is present in something like 40–50% of people. So "circulo de
 * Willis incompleto" reported as an abnormality is a normal variant reported as
 * pathology — it fills a report with noise and trains readers to ignore the line.
 *
 * What is worth reporting is a variant that **removes a collateral pathway the patient would
 * otherwise have**. {@link assessCollateral} answers that, per side, and
 * {@link classifyVariant} names the pattern only as a way of getting there.
 *
 * ## Fetal PCA is the one that changes what an ICA occlusion does
 *
 * Normally the posterior cerebral artery is fed by the basilar through P1. In a fetal
 * configuration P1 is absent or hypoplastic and the PCA is fed by the posterior communicating
 * artery — that is, **by the internal carotid**.
 *
 * The consequence is the finding: an ICA occlusion in that patient threatens the occipital
 * lobe as well as the middle cerebral territory, and thrombectomy planning changes. Reporting
 * "P1 hipoplásico" without saying that is reporting the anatomy and withholding the point.
 *
 * ## An absent A1 makes both frontal lobes depend on one carotid
 *
 * With one A1 absent or hypoplastic, both anterior cerebral arteries fill from the other
 * internal carotid across the anterior communicating artery. That carotid occluding is then
 * a bilateral anterior infarct. The same asymmetry is the classic association with anterior
 * communicating aneurysms, because the whole flow crosses there.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export type Side = 'left' | 'right';

export type SegmentState = 'normal' | 'hypoplastic' | 'absent' | 'occluded' | 'notAssessed';

/**
 * Hypoplastic counts as non-functional for collateral purposes.
 *
 * A 0.8 mm A1 is visible on the angiogram and carries nothing useful under load. Treating it
 * as present because it can be seen is how a report says the collateral exists when it does
 * not.
 */
export const NON_FUNCTIONAL: SegmentState[] = ['hypoplastic', 'absent', 'occluded'];

export interface WillisSegments {
  /** Anterior communicating artery — single, midline. */
  acom: SegmentState;
  /** A1 segment of the anterior cerebral artery, per side. */
  a1: Record<Side, SegmentState>;
  /** Posterior communicating artery, per side. */
  pcom: Record<Side, SegmentState>;
  /** P1 segment of the posterior cerebral artery, per side. */
  p1: Record<Side, SegmentState>;
  /** Internal carotid, per side. Not part of the ring, but the ring's supply. */
  ica?: Record<Side, SegmentState>;
}

const isFunctional = (state: SegmentState | undefined): boolean =>
  !!state && state !== 'notAssessed' && !NON_FUNCTIONAL.includes(state);

const isAssessed = (state: SegmentState | undefined): boolean =>
  !!state && state !== 'notAssessed';

export type WillisVariant =
  | 'complete'
  | 'fetalPca'
  | 'partialFetalPca'
  | 'absentA1'
  | 'absentAcom'
  | 'absentPcom'
  | 'multipleVariants'
  | 'incomplete'
  | 'notAssessable';

export const VARIANT_LABELS: Record<WillisVariant, string> = {
  complete: 'Círculo completo',
  fetalPca: 'PCA fetal',
  partialFetalPca: 'PCA fetal parcial',
  absentA1: 'A1 ausente ou hipoplásico',
  absentAcom: 'Comunicante anterior ausente',
  absentPcom: 'Comunicante posterior ausente',
  multipleVariants: 'Múltiplas variantes',
  incomplete: 'Círculo incompleto',
  notAssessable: 'Não avaliável',
};

export interface VariantFinding {
  variant: WillisVariant;
  side?: Side;
  description: string;
}

export interface VariantAssessment {
  /** Dominant variant, for the report line. */
  variant: WillisVariant;
  findings: VariantFinding[];
  /** Segments that were not assessed. */
  notAssessed: string[];
  /** True when the circle is anatomically complete. */
  complete: boolean;
}

/**
 * Names the variants present.
 *
 * This is a step on the way to {@link assessCollateral}, not the output. A variant name with
 * no consequence attached is anatomy trivia in a clinical document.
 */
export function classifyVariant(segments: WillisSegments): VariantAssessment {
  const findings: VariantFinding[] = [];
  const notAssessed: string[] = [];

  const note = (name: string, state: SegmentState | undefined) => {
    if (!isAssessed(state)) {
      notAssessed.push(name);
    }
  };
  note('AComA', segments?.acom);
  for (const side of ['left', 'right'] as Side[]) {
    note(`A1 ${side}`, segments?.a1?.[side]);
    note(`PComA ${side}`, segments?.pcom?.[side]);
    note(`P1 ${side}`, segments?.p1?.[side]);
  }

  if (notAssessed.length >= 4) {
    return {
      variant: 'notAssessable',
      findings: [],
      notAssessed,
      complete: false,
    };
  }

  for (const side of ['left', 'right'] as Side[]) {
    const p1 = segments?.p1?.[side];
    const pcom = segments?.pcom?.[side];
    if (isAssessed(p1) && !isFunctional(p1) && isFunctional(pcom)) {
      const full = p1 === 'absent';
      findings.push({
        variant: full ? 'fetalPca' : 'partialFetalPca',
        side,
        description: `P1 ${side === 'left' ? 'esquerdo' : 'direito'} ${
          full ? 'ausente' : 'hipoplásico'
        } com PComA pérvia — PCA ${full ? '' : 'predominantemente '}suprida pela carótida interna.`,
      });
    }

    const a1 = segments?.a1?.[side];
    if (isAssessed(a1) && !isFunctional(a1)) {
      findings.push({
        variant: 'absentA1',
        side,
        description: `A1 ${side === 'left' ? 'esquerdo' : 'direito'} ${
          a1 === 'absent' ? 'ausente' : 'hipoplásico'
        }.`,
      });
    }

    if (isAssessed(pcom) && !isFunctional(pcom)) {
      findings.push({
        variant: 'absentPcom',
        side,
        description: `PComA ${side === 'left' ? 'esquerda' : 'direita'} ausente ou hipoplásica.`,
      });
    }
  }

  if (isAssessed(segments?.acom) && !isFunctional(segments.acom)) {
    findings.push({ variant: 'absentAcom', description: 'Comunicante anterior ausente ou hipoplásica.' });
  }

  const complete = !findings.length && !notAssessed.length;
  if (complete) {
    return { variant: 'complete', findings: [], notAssessed, complete: true };
  }

  const variant: WillisVariant =
    findings.length === 0
      ? 'incomplete'
      : findings.length > 1
        ? 'multipleVariants'
        : findings[0].variant;

  return { variant, findings, notAssessed, complete: false };
}

export type CollateralRisk = 'preserved' | 'reduced' | 'absent' | 'unknown';

export interface CollateralPathway {
  /** Territory that would be at risk. */
  territory: string;
  risk: CollateralRisk;
  /** The occlusion this describes the consequence of. */
  ifOccluded: string;
  consequence: string;
}

export interface CollateralAssessment {
  pathways: CollateralPathway[];
  /** The sentence worth putting in the report, or empty when there is nothing to say. */
  summary: string;
  /** True when at least one pathway is absent or reduced. */
  actionable: boolean;
}

/**
 * What happens to this patient if a vessel occludes.
 *
 * This is the output. The variant name is how it gets here — reporting the anatomy without
 * the consequence is reporting the less useful half, and it is what makes readers skip the
 * line.
 */
export function assessCollateral(segments: WillisSegments): CollateralAssessment {
  const pathways: CollateralPathway[] = [];
  const other = (side: Side): Side => (side === 'left' ? 'right' : 'left');
  const pt = (side: Side) => (side === 'left' ? 'esquerda' : 'direita');

  for (const side of ['left', 'right'] as Side[]) {
    const p1 = segments?.p1?.[side];
    const pcom = segments?.pcom?.[side];

    // Fetal PCA: the posterior territory hangs off the carotid.
    if (isAssessed(p1) && !isFunctional(p1) && isFunctional(pcom)) {
      pathways.push({
        territory: `território da PCA ${pt(side)} (occipital)`,
        risk: 'absent',
        ifOccluded: `carótida interna ${pt(side)}`,
        consequence:
          `PCA ${pt(side)} suprida pela carótida (configuração fetal): uma oclusão carotídea ` +
          'ameaça o lobo occipital além do território da cerebral média, e isso muda o planejamento de trombectomia.',
      });
    }

    // Absent A1: both anterior territories fill from the other carotid.
    const a1 = segments?.a1?.[side];
    if (isAssessed(a1) && !isFunctional(a1) && isFunctional(segments?.acom)) {
      pathways.push({
        territory: 'ambos os territórios da ACA',
        risk: 'absent',
        ifOccluded: `carótida interna ${pt(other(side))}`,
        consequence:
          `A1 ${pt(side)} não funcional: as duas cerebrais anteriores enchem pela carótida ${pt(other(side))} ` +
          'através da comunicante anterior. Uma oclusão dessa carótida é um infarto anterior bilateral.',
      });
    }

    // Absent PComA: no anterior-to-posterior collateral on this side.
    if (isAssessed(pcom) && !isFunctional(pcom) && isFunctional(p1)) {
      pathways.push({
        territory: `circulação posterior ${pt(side)}`,
        risk: 'reduced',
        ifOccluded: 'artéria basilar',
        consequence:
          `Sem comunicante posterior ${pt(side)}, não há via colateral da circulação anterior para a posterior desse lado.`,
      });
    }
  }

  // Absent AComA: no crossover between the two anterior territories.
  if (isAssessed(segments?.acom) && !isFunctional(segments.acom)) {
    pathways.push({
      territory: 'território da ACA contralateral',
      risk: 'absent',
      ifOccluded: 'qualquer carótida interna',
      consequence:
        'Sem comunicante anterior não há passagem entre os dois territórios anteriores: cada carótida sustenta o seu lado sozinha.',
    });
  }

  const actionable = pathways.some(p => p.risk === 'absent' || p.risk === 'reduced');
  return {
    pathways,
    actionable,
    summary: actionable
      ? pathways.map(p => p.consequence).join(' ')
      : '',
  };
}

export interface AneurysmRiskNote {
  present: boolean;
  message: string;
}

/**
 * The anterior communicating asymmetry note.
 *
 * A1 asymmetry is the classic association with anterior communicating aneurysms, because
 * the whole cross-flow goes through that one vessel. Worth a sentence when the anatomy is
 * there, and worth nothing said when it is not.
 */
export function acomAneurysmNote(segments: WillisSegments): AneurysmRiskNote {
  const left = segments?.a1?.left;
  const right = segments?.a1?.right;
  const asymmetric =
    (isAssessed(left) && !isFunctional(left) && isFunctional(right)) ||
    (isAssessed(right) && !isFunctional(right) && isFunctional(left));

  if (!asymmetric || !isFunctional(segments?.acom)) {
    return { present: false, message: '' };
  }
  return {
    present: true,
    message:
      'Assimetria de A1 com comunicante anterior pérvia — todo o fluxo cruzado passa por ela, ' +
      'associação clássica com aneurisma de comunicante anterior. Vale olhar com atenção.',
  };
}

/**
 * The report line.
 *
 * A complete circle and an incomplete-but-inconsequential one both produce a short, quiet
 * sentence: a textbook-complete circle exists in under half of people, so "incompleto"
 * reported as an abnormality is a normal variant reported as pathology.
 */
export function describeWillis(segments: WillisSegments): string {
  const variant = classifyVariant(segments);
  if (variant.variant === 'notAssessable') {
    return `Círculo de Willis não avaliável (${variant.notAssessed.join(', ')} não avaliados).`;
  }

  const collateral = assessCollateral(segments);
  const aneurysm = acomAneurysmNote(segments);

  const head = variant.complete
    ? 'Círculo de Willis completo.'
    : `${VARIANT_LABELS[variant.variant]}: ${variant.findings.map(f => f.description).join(' ')}`;

  if (!collateral.actionable) {
    // Variação anatômica sem consequência colateral: dita e encerrada.
    return `${head}${variant.complete ? '' : ' Sem repercussão sobre as vias colaterais.'}`;
  }

  return [head, collateral.summary, aneurysm.message].filter(Boolean).join(' ');
}
