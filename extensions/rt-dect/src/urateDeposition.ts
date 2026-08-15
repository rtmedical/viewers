/**
 * Urate deposition (gout) by dual-energy CT — pure core (RTV-90).
 *
 * DECT colours monosodium urate deposits green and everything calcified blue, and it is
 * genuinely diagnostic: a tophus in a joint that looks normal on radiograph is a finding
 * that changes therapy. It is also the dual-energy application with the best-documented
 * false-positive problem, and a module that only implements the colouring implements the
 * false positives too.
 *
 * ## Gout lives exactly where the ratio is least reliable
 *
 * `materialClassification` refuses below 100 HU because the dual-energy ratio degenerates
 * toward 1 as attenuation approaches water. Tophi sit at 130–170 HU — barely above that
 * floor, in soft tissue, which is precisely the regime where the measurement is worst.
 *
 * That tension is not resolvable by tuning a threshold; it is the reason the artefact
 * rules below exist. The honest position is that a urate call in this range is a
 * *candidate* until it survives them.
 *
 * ## The five known false positives, applied as rules and not as a footnote
 *
 * Every DECT gout series produces green voxels that are not urate. They are well
 * characterised in the literature, and each has a signature this module can test:
 *
 * - **Nail bed and skin** — keratin has a urate-like ratio. Excluded by location.
 * - **Submillimetre speckle at the cortical margin** — beam hardening adjacent to dense
 *   bone. Excluded by size *and* proximity to cortex together, because either alone
 *   throws away real periarticular tophi.
 * - **Motion** — smeared green along the direction of movement. Flagged, not excluded:
 *   the module cannot see the smear, but it can refuse to quantify a study the caller
 *   marked as degraded.
 * - **Severe osteoarthritis / subchondral change** — reported as a source of green in
 *   advanced degenerative joints.
 * - **Vascular calcification adjacent to a joint** — flagged when the attenuation is above
 *   the tophus range.
 *
 * ## Volume is the outcome measure, so what it excludes must be visible
 *
 * Urate volume is what follow-up under urate-lowering therapy is measured on. A volume
 * that silently includes nail-bed artefact does not shrink when the patient improves, and
 * the therapy looks like it failed. {@link quantifyUrate} therefore reports the excluded
 * volume and the reason for every exclusion, next to the number.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

import { classifyMaterial } from './materialClassification';

/** Tophi sit in this attenuation band. Below it the ratio is noise; above it is calcium. */
export const TOPHUS_HU_MIN = 120;
export const TOPHUS_HU_MAX = 200;

/** Beam-hardening speckle at the cortical margin is smaller than this. */
export const SPECKLE_VOLUME_MM3 = 8;

/** Distance from cortical bone within which speckle is expected. */
export const CORTEX_PROXIMITY_MM = 2;

export type UrateExclusion =
  | 'nailBed'
  | 'skin'
  | 'corticalSpeckle'
  | 'vascularCalcification'
  | 'subchondral'
  | 'belowRatioFloor'
  | 'notUrate';

export type UrateSite =
  | 'joint'
  | 'periarticular'
  | 'tendon'
  | 'nailBed'
  | 'skin'
  | 'vessel'
  | 'subchondral'
  | 'unknown';

export interface UrateCandidate {
  id?: string;
  huLow: number;
  huHigh: number;
  volumeMm3: number;
  site: UrateSite;
  /** Distance to the nearest cortical bone surface, mm. */
  distanceToCortexMm?: number;
}

export interface UrateVerdict {
  id?: string;
  accepted: boolean;
  volumeMm3: number;
  attenuationHu: number;
  ratio: number;
  exclusion?: UrateExclusion;
  message?: string;
}

