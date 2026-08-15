/**
 * Breast tomosynthesis (DBT) detection and hanging — pure core (RTV-76).
 *
 * A tomosynthesis study is read as the classic four-up: **CC on top, MLO below,
 * right breast on the viewer's left** ("as if facing the patient"), with the two
 * breasts back-to-back so the chest walls meet in the middle. The reader scrolls the
 * slice slider and every tile moves together — comparing the same depth across the
 * four projections is the whole point of the layout.
 *
 * Framework-free and `@ohif/*`-free, like the other cores in this package.
 * Zero-fork per RTV-114.
 */

/** Breast Tomosynthesis Image Storage. */
export const BREAST_TOMOSYNTHESIS_SOP_CLASS_UID = '1.2.840.10008.5.1.4.1.1.13.1.3';

export type Laterality = 'L' | 'R';
/** The mammographic projections worth hanging. */
export type MammoView = 'CC' | 'MLO' | 'ML' | 'LM' | 'XCCL' | 'AT';

export interface MammoInstanceLike {
  Modality?: string;
  SOPClassUID?: string;
  NumberOfFrames?: number | string;
  /** (0020,0062). */
  ImageLaterality?: string;
  /** (0020,0060), the older attribute. */
  Laterality?: string;
  /** (0018,5101). */
  ViewPosition?: string;
  SeriesDescription?: string;
  BodyPartExamined?: string;
  SeriesInstanceUID?: string;
  SeriesNumber?: number;
  [key: string]: unknown;
}

export interface MammoViewInfo {
  laterality: Laterality | null;
  view: MammoView | null;
  /** Multi-frame MG — the tomosynthesis stack. */
  isTomosynthesis: boolean;
  /** Frames in the stack; 1 for a conventional 2D mammogram. */
  frameCount: number;
}

const VIEWS: MammoView[] = ['MLO', 'XCCL', 'CC', 'ML', 'LM', 'AT'];

function tokens(value: unknown): string[] {
  if (value == null) {
    return [];
  }
  return String(value)
    .toUpperCase()
    .split(/[\\\s_\-./,()[\]+]+/)
    .filter(Boolean);
}

/** Laterality from the DICOM attributes, falling back to the description. */
export function parseLaterality(instance: MammoInstanceLike): Laterality | null {
  for (const raw of [instance?.ImageLaterality, instance?.Laterality]) {
    const value = String(raw ?? '').trim().toUpperCase();
    if (value === 'L' || value === 'R') {
      return value;
    }
  }
  // Descriptions carry it as a standalone token ("R MLO", "LEFT CC"), never as a
  // substring — "LM" must not read as left.
  const words = tokens(instance?.SeriesDescription);
  if (words.includes('R') || words.includes('RIGHT')) {
    return 'R';
  }
  if (words.includes('L') || words.includes('LEFT')) {
    return 'L';
  }
  return null;
}

/**
 * Projection from ViewPosition, falling back to the description.
 *
 * `XCCL` and `MLO` are checked before `CC` and `ML`: matching on whole tokens keeps
 * "XCCL" from reading as "CC", but a description like "R XCCL" tokenises to a single
 * token, so order still matters for the substring fallback below.
 */
export function parseView(instance: MammoInstanceLike): MammoView | null {
  const position = String(instance?.ViewPosition ?? '').trim().toUpperCase();
  if (VIEWS.includes(position as MammoView)) {
    return position as MammoView;
  }
  const words = tokens(instance?.SeriesDescription);
  for (const view of VIEWS) {
    if (words.includes(view)) {
      return view;
    }
  }
  return null;
}

