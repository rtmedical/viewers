/**
 * Dynamic roadmap: a held mask over live fluoroscopy — pure core (RTV-64).
 *
 * `dsa.ts` (RTV-65) subtracts within one recorded run, which the operator then reviews.
 * Roadmap is the interventional case and it is a different problem: the mask is acquired
 * once, from a contrast injection, and then **held for minutes** while the operator
 * advances a wire against it under live fluoroscopy.
 *
 * ## A stale roadmap does not look broken — it looks like a roadmap
 *
 * This is the whole reason the module exists. In a reviewed DSA run, misregistration shows
 * up as obvious paired edges and the reader discounts it. In roadmap, the vessel map is a
 * smooth overlay with no reference to compare against, so when the patient shifts on the
 * table, or the table pans, or the C-arm rotates, the overlay keeps drawing vessels
 * **where the vessels no longer are** — and the operator is steering a guidewire by it.
 *
 * So any change in acquisition geometry beyond tolerance **invalidates the mask
 * automatically**. Not a warning banner over a still-rendered overlay: {@link applyRoadmap}
 * refuses to produce an image at all. A warning next to a plausible-looking roadmap is a
 * warning that gets read after the wire has already gone somewhere.
 *
 * ## Invalidation has a cost, so the reason has to be specific
 *
 * A new mask means another contrast injection and more dose to a patient already on the
 * table under live fluoro. Discarding the roadmap for something a pixel shift could have
 * fixed is not free. {@link geometryChange} therefore separates the two cases:
 *
 * - **In-plane table translation** — correctable by shifting the mask, the standard
 *   re-registration the operator already knows.
 * - **Rotation, height, SID or field of view** — a new mask, because the projection itself
 *   changed and no translation of the old one corresponds to it.
 *
 * {@link shiftMask} refuses in the second case. A shift chosen because it "looks better"
 * over a rotation aligns one region and misaligns the rest: locally convincing, globally
 * wrong, which is worse than an overlay that is obviously stale.
 *
 * ## Image-based drift is a weak signal and is labelled as one
 *
 * {@link maskDrift} correlates the live frame against the mask, but a guidewire crossing
 * the field also lowers the correlation, and slow patient motion barely does. It is a
 * secondary check. The geometry comparison is the one that decides.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

/**
 * A 2D fluoroscopic frame.
 *
 * `dsa.ts` works on a flat indexable buffer because subtraction is element-wise and never
 * needs to know where a pixel is. Roadmap does: re-registration shifts the mask in the
 * plane, so the width and height are part of the type rather than an argument that can be
 * passed wrong.
 */
export interface FluoroFrame {
  width: number;
  height: number;
  data: Float32Array | number[];
}

/** Acquisition geometry the roadmap depends on. */
export interface FluoroGeometry {
  tableLateralMm: number;
  tableLongitudinalMm: number;
  tableHeightMm: number;
  /** LAO/RAO, degrees. */
  primaryAngleDeg: number;
  /** CRA/CAU, degrees. */
  secondaryAngleDeg: number;
  sourceToDetectorMm: number;
  /** Detector field of view (zoom), millimetres. */
  fieldOfViewMm: number;
}

/** Below these a change is noise in the reported geometry, not motion. */
export const GEOMETRY_TOLERANCE = {
  translationMm: 1,
  heightMm: 1,
  angleDeg: 0.5,
  sidMm: 2,
  fovMm: 1,
};

/** A mask held longer than this deserves a second look, milliseconds. */
export const MASK_AGE_ADVISORY_MS = 5 * 60_000;

export type ChangeKind = 'none' | 'translation' | 'projection';

export interface GeometryChange {
  kind: ChangeKind;
  /** Fields that moved beyond tolerance. */
  fields: string[];
  /** In-plane table displacement, millimetres. */
  translationMm: number;
  /** True only for a pure in-plane table translation. */
  correctableByShift: boolean;
  message: string;
}

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * What changed between the geometry the mask was acquired at and the live geometry.
 *
 * The distinction between a translation and a change of projection is the one that decides
 * whether the operator loses the roadmap — and losing it costs contrast and dose.
 */
