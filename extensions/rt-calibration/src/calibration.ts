/**
 * Phantom calibration of pixel spacing, and where it may be applied — pure core (RTV-138).
 *
 * Calibrating an image replaces the spacing every subsequent measurement is computed from.
 * That is a large act performed through a small dialog, and everything here exists to make
 * its blast radius explicit.
 *
 * ## A wrong known length is unfalsifiable from inside
 *
 * If the operator types 100 mm for a 50 mm ball bearing, every measurement afterwards is
 * exactly twice what it should be — and perfectly self-consistent. Nothing looks noisy,
 * nothing contradicts anything, and the lesion that measures 18 mm is reported as 18 mm.
 * **Consistent errors are the ones nobody notices.**
 *
 * The defences are that the reference comes from a catalogue rather than a free-text field,
 * and that the derived spacing is compared against the spacing already in the image:
 * {@link deriveCalibration} refuses a factor that no geometry could explain.
 *
 * ## Scope is the second way to be wrong at scale
 *
 * A spacing measured on one image is only known for that image. Applied at study level it
 * silently governs series acquired at a different distance, a different field of view, a
 * different detector. Widening the scope is a decision someone makes, never a default, so
 * it is a required field and the resolver always prefers the narrowest calibration that
 * covers the image.
 *
 * ## In projection imaging a single scale is right in exactly one plane
 *
 * A phantom on the table top and a vessel twenty centimetres deeper are magnified
 * differently. The calibration is correct at the phantom's depth and progressively wrong
 * away from it, which is not a defect to be fixed — it is a property of projecting a cone
 * onto a plane. {@link magnificationCaveat} states it rather than leaving the reader to
 * assume otherwise.
 *
 * ## The geometry it was measured at is part of it
 *
 * Same rule as `roadmap.ts` (RTV-64): change the SID, the table height or the field of view
 * and the old number describes a scene that no longer exists.
 * {@link calibrationStillValid} refuses instead of scaling something plausible.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export interface Phantom {
  id: string;
  label: string;
  /** The dimension the operator is asked to measure, millimetres. */
  knownLengthMm: number;
  /** Manufacturing tolerance, as a fraction. */
  tolerance: number;
}

/**
 * The catalogue.
 *
 * A closed list rather than a free-text length, because the free-text field is where the
 * unfalsifiable error gets typed.
 */
export const PHANTOMS: Record<string, Phantom> = {
  'ball-25': { id: 'ball-25', label: 'Esfera de 25,4 mm', knownLengthMm: 25.4, tolerance: 0.002 },
  'ball-50': { id: 'ball-50', label: 'Esfera de 50,0 mm', knownLengthMm: 50, tolerance: 0.002 },
  'catheter-marker-100': {
    id: 'catheter-marker-100',
    label: 'Cateter marcado, 100 mm entre marcas',
    knownLengthMm: 100,
    tolerance: 0.01,
  },
  'grid-100': { id: 'grid-100', label: 'Grade de 100 mm', knownLengthMm: 100, tolerance: 0.005 },
  'coin-brl-1': { id: 'coin-brl-1', label: 'Moeda de R$ 1 (27,0 mm)', knownLengthMm: 27, tolerance: 0.01 },
};

export type CalibrationScope = 'sop' | 'series' | 'study';

export const SCOPE_LABELS: Record<CalibrationScope, string> = {
  sop: 'esta imagem',
  series: 'esta série',
  study: 'este estudo',
};

export interface CalibrationGeometry {
  sourceToDetectorMm?: number;
  sourceToObjectMm?: number;
  tableHeightMm?: number;
  fieldOfViewMm?: number;
}

