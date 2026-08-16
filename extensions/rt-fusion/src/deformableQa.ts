/**
 * Deformable registration QA for oncologic follow-up — pure core (RTV-199).
 *
 * RTV-205 registered follow-up studies and RTV-134 handles the fusion session. This is the
 * part that decides whether a deformation vector field may be *used*, and for what.
 *
 * ## Image similarity cannot validate a registration
 *
 * The statement worth making first, because it is the QA metric everyone reaches for: NCC,
 * mutual information and their relatives are what the optimiser maximised. Reporting one
 * back as evidence of accuracy measures how hard the algorithm tried, not whether it was
 * right. A deformable field with enough degrees of freedom can align almost any two images
 * beautifully while moving tissue to places it never was.
 *
 * The three checks here are independent of the objective function: the **Jacobian**, which
 * is a property of the field alone; **inverse consistency**, which asks the two directions
 * to agree with each other; and **landmark error**, which asks a human.
 *
 * ## A field that folds is not a deformation
 *
 * Where the Jacobian determinant is zero or negative, the transform is not invertible:
 * tissue has been turned inside out. It is not a small error, and it does not look like
 * one — the images align *because* the algorithm pushed voxels through each other. Any
 * contour or dose carried through a folded region is meaningless, and
 * {@link foldingReport} localises it rather than reporting a global score.
 *
 * ## Propagating a contour and then measuring it measures the registration
 *
 * This is the one specific to oncologic follow-up, and it is the failure this ticket
 * exists inside. A deformable registration is driven by image intensity. In a follow-up
 * study, **the intensity is what changed** — that is the finding. Propagating the baseline
 * lesion contour onto the follow-up and reading a diameter off it produces a number
 * describing how the algorithm interpolated, and it is biased towards *no change*, because
 * the field was fitted to make the two look alike. {@link propagatedMeasurement} refuses.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export interface Grid {
  dims: [number, number, number];
  /** Millimetres per voxel. */
  spacing: [number, number, number];
}

/**
 * Displacement per voxel, in millimetres, laid out x,y,z per voxel with x fastest.
 *
 * Millimetres rather than voxels so an anisotropic grid cannot silently rescale the field —
 * the classic way a registration comes out stretched along the slice axis.
 */
export type Dvf = Float32Array | Float64Array;

const at = (grid: Grid, x: number, y: number, z: number): number =>
  x + grid.dims[0] * (y + grid.dims[1] * z);

const clamp = (value: number, low: number, high: number): number =>
  value < low ? low : value > high ? high : value;

export function voxelCount(grid: Grid): number {
  return grid.dims[0] * grid.dims[1] * grid.dims[2];
}

