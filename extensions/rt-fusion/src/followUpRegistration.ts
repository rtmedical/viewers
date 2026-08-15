/**
 * Oncological follow-up registration: rigid, deformable, and which one may be measured on
 * — pure core (RTV-205).
 *
 * Comparing a CT with its prior. Rigid alignment gets the patient into the same frame;
 * deformable alignment makes the anatomy actually overlap. Both are useful and only one of
 * them may be measured through, and getting that backwards produces a response assessment
 * that is an artefact of the algorithm.
 *
 * ## A deformable field flexible enough to align the anatomy is flexible enough to shrink
 * the tumour
 *
 * This is the whole tension. Between two scans the patient loses weight, an atelectasis
 * resolves, bowel gas moves. A rigid transform cannot follow any of that, so the images do
 * not overlay and the reader is left eyeballing. A deformable transform follows all of it —
 * and it does not know that the tumour is the one structure it must not follow.
 *
 * Registered deformably, a growing lesion is partly *compressed back* toward its prior
 * shape. Propagate the baseline contour through that field and measure it and you have
 * measured the regularisation strength, not the disease.
 *
 * So: **rigid for measurement, deformable for looking**. {@link isMeasurable} enforces it
 * and {@link propagateContour} refuses to hand back a measurable contour from a deformable
 * field — the propagated shape is returned marked `visualOnly`, and the caller cannot
 * accidentally treat it as a measurement because the type says so.
 *
 * ## The Jacobian tells you where the transform did the thing you were measuring
 *
 * The determinant of the deformation Jacobian is the local volume change the transform
 * applied: 1.0 is volume-preserving, 0.8 is a 20% local compression. In the tumour region
 * that number is exactly the quantity under investigation, applied by the algorithm.
 *
 * {@link jacobianWarning} flags a region where the transform did significant volume work,
 * because a 30% "response" measured inside a field that compressed by 25% is not a
 * response.
 *
 * ## A good global similarity can hide a locally terrible alignment
 *
 * Mutual information over the whole thorax is dominated by lung and chest wall. A
 * registration that nails those and misses the mediastinal node by a centimetre scores
 * beautifully. {@link registrationQuality} therefore takes a local metric in the region of
 * interest as well, and reports them separately rather than averaging — the average is the
 * number that hides the problem.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export type TransformKind = 'rigid' | 'affine' | 'deformable';

export const TRANSFORM_LABELS: Record<TransformKind, string> = {
  rigid: 'rígido',
  affine: 'afim',
  deformable: 'deformável',
};

/** Jacobian determinant this far from 1 counts as the transform doing volume work. */
export const JACOBIAN_TOLERANCE = 0.05;

/** Below this local similarity the region is not aligned, whatever the global score says. */
export const MIN_LOCAL_SIMILARITY = 0.5;

export type MeasurabilityReason =
  | 'deformableField'
  | 'affineScaling'
  | 'poorLocalAlignment'
  | 'jacobianVolumeChange';

export interface MeasurabilityVerdict {
  measurable: boolean;
  reason?: MeasurabilityReason;
  message: string;
}

export interface AffineScaling {
  /** Scale factors along each axis. 1 is no scaling. */
  x: number;
  y: number;
  z: number;
}

/**
 * Whether a measurement may be taken through this transform.
 *
 * Rigid yes. Affine only if it did not scale — an affine that scales is applying exactly
 * the volume change being measured, just globally instead of locally. Deformable never.
 */
