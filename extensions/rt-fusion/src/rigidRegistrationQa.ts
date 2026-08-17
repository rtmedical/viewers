/**
 * Rigid multi-modal registration QA — pure core (RTV-196).
 *
 * The ITK optimiser lives in the sidecar. `deformableQa.ts` (RTV-199) covers deformable
 * fields. This is the rigid case, which fails differently: a deformable field goes wrong by
 * folding, and a rigid transform goes wrong by **converging on a plausible answer that is
 * the wrong one**.
 *
 * ## MR is not geometrically true, so a rigid CT–MR registration cannot be right everywhere
 *
 * This is the fact that decides what the QA can honestly claim. Gradient non-linearity and
 * B0 inhomogeneity displace MR voxels, by a fraction of a millimetre near the magnet
 * isocentre and by several millimetres toward the edge of the bore. A rigid transform has
 * six degrees of freedom and cannot absorb a spatially varying displacement.
 *
 * So the registration is accurate near the isocentre and progressively wrong away from it —
 * and "away from it" is where the skull, the brain surface and the neck are. A single
 * residual figure averages the good centre with the bad periphery and reports neither.
 * {@link distortionEnvelope} states the gradient instead.
 *
 * ## A negative determinant is a reflection, and no patient is a reflection
 *
 * A rigid body transform has determinant +1. A determinant of −1 is a mirror, which no
 * physical motion produces — it means an axis was flipped somewhere, and LPS/RAS confusion
 * between two toolkits is the usual cause. The images will still overlay convincingly on an
 * axial slice of a near-symmetric head, with left and right exchanged.
 *
 * {@link validateRigid} refuses it outright rather than warning, because the visual check a
 * human would apply is exactly the one this failure survives.
 *
 * ## Periodic anatomy gives the optimiser a near-equal wrong answer
 *
 * Vertebral bodies repeat. Mutual information one level up or down is almost as good as at
 * the right level, so a spine registration that started badly converges to an off-by-one
 * result that looks correct on every slice and puts the dose one vertebra away.
 * {@link vertebralAmbiguity} flags a superior-inferior translation near a vertebral pitch.
 *
 * ## A rigid transform cannot correct posture
 *
 * Arms up against arms down, neck flexed against extended: the optimiser returns a
 * transform anyway. It is right where the intensity gradient dominated and wrong elsewhere,
 * and nothing about the number says which region was fitted.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export type Point3 = [number, number, number];

/** Row-major 4x4, patient coordinates, millimetres. */
export type Matrix4 = number[];

export type RigidKind = 'rigid' | 'affine';

export const KIND_LABELS: Record<RigidKind, string> = {
  rigid: 'rígida (6 graus de liberdade)',
  affine: 'afim (12 graus de liberdade)',
};

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};

/** Rotation block of a row-major 4x4, as three rows. */
function rotationRows(m: Matrix4): [Point3, Point3, Point3] {
  return [
    [num(m[0]), num(m[1]), num(m[2])],
    [num(m[4]), num(m[5]), num(m[6])],
    [num(m[8]), num(m[9]), num(m[10])],
  ];
}

export function rigidTranslationOf(m: Matrix4): Point3 {
  return [num(m[3]), num(m[7]), num(m[11])];
}

export function determinantOf(m: Matrix4): number {
  const [r0, r1, r2] = rotationRows(m);
  return (
    r0[0] * (r1[1] * r2[2] - r1[2] * r2[1]) -
    r0[1] * (r1[0] * r2[2] - r1[2] * r2[0]) +
    r0[2] * (r1[0] * r2[1] - r1[1] * r2[0])
  );
}

/**
 * Rotation magnitude, degrees, from the trace.
 *
 * Deliberately not Euler angles: an angle from the trace has no convention and therefore no
 * sign to get wrong. Euler decomposition is where `couchShifts.ts` (RTV-208) previously had
 * a negated yaw, and nothing about the number looked wrong.
 */
export function rotationAngleDeg(m: Matrix4): number {
  const [r0, r1, r2] = rotationRows(m);
  const trace = r0[0] + r1[1] + r2[2];
  const cosine = Math.min(1, Math.max(-1, (trace - 1) / 2));
  return Math.acos(cosine) * (180 / Math.PI);
}

/** How far the rotation block departs from orthonormal. */
export function orthonormalityError(m: Matrix4): number {
  const rows = rotationRows(m);
  let worst = 0;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const dot = rows[i][0] * rows[j][0] + rows[i][1] * rows[j][1] + rows[i][2] * rows[j][2];
      const expected = i === j ? 1 : 0;
      worst = Math.max(worst, Math.abs(dot - expected));
    }
  }
  return worst;
}