/** Displacement at an arbitrary point (millimetres), trilinearly interpolated. */
export function sampleDvf(dvf: Dvf, grid: Grid, point: [number, number, number]): [number, number, number] {
  const [nx, ny, nz] = grid.dims;
  const fx = clamp(point[0] / grid.spacing[0], 0, nx - 1);
  const fy = clamp(point[1] / grid.spacing[1], 0, ny - 1);
  const fz = clamp(point[2] / grid.spacing[2], 0, nz - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const z0 = Math.floor(fz);
  const x1 = Math.min(nx - 1, x0 + 1);
  const y1 = Math.min(ny - 1, y0 + 1);
  const z1 = Math.min(nz - 1, z0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const tz = fz - z0;

  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const c000 = dvf[3 * at(grid, x0, y0, z0) + c];
    const c100 = dvf[3 * at(grid, x1, y0, z0) + c];
    const c010 = dvf[3 * at(grid, x0, y1, z0) + c];
    const c110 = dvf[3 * at(grid, x1, y1, z0) + c];
    const c001 = dvf[3 * at(grid, x0, y0, z1) + c];
    const c101 = dvf[3 * at(grid, x1, y0, z1) + c];
    const c011 = dvf[3 * at(grid, x0, y1, z1) + c];
    const c111 = dvf[3 * at(grid, x1, y1, z1) + c];
    const c00 = c000 * (1 - tx) + c100 * tx;
    const c10 = c010 * (1 - tx) + c110 * tx;
    const c01 = c001 * (1 - tx) + c101 * tx;
    const c11 = c011 * (1 - tx) + c111 * tx;
    const c0 = c00 * (1 - ty) + c10 * ty;
    const c1 = c01 * (1 - ty) + c11 * ty;
    out[c] = c0 * (1 - tz) + c1 * tz;
  }
  return out;
}

/**
 * Jacobian determinant of the transform `x -> x + u(x)`, per voxel.
 *
 * A property of the field alone, which is exactly why it is worth computing: it owes
 * nothing to the objective function the registration maximised.
 *
 * 1 means volume preserved, 2 means the voxel doubled, 0.5 means it halved, and anything
 * at or below zero means the field folded.
 */
export function jacobianDeterminants(dvf: Dvf, grid: Grid): Float64Array {
  const [nx, ny, nz] = grid.dims;
  const [sx, sy, sz] = grid.spacing;
  const out = new Float64Array(nx * ny * nz);

  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        // One-sided at the border, central inside; the step is the actual distance, so a
        // border voxel is not silently given a half-size gradient.
        const xm = Math.max(0, x - 1);
        const xp = Math.min(nx - 1, x + 1);
        const ym = Math.max(0, y - 1);
        const yp = Math.min(ny - 1, y + 1);
        const zm = Math.max(0, z - 1);
        const zp = Math.min(nz - 1, z + 1);
        const dx = (xp - xm) * sx;
        const dy = (yp - ym) * sy;
        const dz = (zp - zm) * sz;

        const g = (c: number, a: number, b: number, step: number): number =>
          step > 0 ? (dvf[3 * a + c] - dvf[3 * b + c]) / step : 0;

        const ixp = at(grid, xp, y, z);
        const ixm = at(grid, xm, y, z);
        const iyp = at(grid, x, yp, z);
        const iym = at(grid, x, ym, z);
        const izp = at(grid, x, y, zp);
        const izm = at(grid, x, y, zm);

        const a11 = 1 + g(0, ixp, ixm, dx);
        const a12 = g(0, iyp, iym, dy);
        const a13 = g(0, izp, izm, dz);
        const a21 = g(1, ixp, ixm, dx);
        const a22 = 1 + g(1, iyp, iym, dy);
        const a23 = g(1, izp, izm, dz);
        const a31 = g(2, ixp, ixm, dx);
        const a32 = g(2, iyp, iym, dy);
        const a33 = 1 + g(2, izp, izm, dz);

        out[at(grid, x, y, z)] =
          a11 * (a22 * a33 - a23 * a32) -
          a12 * (a21 * a33 - a23 * a31) +
          a13 * (a21 * a32 - a22 * a31);
      }
    }
  }
  return out;
}

export interface FoldingReport {
  /** Voxels where the determinant is at or below zero. */
  foldedVoxels: number[];
  foldedFraction: number;
  minDeterminant: number;
  maxDeterminant: number;
  folded: boolean;
  message: string;
}

/**
 * Where the field folded.
 *
 * Localised rather than scored: a global "0.2% folding" number tells a planner nothing
 * about whether the fold sits in the GTV or in the air outside the patient.
 */
export function foldingReport(determinants: Float64Array): FoldingReport {
  const foldedVoxels: number[] = [];
  let minDeterminant = Number.POSITIVE_INFINITY;
  let maxDeterminant = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < determinants.length; i++) {
    const value = determinants[i];
    minDeterminant = Math.min(minDeterminant, value);
    maxDeterminant = Math.max(maxDeterminant, value);
    if (!(value > 0)) {
      foldedVoxels.push(i);
    }
  }

  const foldedFraction = determinants.length ? foldedVoxels.length / determinants.length : 0;
  return {
    foldedVoxels,
    foldedFraction,
    minDeterminant: Number.isFinite(minDeterminant) ? minDeterminant : 0,
    maxDeterminant: Number.isFinite(maxDeterminant) ? maxDeterminant : 0,
    folded: foldedVoxels.length > 0,
    message: foldedVoxels.length
      ? `Campo dobra em ${foldedVoxels.length} voxel(s) (${(foldedFraction * 100).toFixed(2)}%), jacobiano mínimo ${minDeterminant.toFixed(3)}. ` +
        'Onde o determinante é zero ou negativo a transformação não é inversível: o tecido foi virado do avesso. ' +
        'Contorno ou dose que passe por ali não significa nada.'
      : '',
  };
}

export interface PlausibilityLimits {
  /** Smallest credible volume ratio for this site. */
  min: number;
  /** Largest credible volume ratio. */
  max: number;
  site: string;
}

/** Lung breathes; brain does not. The limits belong to the site, so they are injected. */
export const PLAUSIBILITY: Record<string, PlausibilityLimits> = {
  lung: { min: 0.5, max: 2.5, site: 'pulmão' },
  liver: { min: 0.7, max: 1.5, site: 'fígado' },
  brain: { min: 0.9, max: 1.1, site: 'encéfalo' },
  pelvis: { min: 0.6, max: 1.8, site: 'pelve' },
};

export interface PlausibilityReport {
  implausibleVoxels: number;
  implausibleFraction: number;
  plausible: boolean;
  message: string;
}

