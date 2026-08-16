/**
 * Skeletal muscle index at L3 — pure core (RTV-74).
 *
 * The sarcopenia measurement that a body-composition tool exists to produce, and the one
 * where every published cutoff depends on the measurement being made exactly one way.
 *
 * ## The slice is part of the definition
 *
 * The cutoffs come from cohorts measured on a single axial slice at the **mid-L3**
 * vertebral level, because that slice's muscle area correlates with whole-body muscle mass.
 * Measured at L2 or at the L3–L4 disc, the area is different and the cutoff no longer
 * applies — the number is still a muscle area, it is just not the one the threshold was
 * derived for. {@link skeletalMuscleIndex} carries the level and refuses to grade off it.
 *
 * ## The Hounsfield window is part of the definition too
 *
 * Skeletal muscle is counted between −29 and +150 HU. That is not a display preference: it
 * is what separates muscle from intramuscular fat below it and from contrast-filled vessels
 * and bone above. Widening it to "look right" quietly includes fat, and a sarcopenic
 * patient stops being sarcopenic.
 *
 * ## Contrast raises muscle attenuation
 *
 * Not much, but enough to move voxels across the upper boundary and to shift the mean.
 * Comparing an unenhanced baseline with a portal-venous follow-up produces a change in
 * muscle attenuation that is the injection. The phase travels with the measurement for the
 * same reason it does in `abdominalOrgans.ts`.
 *
 * ## The index is an area over a height squared
 *
 * A muscle area alone cannot be compared between a 150 cm patient and a 190 cm one, and the
 * cutoffs are all expressed per square metre. A missing height means no index — not an
 * index computed from an assumed height.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export type VertebralLevel = 'L3' | 'L2' | 'L4' | 'T12' | 'other';

/** The only level the published cutoffs were derived at. */
export const REFERENCE_LEVEL: VertebralLevel = 'L3';

/** Hounsfield window that defines skeletal muscle. Part of the measurement, not a preset. */
export const MUSCLE_HU: [number, number] = [-29, 150];
/** Intramuscular adipose tissue. */
export const IMAT_HU: [number, number] = [-190, -30];
/** Visceral and subcutaneous adipose tissue. */
export const FAT_HU: [number, number] = [-190, -30];

export type MuscleSex = 'male' | 'female';

/** Prado cutoffs for sarcopenia, cm² per m². */
export const SMI_CUTOFF: Record<MuscleSex, number> = { male: 52.4, female: 38.5 };

export type MuscleContrastPhase = 'unenhanced' | 'arterial' | 'portal-venous' | 'delayed' | 'unknown';

export interface SliceGrid {
  /** In-plane voxel counts. */
  dims: [number, number];
  /** In-plane millimetres. */
  spacing: [number, number];
}

export interface MuscleArea {
  level: VertebralLevel;
  phase: MuscleContrastPhase;
  /** Square centimetres. */
  areaCm2: number;
  /** Mean attenuation of the counted muscle, HU. */
  meanHu: number;
  voxels: number;
  /** Voxels inside the mask but outside the muscle window. */
  excludedVoxels: number;
  /** Intramuscular fat area, square centimetres. */
  imatCm2: number;
  warnings: string[];
  ok: boolean;
  reason?: string;
}

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Muscle cross-sectional area on one slice.
 *
 * The mask says where the muscle compartment is; the Hounsfield window decides what inside
 * it counts as muscle. Both are needed: the mask alone includes intramuscular fat, and the
 * window alone includes every other soft tissue in the abdomen.
 */
export function skeletalMuscleArea(
  hu: ArrayLike<number>,
  mask: ArrayLike<number>,
  grid: SliceGrid,
  level: VertebralLevel,
  phase: MuscleContrastPhase,
  window: [number, number] = MUSCLE_HU
): MuscleArea {
  const [nx, ny] = grid.dims;
  const pixelCm2 = (grid.spacing[0] * grid.spacing[1]) / 100;
  const warnings: string[] = [];
  let voxels = 0;
  let excludedVoxels = 0;
  let imatVoxels = 0;
  let sum = 0;

  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const i = x + nx * y;
      if (mask[i] !== 1) {
        continue;
      }
      const value = num(hu[i]);
      if (!Number.isFinite(value)) {
        excludedVoxels++;
        continue;
      }
      if (value >= window[0] && value <= window[1]) {
        voxels++;
        sum += value;
        continue;
      }
      excludedVoxels++;
      if (value >= IMAT_HU[0] && value <= IMAT_HU[1]) {
        imatVoxels++;
      }
    }
  }

  if (!voxels) {
    return {
      level,
      phase,
      areaCm2: 0,
      meanHu: NaN,
      voxels: 0,
      excludedVoxels,
      imatCm2: imatVoxels * pixelCm2,
      warnings,
      ok: false,
      reason: 'Nenhum voxel de músculo dentro da janela — confira a máscara e o nível.',
    };
  }

  if (level !== REFERENCE_LEVEL) {
    warnings.push(
      `Medido em ${level}, não em ${REFERENCE_LEVEL}. Os pontos de corte publicados vêm de coortes medidas num único corte de ${REFERENCE_LEVEL}; ` +
        'em outro nível a área ainda é uma área de músculo, só não é a que o limiar descreve.'
    );
  }
  if (window[0] !== MUSCLE_HU[0] || window[1] !== MUSCLE_HU[1]) {
    warnings.push(
      `Janela de ${window[0]} a ${window[1]} HU em vez de ${MUSCLE_HU[0]} a ${MUSCLE_HU[1]}. Alargá-la inclui gordura intramuscular em silêncio, ` +
        'e um paciente sarcopênico deixa de ser sarcopênico.'
    );
  }
  if (phase !== 'unenhanced' && phase !== 'unknown') {
    warnings.push(
      'Exame contrastado: o realce sobe a atenuação do músculo o bastante para mover voxels pela borda superior da janela. ' +
        'Comparar uma base sem contraste com um seguimento em fase portal produz uma mudança que é a injeção.'
    );
  }
  if (phase === 'unknown') {
    warnings.push('Fase de contraste desconhecida.');
  }

  return {
    level,
    phase,
    areaCm2: voxels * pixelCm2,
    meanHu: sum / voxels,
    voxels,
    excludedVoxels,
    imatCm2: imatVoxels * pixelCm2,
    warnings,
    ok: true,
  };
}