export interface RigidValidation {
  ok: boolean;
  determinant: number;
  rotationDeg: number;
  translationMm: number;
  orthonormalityError: number;
  refusals: string[];
  warnings: string[];
}

/** Departure from orthonormal beyond this is not a rotation. */
export const ORTHONORMALITY_TOLERANCE = 1e-3;

/**
 * Whether a transform is what it claims to be.
 *
 * The determinant check is a refusal rather than a warning: a mirrored transform overlays
 * convincingly on an axial slice of a near-symmetric head with left and right exchanged, so
 * the visual check a human would apply is exactly the one it survives.
 */
export function validateRigid(m: Matrix4, kind: RigidKind = 'rigid'): RigidValidation {
  const refusals: string[] = [];
  const warnings: string[] = [];

  if (!Array.isArray(m) || m.length !== 16 || m.some(v => !Number.isFinite(num(v)))) {
    return {
      ok: false,
      determinant: NaN,
      rotationDeg: NaN,
      translationMm: NaN,
      orthonormalityError: NaN,
      refusals: ['Matriz ausente ou incompleta (esperado 4x4 em ordem de linha).'],
      warnings,
    };
  }

  const determinant = determinantOf(m);
  const rotationDeg = rotationAngleDeg(m);
  const t = rigidTranslationOf(m);
  const translationMm = Math.hypot(t[0], t[1], t[2]);
  const orthoError = orthonormalityError(m);

  if (determinant < 0) {
    refusals.push(
      `Determinante ${determinant.toFixed(3)}: a transformação é um espelhamento, e nenhum movimento físico produz isso. ` +
        'Quase sempre é um eixo invertido entre dois toolkits (confusão LPS/RAS). As imagens ainda vão se sobrepor de forma convincente ' +
        'num corte axial de uma cabeça quase simétrica, com esquerda e direita trocadas — a conferência visual que um humano faria é ' +
        'exatamente a que essa falha sobrevive.'
    );
  }
  if (kind === 'rigid') {
    if (Math.abs(determinant - 1) > 0.01 && determinant > 0) {
      refusals.push(
        `Determinante ${determinant.toFixed(3)} num registro declarado rígido: há escala embutida. ` +
          'Corpo rígido preserva volume — isso é afim rotulado como rígido.'
      );
    }
    if (orthoError > ORTHONORMALITY_TOLERANCE) {
      refusals.push(
        `Bloco de rotação não ortonormal (erro ${orthoError.toExponential(1)}). Não é uma rotação.`
      );
    }
  }

  return {
    ok: refusals.length === 0,
    determinant,
    rotationDeg,
    translationMm,
    orthonormalityError: orthoError,
    refusals,
    warnings,
  };
}

export interface DistortionEnvelope {
  /** Expected MR displacement at the given radius, millimetres. */
  atRadiusMm: number;
  radiusMm: number;
  /** Whether the registration can be treated as accurate there. */
  usable: boolean;
  message: string;
}

/** Typical MR geometric displacement, millimetres per centimetre of radius, beyond the centre. */
export const MR_DISTORTION_MM_PER_CM = 0.15;
/** Radius inside which distortion is negligible for RT purposes, millimetres. */
export const MR_TRUSTED_RADIUS_MM = 100;

/**
 * How much of the residual is the MR being geometrically untrue.
 *
 * A rigid transform has six degrees of freedom and cannot absorb a spatially varying
 * displacement, so accuracy is a function of distance from the magnet isocentre. A single
 * residual figure averages the good centre with the bad periphery and describes neither —
 * and the periphery is where the skull, the brain surface and the neck are.
 */
export function distortionEnvelope(
  radiusMm: number,
  options: { mmPerCm?: number; trustedRadiusMm?: number; distortionCorrected?: boolean } = {}
): DistortionEnvelope {
  const radius = Math.max(0, num(radiusMm) || 0);
  const rate = Number.isFinite(num(options.mmPerCm)) ? num(options.mmPerCm) : MR_DISTORTION_MM_PER_CM;
  const trusted = Number.isFinite(num(options.trustedRadiusMm))
    ? num(options.trustedRadiusMm)
    : MR_TRUSTED_RADIUS_MM;

  if (options.distortionCorrected) {
    return {
      atRadiusMm: 0,
      radiusMm: radius,
      usable: true,
      message: 'Sequência com correção de distorção declarada — a envoltória não se aplica.',
    };
  }

  const atRadiusMm = (Math.max(0, radius - trusted) / 10) * rate;
  const usable = radius <= trusted;

  return {
    atRadiusMm,
    radiusMm: radius,
    usable,
    message: usable
      ? `A ${radius.toFixed(0)} mm do isocentro do magneto a distorção é desprezível.`
      : `A ${radius.toFixed(0)} mm do isocentro do magneto a distorção geométrica da RM já vale cerca de ${atRadiusMm.toFixed(1)} mm. ` +
        'Uma transformação rígida tem seis graus de liberdade e não absorve deslocamento que varia no espaço: o registro é exato perto ' +
        'do centro e progressivamente errado para fora — e "para fora" é onde estão o crânio, a superfície cerebral e o pescoço. ' +
        'Um número único de resíduo faz a média do centro bom com a periferia ruim e não descreve nenhum dos dois.',
  };
}

