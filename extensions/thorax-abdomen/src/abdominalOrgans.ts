/**
 * Organ volume and density from an abdominal segmentation — pure core (RTV-72).
 *
 * The segmentation itself is a Python sidecar. This is the part that turns a mask into
 * numbers a radiologist can put in a report, and the part that refuses to.
 *
 * ## An attenuation with no contrast phase is a number with no unit
 *
 * A liver at 55 HU is normal unenhanced and markedly abnormal in the portal-venous phase.
 * The same three digits, and the difference between "nothing to say" and "significant
 * steatosis, mention it". Reporting organ density without the phase is not an incomplete
 * measurement, it is an uninterpretable one, so {@link measureOrgan} carries the phase and
 * {@link hepaticSteatosis} refuses to apply its thresholds outside the phase they were
 * derived in.
 *
 * ## Volume accuracy is not the same for a liver and an adrenal
 *
 * Voxel counting is wrong at the boundary, by roughly half a voxel each way, and the size
 * of that error relative to the organ is set by the surface-to-volume ratio. The same
 * segmentation quality gives a liver volume good to a fraction of a percent and an adrenal
 * volume good to perhaps ten. Printing both to the same decimal place asserts a precision
 * that one of them does not have — {@link measureOrgan} returns the uncertainty alongside.
 *
 * ## A mean over a whole organ answers a question nobody asked
 *
 * A liver with a large cyst, a kidney including the opacified collecting system: the mean
 * lands between the two populations, on a value that describes neither. The median and the
 * interquartile range are reported for that reason, and a wide spread is flagged rather
 * than averaged over.
 *
 * ## Leakage moves two organs in opposite directions
 *
 * A segmentation that spills from liver into spleen inflates one and deflates the other by
 * the same amount. The total is preserved, so a "does everything add up" check passes.
 * {@link adjacencySuspicion} looks at the shared boundary instead.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export type Organ =
  | 'liver'
  | 'spleen'
  | 'kidney-left'
  | 'kidney-right'
  | 'pancreas'
  | 'gallbladder'
  | 'adrenal-left'
  | 'adrenal-right'
  | 'aorta';

export const ORGAN_LABELS: Record<Organ, string> = {
  liver: 'fígado',
  spleen: 'baço',
  'kidney-left': 'rim esquerdo',
  'kidney-right': 'rim direito',
  pancreas: 'pâncreas',
  gallbladder: 'vesícula biliar',
  'adrenal-left': 'adrenal esquerda',
  'adrenal-right': 'adrenal direita',
  aorta: 'aorta',
};

export type ContrastPhase = 'unenhanced' | 'arterial' | 'portal-venous' | 'delayed' | 'unknown';

export const PHASE_LABELS: Record<ContrastPhase, string> = {
  unenhanced: 'sem contraste',
  arterial: 'fase arterial',
  'portal-venous': 'fase portal',
  delayed: 'fase tardia',
  unknown: 'fase desconhecida',
};

export interface Grid {
  dims: [number, number, number];
  /** Millimetres. */
  spacing: [number, number, number];
}

export interface OrganMeasurement {
  organ: Organ;
  phase: ContrastPhase;
  voxels: number;
  boundaryVoxels: number;
  volumeMl: number;
  /** Half a voxel each way over the boundary, in millilitres. */
  volumeUncertaintyMl: number;
  /** Uncertainty as a fraction of the volume. */
  volumeUncertaintyFraction: number;
  meanHu: number;
  medianHu: number;
  p25Hu: number;
  p75Hu: number;
  /** Voxels dropped by an explicit HU window, and why. */
  excludedVoxels: number;
  warnings: string[];
  ok: boolean;
  reason?: string;
}

const index = (dims: [number, number, number], x: number, y: number, z: number): number =>
  x + dims[0] * (y + dims[1] * z);

/** Interquartile range beyond this means the organ is not one population. */
export const WIDE_SPREAD_HU = 40;

/**
 * Volume, density and their uncertainty for one segmented organ.
 *
 * Returns the median and the interquartile range as well as the mean, because the mean of a
 * bimodal organ lands between the two populations on a value that describes neither.
 */