/** Frames in the instance; 1 when the attribute is absent. */
export function frameCount(instance: MammoInstanceLike): number {
  const n = Number(instance?.NumberOfFrames);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

/**
 * Whether the instance is a tomosynthesis stack.
 *
 * The SOP Class is definitive when present. Otherwise it is multi-frame MG: a
 * conventional 2D mammogram is single-frame, so `NumberOfFrames > 1` on an MG series
 * is the reconstruction. Modality is required — a multi-frame CT is not DBT.
 */
export function isTomosynthesis(instance: MammoInstanceLike): boolean {
  if (String(instance?.SOPClassUID ?? '') === BREAST_TOMOSYNTHESIS_SOP_CLASS_UID) {
    return true;
  }
  const modality = String(instance?.Modality ?? '').trim().toUpperCase();
  return modality === 'MG' && frameCount(instance) > 1;
}

export function parseMammoView(instance: MammoInstanceLike): MammoViewInfo {
  return {
    laterality: parseLaterality(instance ?? {}),
    view: parseView(instance ?? {}),
    isTomosynthesis: isTomosynthesis(instance ?? {}),
    frameCount: frameCount(instance ?? {}),
  };
}

/** The four tiles, in hanging order. */
export type DbtTile = 'RCC' | 'LCC' | 'RMLO' | 'LMLO';

/**
 * Reading order: CC row on top, MLO below, right breast on the viewer's LEFT.
 *
 * "As if facing the patient" is the convention every mammographer reads by; hanging
 * the left breast on the left would silently mirror the reader's mental model.
 */
export const DBT_HANGING_ORDER: DbtTile[] = ['RCC', 'LCC', 'RMLO', 'LMLO'];

export const DBT_TILE_LABELS: Record<DbtTile, string> = {
  RCC: 'R CC',
  LCC: 'L CC',
  RMLO: 'R MLO',
  LMLO: 'L MLO',
};

/**
 * Which edge of its own tile the chest wall sits against, under the back-to-back
 * convention.
 *
 * With the right breast on the viewer's left, the two chest walls meet in the middle:
 * the right image's chest wall is at its right edge, the left image's at its left.
 *
 * NOTE this describes the *intended presentation*, not a transform to apply blindly.
 * Whether the stored pixel data already satisfies it depends on how the vendor
 * oriented the image (PatientOrientation, 0020,0020); the renderer should reconcile
 * the two rather than flipping on laterality alone.
 */
export function expectedChestWallSide(laterality: Laterality): 'left' | 'right' {
  return laterality === 'R' ? 'right' : 'left';
}

/** Tile id for a laterality/view pair, or null when it is not one of the four. */
export function tileFor(info: MammoViewInfo): DbtTile | null {
  if (!info?.laterality || !info.view) {
    return null;
  }
  if (info.view === 'CC') {
    return info.laterality === 'R' ? 'RCC' : 'LCC';
  }
  if (info.view === 'MLO') {
    return info.laterality === 'R' ? 'RMLO' : 'LMLO';
  }
  // ML, LM, XCCL and AT are supplementary projections; they do not belong in the
  // standard four-up and are left for the reader to open manually.
  return null;
}

export interface DbtSet<T extends MammoInstanceLike = MammoInstanceLike> {
  tiles: Partial<Record<DbtTile, T>>;
  /** Tiles present, in hanging order. */
  present: DbtTile[];
  /** True when at least one tomosynthesis stack was found. */
  isDbt: boolean;
  /** Largest frame count across the tiles — the slice slider's range. */
  maxFrameCount: number;
}

/**
 * Groups a study's series into the four-up.
 *
 * Only tomosynthesis series are placed: a study routinely contains both the 2D
 * mammogram and the DBT stack for each view, and hanging the 2D image in a slot whose
 * slider does nothing would be worse than leaving it empty. When two stacks claim the
 * same tile, the lower SeriesNumber wins.
 */
export function detectDbtSet<T extends MammoInstanceLike>(seriesList: T[]): DbtSet<T> {
  const tiles: Partial<Record<DbtTile, T>> = {};
  let maxFrameCount = 0;

  for (const series of seriesList ?? []) {
    if (!series) {
      continue;
    }
    const info = parseMammoView(series);
    if (!info.isTomosynthesis) {
      continue;
    }
    const tile = tileFor(info);
    if (!tile) {
      continue;
    }
    const incumbent = tiles[tile];
    if (!incumbent || seriesNumberOf(series) < seriesNumberOf(incumbent)) {
      tiles[tile] = series;
    }
    maxFrameCount = Math.max(maxFrameCount, info.frameCount);
  }

  const present = DBT_HANGING_ORDER.filter(tile => tiles[tile] != null);
  return { tiles, present, isDbt: present.length > 0, maxFrameCount };
}

function seriesNumberOf(series: MammoInstanceLike): number {
  const n = Number(series?.SeriesNumber);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

/** One-line summary for the panel. */
export function describeDbtSet(set: DbtSet): string {
  if (!set?.isDbt) {
    return 'No tomosynthesis series in this study';
  }
  const missing = DBT_HANGING_ORDER.filter(t => !set.tiles[t]);
  const base = `DBT ${set.present.length}/4 · ${set.maxFrameCount} slices`;
  return missing.length ? `${base} · missing ${missing.map(t => DBT_TILE_LABELS[t]).join(', ')}` : base;
}