export interface VertebralCheck {
  suspicious: boolean;
  /** Superior-inferior component of the translation, millimetres. */
  siTranslationMm: number;
  /** Nearest whole number of vertebral pitches. */
  levels: number;
  message: string;
}

/** Typical vertebral pitch in the thoracolumbar spine, millimetres. */
export const VERTEBRAL_PITCH_MM = 30;

/**
 * Whether the transform looks like an off-by-one-vertebra convergence.
 *
 * Vertebral bodies repeat, so mutual information one level up or down is almost as good as
 * at the right level. A spine registration that started badly converges to a result that
 * looks correct on every slice and puts the dose one vertebra away — there is no slice on
 * which it looks wrong, because every slice matches a vertebra.
 */
export function vertebralAmbiguity(
  m: Matrix4,
  options: { pitchMm?: number; toleranceMm?: number } = {}
): VertebralCheck {
  const t = rigidTranslationOf(m);
  // Superior-inferior is z in DICOM patient coordinates.
  const siTranslationMm = t[2];
  const pitch = Number.isFinite(num(options.pitchMm)) ? num(options.pitchMm) : VERTEBRAL_PITCH_MM;
  const tolerance = Number.isFinite(num(options.toleranceMm)) ? num(options.toleranceMm) : 8;

  if (!Number.isFinite(siTranslationMm) || !(pitch > 0)) {
    return { suspicious: false, siTranslationMm: NaN, levels: 0, message: '' };
  }

  const levels = Math.round(Math.abs(siTranslationMm) / pitch);
  const residual = Math.abs(Math.abs(siTranslationMm) - levels * pitch);
  const suspicious = levels >= 1 && residual <= tolerance;

  return {
    suspicious,
    siTranslationMm,
    levels,
    message: suspicious
      ? `Translação crânio-caudal de ${siTranslationMm.toFixed(1)} mm, a ${residual.toFixed(1)} mm de ${levels} corpo(s) vertebral(is). ` +
        'Corpos vertebrais se repetem, então a informação mútua um nível acima ou abaixo é quase tão boa quanto no nível certo: ' +
        'o resultado parece correto em TODOS os cortes e põe a dose uma vértebra ao lado. Não existe corte em que isso pareça errado, ' +
        'porque cada corte casa com uma vértebra. Confirme por landmark ósseo numerado.'
      : '',
  };
}

export interface PostureCheck {
  plausible: boolean;
  rotationDeg: number;
  translationMm: number;
  message: string;
}

/**
 * Whether the transform is a plausible difference in positioning.
 *
 * A rigid transform cannot correct posture. Arms up against arms down, neck flexed against
 * extended: the optimiser returns a transform anyway, right where the intensity gradient
 * dominated and wrong elsewhere, and nothing about the number says which region was fitted.
 */
export function posturePlausibility(
  m: Matrix4,
  context: { sameProtocol: boolean; maxRotationDeg?: number; maxTranslationMm?: number }
): PostureCheck {
  const rotationDeg = rotationAngleDeg(m);
  const t = rigidTranslationOf(m);
  const translationMm = Math.hypot(t[0], t[1], t[2]);
  const maxRotation = Number.isFinite(num(context?.maxRotationDeg))
    ? num(context.maxRotationDeg)
    : context?.sameProtocol
      ? 5
      : 20;
  const maxTranslation = Number.isFinite(num(context?.maxTranslationMm))
    ? num(context.maxTranslationMm)
    : context?.sameProtocol
      ? 30
      : 150;

  const plausible = rotationDeg <= maxRotation && translationMm <= maxTranslation;
  if (plausible) {
    return { plausible, rotationDeg, translationMm, message: '' };
  }

  return {
    plausible,
    rotationDeg,
    translationMm,
    message: context?.sameProtocol
      ? `Rotação de ${rotationDeg.toFixed(1)}° e translação de ${translationMm.toFixed(0)} mm entre dois exames do MESMO protocolo. ` +
        'Ou o paciente foi posicionado de forma muito diferente, ou o otimizador convergiu num mínimo local. Nas duas hipóteses o ' +
        'resíduo não é uniforme, e um número único esconde qual região foi ajustada.'
      : `Rotação de ${rotationDeg.toFixed(1)}° e translação de ${translationMm.toFixed(0)} mm. ` +
        'Diferença grande de postura não é corrigível por transformação rígida: braços para cima contra braços para baixo, pescoço ' +
        'fletido contra estendido. O otimizador devolve uma transformação de qualquer jeito, certa onde o gradiente de intensidade ' +
        'dominou e errada no resto.',
  };
}