export function measureOrgan(
  hu: ArrayLike<number>,
  mask: ArrayLike<number>,
  grid: Grid,
  organ: Organ,
  phase: ContrastPhase,
  options: { excludeHuOutside?: [number, number] } = {}
): OrganMeasurement {
  const [nx, ny, nz] = grid.dims;
  const voxelMl = (grid.spacing[0] * grid.spacing[1] * grid.spacing[2]) / 1000;
  const warnings: string[] = [];
  const values: number[] = [];
  let voxels = 0;
  let boundaryVoxels = 0;
  let excludedVoxels = 0;
  const window = options.excludeHuOutside;

  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const i = index(grid.dims, x, y, z);
        if (mask[i] !== 1) {
          continue;
        }
        voxels++;
        const neighbours: Array<[number, number, number]> = [
          [x - 1, y, z], [x + 1, y, z], [x, y - 1, z], [x, y + 1, z], [x, y, z - 1], [x, y, z + 1],
        ];
        for (const [ax, ay, az] of neighbours) {
          const out =
            ax < 0 || ay < 0 || az < 0 || ax >= nx || ay >= ny || az >= nz
              ? true
              : mask[index(grid.dims, ax, ay, az)] !== 1;
          if (out) {
            boundaryVoxels++;
            break;
          }
        }
        const value = Number(hu[i]);
        if (!Number.isFinite(value)) {
          excludedVoxels++;
          continue;
        }
        if (window && (value < window[0] || value > window[1])) {
          excludedVoxels++;
          continue;
        }
        values.push(value);
      }
    }
  }

  if (!voxels) {
    return empty(`Máscara de ${ORGAN_LABELS[organ]} vazia.`);
  }
  if (!values.length) {
    return empty(`Nenhum voxel de ${ORGAN_LABELS[organ]} sobrou depois da janela de exclusão.`);
  }

  const volumeMl = voxels * voxelMl;
  // Each boundary voxel is roughly half in and half out; that is the error, and its size
  // relative to the organ is set by the surface-to-volume ratio.
  const volumeUncertaintyMl = 0.5 * boundaryVoxels * voxelMl;
  const volumeUncertaintyFraction = volumeMl > 0 ? volumeUncertaintyMl / volumeMl : 0;

  values.sort((a, b) => a - b);
  const meanHu = values.reduce((a, b) => a + b, 0) / values.length;
  const medianHu = quantile(values, 0.5);
  const p25Hu = quantile(values, 0.25);
  const p75Hu = quantile(values, 0.75);
  const iqr = p75Hu - p25Hu;

  if (phase === 'unknown') {
    warnings.push(
      'Fase de contraste desconhecida. Uma atenuação sem fase não é uma medida incompleta, é uma medida ininterpretável: ' +
        '55 HU no fígado é normal sem contraste e nitidamente anormal na fase portal.'
    );
  }
  if (volumeUncertaintyFraction > 0.05) {
    warnings.push(
      `Incerteza de volume de ${(volumeUncertaintyFraction * 100).toFixed(0)}% pela contagem de voxels de borda — ` +
        'órgão pequeno tem proporcionalmente muito mais borda, e o mesmo contorno dá precisões muito diferentes.'
    );
  }
  if (iqr > WIDE_SPREAD_HU) {
    warnings.push(
      `Dispersão interna larga (IQR ${iqr.toFixed(0)} HU): o órgão não é uma população só. A média cai entre as duas e não descreve nenhuma — ` +
        'use a mediana e olhe o que está dentro.'
    );
  }
  if (excludedVoxels > 0) {
    warnings.push(`${excludedVoxels} voxel(s) fora da janela de exclusão não entraram na densidade.`);
  }

  return {
    organ,
    phase,
    voxels,
    boundaryVoxels,
    volumeMl,
    volumeUncertaintyMl,
    volumeUncertaintyFraction,
    meanHu,
    medianHu,
    p25Hu,
    p75Hu,
    excludedVoxels,
    warnings,
    ok: true,
  };

  function empty(reason: string): OrganMeasurement {
    return {
      organ,
      phase,
      voxels,
      boundaryVoxels,
      volumeMl: 0,
      volumeUncertaintyMl: 0,
      volumeUncertaintyFraction: 0,
      meanHu: NaN,
      medianHu: NaN,
      p25Hu: NaN,
      p75Hu: NaN,
      excludedVoxels,
      warnings,
      ok: false,
      reason,
    };
  }
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) {
    return NaN;
  }
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return low === high ? sorted[low] : sorted[low] + (position - low) * (sorted[high] - sorted[low]);
}

