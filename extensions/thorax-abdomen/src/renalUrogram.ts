/**
 * Renal stones, hydronephrosis and urogram coverage — pure core (RTV-73).
 *
 * The segmentation is a sidecar and the organ volumes live in `abdominalOrgans.ts`. What is
 * here is the urinary-tract-specific reasoning, and it is mostly about the ways a confident
 * number stops meaning what it says.
 *
 * ## A stone's attenuation is a property of the slice thickness
 *
 * Composition by Hounsfield value assumes the peak attenuation belongs to the stone. On
 * thick slices it does not: a four-millimetre stone in a five-millimetre slice is averaged
 * with the urine and fat around it, and the peak comes back hundreds of units low. A
 * calcium stone then reads in the uric-acid range, which is the one call that changes
 * management — uric acid dissolves with alkalinisation and calcium does not.
 *
 * The failure scales with the ratio, so it hits **small stones hardest**, and small stones
 * are the ones where the medical-versus-surgical decision is live. {@link stoneComposition}
 * refuses rather than classifying, and points at dual-energy (RTV-89), which separates
 * uric acid by material rather than by attenuation and does not care about the slice.
 *
 * ## Maximum diameter depends on which plane you looked in
 *
 * Passage prediction uses maximum diameter, and a stone elongated head-to-foot measures
 * small on every axial slice while being large on the coronal reformat. Measuring axially
 * only is not imprecise — it is **biased towards smaller**, and smaller is the direction
 * that predicts spontaneous passage.
 *
 * ## Dilation is not obstruction, and obstruction is not always dilated
 *
 * An extrarenal pelvis is wide in a normal kidney. An early or decompressed obstruction is
 * barely dilated at all. Grading on pelvic diameter alone gets both wrong, in opposite
 * directions, so {@link hydronephrosisGrade} needs the calyces and the parenchyma.
 *
 * ## A ureter that was never opacified is not a normal ureter
 *
 * A urogram excludes a filling defect only along the segments that filled. A report that
 * says "no filling defect" over a non-opacified segment describes the contrast timing.
 * {@link urogramCoverage} lists what could not be assessed instead of leaving it out.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export type StoneComposition = 'uric-acid' | 'non-uric-acid' | 'indeterminate';

export const COMPOSITION_LABELS: Record<StoneComposition, string> = {
  'uric-acid': 'ácido úrico',
  'non-uric-acid': 'não úrico (cálcio, estruvita ou cistina)',
  indeterminate: 'indeterminada',
};

/** Below this a stone is in the uric-acid range on single energy. */
export const URIC_ACID_HU_MAX = 500;
/** Above this a stone is confidently calcified. */
export const CALCIFIED_HU_MIN = 1000;
/**
 * A stone must be at least this many slices across for its peak attenuation to be its own.
 *
 * Two, so at least one slice sits entirely within the stone.
 */
export const MIN_SLICES_ACROSS_STONE = 2;

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};

export interface StoneInput {
  /** Peak attenuation inside the stone, Hounsfield units. */
  peakHu: number;
  /** Reconstructed slice thickness, millimetres. */
  sliceThicknessMm: number;
  /** Largest dimension measured, millimetres. */
  maxDiameterMm: number;
}

export interface CompositionResult {
  composition: StoneComposition;
  peakHu: number;
  /** How many slices span the stone. */
  slicesAcross: number;
  reliable: boolean;
  message: string;
}

/**
 * Stone composition from single-energy attenuation, or a refusal.
 *
 * Refuses when the stone spans too few slices. The arithmetic would return a class — the
 * wrong one, systematically, and in the direction that matters: partial volume pulls the
 * peak **down**, which moves a calcium stone into the uric-acid range and not the reverse.
 */
