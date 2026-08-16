/**
 * Airway wall metrics and air trapping — pure core (RTV-70).
 *
 * The segmentation is a sidecar. This is the measurement, and airway measurement has a
 * property that makes it unusually easy to publish nonsense: **the number depends on the
 * reconstruction as much as on the patient.**
 *
 * ## Wall thickness is a property of the kernel as much as of the bronchus
 *
 * A sharp reconstruction kernel edge-enhances, so the wall looks thinner and better
 * defined. A smooth kernel blurs, so it looks thicker. Same patient, same scan, two series
 * reconstructed from the same raw data, and the wall area percent differs by more than most
 * diseases move it.
 *
 * Nothing in the image says which one you are looking at. So the kernel travels with the
 * measurement and {@link compareAirways} refuses across kernels: the change it would report
 * is the reconstruction.
 *
 * ## Pi10 exists because wall area percent depends on airway size
 *
 * A segmental bronchus and a subsegmental one have different wall fractions in a healthy
 * lung, so "the wall area percent" is meaningless without saying which airway. Pi10 — the
 * square root of the wall area of a hypothetical airway with a 10 mm internal perimeter,
 * read off a regression across many airways — removes the size dependence.
 *
 * It does **not** remove the kernel dependence, and it is regularly treated as though it
 * did. {@link computePi10} carries the kernel through for that reason.
 *
 * ## Below the resolution limit the wall thickness is the point spread function
 *
 * At a lumen of a couple of millimetres the wall is a handful of voxels and most of its
 * apparent thickness is partial volume. The measurement still returns a number, and the
 * number still varies between patients — it just varies with how the blur landed.
 * {@link measureAirway} refuses below the floor rather than contributing noise to the
 * regression.
 *
 * ## Calibre changes with lung volume, and a poor breath-hold looks like disease
 *
 * Airways narrow as the lung empties. An inspiratory scan compared with one where the
 * patient did not fully inspire shows narrowing that is the breath-hold. The same confound
 * runs the other way for air trapping: incomplete expiration leaves the lung looking
 * hyperinflated and the trapping percentage falls.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

/** Reconstruction kernels differ enough that a comparison across them is meaningless. */
export type Kernel = 'sharp' | 'standard' | 'smooth' | 'unknown';

export const KERNEL_LABELS: Record<Kernel, string> = {
  sharp: 'kernel duro (realce de borda)',
  standard: 'kernel padrão',
  smooth: 'kernel suave',
  unknown: 'kernel não informado',
};

export type BreathState = 'inspiration' | 'expiration' | 'unknown';

/** Below this internal diameter the wall is mostly point spread function, millimetres. */
export const RESOLUTION_FLOOR_MM = 2;
/** Lung voxels below this on expiration are trapped air, Hounsfield units. */
export const AIR_TRAPPING_HU = -856;
/** Emphysema threshold on inspiration, Hounsfield units. */
export const EMPHYSEMA_HU = -950;

export interface AirwayInput {
  /** Airway identifier, e.g. RB1. */
  label: string;
  /** Internal (luminal) area, square millimetres. */
  lumenAreaMm2: number;
  /** Total area inside the outer wall, square millimetres. */
  totalAreaMm2: number;
  kernel: Kernel;
  breath: BreathState;
  /** Generation, when known. Used only for reporting. */
  generation?: number;
}

export interface AirwayMeasurement {
  label: string;
  lumenAreaMm2: number;
  wallAreaMm2: number;
  /** Wall area as a percentage of total area. */
  wallAreaPercent: number;
  /** Internal perimeter of a circle of the same lumen area, millimetres. */
  internalPerimeterMm: number;
  /** Equivalent internal diameter, millimetres. */
  internalDiameterMm: number;
  kernel: Kernel;
  breath: BreathState;
  warnings: string[];
  ok: boolean;
  reason?: string;
}

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * One airway.
 *
 * The internal perimeter is derived from the lumen area rather than traced, because a
 * traced perimeter on a blurred wall is longer than the anatomy and the error grows as the
 * airway shrinks — which is the direction the regression is most sensitive to.
 */
