/**
 * Renal stone characterisation — pure core (RTV-89).
 *
 * Pulls together what the other dual-energy modules established and turns it into the
 * three things a urologist actually acts on: **how big**, **what is it made of**, and
 * **will lithotripsy work**.
 *
 * ## Size decides treatment more than composition does, and size is window-dependent
 *
 * Spontaneous passage is essentially a function of diameter: most stones under 5 mm pass,
 * most over 10 mm do not. So the measurement that drives management is the one most
 * vulnerable to a display setting — a stone measured on a soft-tissue window blooms and
 * reads 1–2 mm larger than the same stone on a bone window, and 1 mm at the 5 mm boundary
 * moves the patient between "hydrate and wait" and "refer".
 *
 * {@link characteriseStone} therefore takes the window the measurement was made on, records
 * it, and applies a documented correction when it was not the bone window — rather than
 * silently accepting a number whose provenance nobody wrote down.
 *
 * ## Attenuation predicts whether shockwave lithotripsy will work
 *
 * Stones above about 1000 HU resist SWL and are better served by ureteroscopy. That is a
 * genuinely useful thing for a report to say, and it costs nothing to compute — but it is
 * only meaningful on a stone large enough not to be partial-volumed, so it inherits the
 * same size guard as the composition.
 *
 * ## Everything the physics cannot say, it does not say
 *
 * Composition comes from `materialClassification`, which reports uric acid versus
 * non-uric-acid and refuses to name the mineral. That refusal survives to here: the stone
 * report says "not uric acid" and states the therapeutic consequence, and never guesses
 * oxalate.
 *
 * And a stone that was only seen on a virtual non-contrast series carries the RTV-86
 * warning: below the visibility limit, absence on VNC does not exclude.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

import {
  ClassificationResult,
  classifyMaterial,
  MIN_OBJECT_SIZE_MM,
} from './materialClassification';

/** Most stones below this pass spontaneously. */
export const SPONTANEOUS_PASSAGE_MM = 5;
/** Above this, spontaneous passage is unlikely. */
export const INTERVENTION_LIKELY_MM = 10;
/** Above this attenuation, shockwave lithotripsy is likely to fail. */
export const SWL_RESISTANT_HU = 1000;

/**
 * Blooming when a stone is measured on a soft-tissue window instead of a bone window.
 *
 * 1.5 mm is the middle of the range reported in the literature. It is a correction, not a
 * fudge: the bone-window measurement is the reference, and this brings a soft-tissue
 * measurement onto it.
 */
export const SOFT_TISSUE_WINDOW_BLOOM_MM = 1.5;

export type MeasurementWindow = 'bone' | 'softTissue' | 'unknown';

export type PassageLikelihood = 'likely' | 'uncertain' | 'unlikely';

export type StoneComposition = 'uricAcid' | 'nonUricAcid' | 'indeterminate';

export interface StoneInput {
  /** Largest diameter as measured, mm. */
  measuredSizeMm: number;
  window: MeasurementWindow;
  huLow: number;
  huHigh: number;
  /** True when the stone was identified on a VNC series rather than a true acquisition. */
  seenOnVncOnly?: boolean;
  location?: string;
}

export interface StoneReport {
  /** Size corrected onto the bone-window reference. */
  sizeMm: number;
  measuredSizeMm: number;
  window: MeasurementWindow;
  sizeCorrectionMm: number;
  attenuationHu: number;
  composition: StoneComposition;
  compositionLabel: string;
  classification: ClassificationResult;
  passage: PassageLikelihood;
  /** True when the attenuation predicts shockwave lithotripsy will fail. */
  swlResistant: boolean | null;
  warnings: string[];
  summary: string;
}

/**
 * The stone report.
 *
 * Every uncertainty that the earlier modules established is carried through as a warning
 * rather than being resolved here — this file composes, it does not overrule.
 */
export function characteriseStone(input: StoneInput): StoneReport {
  const measuredSizeMm = Number(input?.measuredSizeMm);
  const window: MeasurementWindow = ['bone', 'softTissue', 'unknown'].includes(
    input?.window as string
  )
    ? (input.window as MeasurementWindow)
    : 'unknown';

  const warnings: string[] = [];

  // Bring the measurement onto the bone-window reference.
  let sizeCorrectionMm = 0;
  if (window === 'softTissue') {
    sizeCorrectionMm = -SOFT_TISSUE_WINDOW_BLOOM_MM;
  } else if (window === 'unknown') {
    warnings.push(
      'Janela de medida não registrada — medida em janela de partes moles superestima o cálculo em ~1,5 mm.'
    );
  }

  const sizeMm = Number.isFinite(measuredSizeMm)
    ? Math.max(0, measuredSizeMm + sizeCorrectionMm)
    : NaN;

  const classification = classifyMaterial({
    huLow: input?.huLow,
    huHigh: input?.huHigh,
    sizeMm: Number.isFinite(sizeMm) ? sizeMm : undefined,
  });

  const composition: StoneComposition =
    classification.material === 'uricAcid'
      ? 'uricAcid'
      : classification.material === 'nonUricAcid'
        ? 'nonUricAcid'
        : 'indeterminate';

  if (composition === 'indeterminate' && classification.message) {
    warnings.push(classification.message);
  }
  if (input?.seenOnVncOnly && Number.isFinite(sizeMm) && sizeMm < MIN_OBJECT_SIZE_MM) {
    warnings.push(
      `Visto apenas em série VNC e abaixo de ${MIN_OBJECT_SIZE_MM} mm — a VNC subtrai cálcio junto com o iodo; ausência não exclui e o tamanho não é confiável.`
    );
  }

  const attenuationHu = classification.attenuationHu;
  const swlResistant =
    Number.isFinite(sizeMm) && sizeMm >= MIN_OBJECT_SIZE_MM && Number.isFinite(attenuationHu)
      ? attenuationHu >= SWL_RESISTANT_HU
      : null;
  if (swlResistant === null) {
    warnings.push(
      'Atenuação não interpretável para prever LECO: cálculo pequeno demais ou medida inválida.'
    );
  }

  const passage = passageLikelihood(sizeMm);

  return {
    sizeMm,
    measuredSizeMm,
    window,
    sizeCorrectionMm,
    attenuationHu,
    composition,
    compositionLabel: compositionLabel(composition),
    classification,
    passage,
    swlResistant,
    warnings,
    summary: buildSummary({
      sizeMm,
      passage,
      composition,
      swlResistant,
      attenuationHu,
      location: input?.location,
    }),
  };
}