/**
 * Deformation that is mathematically valid and biologically not.
 *
 * A Jacobian of 3 means a voxel tripled in volume. In lung, over a breath, that can be
 * real. In brain it is the registration inventing motion to explain an intensity
 * difference that had another cause.
 */
export function plausibilityReport(
  determinants: Float64Array,
  limits: PlausibilityLimits
): PlausibilityReport {
  let implausibleVoxels = 0;
  for (let i = 0; i < determinants.length; i++) {
    const value = determinants[i];
    if (!(value >= limits.min && value <= limits.max)) {
      implausibleVoxels++;
    }
  }
  const implausibleFraction = determinants.length ? implausibleVoxels / determinants.length : 0;
  return {
    implausibleVoxels,
    implausibleFraction,
    plausible: implausibleVoxels === 0,
    message: implausibleVoxels
      ? `${implausibleVoxels} voxel(s) (${(implausibleFraction * 100).toFixed(2)}%) fora da faixa de deformação plausível para ${limits.site} (${limits.min}–${limits.max}).`
      : '',
  };
}

export interface InverseConsistency {
  meanMm: number;
  maxMm: number;
  p95Mm: number;
  message: string;
}

/**
 * How far a round trip through both fields misses its starting point.
 *
 * Model-free and independent of the objective: it asks the two directions to agree with
 * each other. It matters here in particular because follow-up workflows propagate contours
 * one way and read measurements the other, so a directional disagreement becomes a
 * measurement error nobody attributes to the registration.
 */
export function inverseConsistency(
  forward: Dvf,
  backward: Dvf,
  grid: Grid,
  step = 1
): InverseConsistency {
  const [nx, ny, nz] = grid.dims;
  const [sx, sy, sz] = grid.spacing;
  const residuals: number[] = [];
  const stride = Math.max(1, Math.floor(Number(step) || 1));

  for (let z = 0; z < nz; z += stride) {
    for (let y = 0; y < ny; y += stride) {
      for (let x = 0; x < nx; x += stride) {
        const i = at(grid, x, y, z);
        const px = x * sx;
        const py = y * sy;
        const pz = z * sz;
        const ux = forward[3 * i];
        const uy = forward[3 * i + 1];
        const uz = forward[3 * i + 2];
        const back = sampleDvf(backward, grid, [px + ux, py + uy, pz + uz]);
        residuals.push(Math.hypot(ux + back[0], uy + back[1], uz + back[2]));
      }
    }
  }

  if (!residuals.length) {
    return { meanMm: 0, maxMm: 0, p95Mm: 0, message: 'Sem amostras.' };
  }

  residuals.sort((a, b) => a - b);
  const mean = residuals.reduce((a, b) => a + b, 0) / residuals.length;
  const p95 = residuals[Math.min(residuals.length - 1, Math.floor(0.95 * residuals.length))];
  const max = residuals[residuals.length - 1];

  return {
    meanMm: mean,
    maxMm: max,
    p95Mm: p95,
    message: `Inconsistência inversa: média ${mean.toFixed(2)} mm, p95 ${p95.toFixed(2)} mm, máxima ${max.toFixed(2)} mm.`,
  };
}

export interface LandmarkPair {
  label: string;
  /** Millimetres in the fixed image. */
  fixed: [number, number, number];
  /** Millimetres in the moving image. */
  moving: [number, number, number];
}

export interface LandmarkError {
  perLandmark: Array<{ label: string; errorMm: number }>;
  meanMm: number;
  maxMm: number;
  count: number;
  message: string;
}

/**
 * Target registration error against landmarks a human placed.
 *
 * The only one of the three checks that brings information from outside the images, and
 * therefore the only one that can catch a field that is smooth, invertible, plausible and
 * wrong.
 */
export function landmarkError(
  dvf: Dvf,
  grid: Grid,
  landmarks: LandmarkPair[]
): LandmarkError {
  const perLandmark = (landmarks ?? []).map(pair => {
    const u = sampleDvf(dvf, grid, pair.fixed);
    return {
      label: pair.label,
      errorMm: Math.hypot(
        pair.fixed[0] + u[0] - pair.moving[0],
        pair.fixed[1] + u[1] - pair.moving[1],
        pair.fixed[2] + u[2] - pair.moving[2]
      ),
    };
  });

  if (!perLandmark.length) {
    return {
      perLandmark,
      meanMm: NaN,
      maxMm: NaN,
      count: 0,
      message:
        'Nenhum landmark. Sem um par marcado por um humano, as outras métricas só dizem que o campo é bem-comportado — não que ele está certo.',
    };
  }

  const errors = perLandmark.map(l => l.errorMm);
  const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
  const max = Math.max(...errors);
  return {
    perLandmark,
    meanMm: mean,
    maxMm: max,
    count: errors.length,
    message: `Erro em ${errors.length} landmark(s): média ${mean.toFixed(2)} mm, máximo ${max.toFixed(2)} mm.`,
  };
}