export function geometryChange(
  maskGeometry: FluoroGeometry,
  liveGeometry: FluoroGeometry
): GeometryChange {
  if (!maskGeometry || !liveGeometry) {
    return {
      kind: 'projection',
      fields: ['geometry'],
      translationMm: 0,
      correctableByShift: false,
      message: 'Geometria de aquisição indisponível — o roadmap não pode ser confiado.',
    };
  }

  const dLateral = num(liveGeometry.tableLateralMm) - num(maskGeometry.tableLateralMm);
  const dLongitudinal =
    num(liveGeometry.tableLongitudinalMm) - num(maskGeometry.tableLongitudinalMm);
  const translationMm = Math.hypot(dLateral || 0, dLongitudinal || 0);

  const projectionFields: string[] = [];
  const check = (field: keyof FluoroGeometry, tolerance: number, label: string) => {
    const delta = Math.abs(num(liveGeometry[field]) - num(maskGeometry[field]));
    if (!Number.isFinite(delta) || delta > tolerance) {
      projectionFields.push(label);
    }
  };
  check('tableHeightMm', GEOMETRY_TOLERANCE.heightMm, 'altura da mesa');
  check('primaryAngleDeg', GEOMETRY_TOLERANCE.angleDeg, 'angulação primária');
  check('secondaryAngleDeg', GEOMETRY_TOLERANCE.angleDeg, 'angulação secundária');
  check('sourceToDetectorMm', GEOMETRY_TOLERANCE.sidMm, 'distância foco-detector');
  check('fieldOfViewMm', GEOMETRY_TOLERANCE.fovMm, 'campo de visão');

  const translated = translationMm > GEOMETRY_TOLERANCE.translationMm;

  if (projectionFields.length) {
    const fields = translated ? ['translação da mesa', ...projectionFields] : projectionFields;
    return {
      kind: 'projection',
      fields,
      translationMm,
      correctableByShift: false,
      message:
        `Mudou ${fields.join(', ')} — a projeção em si mudou, e nenhuma translação da máscara antiga corresponde a ela. ` +
        'É preciso máscara nova.',
    };
  }

  if (translated) {
    return {
      kind: 'translation',
      fields: ['translação da mesa'],
      translationMm,
      correctableByShift: true,
      message:
        `Mesa transladou ${translationMm.toFixed(1)} mm no plano — corrigível por deslocamento da máscara, ` +
        'sem novo contraste nem nova dose.',
    };
  }

  return {
    kind: 'none',
    fields: [],
    translationMm,
    correctableByShift: false,
    message: '',
  };
}

export interface RoadmapState {
  /** Pre-contrast mask. */
  mask: FluoroFrame;
  /** Opacified vessel map, already subtracted. Null until captured. */
  vesselMap: FluoroFrame | null;
  geometry: FluoroGeometry;
  acquiredAt: number;
  /** Manual re-registration, in pixels. */
  shift: [number, number];
  /** Value that means "no change" in the subtracted data. */
  offset: number;
}

export function acquireRoadmap(input: {
  mask: FluoroFrame;
  vesselMap?: FluoroFrame | null;
  geometry: FluoroGeometry;
  acquiredAt: number;
  offset?: number;
}): RoadmapState {
  return {
    mask: input.mask,
    vesselMap: input.vesselMap ? input.vesselMap : null,
    geometry: input.geometry,
    acquiredAt: Number(input.acquiredAt),
    shift: [0, 0],
    offset: Number.isFinite(Number(input.offset)) ? Number(input.offset) : 0,
  };
}

export interface RoadmapValidity {
  valid: boolean;
  change: GeometryChange;
  ageMs: number;
  advisories: string[];
  reason?: string;
}