const EXCLUSION_MESSAGES: Record<UrateExclusion, string> = {
  nailBed: 'Leito ungueal — queratina tem razão semelhante à do urato; falso-positivo clássico.',
  skin: 'Pele — mesma assinatura da queratina.',
  corticalSpeckle:
    'Pontilhado submilimétrico junto à cortical — endurecimento de feixe, não urato.',
  vascularCalcification:
    'Atenuação acima da faixa de tofo e adjacente a vaso — calcificação vascular.',
  subchondral:
    'Alteração subcondral em artrose avançada — fonte reconhecida de verde que não é urato.',
  belowRatioFloor:
    'Atenuação baixa demais para a razão dual-energy significar alguma coisa.',
  notUrate: 'Razão fora da faixa do ácido úrico.',
};

/**
 * Judges one candidate deposit.
 *
 * The order is deliberate: location-based exclusions run before the material check,
 * because a nail bed *does* classify as urate and the classifier is not wrong — it is
 * being asked the wrong question.
 */
export function judgeCandidate(candidate: UrateCandidate): UrateVerdict {
  const huLow = Number(candidate?.huLow);
  const huHigh = Number(candidate?.huHigh);
  const volumeMm3 = Math.max(0, Number(candidate?.volumeMm3) || 0);
  const classification = classifyMaterial({ huLow, huHigh });
  const attenuationHu = classification.attenuationHu;
  const ratio = classification.ratio;

  const reject = (exclusion: UrateExclusion): UrateVerdict => ({
    id: candidate?.id,
    accepted: false,
    volumeMm3,
    attenuationHu,
    ratio,
    exclusion,
    message: EXCLUSION_MESSAGES[exclusion],
  });

  if (candidate?.site === 'nailBed') {
    return reject('nailBed');
  }
  if (candidate?.site === 'skin') {
    return reject('skin');
  }
  if (candidate?.site === 'subchondral') {
    return reject('subchondral');
  }

  // Size AND proximity together: either alone throws away real periarticular tophi.
  const distance = Number(candidate?.distanceToCortexMm);
  if (
    volumeMm3 > 0 &&
    volumeMm3 < SPECKLE_VOLUME_MM3 &&
    Number.isFinite(distance) &&
    distance <= CORTEX_PROXIMITY_MM
  ) {
    return reject('corticalSpeckle');
  }

  if (candidate?.site === 'vessel' && attenuationHu > TOPHUS_HU_MAX) {
    return reject('vascularCalcification');
  }

  if (!classification.ok) {
    return reject(
      classification.refusal === 'belowAttenuationFloor' ? 'belowRatioFloor' : 'notUrate'
    );
  }
  if (classification.material !== 'uricAcid') {
    return reject('notUrate');
  }
  if (attenuationHu > TOPHUS_HU_MAX) {
    return reject('notUrate');
  }

  return { id: candidate?.id, accepted: true, volumeMm3, attenuationHu, ratio };
}

export interface UrateQuantification {
  /** Volume accepted as urate, mm³. */
  urateVolumeMm3: number;
  /** Volume rejected, mm³ — reported next to the number, never hidden. */
  excludedVolumeMm3: number;
  accepted: UrateVerdict[];
  excluded: UrateVerdict[];
  /** Counts by exclusion reason, so a systematic artefact is visible. */
  exclusionCounts: Partial<Record<UrateExclusion, number>>;
  /** True when the study was marked degraded and the number must not be trusted. */
  motionDegraded: boolean;
  ok: boolean;
  message: string;
}

export interface QuantifyOptions {
  /**
   * Caller-supplied: the acquisition was motion-degraded.
   *
   * Not detectable here — motion shows as a smear this module cannot see. But it can
   * refuse to hand back a number the reader would compare against a prior.
   */
  motionDegraded?: boolean;
}

/**
 * Total urate volume, with what was thrown away and why.
 *
 * A volume that silently includes nail-bed artefact does not shrink when the patient
 * improves, and the therapy looks like it failed. So the excluded volume travels with the
 * result.
 */