export function passageLikelihood(sizeMm: number): PassageLikelihood {
  const size = Number(sizeMm);
  if (!Number.isFinite(size)) {
    return 'uncertain';
  }
  if (size < SPONTANEOUS_PASSAGE_MM) {
    return 'likely';
  }
  return size > INTERVENTION_LIKELY_MM ? 'unlikely' : 'uncertain';
}

function compositionLabel(composition: StoneComposition): string {
  switch (composition) {
    case 'uricAcid':
      return 'Ácido úrico';
    case 'nonUricAcid':
      return 'Não ácido úrico (cálcico)';
    default:
      return 'Composição indeterminada';
  }
}

interface SummaryInput {
  sizeMm: number;
  passage: PassageLikelihood;
  composition: StoneComposition;
  swlResistant: boolean | null;
  attenuationHu: number;
  location?: string;
}

/**
 * The sentence that goes in the report.
 *
 * Built from the parts that survived their own guards, so a stone whose composition could
 * not be determined produces a sentence about its size and nothing about its chemistry —
 * rather than a sentence with a confident-sounding gap in it.
 */
function buildSummary(input: SummaryInput): string {
  const parts: string[] = [];
  const where = String(input.location ?? '').trim();

  if (Number.isFinite(input.sizeMm)) {
    parts.push(
      `Cálculo de ${input.sizeMm.toFixed(1)} mm${where ? ` em ${where}` : ''}` +
        ` (${Math.round(input.attenuationHu)} HU).`
    );
  } else {
    parts.push(`Cálculo${where ? ` em ${where}` : ''} sem medida válida.`);
  }

  switch (input.passage) {
    case 'likely':
      parts.push(`Abaixo de ${SPONTANEOUS_PASSAGE_MM} mm — eliminação espontânea provável.`);
      break;
    case 'unlikely':
      parts.push(`Acima de ${INTERVENTION_LIKELY_MM} mm — eliminação espontânea improvável.`);
      break;
    default:
      parts.push(
        `Entre ${SPONTANEOUS_PASSAGE_MM} e ${INTERVENTION_LIKELY_MM} mm — eliminação incerta.`
      );
  }

  if (input.composition === 'uricAcid') {
    parts.push('Ácido úrico: candidato a dissolução com alcalinização urinária.');
  } else if (input.composition === 'nonUricAcid') {
    parts.push(
      'Não é ácido úrico; não dissolve com alcalinização. A dupla energia não separa oxalato de fosfato de cálcio.'
    );
  }

  if (input.swlResistant === true) {
    parts.push(`Acima de ${SWL_RESISTANT_HU} HU — resistente a LECO; considerar ureteroscopia.`);
  } else if (input.swlResistant === false) {
    parts.push(`Abaixo de ${SWL_RESISTANT_HU} HU — LECO plausível.`);
  }

  return parts.join(' ');
}

/** Sorts a burden of stones so the one driving management comes first. */
export function rankStones(reports: StoneReport[]): StoneReport[] {
  const rank = { unlikely: 0, uncertain: 1, likely: 2 };
  return [...(reports ?? [])].sort((a, b) => {
    const byPassage = rank[a.passage] - rank[b.passage];
    return byPassage !== 0 ? byPassage : (b.sizeMm || 0) - (a.sizeMm || 0);
  });
}

/** Total stone burden, for the impression. */
export function stoneBurden(reports: StoneReport[]): {
  count: number;
  largestMm: number;
  anyUricAcid: boolean;
  anySwlResistant: boolean;
} {
  const list = (reports ?? []).filter(Boolean);
  return {
    count: list.length,
    largestMm: list.reduce((max, r) => Math.max(max, Number(r.sizeMm) || 0), 0),
    anyUricAcid: list.some(r => r.composition === 'uricAcid'),
    anySwlResistant: list.some(r => r.swlResistant === true),
  };
}
