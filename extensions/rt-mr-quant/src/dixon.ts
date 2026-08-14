/**
 * DIXON series detection — pure core (RTV-83).
 *
 * A Dixon (fat/water separation) acquisition arrives as up to four
 * reconstructions of the same anatomy: **fat only**, **water only**,
 * **in-phase** and **out-of-phase** (opposed-phase). Radiologists read them
 * side by side, so the viewer has to recognise the quartet and hang it 2x2
 * with slice and window/level synchronised.
 *
 * There is no single DICOM tag that says "this is the fat image". The reliable
 * signal is ImageType (0008,0008), where vendors put FAT / WATER / IN_PHASE /
 * OUT_PHASE among the value 3+ tokens; SeriesDescription is the fallback.
 *
 * Framework-free and `@ohif/*`-free (mirrors the house style of the other
 * `rt-*` cores — see extensions/rt-plan/README.md on why the extension cores
 * avoid importing `@ohif/core`). Zero-fork per RTV-114.
 */

/** The four reconstructions of a Dixon acquisition. */
export type DixonComponent = 'fat' | 'water' | 'inPhase' | 'outPhase';

export const DIXON_COMPONENTS: DixonComponent[] = ['fat', 'water', 'inPhase', 'outPhase'];

/**
 * Reading order for the 2x2 layout: water and fat on top (the separation that
 * carries the diagnosis), in/out phase below (the source pair).
 */
export const DIXON_HANGING_ORDER: DixonComponent[] = ['water', 'fat', 'inPhase', 'outPhase'];

/** Human labels. */
export const DIXON_LABELS: Record<DixonComponent, string> = {
  water: 'Water only',
  fat: 'Fat only',
  inPhase: 'In-phase',
  outPhase: 'Out-of-phase',
};

/** The minimum a series has to expose for classification. */
export interface DixonSeriesLike {
  SeriesInstanceUID?: string;
  SeriesDescription?: string;
  SeriesNumber?: number;
  Modality?: string;
  /** DICOM (0008,0008). Either the raw backslash string or an already-split array. */
  ImageType?: string | string[];
}

/**
 * Fat-saturation is NOT Dixon fat-only — it is the opposite (fat suppressed).
 * "T2 TSE FS", "STIR fatsat" and "SPAIR" must never be classified as `fat`,
 * so these tokens veto a fat match.
 */
const FAT_SUPPRESSION_TOKENS = [
  'FATSAT',
  'FATSATURATION',
  'FS',
  'SPAIR',
  'SPIR',
  'STIR',
  'FATSUP',
  'FATSUPPRESSION',
  'CHESS',
];

/**
 * Vendor names for the Dixon technique itself. Their presence is what licenses
 * the *ambiguous* abbreviations below.
 */
const DIXON_TECHNIQUE_TOKENS = ['DIXON', 'MDIXON', 'IDEAL', 'IDEALIQ', 'FLEX', 'LAVAFLEX'];

/**
 * Abbreviations that are only safe to read as Dixon components when the series
 * also names the technique.
 *
 * `W` and `F` are the dangerous pair: "T2 W" / "T1_W" tokenise to a bare `W`,
 * and that is MR *weighting*, not water. Same story for `IP`/`OP`. Requiring a
 * DIXON/mDIXON/IDEAL marker alongside them keeps ordinary T1/T2 series out
 * while still catching the real vendor strings ("mDIXON W", "IDEAL IP").
 */
const AMBIGUOUS_ABBREVIATIONS: Record<string, DixonComponent> = {
  W: 'water',
  F: 'fat',
  IP: 'inPhase',
  OP: 'outPhase',
  OPP: 'outPhase',
};

/**
 * Splits a DICOM multi-valued string / array into upper-case tokens.
 *
 * Both the DICOM value separator (`\`) and the separators vendors use inside a
 * SeriesDescription (space, underscore, hyphen, dot, slash, comma, brackets)
 * are treated as boundaries, so `mDIXON-W` and `T1_VIBE_FAT_ONLY` both tokenise.
 */
export function tokenize(value?: string | string[]): string[] {
  if (value == null) {
    return [];
  }
  const joined = Array.isArray(value) ? value.join('\\') : value;
  return joined
    .toUpperCase()
    .split(/[\\\s_\-./,()[\]+]+/)
    .filter(Boolean);
}

/** True when the tokens carry a fat-suppression marker (vetoes `fat`). */
function hasFatSuppression(tokens: string[]): boolean {
  return tokens.some(t => FAT_SUPPRESSION_TOKENS.includes(t));
}

/** True when the tokens name the Dixon technique. */
export function namesDixonTechnique(tokens: string[]): boolean {
  return tokens.some(t => DIXON_TECHNIQUE_TOKENS.includes(t));
}

