/**
 * Left ventricular function: volumes, ejection fraction and mass — pure core (RTV-47).
 *
 * `EF = (EDV − ESV) / EDV` is one line. Everything that decides whether two ejection
 * fractions from the same patient mean the same thing is in the conventions around it,
 * and none of those conventions is recorded in the pixel data.
 *
 * ## The slice gap is a 17% error waiting to happen
 *
 * Summation of disks integrates area over the stack, and the height of each disk is the
 * slice thickness **plus the gap**, not the thickness. A routine 8 mm/2 mm short-axis
 * stack loses 20% of the volume if the gap is dropped — and it looks fine, because every
 * volume in the study is wrong by the same factor and the ejection fraction (a ratio) is
 * unaffected. So the error is invisible in the number people check and present in the
 * numbers they compare against published thresholds.
 *
 * {@link summationOfDisks} requires the gap explicitly and refuses without it.
 *
 * ## Papillary muscles are a convention, not a measurement
 *
 * Including the papillary muscles and trabeculae in the blood pool or in the myocardium
 * changes EF by a few points and mass by 10–20%. Both are defensible; SCMR recommends
 * excluding them from the blood pool. What is not defensible is comparing a follow-up
 * traced one way against a baseline traced the other — the change is the convention.
 *
 * The convention travels in {@link VentricularVolumes} and
 * {@link compareStudies} refuses across conventions.
 *
 * ## Basal slice selection is the biggest inter-observer term
 *
 * The atrioventricular plane moves through the basal slice during the cycle, so "is this
 * slice ventricle or atrium?" is answered differently by different readers and differently
 * at ED and ES. It is recorded rather than solved — a number whose largest error source is
 * unnamed cannot be audited.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

/** Myocardial specific gravity, g/mL. */
export const MYOCARDIAL_DENSITY_G_ML = 1.05;

export type PapillaryConvention = 'inBloodPool' | 'inMyocardium';
export type BasalSliceRule = 'mostBasalWithFullRim' | 'fiftyPercentCircumference' | 'unrecorded';

export const PAPILLARY_LABELS: Record<PapillaryConvention, string> = {
  inBloodPool: 'papilares no pool sanguíneo',
  inMyocardium: 'papilares no miocárdio',
};

export interface SliceContour {
  /** Endocardial area, cm². */
  endocardialAreaCm2: number;
  /** Epicardial area, cm². Needed for mass. */
  epicardialAreaCm2?: number;
}

export interface StackGeometry {
  /** Slice thickness, mm. */
  thicknessMm: number;
  /** Gap between slices, mm. Zero for a contiguous stack — but it must be stated. */
  gapMm: number;
}

export type VolumeFailure = 'noSlices' | 'missingGeometry' | 'missingEpicardium';

export interface DiskSummation {
  volumeMl: number;
  sliceCount: number;
  /** Disk height used, mm — thickness + gap. */
  diskHeightMm: number;
  ok: boolean;
  failure?: VolumeFailure;
  reason?: string;
}

/**
 * Simpson's summation of disks.
 *
 * The gap is a required argument with no default. A default of zero would be silently
 * wrong on the majority of real short-axis stacks, and wrong in a way that does not show
 * up in the ejection fraction.
 */
export function summationOfDisks(
  areasCm2: number[],
  geometry: StackGeometry
): DiskSummation {
  const thickness = Number(geometry?.thicknessMm);
  const gap = Number(geometry?.gapMm);

  if (!Number.isFinite(thickness) || thickness <= 0 || !Number.isFinite(gap) || gap < 0) {
    return {
      volumeMl: 0,
      sliceCount: 0,
      diskHeightMm: 0,
      ok: false,
      failure: 'missingGeometry',
      reason:
        'Espessura e intervalo entre cortes são obrigatórios — omitir o intervalo subestima o volume por até 20% sem alterar a fração de ejeção.',
    };
  }

  const areas = (areasCm2 ?? []).map(Number).filter(a => Number.isFinite(a) && a >= 0);
  if (!areas.length) {
    return {
      volumeMl: 0,
      sliceCount: 0,
      diskHeightMm: thickness + gap,
      ok: false,
      failure: 'noSlices',
      reason: 'Nenhum corte contornado.',
    };
  }

  const diskHeightMm = thickness + gap;
  // cm² × mm → mL needs the height in cm.
  const volumeMl = areas.reduce((sum, area) => sum + area * (diskHeightMm / 10), 0);

  return { volumeMl, sliceCount: areas.length, diskHeightMm, ok: true };
}