export type SteatosisGrade = 'none' | 'mild' | 'moderate-severe' | 'indeterminate';

export interface SteatosisResult {
  grade: SteatosisGrade;
  liverHu: number;
  spleenHu: number | null;
  /** Liver minus spleen, the technique-independent form. */
  differenceHu: number | null;
  applicable: boolean;
  message: string;
}

/** Unenhanced liver attenuation at or below this indicates steatosis. */
export const LIVER_STEATOSIS_HU = 40;
/** Liver minus spleen at or below this indicates moderate-to-severe steatosis. */
export const LIVER_SPLEEN_DIFFERENCE_HU = -10;

/**
 * Hepatic steatosis from unenhanced attenuation.
 *
 * Refuses on a contrast-enhanced study. The thresholds were derived unenhanced and the
 * enhancement depends on the injection, the timing and the cardiac output — applying them
 * to a portal-venous liver produces a grade that varies with how fast the contrast was
 * pushed.
 *
 * The liver-minus-spleen difference is preferred where a spleen is available because it
 * normalises for kV, reconstruction kernel and patient size, which the absolute number does
 * not.
 */
export function hepaticSteatosis(
  liver: OrganMeasurement,
  spleen?: OrganMeasurement
): SteatosisResult {
  const liverHu = Number(liver?.medianHu);
  const spleenHu = spleen && Number.isFinite(Number(spleen.medianHu)) ? Number(spleen.medianHu) : null;

  if (!Number.isFinite(liverHu)) {
    return {
      grade: 'indeterminate',
      liverHu,
      spleenHu,
      differenceHu: null,
      applicable: false,
      message: 'Sem atenuação hepática medida.',
    };
  }

  if (liver.phase !== 'unenhanced') {
    return {
      grade: 'indeterminate',
      liverHu,
      spleenHu,
      differenceHu: spleenHu === null ? null : liverHu - spleenHu,
      applicable: false,
      message:
        `Limiares de esteatose não se aplicam em ${PHASE_LABELS[liver.phase]}. Eles foram derivados sem contraste, ` +
        'e o realce depende da injeção, do tempo e do débito cardíaco — aplicá-los aqui produz um grau que varia com a velocidade com que o contraste foi empurrado.',
    };
  }

  if (spleen && spleen.phase !== liver.phase) {
    return {
      grade: 'indeterminate',
      liverHu,
      spleenHu,
      differenceHu: null,
      applicable: false,
      message: 'Fígado e baço medidos em fases diferentes — a diferença não significa nada.',
    };
  }

  const differenceHu = spleenHu === null ? null : liverHu - spleenHu;

  if (differenceHu !== null && differenceHu <= LIVER_SPLEEN_DIFFERENCE_HU) {
    return {
      grade: 'moderate-severe',
      liverHu,
      spleenHu,
      differenceHu,
      applicable: true,
      message: `Fígado ${liverHu.toFixed(0)} HU, baço ${spleenHu!.toFixed(0)} HU, diferença ${differenceHu.toFixed(0)} HU — esteatose moderada a acentuada.`,
    };
  }
  if (liverHu <= LIVER_STEATOSIS_HU) {
    return {
      grade: 'moderate-severe',
      liverHu,
      spleenHu,
      differenceHu,
      applicable: true,
      message: `Fígado ${liverHu.toFixed(0)} HU, igual ou abaixo de ${LIVER_STEATOSIS_HU} HU — esteatose moderada a acentuada.`,
    };
  }
  if (differenceHu !== null && differenceHu < 1) {
    return {
      grade: 'mild',
      liverHu,
      spleenHu,
      differenceHu,
      applicable: true,
      message: `Diferença fígado-baço de ${differenceHu.toFixed(0)} HU — esteatose leve.`,
    };
  }

  return {
    grade: 'none',
    liverHu,
    spleenHu,
    differenceHu,
    applicable: true,
    message: spleenHu === null
      ? `Fígado ${liverHu.toFixed(0)} HU, sem esteatose pelos limiares absolutos. Sem baço para normalizar por técnica.`
      : `Fígado ${liverHu.toFixed(0)} HU, diferença ${differenceHu!.toFixed(0)} HU — sem esteatose.`,
  };
}