export function isMeasurable(input: {
  kind: TransformKind;
  scaling?: AffineScaling;
  localSimilarity?: number;
  jacobianDeterminant?: number;
}): MeasurabilityVerdict {
  const kind = input?.kind;

  if (kind === 'deformable') {
    return {
      measurable: false,
      reason: 'deformableField',
      message:
        'Registro deformável: um campo flexível o bastante para alinhar a anatomia é flexível o bastante para comprimir o tumor. Meça no rígido.',
    };
  }

  if (kind === 'affine') {
    const scaling = input?.scaling;
    const scales = [scaling?.x, scaling?.y, scaling?.z].map(v => Number(v));
    const scaled = scales.some(s => Number.isFinite(s) && Math.abs(s - 1) > 0.01);
    if (scaled) {
      return {
        measurable: false,
        reason: 'affineScaling',
        message:
          'Registro afim com escala: a transformação aplica a própria variação de volume que se quer medir.',
      };
    }
  }

  const local = Number(input?.localSimilarity);
  if (Number.isFinite(local) && local < MIN_LOCAL_SIMILARITY) {
    return {
      measurable: false,
      reason: 'poorLocalAlignment',
      message: `Similaridade local de ${local.toFixed(2)} — a região de interesse não está alinhada, qualquer que seja a métrica global.`,
    };
  }

  const jacobian = Number(input?.jacobianDeterminant);
  if (Number.isFinite(jacobian) && Math.abs(jacobian - 1) > JACOBIAN_TOLERANCE) {
    return {
      measurable: false,
      reason: 'jacobianVolumeChange',
      message: `Jacobiano de ${jacobian.toFixed(2)} na região — a transformação alterou o volume local em ${Math.round(
        Math.abs(1 - jacobian) * 100
      )}%, que é a grandeza sob investigação.`,
    };
  }

  return { measurable: true, message: '' };
}

export interface JacobianWarning {
  present: boolean;
  volumeChangeFraction: number;
  message: string;
}

/**
 * Whether the transform did significant volume work in this region.
 *
 * A 30% "response" measured inside a field that compressed by 25% is not a response — it
 * is the regularisation strength with a clinical label on it.
 */
export function jacobianWarning(
  determinant: number,
  tolerance = JACOBIAN_TOLERANCE
): JacobianWarning {
  const j = Number(determinant);
  if (!Number.isFinite(j) || j <= 0) {
    return {
      present: true,
      volumeChangeFraction: 0,
      message: 'Jacobiano não positivo — a transformação dobrou o espaço sobre si mesmo aqui.',
    };
  }
  const change = j - 1;
  if (Math.abs(change) <= Math.max(0, Number(tolerance) || 0)) {
    return { present: false, volumeChangeFraction: change, message: '' };
  }
  return {
    present: true,
    volumeChangeFraction: change,
    message:
      `A transformação ${change < 0 ? 'comprimiu' : 'expandiu'} esta região em ` +
      `${Math.round(Math.abs(change) * 100)}% — isso entra direto em qualquer variação de volume medida aqui.`,
  };
}

export interface QualityInput {
  /** Similarity over the whole field of view, 0..1. */
  globalSimilarity: number;
  /** Similarity restricted to the lesion and its surroundings, 0..1. */
  localSimilarity: number;
  kind: TransformKind;
}

export interface QualityAssessment {
  globalSimilarity: number;
  localSimilarity: number;
  /** True when the global score looks fine and the local one does not. */
  misleadingGlobal: boolean;
  usable: boolean;
  message: string;
}

/**
 * Reports global and local similarity separately.
 *
 * Never averaged. Mutual information over a thorax is dominated by lung and chest wall; a
 * registration that nails those and misses the mediastinal node by a centimetre scores
 * beautifully, and the average is the number that hides it.
 */