export function measureAirway(input: AirwayInput): AirwayMeasurement {
  const lumenAreaMm2 = num(input?.lumenAreaMm2);
  const totalAreaMm2 = num(input?.totalAreaMm2);
  const warnings: string[] = [];
  const kernel = input?.kernel ?? 'unknown';
  const breath = input?.breath ?? 'unknown';

  const empty = (reason: string): AirwayMeasurement => ({
    label: String(input?.label ?? ''),
    lumenAreaMm2,
    wallAreaMm2: NaN,
    wallAreaPercent: NaN,
    internalPerimeterMm: NaN,
    internalDiameterMm: NaN,
    kernel,
    breath,
    warnings,
    ok: false,
    reason,
  });

  if (!(lumenAreaMm2 > 0)) {
    return empty('Área luminal ausente ou não positiva.');
  }
  if (!(totalAreaMm2 > lumenAreaMm2)) {
    return empty('Área total não é maior que a luminal — a parede sairia negativa.');
  }

  const internalDiameterMm = 2 * Math.sqrt(lumenAreaMm2 / Math.PI);
  if (internalDiameterMm < RESOLUTION_FLOOR_MM) {
    return empty(
      `Diâmetro interno de ${internalDiameterMm.toFixed(1)} mm, abaixo do piso de ${RESOLUTION_FLOOR_MM} mm. ` +
        'Nessa escala a parede tem poucos voxels e a maior parte da espessura aparente é volume parcial: ' +
        'a medida ainda devolve um número, e o número ainda varia entre pacientes — só varia com como o borrão caiu.'
    );
  }

  if (kernel === 'unknown') {
    warnings.push(
      'Kernel de reconstrução não informado. Espessura de parede depende do kernel tanto quanto do brônquio, e nada na imagem diz qual foi usado.'
    );
  }
  if (breath === 'unknown') {
    warnings.push('Fase respiratória não informada — calibre de via aérea muda com o volume pulmonar.');
  }

  const wallAreaMm2 = totalAreaMm2 - lumenAreaMm2;
  return {
    label: String(input.label ?? ''),
    lumenAreaMm2,
    wallAreaMm2,
    wallAreaPercent: (wallAreaMm2 / totalAreaMm2) * 100,
    internalPerimeterMm: Math.PI * internalDiameterMm,
    internalDiameterMm,
    kernel,
    breath,
    warnings,
    ok: true,
  };
}

export interface Pi10Result {
  /** Square root of wall area at a 10 mm internal perimeter, millimetres. */
  pi10Mm: number | null;
  /** Regression slope and intercept of sqrt(WA) against internal perimeter. */
  slope: number;
  intercept: number;
  /** Coefficient of determination. */
  r2: number;
  airways: number;
  kernel: Kernel;
  warnings: string[];
  ok: boolean;
  reason?: string;
}

/** Fewer airways than this and the regression is fitting noise. */
export const MIN_AIRWAYS_FOR_PI10 = 6;

/**
 * Pi10 from a set of airway measurements.
 *
 * Removes the size dependence that makes a bare wall area percent uninterpretable. It does
 * not remove the kernel dependence, and it is routinely treated as though it did — so the
 * kernel is carried on the result and a mixed-kernel set is refused rather than averaged.
 */
export function computePi10(measurements: AirwayMeasurement[]): Pi10Result {
  const usable = (measurements ?? []).filter(m => m?.ok);
  const warnings: string[] = [];

  const empty = (reason: string): Pi10Result => ({
    pi10Mm: null,
    slope: NaN,
    intercept: NaN,
    r2: NaN,
    airways: usable.length,
    kernel: usable[0]?.kernel ?? 'unknown',
    warnings,
    ok: false,
    reason,
  });

  if (usable.length < MIN_AIRWAYS_FOR_PI10) {
    return empty(
      `${usable.length} via(s) aérea(s) mensurável(is), abaixo de ${MIN_AIRWAYS_FOR_PI10}. A regressão estaria ajustando ruído.`
    );
  }

  const kernels = [...new Set(usable.map(m => m.kernel))];
  if (kernels.length > 1) {
    return empty(
      `Vias aéreas reconstruídas com kernels diferentes (${kernels.map(k => KERNEL_LABELS[k]).join(', ')}). ` +
        'Misturá-las num só Pi10 produz um número que descreve a mistura de reconstruções.'
    );
  }
  if (kernels[0] === 'unknown') {
    warnings.push(
      'Kernel desconhecido: o Pi10 remove a dependência do tamanho da via aérea, não a da reconstrução — e é rotineiramente tratado como se removesse.'
    );
  }

  const xs = usable.map(m => m.internalPerimeterMm);
  const ys = usable.map(m => Math.sqrt(m.wallAreaMm2));
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - meanX) * (ys[i] - meanY);
    sxx += (xs[i] - meanX) ** 2;
    syy += (ys[i] - meanY) ** 2;
  }
  if (!(sxx > 0)) {
    return empty('Todas as vias aéreas têm o mesmo perímetro — não há regressão a ajustar.');
  }

  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;
  const r2 = syy > 0 ? (sxy * sxy) / (sxx * syy) : 1;
  if (r2 < 0.5) {
    warnings.push(`Ajuste fraco (R² ${r2.toFixed(2)}): o Pi10 extrapolado carrega essa incerteza.`);
  }

  return {
    pi10Mm: intercept + slope * 10,
    slope,
    intercept,
    r2,
    airways: n,
    kernel: kernels[0],
    warnings,
    ok: true,
  };
}

export interface AirwayComparison {
  deltaPercent: number | null;
  comparable: boolean;
  message: string;
}