/**
 * Matches a component from a token list, or `null`.
 *
 * Order matters: out/opposed is tested before in-phase, because "OUT_PHASE"
 * tokenises to ['OUT','PHASE'] and a substring check for "IN" would also hit
 * "opposed". Matching whole tokens (never substrings) is what keeps
 * "WATERFALL"-style false positives out.
 */
function classifyTokens(
  tokens: string[],
  techniqueNamed = false,
  fatVetoedElsewhere = false
): DixonComponent | null {
  if (!tokens.length) {
    return null;
  }
  const has = (...names: string[]) => names.some(n => tokens.includes(n));
  const fatIsVetoed = fatVetoedElsewhere || hasFatSuppression(tokens);

  // --- Unambiguous spellings, safe on their own. -----------------------------
  if (has('OUTPHASE', 'OUTOFPHASE', 'OPPOSED', 'OPPOSEDPHASE') || (has('OUT') && has('PHASE'))) {
    return 'outPhase';
  }
  if (has('INPHASE') || (has('IN') && has('PHASE'))) {
    return 'inPhase';
  }
  if (has('WATER', 'WATERONLY')) {
    return 'water';
  }
  if (has('FAT', 'FATONLY')) {
    return fatIsVetoed ? null : 'fat';
  }

  // --- Ambiguous abbreviations: only with a technique marker. ----------------
  if (techniqueNamed || namesDixonTechnique(tokens)) {
    for (const token of tokens) {
      const component = AMBIGUOUS_ABBREVIATIONS[token];
      if (component) {
        return component === 'fat' && fatIsVetoed ? null : component;
      }
    }
  }

  return null;
}

/**
 * Classifies one series as a Dixon component, or `null` when it is not one.
 *
 * ImageType wins over SeriesDescription: it is where the standard and the
 * vendors put the reconstruction identity, and it is far less likely than a
 * free-text description to contain misleading words. When ImageType is silent
 * the description is consulted — and a fat-suppression marker *there* still
 * vetoes fat, so "T1 FS FAT" stays unclassified.
 */
export function classifyDixonSeries(series: DixonSeriesLike): DixonComponent | null {
  if (!series) {
    return null;
  }
  // Dixon is an MR technique. Guard so a CT series described "IN PHASE" cannot
  // match. An absent Modality is tolerated (metadata is often partial).
  if (series.Modality && series.Modality.toUpperCase() !== 'MR') {
    return null;
  }

  const imageTypeTokens = tokenize(series.ImageType);
  const descriptionTokens = tokenize(series.SeriesDescription);

  // The technique marker usually lives in the description ("T1 mDIXON") while the
  // component lives in ImageType ("...\\W"), so the abbreviation rule has to be
  // licensed by either field.
  const combined = imageTypeTokens.concat(descriptionTokens);
  const techniqueNamed = namesDixonTechnique(combined);
  // The veto is study-wide across both fields: ImageType may say FAT while the
  // description reveals it is a fat-*saturated* sequence.
  const fatVetoed = hasFatSuppression(combined);

  const fromImageType = classifyTokens(imageTypeTokens, techniqueNamed, fatVetoed);
  if (fromImageType) {
    return fromImageType;
  }

  return classifyTokens(descriptionTokens, techniqueNamed, fatVetoed);
}

export interface DixonSet<T extends DixonSeriesLike = DixonSeriesLike> {
  /** The series found per component. Absent components are simply missing. */
  components: Partial<Record<DixonComponent, T>>;
  /** Components present, in hanging order. */
  present: DixonComponent[];
  /**
   * True when the study looks like a Dixon acquisition worth hanging 2x2.
   * Two components is the meaningful floor: a lone "water only" series is just
   * a series, while water+fat (or in+out) is a separation to compare.
   */
  isDixon: boolean;
}

function seriesNumberOf(series: DixonSeriesLike): number {
  const n = Number(series?.SeriesNumber);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

/**
 * Groups a study's series into a Dixon set.
 *
 * When two series claim the same component (repeat acquisitions), the lower
 * SeriesNumber wins — the first reconstruction of a repeat pair is the one
 * radiologists expect to be hung.
 */
export function detectDixonSet<T extends DixonSeriesLike>(seriesList: T[]): DixonSet<T> {
  const components: Partial<Record<DixonComponent, T>> = {};

  for (const series of seriesList ?? []) {
    const component = classifyDixonSeries(series);
    if (!component) {
      continue;
    }
    const incumbent = components[component];
    if (!incumbent || seriesNumberOf(series) < seriesNumberOf(incumbent)) {
      components[component] = series;
    }
  }

  const present = DIXON_HANGING_ORDER.filter(c => components[c] != null);
  return { components, present, isDixon: present.length >= 2 };
}