export interface LeakSuspicion {
  suspicious: boolean;
  /** Fraction of the first organ's boundary that touches the second. */
  sharedFraction: number;
  message: string;
}

/**
 * Shared boundary between two organ masks.
 *
 * Leakage between adjacent organs inflates one and deflates the other by the same amount,
 * so the total volume is preserved and a "does it add up" check passes. A long shared
 * surface is a hint, not a proof — organs do touch — but it is the only hint available from
 * the masks alone.
 */
export function adjacencySuspicion(
  maskA: ArrayLike<number>,
  maskB: ArrayLike<number>,
  grid: Grid,
  threshold = 0.25
): LeakSuspicion {
  const [nx, ny, nz] = grid.dims;
  let boundary = 0;
  let shared = 0;

  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const i = index(grid.dims, x, y, z);
        if (maskA[i] !== 1) {
          continue;
        }
        let isBoundary = false;
        let touchesB = false;
        const neighbours: Array<[number, number, number]> = [
          [x - 1, y, z], [x + 1, y, z], [x, y - 1, z], [x, y + 1, z], [x, y, z - 1], [x, y, z + 1],
        ];
        for (const [ax, ay, az] of neighbours) {
          if (ax < 0 || ay < 0 || az < 0 || ax >= nx || ay >= ny || az >= nz) {
            isBoundary = true;
            continue;
          }
          const j = index(grid.dims, ax, ay, az);
          if (maskA[j] !== 1) {
            isBoundary = true;
            if (maskB[j] === 1) {
              touchesB = true;
            }
          }
        }
        if (isBoundary) {
          boundary++;
          if (touchesB) {
            shared++;
          }
        }
      }
    }
  }

  const sharedFraction = boundary > 0 ? shared / boundary : 0;
  // Not `Number(threshold) || 0.25`: a caller asking for a threshold of zero -- "flag any
  // contact at all" -- would have it silently replaced by the default, and the check would
  // quietly stop doing what was asked.
  const parsed = Number(threshold);
  const limit = Math.max(0, Number.isFinite(parsed) ? parsed : 0.25);
  return {
    suspicious: sharedFraction > limit,
    sharedFraction,
    message:
      sharedFraction > limit
        ? `${(sharedFraction * 100).toFixed(0)}% da borda é compartilhada. Vazamento entre órgãos vizinhos infla um e deflaciona o outro na mesma medida, ` +
          'então o total continua batendo e uma conferência de soma passa. Confira a interface.'
        : '',
  };
}

/** One line per organ for the abdominal panel. */
export function describeOrgan(measurement: OrganMeasurement): string {
  if (!measurement.ok) {
    return measurement.reason ?? '';
  }
  const uncertainty =
    measurement.volumeUncertaintyFraction > 0.02
      ? ` ± ${measurement.volumeUncertaintyMl.toFixed(0)} mL`
      : '';
  const warnings = measurement.warnings.length ? ` ${measurement.warnings.join(' ')}` : '';
  return (
    `${ORGAN_LABELS[measurement.organ]}: ${measurement.volumeMl.toFixed(0)} mL${uncertainty}, ` +
    `mediana ${measurement.medianHu.toFixed(0)} HU (IQR ${measurement.p25Hu.toFixed(0)}–${measurement.p75Hu.toFixed(0)}), ${PHASE_LABELS[measurement.phase]}.${warnings}`
  );
}