export interface VentricularVolumes {
  edvMl: number;
  esvMl: number;
  /** Stroke volume, mL. */
  svMl: number;
  /** Ejection fraction, 0..1. */
  ef: number;
  /** Myocardial mass at end diastole, g. Null when no epicardial contour was supplied. */
  massG: number | null;
  papillaryConvention: PapillaryConvention;
  basalSliceRule: BasalSliceRule;
  warnings: string[];
  ok: boolean;
  reason?: string;
}

export interface FunctionInput {
  /** End-diastolic contours, apex to base or base to apex — order does not matter. */
  endDiastole: SliceContour[];
  endSystole: SliceContour[];
  geometry: StackGeometry;
  papillaryConvention: PapillaryConvention;
  basalSliceRule?: BasalSliceRule;
}

/**
 * Volumes, ejection fraction and mass from traced contours.
 *
 * The papillary convention is a required argument. It cannot be inferred from the contours
 * and it changes the answer, so asking for it is the only honest option — a default would
 * be a silent decision about somebody's ejection fraction.
 */
export function analyseFunction(input: FunctionInput): VentricularVolumes {
  const convention = input?.papillaryConvention;
  const basalSliceRule: BasalSliceRule = input?.basalSliceRule ?? 'unrecorded';
  const warnings: string[] = [];

  const empty = (reason: string): VentricularVolumes => ({
    edvMl: 0,
    esvMl: 0,
    svMl: 0,
    ef: 0,
    massG: null,
    papillaryConvention: convention ?? 'inBloodPool',
    basalSliceRule,
    warnings,
    ok: false,
    reason,
  });

  if (convention !== 'inBloodPool' && convention !== 'inMyocardium') {
    return empty(
      'Convenção de músculos papilares não informada — ela muda a FE em alguns pontos e a massa em 10–20%.'
    );
  }
  if (basalSliceRule === 'unrecorded') {
    // Recorded rather than solved: a number whose largest error source is unnamed cannot
    // be audited.
    warnings.push(
      'Regra de escolha do corte basal não registrada — é a maior fonte de variabilidade interobservador em volumetria de eixo curto.'
    );
  }

  const ed = summationOfDisks(
    (input?.endDiastole ?? []).map(s => Number(s?.endocardialAreaCm2)),
    input?.geometry
  );
  if (!ed.ok) {
    return empty(`Diástole: ${ed.reason}`);
  }
  const es = summationOfDisks(
    (input?.endSystole ?? []).map(s => Number(s?.endocardialAreaCm2)),
    input?.geometry
  );
  if (!es.ok) {
    return empty(`Sístole: ${es.reason}`);
  }

  if (es.volumeMl > ed.volumeMl) {
    return empty(
      'Volume sistólico maior que o diastólico — contornos provavelmente trocados entre as fases.'
    );
  }
  if (ed.sliceCount !== es.sliceCount) {
    warnings.push(
      `Número de cortes difere entre diástole (${ed.sliceCount}) e sístole (${es.sliceCount}) — a escolha do corte basal mudou entre as fases.`
    );
  }

  const svMl = ed.volumeMl - es.volumeMl;
  const ef = ed.volumeMl > 0 ? svMl / ed.volumeMl : 0;

  // Mass is measured at end diastole by convention.
  const epicardialAreas = (input?.endDiastole ?? [])
    .map(s => Number(s?.epicardialAreaCm2))
    .filter(a => Number.isFinite(a) && a > 0);
  let massG: number | null = null;
  if (epicardialAreas.length === ed.sliceCount) {
    const epicardial = summationOfDisks(epicardialAreas, input.geometry);
    if (epicardial.ok) {
      massG = Math.max(0, epicardial.volumeMl - ed.volumeMl) * MYOCARDIAL_DENSITY_G_ML;
    }
  } else if (epicardialAreas.length) {
    warnings.push('Contorno epicárdico incompleto — massa não calculada.');
  }

  return {
    edvMl: ed.volumeMl,
    esvMl: es.volumeMl,
    svMl,
    ef,
    massG,
    papillaryConvention: convention,
    basalSliceRule,
    warnings,
    ok: true,
  };
}

export interface IndexedValues {
  edviMlM2: number;
  esviMlM2: number;
  sviMlM2: number;
  massIndexGM2: number | null;
}