/**
 * Whether the held mask still describes the live scene.
 *
 * Returns invalid — not "valid with a warning" — for any geometry change beyond tolerance.
 */
export function checkRoadmap(
  state: RoadmapState,
  liveGeometry: FluoroGeometry,
  now: number
): RoadmapValidity {
  const change = geometryChange(state?.geometry, liveGeometry);
  const ageMs = Math.max(0, num(now) - num(state?.acquiredAt));
  const advisories: string[] = [];

  if (ageMs > MASK_AGE_ADVISORY_MS) {
    advisories.push(
      `Máscara mantida há ${(ageMs / 60000).toFixed(0)} min. Movimento lento do paciente não aparece na geometria da mesa.`
    );
  }

  if (change.kind === 'none') {
    return { valid: true, change, ageMs, advisories };
  }

  return {
    valid: false,
    change,
    ageMs,
    advisories,
    reason: change.message,
  };
}

export interface ShiftResult {
  state: RoadmapState;
  ok: boolean;
  reason?: string;
}

/**
 * Manual re-registration by translating the mask.
 *
 * Refuses when the projection changed. A shift chosen because it looks better over a
 * rotation aligns one region and misaligns the rest — locally convincing, globally wrong,
 * which is more dangerous than an overlay that is obviously stale.
 */
export function shiftMask(
  state: RoadmapState,
  change: GeometryChange,
  dx: number,
  dy: number
): ShiftResult {
  if (change && change.kind === 'projection') {
    return {
      state,
      ok: false,
      reason:
        'Deslocar a máscara não corrige mudança de projeção: o ajuste alinha uma região e desalinha o resto — ' +
        'convincente localmente, errado globalmente. Adquira máscara nova.',
    };
  }
  const x = Math.round(num(dx));
  const y = Math.round(num(dy));
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { state, ok: false, reason: 'Deslocamento inválido.' };
  }
  return { state: { ...state, shift: [x, y] }, ok: true };
}

/** The mask resampled by the current shift; uncovered pixels become `offset`. */
export function shiftedMask(state: RoadmapState): FluoroFrame {
  const { mask, shift, offset } = state;
  const [dx, dy] = shift;
  if (!dx && !dy) {
    return mask;
  }
  const out = new Float32Array(mask.width * mask.height).fill(offset);
  for (let y = 0; y < mask.height; y++) {
    const sy = y - dy;
    if (sy < 0 || sy >= mask.height) {
      continue;
    }
    for (let x = 0; x < mask.width; x++) {
      const sx = x - dx;
      if (sx < 0 || sx >= mask.width) {
        continue;
      }
      out[y * mask.width + x] = mask.data[sy * mask.width + sx];
    }
  }
  return { width: mask.width, height: mask.height, data: out };
}

export type RoadmapMode = 'subtracted' | 'overlay';

export interface RoadmapFrame {
  frame: FluoroFrame | null;
  ok: boolean;
  reason?: string;
  advisories: string[];
}

/**
 * The displayed frame, or a refusal.
 *
 * Refusing to render is the point. A banner over a plausible-looking overlay is read after
 * the wire has already gone somewhere.
 *
 * - `subtracted` — live minus mask, the classic roadmap image.
 * - `overlay` — the opacified vessel map burned into the unsubtracted live frame, which is
 *   what most operators mean by roadmap: the wire keeps its native contrast and the vessels
 *   are drawn over it.
 */