/**
 * Change in wall area percent between two studies.
 *
 * Refuses across kernels and across breath states. Both produce a difference that is the
 * technique, and both are invisible in the images.
 */
export function compareAirways(
  current: AirwayMeasurement,
  prior: AirwayMeasurement
): AirwayComparison {
  if (!current?.ok || !prior?.ok) {
    return { deltaPercent: null, comparable: false, message: 'Uma das medidas falhou.' };
  }
  if (current.kernel !== prior.kernel) {
    return {
      deltaPercent: null,
      comparable: false,
      message:
        `Kernels diferentes (${KERNEL_LABELS[current.kernel]} e ${KERNEL_LABELS[prior.kernel]}). ` +
        'Kernel duro realça a borda e a parede parece mais fina; kernel suave borra e ela parece mais grossa. ' +
        'A mudança relatada seria a reconstrução, e ela move a medida mais do que a maioria das doenças.',
    };
  }
  if (current.breath !== prior.breath) {
    return {
      deltaPercent: null,
      comparable: false,
      message:
        `Fases respiratórias diferentes (${current.breath} e ${prior.breath}) — via aérea estreita conforme o pulmão esvazia, ` +
        'e a diferença seria a apneia.',
    };
  }

  return {
    deltaPercent: current.wallAreaPercent - prior.wallAreaPercent,
    comparable: true,
    message: `${(current.wallAreaPercent - prior.wallAreaPercent >= 0 ? '+' : '')}${(current.wallAreaPercent - prior.wallAreaPercent).toFixed(1)} pontos percentuais de área de parede.`,
  };
}

export interface DensitometryResult {
  /** Percentage of lung voxels below the threshold. */
  percentBelow: number;
  thresholdHu: number;
  voxels: number;
  breath: BreathState;
  warnings: string[];
  ok: boolean;
  reason?: string;
}

/**
 * Percentage of lung below a Hounsfield threshold.
 *
 * Air trapping on expiration and emphysema on inspiration are the same computation on
 * different acquisitions, which is exactly why the breath state has to be checked: run on
 * the wrong one, the number is still plausible and describes something else.
 *
 * Incomplete expiration is the confound that matters and it runs towards reassurance — a
 * lung that never emptied looks less trapped.
 */
export function lungDensitometry(
  hu: ArrayLike<number>,
  lungMask: ArrayLike<number>,
  breath: BreathState,
  thresholdHu: number = AIR_TRAPPING_HU
): DensitometryResult {
  const warnings: string[] = [];
  let voxels = 0;
  let below = 0;
  let sum = 0;

  for (let i = 0; i < lungMask.length; i++) {
    if (lungMask[i] !== 1) {
      continue;
    }
    const value = num(hu[i]);
    if (!Number.isFinite(value)) {
      continue;
    }
    voxels++;
    sum += value;
    if (value < thresholdHu) {
      below++;
    }
  }

  if (!voxels) {
    return {
      percentBelow: NaN,
      thresholdHu,
      voxels: 0,
      breath,
      warnings,
      ok: false,
      reason: 'Máscara pulmonar vazia.',
    };
  }

  const meanHu = sum / voxels;
  if (thresholdHu === AIR_TRAPPING_HU && breath !== 'expiration') {
    warnings.push(
      `Limiar de aprisionamento aéreo (${AIR_TRAPPING_HU} HU) aplicado a uma aquisição em ${breath}. ` +
        'É a mesma conta do enfisema numa aquisição diferente: o número sai plausível e descreve outra coisa.'
    );
  }
  if (thresholdHu === EMPHYSEMA_HU && breath !== 'inspiration') {
    warnings.push(`Limiar de enfisema (${EMPHYSEMA_HU} HU) aplicado a uma aquisição em ${breath}.`);
  }
  // A lung that never emptied sits closer to inspiratory density, and the trapping
  // percentage falls -- the confound points at reassurance.
  if (breath === 'expiration' && meanHu < -800) {
    warnings.push(
      `Densidade média de ${meanHu.toFixed(0)} HU numa aquisição expiratória sugere expiração incompleta. ` +
        'Um pulmão que não esvaziou parece menos aprisionado, então o viés aponta para o resultado tranquilizador.'
    );
  }

  return {
    percentBelow: (below / voxels) * 100,
    thresholdHu,
    voxels,
    breath,
    warnings,
    ok: true,
  };
}

/** One line per airway for the panel. */
export function describeAirway(measurement: AirwayMeasurement): string {
  if (!measurement.ok) {
    return measurement.reason ?? '';
  }
  const warnings = measurement.warnings.length ? ` ${measurement.warnings.join(' ')}` : '';
  return (
    `${measurement.label}: luz ${measurement.internalDiameterMm.toFixed(1)} mm, ` +
    `parede ${measurement.wallAreaPercent.toFixed(1)}% da área total (${KERNEL_LABELS[measurement.kernel]}).${warnings}`
  );
}