export function registrationQuality(input: QualityInput): QualityAssessment {
  const globalSimilarity = clamp01(input?.globalSimilarity);
  const localSimilarity = clamp01(input?.localSimilarity);
  const misleadingGlobal = globalSimilarity >= 0.8 && localSimilarity < MIN_LOCAL_SIMILARITY;
  const usable = localSimilarity >= MIN_LOCAL_SIMILARITY;

  let message = '';
  if (misleadingGlobal) {
    message =
      `Global ${globalSimilarity.toFixed(2)} contra local ${localSimilarity.toFixed(2)}: a métrica global está ` +
      'dominada por pulmão e parede torácica e não diz nada sobre a lesão. Realinhe localmente.';
  } else if (!usable) {
    message = `Alinhamento local insuficiente (${localSimilarity.toFixed(2)}).`;
  } else {
    message = `Alinhamento local ${localSimilarity.toFixed(2)} (${TRANSFORM_LABELS[input?.kind] ?? '?'}).`;
  }

  return { globalSimilarity, localSimilarity, misleadingGlobal, usable, message };
}

function clamp01(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.min(1, Math.max(0, n));
}

export type ContactUse = 'measurement' | 'visualOnly';

export interface PropagatedContour {
  points: Array<[number, number, number]>;
  /** What this contour may be used for. Enforced by the type, not by a comment. */
  use: ContactUse;
  transformKind: TransformKind;
  warnings: string[];
}

export type Displacement = (point: [number, number, number]) => [number, number, number];

/**
 * Pushes a baseline contour through a transform.
 *
 * A contour propagated through a **deformable** field comes back marked `visualOnly`.
 * Measuring it measures the regularisation, and the marking is on the value rather than in
 * a comment because a comment does not survive being passed to a volume function.
 */
export function propagateContour(
  points: Array<[number, number, number]>,
  displacement: Displacement,
  kind: TransformKind
): PropagatedContour {
  const warnings: string[] = [];
  const moved: Array<[number, number, number]> = [];

  for (const point of points ?? []) {
    const p = (point ?? []).map(v => Number(v)) as [number, number, number];
    if (p.length < 3 || !p.every(Number.isFinite)) {
      continue;
    }
    const out = displacement ? displacement(p) : p;
    const q = (out ?? []).map(v => Number(v)) as [number, number, number];
    moved.push(q.every(Number.isFinite) ? q : p);
  }

  if (kind === 'deformable') {
    warnings.push(
      'Contorno propagado por campo deformável — serve para visualização e comparação qualitativa, não para medida.'
    );
  }

  return {
    points: moved,
    use: kind === 'deformable' ? 'visualOnly' : 'measurement',
    transformKind: kind,
    warnings,
  };
}

export interface VolumeComparison {
  priorMm3: number;
  currentMm3: number;
  changeFraction: number;
  valid: boolean;
  message: string;
}

/**
 * Compares two volumes, refusing when the measurement path was not measurable.
 *
 * The refusal is the point. A volume change computed from a deformably propagated contour
 * is a number with a percent sign that describes the algorithm.
 */
export function compareVolumes(
  priorMm3: number,
  currentMm3: number,
  measurability: MeasurabilityVerdict
): VolumeComparison {
  const prior = Number(priorMm3);
  const current = Number(currentMm3);

  if (!measurability?.measurable) {
    return {
      priorMm3: prior,
      currentMm3: current,
      changeFraction: 0,
      valid: false,
      message: measurability?.message ?? 'Transformação não mensurável.',
    };
  }
  if (!Number.isFinite(prior) || !Number.isFinite(current) || prior <= 0) {
    return {
      priorMm3: prior,
      currentMm3: current,
      changeFraction: 0,
      valid: false,
      message: 'Volumes inválidos.',
    };
  }

  const changeFraction = (current - prior) / prior;
  return {
    priorMm3: prior,
    currentMm3: current,
    changeFraction,
    valid: true,
    message: `Volume ${changeFraction >= 0 ? '+' : ''}${(changeFraction * 100).toFixed(0)}%.`,
  };
}

/** Readout for the follow-up panel. */
export function describeFollowUp(
  quality: QualityAssessment,
  measurability: MeasurabilityVerdict,
  jacobian?: JacobianWarning
): string {
  const parts = [quality?.message, measurability?.message, jacobian?.message];
  return parts.filter(Boolean).join(' ');
}