export function quantifyUrate(
  candidates: UrateCandidate[],
  options: QuantifyOptions = {}
): UrateQuantification {
  const verdicts = (candidates ?? []).filter(Boolean).map(judgeCandidate);
  const accepted = verdicts.filter(v => v.accepted);
  const excluded = verdicts.filter(v => !v.accepted);

  const exclusionCounts: Partial<Record<UrateExclusion, number>> = {};
  for (const verdict of excluded) {
    if (verdict.exclusion) {
      exclusionCounts[verdict.exclusion] = (exclusionCounts[verdict.exclusion] ?? 0) + 1;
    }
  }

  const urateVolumeMm3 = accepted.reduce((sum, v) => sum + v.volumeMm3, 0);
  const excludedVolumeMm3 = excluded.reduce((sum, v) => sum + v.volumeMm3, 0);
  const motionDegraded = !!options.motionDegraded;

  return {
    urateVolumeMm3,
    excludedVolumeMm3,
    accepted,
    excluded,
    exclusionCounts,
    motionDegraded,
    ok: !motionDegraded,
    message: motionDegraded
      ? 'Aquisição degradada por movimento — o volume de urato NÃO é comparável com exames prévios.'
      : buildMessage(urateVolumeMm3, excludedVolumeMm3, exclusionCounts),
  };
}

function buildMessage(
  urateVolumeMm3: number,
  excludedVolumeMm3: number,
  counts: Partial<Record<UrateExclusion, number>>
): string {
  if (urateVolumeMm3 <= 0 && excludedVolumeMm3 <= 0) {
    return 'Sem depósitos candidatos.';
  }
  const head = `Volume de urato ${(urateVolumeMm3 / 1000).toFixed(2)} cm³.`;
  if (excludedVolumeMm3 <= 0) {
    return head;
  }
  const reasons = Object.entries(counts)
    .map(([reason, count]) => `${count}× ${reason}`)
    .join(', ');
  return `${head} Excluídos ${(excludedVolumeMm3 / 1000).toFixed(2)} cm³ como artefato (${reasons}).`;
}

export interface UrateComparison {
  changeMm3: number;
  changeFraction: number;
  direction: 'reduced' | 'increased' | 'stable' | 'notComparable';
  message: string;
}

/**
 * Change in urate volume under therapy.
 *
 * Refuses when either study was motion-degraded, and refuses when the *excluded* fraction
 * changed a lot between the two — a follow-up where twice as much was thrown away as
 * artefact is not measuring the same thing, and the difference will read as treatment
 * response.
 */
export function compareUrateVolumes(
  prior: UrateQuantification,
  current: UrateQuantification,
  stableFraction = 0.1
): UrateComparison {
  if (!prior?.ok || !current?.ok) {
    return {
      changeMm3: 0,
      changeFraction: 0,
      direction: 'notComparable',
      message: 'Um dos exames está degradado por movimento — não comparável.',
    };
  }

  const priorExcludedShare = share(prior);
  const currentExcludedShare = share(current);
  if (Math.abs(currentExcludedShare - priorExcludedShare) > 0.25) {
    return {
      changeMm3: 0,
      changeFraction: 0,
      direction: 'notComparable',
      message:
        'A fração excluída como artefato mudou muito entre os exames — a diferença de volume não é resposta ao tratamento.',
    };
  }

  const changeMm3 = current.urateVolumeMm3 - prior.urateVolumeMm3;
  const changeFraction = prior.urateVolumeMm3 > 0 ? changeMm3 / prior.urateVolumeMm3 : 0;

  if (Math.abs(changeFraction) <= stableFraction) {
    return {
      changeMm3,
      changeFraction,
      direction: 'stable',
      message: `Volume de urato estável (${(changeFraction * 100).toFixed(0)}%).`,
    };
  }
  return {
    changeMm3,
    changeFraction,
    direction: changeMm3 < 0 ? 'reduced' : 'increased',
    message: `Volume de urato ${changeMm3 < 0 ? 'reduzido' : 'aumentado'} em ${Math.abs(
      changeFraction * 100
    ).toFixed(0)}% (${(Math.abs(changeMm3) / 1000).toFixed(2)} cm³).`,
  };
}

function share(quantification: UrateQuantification): number {
  const total = quantification.urateVolumeMm3 + quantification.excludedVolumeMm3;
  return total > 0 ? quantification.excludedVolumeMm3 / total : 0;
}