export function applyRoadmap(
  state: RoadmapState,
  live: FluoroFrame,
  liveGeometry: FluoroGeometry,
  now: number,
  mode: RoadmapMode = 'subtracted',
  options: { overlayStrength?: number; negate?: boolean } = {}
): RoadmapFrame {
  const validity = checkRoadmap(state, liveGeometry, now);
  if (!validity.valid) {
    return { frame: null, ok: false, reason: validity.reason, advisories: validity.advisories };
  }
  if (!live || !state?.mask || live.width !== state.mask.width || live.height !== state.mask.height) {
    return {
      frame: null,
      ok: false,
      reason: 'Quadro ao vivo e máscara com dimensões diferentes.',
      advisories: validity.advisories,
    };
  }

  const mask = shiftedMask(state);
  const size = live.width * live.height;
  const out = new Float32Array(size);
  const negate = options.negate === true;

  if (mode === 'overlay') {
    if (!state.vesselMap) {
      return {
        frame: null,
        ok: false,
        reason: 'Sem mapa vascular capturado — o overlay não tem o que desenhar.',
        advisories: validity.advisories,
      };
    }
    const strength = Number.isFinite(Number(options.overlayStrength))
      ? Math.min(1, Math.max(0, Number(options.overlayStrength)))
      : 1;
    // Contrast darkens, so the vessel map sits BELOW the offset; the depth below it is how
    // opacified that pixel was.
    for (let i = 0; i < size; i++) {
      const opacity = Math.max(0, state.offset - state.vesselMap.data[i]);
      const value = live.data[i] - strength * opacity;
      out[i] = negate ? -value : value;
    }
  } else {
    for (let i = 0; i < size; i++) {
      const a = live.data[i];
      const b = mask.data[i];
      const value = Number.isFinite(a) && Number.isFinite(b) ? a - b + state.offset : state.offset;
      out[i] = negate ? state.offset - (value - state.offset) : value;
    }
  }

  return {
    frame: { width: live.width, height: live.height, data: out },
    ok: true,
    advisories: validity.advisories,
  };
}

export interface DriftResult {
  /** Normalised cross-correlation with the mask, −1..1. */
  correlation: number;
  suspected: boolean;
  message: string;
}

/**
 * Image-based drift, explicitly a secondary check.
 *
 * A guidewire crossing the field lowers the correlation without any patient motion, and
 * slow patient motion barely lowers it at all. Useful as a prompt, useless as a gate — the
 * geometry comparison is what decides.
 */
export function maskDrift(state: RoadmapState, live: FluoroFrame, threshold = 0.9): DriftResult {
  const mask = state?.mask;
  if (!mask || !live || mask.width !== live.width || mask.height !== live.height) {
    return { correlation: NaN, suspected: false, message: 'Quadros incomparáveis.' };
  }
  const n = mask.width * mask.height;
  let sumA = 0;
  let sumB = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(mask.data[i]) && Number.isFinite(live.data[i])) {
      sumA += mask.data[i];
      sumB += live.data[i];
      count++;
    }
  }
  if (!count) {
    return { correlation: NaN, suspected: false, message: 'Quadros sem dados válidos.' };
  }
  const meanA = sumA / count;
  const meanB = sumB / count;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(mask.data[i]) || !Number.isFinite(live.data[i])) {
      continue;
    }
    const da = mask.data[i] - meanA;
    const db = live.data[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  const denominator = Math.sqrt(varA * varB);
  if (!(denominator > 0)) {
    return { correlation: NaN, suspected: false, message: 'Quadro sem variação — correlação indefinida.' };
  }
  const correlation = cov / denominator;
  const limit = Number.isFinite(Number(threshold)) ? Number(threshold) : 0.9;

  return {
    correlation,
    suspected: correlation < limit,
    message:
      correlation < limit
        ? `Correlação com a máscara caiu para ${correlation.toFixed(2)}. Sinal fraco: um fio-guia cruzando o campo derruba a correlação sem haver movimento, e movimento lento do paciente quase não a derruba. Confirme pela geometria.`
        : '',
  };
}

/** One line for the roadmap panel. */
export function describeRoadmap(validity: RoadmapValidity): string {
  const advisories = validity.advisories.length ? ` ${validity.advisories.join(' ')}` : '';
  if (validity.valid) {
    return `Roadmap ativo.${advisories}`;
  }
  return `Roadmap invalidado: ${validity.reason}${advisories}`;
}