export interface SmiResult {
  /** Square centimetres per square metre. */
  smi: number | null;
  sarcopenic: boolean | null;
  cutoff: number;
  applicable: boolean;
  message: string;
}

/**
 * The index, or a refusal.
 *
 * Refuses without a height — an index computed from an assumed height is a number that
 * looks like a measurement — and refuses to grade a slice taken anywhere but L3.
 */
export function skeletalMuscleIndex(
  area: MuscleArea,
  heightM: number,
  sex: MuscleSex
): SmiResult {
  const cutoff = SMI_CUTOFF[sex] ?? SMI_CUTOFF.male;
  const height = num(heightM);

  if (!area?.ok) {
    return { smi: null, sarcopenic: null, cutoff, applicable: false, message: area?.reason ?? 'Sem área medida.' };
  }
  if (!(height > 0.5) || !(height < 2.6)) {
    return {
      smi: null,
      sarcopenic: null,
      cutoff,
      applicable: false,
      message:
        'Altura ausente ou implausível. Sem ela não há índice — e um índice calculado a partir de uma altura presumida é um número com cara de medida.',
    };
  }
  if (area.level !== REFERENCE_LEVEL) {
    return {
      smi: area.areaCm2 / (height * height),
      sarcopenic: null,
      cutoff,
      applicable: false,
      message:
        `Índice calculado, mas não classificado: o corte é ${area.level} e os pontos de corte são de ${REFERENCE_LEVEL}.`,
    };
  }

  const smi = area.areaCm2 / (height * height);
  const sarcopenic = smi < cutoff;
  return {
    smi,
    sarcopenic,
    cutoff,
    applicable: true,
    message: `${smi.toFixed(1)} cm²/m² (corte ${cutoff} cm²/m²) — ${sarcopenic ? 'abaixo do limiar' : 'acima do limiar'}.`,
  };
}

export interface MuscleComparison {
  deltaCm2: number | null;
  deltaPercent: number | null;
  comparable: boolean;
  message: string;
}

/**
 * Change in muscle area between two studies.
 *
 * Refuses across different levels or different phases, because both produce a difference
 * that is the technique rather than the patient.
 */
export function compareMuscle(current: MuscleArea, prior: MuscleArea): MuscleComparison {
  if (!current?.ok || !prior?.ok) {
    return { deltaCm2: null, deltaPercent: null, comparable: false, message: 'Uma das medidas falhou.' };
  }
  if (current.level !== prior.level) {
    return {
      deltaCm2: null,
      deltaPercent: null,
      comparable: false,
      message: `Níveis diferentes (${current.level} e ${prior.level}) — a diferença seria o corte escolhido.`,
    };
  }
  if (current.phase !== prior.phase) {
    return {
      deltaCm2: null,
      deltaPercent: null,
      comparable: false,
      message: `Fases diferentes (${current.phase} e ${prior.phase}) — a diferença seria a injeção.`,
    };
  }

  const deltaCm2 = current.areaCm2 - prior.areaCm2;
  return {
    deltaCm2,
    deltaPercent: prior.areaCm2 > 0 ? (deltaCm2 / prior.areaCm2) * 100 : null,
    comparable: true,
    message: `${deltaCm2 >= 0 ? '+' : ''}${deltaCm2.toFixed(1)} cm² (${((deltaCm2 / prior.areaCm2) * 100).toFixed(1)}%).`,
  };
}

/** One line for the body-composition panel. */
export function describeMuscle(area: MuscleArea, index?: SmiResult): string {
  if (!area.ok) {
    return area.reason ?? '';
  }
  const parts = [
    `${area.areaCm2.toFixed(1)} cm² de músculo em ${area.level}, média ${area.meanHu.toFixed(0)} HU, ` +
      `gordura intramuscular ${area.imatCm2.toFixed(1)} cm².`,
  ];
  if (index?.message) {
    parts.push(index.message);
  }
  if (area.warnings.length) {
    parts.push(area.warnings.join(' '));
  }
  return parts.join(' ');
}