export interface UsageVerdict {
  contourPropagation: boolean;
  doseAccumulation: boolean;
  /** Never true. See {@link propagatedMeasurement}. */
  measurement: false;
  reasons: string[];
  message: string;
}

export interface QaThresholds {
  /** Maximum tolerable mean inverse-consistency error, millimetres. */
  inverseConsistencyMm: number;
  /** Maximum tolerable mean landmark error, millimetres. */
  landmarkMm: number;
  /** Folding is never tolerated for dose; this is the limit for contours. */
  foldedFraction: number;
}

export const DEFAULT_THRESHOLDS: QaThresholds = {
  inverseConsistencyMm: 2,
  landmarkMm: 3,
  foldedFraction: 0,
};

/**
 * What this field may be used for.
 *
 * Dose accumulation is held to a stricter standard than contour propagation, because a
 * propagated contour is reviewed by a human before it is treated and an accumulated dose
 * distribution usually is not — it becomes a number in a plan comparison.
 */
export function usageVerdict(
  folding: FoldingReport,
  consistency: InverseConsistency,
  landmarks: LandmarkError,
  plausibility: PlausibilityReport,
  thresholds: QaThresholds = DEFAULT_THRESHOLDS
): UsageVerdict {
  const reasons: string[] = [];
  let contourPropagation = true;
  let doseAccumulation = true;

  if (folding.folded) {
    doseAccumulation = false;
    reasons.push(folding.message);
    if (folding.foldedFraction > thresholds.foldedFraction) {
      contourPropagation = false;
    }
  }
  if (consistency.meanMm > thresholds.inverseConsistencyMm) {
    contourPropagation = false;
    doseAccumulation = false;
    reasons.push(
      `${consistency.message} Acima de ${thresholds.inverseConsistencyMm} mm as duas direções discordam o bastante para o contorno propagado e a dose acumulada descreverem geometrias diferentes.`
    );
  }
  if (!landmarks.count) {
    doseAccumulation = false;
    reasons.push(landmarks.message);
  } else if (landmarks.meanMm > thresholds.landmarkMm) {
    contourPropagation = false;
    doseAccumulation = false;
    reasons.push(`${landmarks.message} Acima de ${thresholds.landmarkMm} mm.`);
  }
  if (!plausibility.plausible) {
    reasons.push(plausibility.message);
  }

  return {
    contourPropagation,
    doseAccumulation,
    measurement: false,
    reasons,
    message: reasons.length
      ? reasons.join(' ')
      : 'Campo aprovado para propagação de contorno e acumulação de dose.',
  };
}

export interface MeasurementRefusal {
  ok: false;
  reason: string;
}

/**
 * Refuses a measurement read off a propagated contour.
 *
 * The failure this ticket sits inside. A deformable registration is driven by image
 * intensity; in a follow-up study **the intensity is what changed**, and that change is the
 * finding. Propagating the baseline contour and reading a diameter from it describes how
 * the algorithm interpolated, and it is biased towards *no change* — the field was fitted
 * to make the two studies look alike. Which is precisely the direction that loses a
 * progression.
 */
export function propagatedMeasurement(): MeasurementRefusal {
  return {
    ok: false,
    reason:
      'Medida lida de contorno propagado não vale como medida de resposta. O registro deformável é guiado pela intensidade da ' +
      'imagem, e no seguimento é justamente a intensidade que mudou -- essa mudança é o achado. O número descreve como o algoritmo ' +
      'interpolou, e o viés é na direção de "sem mudança", porque o campo foi ajustado para fazer os dois exames se parecerem. ' +
      'Meça no exame de seguimento, com o contorno propagado servindo apenas de ponto de partida revisado.',
  };
}

/**
 * The other refusal: image similarity offered as evidence of accuracy.
 *
 * NCC and mutual information are what the optimiser maximised. Quoting one back measures
 * how hard the algorithm tried.
 */
export function similarityAsAccuracy(metric: string): MeasurementRefusal {
  return {
    ok: false,
    reason:
      `${metric} é a função que o registro maximizou — devolvê-la como evidência de acurácia mede o quanto o algoritmo se esforçou, ` +
      'não se ele acertou. Use jacobiano, consistência inversa e landmarks, que não dependem da função objetivo.',
  };
}

/** One line for the fusion QA panel. */
export function describeQa(verdict: UsageVerdict): string {
  const uses = [
    verdict.contourPropagation ? 'contorno: sim' : 'contorno: não',
    verdict.doseAccumulation ? 'dose: sim' : 'dose: não',
    'medida: nunca',
  ].join(' · ');
  return `${uses}. ${verdict.message}`;
}