export interface Calibration {
  id: string;
  scope: CalibrationScope;
  /** UID of the SOP instance, series or study the scope refers to. */
  targetUid: string;
  studyInstanceUid: string;
  seriesInstanceUid?: string;
  sopInstanceUid?: string;
  mmPerPixel: number;
  phantomId: string;
  measuredPixels: number;
  modality: string;
  geometry?: CalibrationGeometry;
  /** Spacing that was in the image before, when there was one. */
  replacedSpacingMm?: number;
  createdBy: string;
  createdAt: number;
  reason?: string;
}

export interface DeriveResult {
  calibration: Calibration | null;
  ok: boolean;
  reason?: string;
  warnings: string[];
}

/** Ratios beyond this cannot be explained by magnification in any real geometry. */
export const IMPLAUSIBLE_RATIO = 2;
/** Beyond this the ratio is possible but worth a second look. */
export const SUSPICIOUS_RATIO = 1.35;
/** Modalities whose stored spacing is at the detector, not at the object. */
export const PROJECTION_MODALITIES = ['XA', 'RF', 'CR', 'DX', 'MG'];

const text = (value: unknown): string => String(value ?? '').trim();
const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Derives mm-per-pixel from a phantom measurement.
 *
 * Refuses a factor no geometry could produce, because that is the shape a mistyped
 * reference length takes: a clean, self-consistent, wildly wrong scale.
 */
export function deriveCalibration(input: {
  id: string;
  phantomId: string;
  measuredPixels: number;
  scope: CalibrationScope;
  studyInstanceUid: string;
  seriesInstanceUid?: string;
  sopInstanceUid?: string;
  modality: string;
  storedSpacingMm?: number;
  geometry?: CalibrationGeometry;
  createdBy: string;
  createdAt: number;
  reason?: string;
}): DeriveResult {
  const warnings: string[] = [];
  const phantom = PHANTOMS[text(input?.phantomId)];
  const pixels = num(input?.measuredPixels);

  if (!phantom) {
    return {
      calibration: null,
      ok: false,
      warnings,
      reason:
        'Referência fora do catálogo. O comprimento digitado à mão é onde o erro indetectável entra: ' +
        '100 mm digitados para uma esfera de 50 mm deixam toda medida exatamente ao dobro, e perfeitamente coerente consigo mesma.',
    };
  }
  if (!(pixels > 0)) {
    return { calibration: null, ok: false, warnings, reason: 'Medida em pixels ausente ou não positiva.' };
  }
  if (!text(input?.createdBy)) {
    return { calibration: null, ok: false, warnings, reason: 'Calibração sem autor.' };
  }
  if (!text(input?.studyInstanceUid)) {
    return { calibration: null, ok: false, warnings, reason: 'Calibração sem estudo.' };
  }

  const scope = input.scope;
  if (!SCOPE_LABELS[scope]) {
    return { calibration: null, ok: false, warnings, reason: 'Escopo da calibração não informado.' };
  }
  const targetUid =
    scope === 'sop'
      ? text(input.sopInstanceUid)
      : scope === 'series'
        ? text(input.seriesInstanceUid)
        : text(input.studyInstanceUid);
  if (!targetUid) {
    return {
      calibration: null,
      ok: false,
      warnings,
      reason: `Escopo "${SCOPE_LABELS[scope]}" exige o identificador correspondente.`,
    };
  }

  const mmPerPixel = phantom.knownLengthMm / pixels;
  const stored = num(input?.storedSpacingMm);
  const projection = PROJECTION_MODALITIES.includes(text(input?.modality).toUpperCase());

  if (Number.isFinite(stored) && stored > 0) {
    const ratio = mmPerPixel / stored;
    const away = ratio >= 1 ? ratio : 1 / ratio;
    if (away > IMPLAUSIBLE_RATIO) {
      return {
        calibration: null,
        ok: false,
        warnings,
        reason:
          `A escala derivada é ${away.toFixed(1)}× a que está na imagem. Nenhuma geometria real produz esse fator — ` +
          'quase certamente a referência medida não é a que foi selecionada, ou o traço pegou outra coisa.',
      };
    }
    if (away > SUSPICIOUS_RATIO) {
      warnings.push(
        `A escala derivada é ${away.toFixed(2)}× a que está na imagem. Em imagem de projeção isso é possível pela ampliação; fora dela, confira o traço.`
      );
    }
    if (!projection && !text(input?.reason)) {
      warnings.push(
        'A imagem já traz espaçamento de pixel válido e a modalidade não é de projeção. Sobrescrevê-lo sem motivo registrado troca a régua de todas as medidas seguintes.'
      );
    }
  }

  if (projection) {
    warnings.push(magnificationCaveat(input.modality).message);
  }
  if (scope === 'study') {
    warnings.push(
      'Escopo de estudo: a calibração vai reger séries adquiridas com outra distância, outro campo de visão ou outro detector. ' +
        'Ela só foi medida numa imagem.'
    );
  }

  return {
    ok: true,
    warnings,
    calibration: {
      id: text(input.id),
      scope,
      targetUid,
      studyInstanceUid: text(input.studyInstanceUid),
      seriesInstanceUid: text(input.seriesInstanceUid) || undefined,
      sopInstanceUid: text(input.sopInstanceUid) || undefined,
      mmPerPixel,
      phantomId: phantom.id,
      measuredPixels: pixels,
      modality: text(input.modality),
      geometry: input.geometry,
      replacedSpacingMm: Number.isFinite(stored) && stored > 0 ? stored : undefined,
      createdBy: text(input.createdBy),
      createdAt: Number(input.createdAt),
      reason: text(input.reason) || undefined,
    },
  };
}

