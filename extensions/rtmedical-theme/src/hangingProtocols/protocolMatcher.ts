/**
 * Combined-score hanging-protocol matcher (RTV-26) — ports the legacy
 * connectviewer HPMatcher to a framework-free, unit-tested scorer.
 *
 * Each protocol declares criteria across four DICOM attributes; the score is
 * the weighted sum of the criteria that match (Modality 40%, BodyPart 30%,
 * StudyDescription 20%, SeriesDescription 10%). `selectProtocol` picks the
 * highest scorer at or above the threshold (default 0.5), else falls back to a
 * default protocol id. Match levels: exact / contains / regex.
 *
 * Wires into OHIF's native HangingProtocolService via `addCustomAttribute`
 * (a custom "rtMatchScore" attribute), keeping the scoring logic here testable.
 * Zero-fork (RTV-114).
 */
export type MatchLevel = 'exact' | 'contains' | 'regex';

export interface Criterion {
  value: string;
  level?: MatchLevel; // default 'contains'
}

export interface ProtocolCriteria {
  modality?: Criterion;
  bodyPart?: Criterion;
  studyDescription?: Criterion;
  seriesDescription?: Criterion;
}

export interface StudyAttributes {
  modality?: string;
  bodyPart?: string;
  studyDescription?: string;
  seriesDescription?: string;
}

export const MATCH_WEIGHTS = {
  modality: 0.4,
  bodyPart: 0.3,
  studyDescription: 0.2,
  seriesDescription: 0.1,
} as const;

export const DEFAULT_THRESHOLD = 0.5;
export const DEFAULT_FALLBACK_ID = 'rt-radiology-default';

function attributeMatches(attribute: string | undefined, criterion: Criterion): boolean {
  if (attribute == null) {
    return false;
  }
  const level = criterion.level ?? 'contains';
  if (level === 'regex') {
    try {
      return new RegExp(criterion.value, 'i').test(attribute);
    } catch {
      return false;
    }
  }
  const a = attribute.toLowerCase();
  const v = criterion.value.toLowerCase();
  return level === 'exact' ? a === v : a.includes(v);
}

/** Weighted 0..1 score of how well `study` satisfies `criteria`. */
export function scoreMatch(study: StudyAttributes, criteria: ProtocolCriteria): number {
  let score = 0;
  if (criteria.modality && attributeMatches(study.modality, criteria.modality)) {
    score += MATCH_WEIGHTS.modality;
  }
  if (criteria.bodyPart && attributeMatches(study.bodyPart, criteria.bodyPart)) {
    score += MATCH_WEIGHTS.bodyPart;
  }
  if (criteria.studyDescription && attributeMatches(study.studyDescription, criteria.studyDescription)) {
    score += MATCH_WEIGHTS.studyDescription;
  }
  if (criteria.seriesDescription && attributeMatches(study.seriesDescription, criteria.seriesDescription)) {
    score += MATCH_WEIGHTS.seriesDescription;
  }
  return Math.round(score * 1000) / 1000;
}

export interface ProtocolCandidate {
  id: string;
  criteria: ProtocolCriteria;
}

export interface SelectOptions {
  threshold?: number;
  fallbackId?: string;
}

export interface SelectResult {
  protocolId: string;
  score: number;
  isFallback: boolean;
}

/**
 * Picks the best-scoring candidate at/above the threshold; otherwise returns the
 * fallback protocol. Ties resolve to the earliest candidate (stable).
 */
export function selectProtocol(
  study: StudyAttributes,
  candidates: ProtocolCandidate[],
  options: SelectOptions = {}
): SelectResult {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const fallbackId = options.fallbackId ?? DEFAULT_FALLBACK_ID;

  let best: ProtocolCandidate | undefined;
  let bestScore = -1;
  for (const candidate of candidates) {
    const score = scoreMatch(study, candidate.criteria);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  if (best && bestScore >= threshold) {
    return { protocolId: best.id, score: bestScore, isFallback: false };
  }
  return { protocolId: fallbackId, score: Math.max(0, bestScore), isFallback: true };
}