export interface CacheKey {
  key: string;
  ok: boolean;
  reason?: string;
}

/**
 * Cache key for a computed transform.
 *
 * Includes the transform kind and any preprocessing, because a cache keyed only on the two
 * series returns a rigid transform to a caller who asked for affine — and the answer is
 * plausible, which is the whole problem.
 */
export function transformCacheKey(input: {
  fixedSeriesUid: string;
  movingSeriesUid: string;
  kind: RigidKind;
  /** Anything that changes the result: masking, resampling, metric. */
  preprocessing?: string;
  metric?: string;
}): CacheKey {
  const fixed = String(input?.fixedSeriesUid ?? '').trim();
  const moving = String(input?.movingSeriesUid ?? '').trim();
  if (!fixed || !moving) {
    return { key: '', ok: false, reason: 'Chave de cache exige as duas séries.' };
  }
  if (!KIND_LABELS[input?.kind]) {
    return {
      key: '',
      ok: false,
      reason:
        'Chave de cache exige o tipo de transformação. Uma chave só com as duas séries devolve uma transformação rígida a quem pediu ' +
        'afim, e a resposta é plausível — que é o problema inteiro.',
    };
  }
  return {
    key: [
      fixed,
      moving,
      input.kind,
      String(input.metric ?? 'default'),
      String(input.preprocessing ?? 'none'),
    ].join('|'),
    ok: true,
  };
}

export interface RigidQaVerdict {
  usable: boolean;
  /** Registration may be used for visual fusion. */
  fusion: boolean;
  /** Registration may be used to transfer contours or dose. */
  transfer: boolean;
  refusals: string[];
  warnings: string[];
  message: string;
}

/**
 * What the registration may be used for.
 *
 * Visual fusion tolerates a few millimetres; transferring a contour or a dose does not. The
 * split matters because the same transform is offered for both in the same dialog.
 */
export function rigidQaVerdict(input: {
  validation: RigidValidation;
  landmarkErrorMm?: number;
  landmarkCount?: number;
  distortion?: DistortionEnvelope;
  vertebral?: VertebralCheck;
  posture?: PostureCheck;
  fusionToleranceMm?: number;
  transferToleranceMm?: number;
}): RigidQaVerdict {
  const refusals = [...(input.validation?.refusals ?? [])];
  const warnings = [...(input.validation?.warnings ?? [])];

  if (input.vertebral?.suspicious) {
    refusals.push(input.vertebral.message);
  }
  if (input.posture && !input.posture.plausible) {
    warnings.push(input.posture.message);
  }
  if (input.distortion && !input.distortion.usable) {
    warnings.push(input.distortion.message);
  }

  const landmarkErrorMm = num(input.landmarkErrorMm);
  const landmarkCount = Math.max(0, Math.floor(num(input.landmarkCount) || 0));
  const fusionTolerance = Number.isFinite(num(input.fusionToleranceMm)) ? num(input.fusionToleranceMm) : 5;
  const transferTolerance = Number.isFinite(num(input.transferToleranceMm))
    ? num(input.transferToleranceMm)
    : 2;

  let fusion = refusals.length === 0;
  let transfer = refusals.length === 0;

  if (!landmarkCount) {
    transfer = false;
    warnings.push(
      'Sem landmarks marcados por um humano. Jacobiano e métrica de similaridade não valem aqui — a similaridade é a função que o ' +
        'otimizador maximizou (ver RTV-199), e uma transformação rígida bem-comportada e errada tem exatamente a mesma aparência de uma certa.'
    );
  } else {
    if (Number.isFinite(landmarkErrorMm) && landmarkErrorMm > fusionTolerance) {
      fusion = false;
    }
    if (!Number.isFinite(landmarkErrorMm) || landmarkErrorMm > transferTolerance) {
      transfer = false;
    }
  }

  const parts: string[] = [];
  if (refusals.length) {
    parts.push(refusals.join(' '));
  } else {
    parts.push(
      `Fusão visual: ${fusion ? 'liberada' : 'não liberada'}. Transferência de contorno ou dose: ${transfer ? 'liberada' : 'não liberada'}.`
    );
  }
  if (warnings.length) {
    parts.push(warnings.join(' '));
  }

  return {
    usable: refusals.length === 0,
    fusion,
    transfer,
    refusals,
    warnings,
    message: parts.join(' '),
  };
}

/** One line for the registration panel. */
export function describeRigidQa(verdict: RigidQaVerdict): string {
  return verdict.message;
}