/** DuBois body surface area, m². */
export function bodySurfaceAreaM2(weightKg: number, heightCm: number): number {
  const w = Number(weightKg);
  const h = Number(heightCm);
  if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) {
    return 0;
  }
  return 0.007184 * Math.pow(w, 0.425) * Math.pow(h, 0.725);
}

/** Volumes indexed to body surface area, which is how reference ranges are published. */
export function indexToBsa(
  volumes: VentricularVolumes,
  bsaM2: number
): IndexedValues | null {
  const bsa = Number(bsaM2);
  if (!volumes?.ok || !Number.isFinite(bsa) || bsa <= 0) {
    return null;
  }
  return {
    edviMlM2: volumes.edvMl / bsa,
    esviMlM2: volumes.esvMl / bsa,
    sviMlM2: volumes.svMl / bsa,
    massIndexGM2: volumes.massG !== null ? volumes.massG / bsa : null,
  };
}

export type EfCategory = 'normal' | 'mildlyReduced' | 'moderatelyReduced' | 'severelyReduced';

/**
 * Ejection fraction category.
 *
 * The bands are the widely used ones; the *normal lower limit* is sex-specific, which is
 * why sex is an argument rather than a constant hidden in a threshold.
 */
export function categoriseEf(ef: number, sex?: 'male' | 'female'): EfCategory {
  const value = Number(ef);
  if (!Number.isFinite(value)) {
    return 'severelyReduced';
  }
  const lowerNormal = sex === 'female' ? 0.54 : 0.52;
  if (value >= lowerNormal) {
    return 'normal';
  }
  if (value >= 0.41) {
    return 'mildlyReduced';
  }
  return value >= 0.3 ? 'moderatelyReduced' : 'severelyReduced';
}

export interface StudyComparison {
  comparable: boolean;
  efChange: number;
  massChangeG: number | null;
  message: string;
}

/**
 * Compares two studies.
 *
 * Refuses across papillary conventions. A follow-up traced with the papillaries in the
 * myocardium against a baseline that put them in the blood pool shows an EF change of
 * several points and a mass change of 10–20% — and both are the convention, not the
 * patient. The reader has no way to see this from the images.
 */
export function compareStudies(
  prior: VentricularVolumes,
  current: VentricularVolumes
): StudyComparison {
  if (!prior?.ok || !current?.ok) {
    return {
      comparable: false,
      efChange: 0,
      massChangeG: null,
      message: 'Um dos estudos não pôde ser analisado.',
    };
  }
  if (prior.papillaryConvention !== current.papillaryConvention) {
    return {
      comparable: false,
      efChange: 0,
      massChangeG: null,
      message:
        `Estudos traçados com convenções diferentes (${PAPILLARY_LABELS[prior.papillaryConvention]} vs ` +
        `${PAPILLARY_LABELS[current.papillaryConvention]}). A diferença de FE e de massa seria da convenção, não do paciente.`,
    };
  }

  const efChange = current.ef - prior.ef;
  const massChangeG =
    prior.massG !== null && current.massG !== null ? current.massG - prior.massG : null;

  return {
    comparable: true,
    efChange,
    massChangeG,
    message: `FE ${efChange >= 0 ? '+' : ''}${(efChange * 100).toFixed(1)} pontos percentuais${
      massChangeG !== null ? `, massa ${massChangeG >= 0 ? '+' : ''}${massChangeG.toFixed(0)} g` : ''
    }.`,
  };
}

/** Readout for the function panel. */
export function describeFunction(volumes: VentricularVolumes, sex?: 'male' | 'female'): string {
  if (!volumes) {
    return '';
  }
  if (!volumes.ok) {
    return volumes.reason ?? '';
  }
  const mass = volumes.massG !== null ? ` · massa ${volumes.massG.toFixed(0)} g` : '';
  const warnings = volumes.warnings.length ? ` ${volumes.warnings.join(' ')}` : '';
  return (
    `VDF ${volumes.edvMl.toFixed(0)} mL · VSF ${volumes.esvMl.toFixed(0)} mL · ` +
    `VS ${volumes.svMl.toFixed(0)} mL · FE ${(volumes.ef * 100).toFixed(0)}% (${categoriseEf(
      volumes.ef,
      sex
    )})${mass} · ${PAPILLARY_LABELS[volumes.papillaryConvention]}.${warnings}`
  );
}