export function stoneComposition(input: StoneInput): CompositionResult {
  const peakHu = num(input?.peakHu);
  const thickness = num(input?.sliceThicknessMm);
  const size = num(input?.maxDiameterMm);

  if (!Number.isFinite(peakHu)) {
    return {
      composition: 'indeterminate',
      peakHu,
      slicesAcross: NaN,
      reliable: false,
      message: 'Atenuação de pico não medida.',
    };
  }
  if (!(thickness > 0) || !(size > 0)) {
    return {
      composition: 'indeterminate',
      peakHu,
      slicesAcross: NaN,
      reliable: false,
      message: 'Espessura de corte ou tamanho do cálculo ausente — sem eles não dá para saber se o pico é do cálculo.',
    };
  }

  const slicesAcross = size / thickness;
  if (slicesAcross < MIN_SLICES_ACROSS_STONE) {
    return {
      composition: 'indeterminate',
      peakHu,
      slicesAcross,
      reliable: false,
      message:
        `Cálculo de ${size.toFixed(1)} mm em cortes de ${thickness.toFixed(1)} mm: ${slicesAcross.toFixed(1)} corte(s) de espessura. ` +
        'O pico está mediado com a urina e a gordura ao redor e volta centenas de unidades baixo, o que empurra um cálculo de cálcio ' +
        'para a faixa do ácido úrico — e não o contrário. É justamente nos cálculos pequenos que a decisão clínica ou cirúrgica está em aberto. ' +
        'Para composição, use cortes finos ou dupla energia (RTV-89), que separa por material e não por atenuação.',
    };
  }

  if (peakHu < URIC_ACID_HU_MAX) {
    return {
      composition: 'uric-acid',
      peakHu,
      slicesAcross,
      reliable: true,
      message: `${peakHu.toFixed(0)} HU, abaixo de ${URIC_ACID_HU_MAX} — faixa de ácido úrico. Confirmação por dupla energia muda a conduta (dissolução por alcalinização).`,
    };
  }
  if (peakHu >= CALCIFIED_HU_MIN) {
    return {
      composition: 'non-uric-acid',
      peakHu,
      slicesAcross,
      reliable: true,
      message: `${peakHu.toFixed(0)} HU — calcificado, não é ácido úrico.`,
    };
  }
  return {
    composition: 'indeterminate',
    peakHu,
    slicesAcross,
    reliable: true,
    message: `${peakHu.toFixed(0)} HU, entre ${URIC_ACID_HU_MAX} e ${CALCIFIED_HU_MIN} — a atenuação sozinha não decide. Dupla energia resolve.`,
  };
}

export interface StoneSizeInput {
  axialMaxMm: number;
  /** Maximum on the coronal reformat, when it was measured. */
  coronalMaxMm?: number;
  /** Maximum on the sagittal reformat, when it was measured. */
  sagittalMaxMm?: number;
}

export interface StoneSizeResult {
  maxDiameterMm: number;
  /** The plane the maximum came from. */
  plane: 'axial' | 'coronal' | 'sagittal';
  planesMeasured: number;
  warnings: string[];
}

/**
 * Largest dimension across the planes that were measured.
 *
 * Measuring axially only is not imprecise, it is biased towards smaller — and smaller is
 * the direction that predicts spontaneous passage, so the bias points at watchful waiting
 * for a stone that will not pass.
 */
export function stoneSize(input: StoneSizeInput): StoneSizeResult {
  const candidates: Array<{ value: number; plane: 'axial' | 'coronal' | 'sagittal' }> = [
    { value: num(input?.axialMaxMm), plane: 'axial' },
    { value: num(input?.coronalMaxMm), plane: 'coronal' },
    { value: num(input?.sagittalMaxMm), plane: 'sagittal' },
  ].filter(c => Number.isFinite(c.value) && c.value > 0);

  const warnings: string[] = [];
  if (!candidates.length) {
    return { maxDiameterMm: NaN, plane: 'axial', planesMeasured: 0, warnings: ['Nenhuma medida.'] };
  }
  if (candidates.length === 1 && candidates[0].plane === 'axial') {
    warnings.push(
      'Medido só no plano axial. Cálculo alongado no eixo crânio-caudal mede pequeno em todo corte axial e grande no reformatado coronal — ' +
        'a medida não fica imprecisa, fica ENVIESADA PARA MENOR, e menor é a direção que prevê eliminação espontânea.'
    );
  }

  const best = candidates.reduce((a, b) => (b.value > a.value ? b : a));
  return {
    maxDiameterMm: best.value,
    plane: best.plane,
    planesMeasured: candidates.length,
    warnings,
  };
}

export type HydronephrosisGrade = 0 | 1 | 2 | 3 | 4;

export const GRADE_LABELS: Record<HydronephrosisGrade, string> = {
  0: 'ausente',
  1: 'discreta (pelve dilatada, cálices normais)',
  2: 'moderada (cálices maiores dilatados)',
  3: 'acentuada (todos os cálices dilatados)',
  4: 'acentuada com afilamento parenquimatoso',
};

export interface HydronephrosisInput {
  /** Anteroposterior pelvic diameter, millimetres. */
  pelvisApMm: number;
  /** Whether the major calyces are dilated. */
  majorCalycesDilated: boolean;
  /** Whether the minor calyces are dilated. */
  minorCalycesDilated: boolean;
  /** Parenchymal thickness, millimetres. */
  parenchymalThicknessMm?: number;
  /** Whether the pelvis is extrarenal, which is wide without obstruction. */
  extrarenalPelvis?: boolean;
}

export interface HydronephrosisResult {
  grade: HydronephrosisGrade;
  obstructionLikely: boolean;
  warnings: string[];
  message: string;
}

/** Parenchyma thinner than this suggests long-standing obstruction, millimetres. */
export const THIN_PARENCHYMA_MM = 7;
/** A pelvis wider than this without calyceal dilation still warrants a look. */
export const WIDE_PELVIS_MM = 15;