export interface MagnificationNote {
  applies: boolean;
  message: string;
}

/**
 * The caveat that cannot be engineered away.
 *
 * A phantom on the table top and a vessel twenty centimetres deeper are magnified
 * differently; one scale is correct in one plane. Saying so is the whole mitigation.
 */
export function magnificationCaveat(modality: string): MagnificationNote {
  if (!PROJECTION_MODALITIES.includes(text(modality).toUpperCase())) {
    return { applies: false, message: '' };
  }
  return {
    applies: true,
    message:
      'Imagem de projeção: a escala vale no plano onde o phantom estava. Uma estrutura mais próxima ou mais distante do detector ' +
      'aparece com outra ampliação, e a medida sai progressivamente errada conforme se afasta desse plano — é propriedade da projeção, não defeito a corrigir.',
  };
}

export interface ResolveResult {
  calibration: Calibration | null;
  /** How the calibration was found. */
  via: CalibrationScope | null;
  message: string;
}

/**
 * The calibration that governs an image.
 *
 * The narrowest wins: a spacing measured on one image is known for that image, and a
 * study-level entry is a broader claim that should not override a specific measurement.
 */
export function resolveCalibration(
  store: Calibration[],
  target: { studyInstanceUid: string; seriesInstanceUid?: string; sopInstanceUid?: string }
): ResolveResult {
  const list = (store ?? []).filter(Boolean);
  const newest = (candidates: Calibration[]): Calibration | null =>
    candidates.length ? candidates.reduce((a, b) => (b.createdAt > a.createdAt ? b : a)) : null;

  const bySop = newest(
    list.filter(c => c.scope === 'sop' && target.sopInstanceUid && c.targetUid === target.sopInstanceUid)
  );
  if (bySop) {
    return { calibration: bySop, via: 'sop', message: `Calibrada para ${SCOPE_LABELS.sop}.` };
  }
  const bySeries = newest(
    list.filter(c => c.scope === 'series' && target.seriesInstanceUid && c.targetUid === target.seriesInstanceUid)
  );
  if (bySeries) {
    return { calibration: bySeries, via: 'series', message: `Calibrada para ${SCOPE_LABELS.series}.` };
  }
  const byStudy = newest(
    list.filter(c => c.scope === 'study' && c.targetUid === target.studyInstanceUid)
  );
  if (byStudy) {
    return {
      calibration: byStudy,
      via: 'study',
      message:
        `Calibrada para ${SCOPE_LABELS.study} — medida numa imagem e aplicada a todas, incluindo as de outra geometria.`,
    };
  }
  return { calibration: null, via: null, message: '' };
}