/**
 * Hydronephrosis grade from the collecting system rather than from the pelvis alone.
 *
 * Pelvic diameter alone gets two common cases wrong in opposite directions: an extrarenal
 * pelvis is wide in a normal kidney, and an early or decompressed obstruction is barely
 * dilated. The calyces decide the grade; the parenchyma decides how long it has been going
 * on.
 */
export function hydronephrosisGrade(input: HydronephrosisInput): HydronephrosisResult {
  const pelvis = num(input?.pelvisApMm);
  const parenchyma = num(input?.parenchymalThicknessMm);
  const warnings: string[] = [];

  let grade: HydronephrosisGrade = 0;
  if (input?.minorCalycesDilated) {
    grade = 3;
  } else if (input?.majorCalycesDilated) {
    grade = 2;
  } else if (pelvis > WIDE_PELVIS_MM) {
    grade = 1;
  }

  if (grade >= 3 && Number.isFinite(parenchyma) && parenchyma < THIN_PARENCHYMA_MM) {
    grade = 4;
  }

  if (input?.extrarenalPelvis && grade === 1) {
    warnings.push(
      'Pelve extrarrenal: ela é larga num rim normal, e graduar pelo diâmetro pélvico sozinho chamaria isso de hidronefrose.'
    );
  }
  if (grade === 0 && pelvis > 10) {
    warnings.push(
      'Sistema pouco dilatado não exclui obstrução: obstrução precoce, ou já descomprimida, dilata pouco ou nada.'
    );
  }
  if (Number.isFinite(parenchyma) && parenchyma < THIN_PARENCHYMA_MM) {
    warnings.push(
      `Parênquima de ${parenchyma.toFixed(1)} mm indica obstrução de longa data — a função daquele rim provavelmente não recupera com a desobstrução. ` +
        'A medida absoluta de função (RTV-209) responde isso; a função relativa não.'
    );
  }

  const obstructionLikely = grade >= 2 || (grade === 1 && !input?.extrarenalPelvis);
  return {
    grade,
    obstructionLikely,
    warnings,
    message: `Hidronefrose ${GRADE_LABELS[grade]}.`,
  };
}

export type UreterSegment = 'proximal' | 'mid' | 'distal';

export const SEGMENT_LABELS: Record<UreterSegment, string> = {
  proximal: 'ureter proximal',
  mid: 'ureter médio',
  distal: 'ureter distal',
};

export interface UrogramInput {
  side: 'left' | 'right';
  opacified: UreterSegment[];
  /** Delay from injection to the excretory acquisition, seconds. */
  excretoryDelaySec?: number;
}

export interface UrogramCoverage {
  assessed: UreterSegment[];
  notAssessed: UreterSegment[];
  complete: boolean;
  message: string;
}

/** Excretory phase before this is usually too early for distal filling, seconds. */
export const EXCRETORY_DELAY_SEC = 480;

/**
 * Which ureteric segments the study can actually speak about.
 *
 * A urogram excludes a filling defect only where contrast filled. "No filling defect"
 * written over a non-opacified segment is a statement about the contrast timing that reads
 * as a statement about the ureter.
 */
export function urogramCoverage(input: UrogramInput): UrogramCoverage {
  const all: UreterSegment[] = ['proximal', 'mid', 'distal'];
  const assessed = all.filter(s => (input?.opacified ?? []).includes(s));
  const notAssessed = all.filter(s => !assessed.includes(s));
  const delay = num(input?.excretoryDelaySec);

  const parts: string[] = [];
  if (!notAssessed.length) {
    parts.push(`Ureter ${input.side === 'left' ? 'esquerdo' : 'direito'} opacificado em toda a extensão.`);
  } else {
    parts.push(
      `Sem opacificação em: ${notAssessed.map(s => SEGMENT_LABELS[s]).join(', ')}. ` +
        'Esses segmentos NÃO foram avaliados — escrever "sem falha de enchimento" sobre eles é uma afirmação sobre o tempo do contraste que se lê como afirmação sobre o ureter.'
    );
  }
  if (Number.isFinite(delay) && delay < EXCRETORY_DELAY_SEC && notAssessed.length) {
    parts.push(
      `Fase excretora com ${Math.round(delay)}s de atraso, abaixo dos ${EXCRETORY_DELAY_SEC}s habituais: a falta de opacificação pode ser só tempo.`
    );
  }

  return {
    assessed,
    notAssessed,
    complete: notAssessed.length === 0,
    message: parts.join(' '),
  };
}

/** One line for the urinary panel. */
export function describeStone(composition: CompositionResult, size: StoneSizeResult): string {
  const warnings = size.warnings.length ? ` ${size.warnings.join(' ')}` : '';
  return `Cálculo de ${size.maxDiameterMm.toFixed(1)} mm (maior no plano ${size.plane}), ${composition.message}${warnings}`;
}