export interface ValidityCheck {
  valid: boolean;
  changed: string[];
  message: string;
}

/** Beyond these the geometry is not the one the calibration was measured at. */
export const GEOMETRY_TOLERANCE = { sidMm: 5, tableHeightMm: 5, fovMm: 2 };

/**
 * Whether the calibration still describes the current acquisition.
 *
 * The same rule as the fluoroscopic roadmap: change the distance or the field of view and
 * the old number describes a scene that no longer exists. Refusing beats scaling something
 * plausible, because a plausible wrong ruler is used without question.
 */
export function calibrationStillValid(
  calibration: Calibration,
  current: CalibrationGeometry
): ValidityCheck {
  if (!calibration?.geometry || !current) {
    return {
      valid: true,
      changed: [],
      message: 'Sem geometria registrada na calibração — não há como saber se ela ainda vale.',
    };
  }
  const changed: string[] = [];
  const compare = (key: keyof CalibrationGeometry, tolerance: number, label: string) => {
    const a = num(calibration.geometry?.[key]);
    const b = num(current[key]);
    if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) > tolerance) {
      changed.push(label);
    }
  };
  compare('sourceToDetectorMm', GEOMETRY_TOLERANCE.sidMm, 'distância foco-detector');
  compare('tableHeightMm', GEOMETRY_TOLERANCE.tableHeightMm, 'altura da mesa');
  compare('fieldOfViewMm', GEOMETRY_TOLERANCE.fovMm, 'campo de visão');

  return {
    valid: !changed.length,
    changed,
    message: changed.length
      ? `Mudou ${changed.join(', ')} desde a calibração — a escala antiga descreve uma cena que não existe mais.`
      : '',
  };
}

export interface CalibrationAudit {
  calibrationId: string;
  targetUid: string;
  scope: CalibrationScope;
  by: string;
  at: number;
  mmPerPixel: number;
  replacedSpacingMm?: number;
  phantom: string;
  reason?: string;
  message: string;
}

/**
 * The audit line.
 *
 * Records the spacing that was replaced, not only the new one: a measurement disputed six
 * months later is only re-checkable if the ruler it was made with, and the ruler it
 * displaced, are both on record.
 */
export function auditCalibration(calibration: Calibration): CalibrationAudit {
  const phantom = PHANTOMS[calibration.phantomId];
  return {
    calibrationId: calibration.id,
    targetUid: calibration.targetUid,
    scope: calibration.scope,
    by: calibration.createdBy,
    at: calibration.createdAt,
    mmPerPixel: calibration.mmPerPixel,
    replacedSpacingMm: calibration.replacedSpacingMm,
    phantom: phantom ? phantom.label : calibration.phantomId,
    reason: calibration.reason,
    message:
      `${calibration.createdBy} calibrou ${SCOPE_LABELS[calibration.scope]} em ${calibration.mmPerPixel.toFixed(4)} mm/px ` +
      `com ${phantom ? phantom.label : calibration.phantomId}` +
      (calibration.replacedSpacingMm
        ? `, substituindo ${calibration.replacedSpacingMm.toFixed(4)} mm/px`
        : '') +
      '.',
  };
}

/** One line for the calibration dialog. */
export function describeCalibration(result: DeriveResult): string {
  if (!result?.ok || !result.calibration) {
    return result?.reason ?? '';
  }
  const warnings = result.warnings.length ? ` ${result.warnings.join(' ')}` : '';
  return `${result.calibration.mmPerPixel.toFixed(4)} mm/px para ${SCOPE_LABELS[result.calibration.scope]}.${warnings}`;
}
