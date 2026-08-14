/**
 * Volume-rendering preset curation (RTV-18) — pure module.
 *
 * ## What this is, and what it is not
 *
 * The ticket asks for "10 presets pré-prontos (CT bone, CT angio, CT lung, MR
 * default, etc.)". Those **already exist**: `@cornerstonejs/core` ships ~26
 * transfer-function presets (`CONSTANTS.VIEWPORT_PRESETS`), already surfaced by
 * `extensions/cornerstone`'s `cornerstone.3dVolumeRendering` customization. So
 * this module does *not* invent presets — inventing a second, worse set of
 * transfer functions would be strictly harmful.
 *
 * What is missing is **order and grouping**. The stock list arrives in essentially
 * arbitrary order with names like `CT-Coronary-Arteries-3`, so a radiotherapy
 * physicist hunting for bone or a DRR-like look scrolls a flat list of 26. This
 * module produces an RT-oriented ordering with clinical groups and friendly
 * labels, exposed through the CustomizationService for whatever renders the
 * preset picker.
 *
 * ## Robustness
 *
 * Curation is **non-destructive and rename-proof**: presets are ordered by a
 * preference list, grouped by rules, and *anything the list does not name is
 * grouped heuristically and appended*. Nothing is ever dropped, so an upstream
 * rename or addition degrades to "appears at the end", never to "disappears".
 *
 * No `@cornerstonejs/core` import — rtmedical-theme carries a nested dead copy of
 * it (see touchGestures.ts), so presets arrive as an argument. Framework-free and
 * unit-tested. Zero-fork per RTV-114.
 */

/** Clinical groups, in the order they should be presented. */
export type VrPresetGroup =
  | 'bone'
  | 'vascular'
  | 'lung'
  | 'softTissue'
  | 'cardiac'
  | 'projection'
  | 'mr'
  | 'other';

export const VR_PRESET_GROUP_ORDER: VrPresetGroup[] = [
  'bone',
  'vascular',
  'lung',
  'softTissue',
  'cardiac',
  'projection',
  'mr',
  'other',
];

export const VR_PRESET_GROUP_LABELS: Record<VrPresetGroup, string> = {
  bone: 'Bone / skeleton',
  vascular: 'Vascular',
  lung: 'Lung / airway',
  softTissue: 'Soft tissue',
  cardiac: 'Cardiac',
  projection: 'Projection',
  mr: 'MR',
  other: 'Other',
};

/** Anything with a `name`. The real presets also carry transfer-function data. */
export interface VrPresetLike {
  name?: string;
  [key: string]: unknown;
}

export interface CuratedVrPreset<T extends VrPresetLike = VrPresetLike> {
  /** The stock preset, untouched. */
  preset: T;
  name: string;
  group: VrPresetGroup;
  /** Friendly label, e.g. `CT-Soft-Tissue` -> "Soft tissue". */
  label: string;
  /** True when this preset was explicitly curated rather than heuristically placed. */
  curated: boolean;
}

/**
 * Explicit group assignment for the stock names, most useful first within each
 * group. Names not listed here still get grouped — by {@link guessGroup}.
 */
const CURATED_ORDER: Array<[string, VrPresetGroup]> = [
  // Bone first: it is what an RT physicist reaches for most (bony landmarks for
  // setup verification).
  ['CT-Bone', 'bone'],
  ['CT-Bones', 'bone'],
  ['CT-Cropped-Volume-Bone', 'bone'],

  ['CT-AAA', 'vascular'],
  ['CT-AAA2', 'vascular'],
  ['CT-Chest-Vessels', 'vascular'],
  ['CT-Pulmonary-Arteries', 'vascular'],
  ['CT-Liver-Vasculature', 'vascular'],
  ['CT-Coronary-Arteries', 'vascular'],
  ['CT-Coronary-Arteries-2', 'vascular'],
  ['CT-Coronary-Arteries-3', 'vascular'],

  ['CT-Lung', 'lung'],
  ['CT-Air', 'lung'],

  ['CT-Soft-Tissue', 'softTissue'],
  ['CT-Muscle', 'softTissue'],
  ['CT-Fat', 'softTissue'],
  ['CT-Chest-Contrast-Enhanced', 'softTissue'],

  ['CT-Cardiac', 'cardiac'],
  ['CT-Cardiac2', 'cardiac'],
  ['CT-Cardiac3', 'cardiac'],

  // Grouped separately because these are projections, not tissue presets — the
  // closest stock equivalent to the DRR look.
  ['CT-MIP', 'projection'],
  ['MR-MIP', 'projection'],

  ['MR-Default', 'mr'],
  ['MR-Angio', 'mr'],
  ['MR-T2-Brain', 'mr'],
  ['MR-T-Brain', 'mr'],
  ['DTI-FA-Brain', 'mr'],
];

const CURATED_GROUP_BY_NAME = new Map<string, VrPresetGroup>(CURATED_ORDER);
const CURATED_RANK_BY_NAME = new Map<string, number>(
  CURATED_ORDER.map(([name], index) => [name, index])
);

/**
 * Group for a preset the curation list does not name.
 * Keyword rules first, then the modality prefix, then `other`.
 */
export function guessGroup(name: string): VrPresetGroup {
  const upper = String(name ?? '').toUpperCase();
  const has = (...needles: string[]) => needles.some(n => upper.includes(n));

  if (has('BONE', 'SKELET')) {
    return 'bone';
  }
  if (has('MIP')) {
    return 'projection';
  }
  if (has('VESSEL', 'ARTER', 'ANGIO', 'VASCULAR', 'AAA', 'VEIN')) {
    return 'vascular';
  }
  if (has('LUNG', 'AIR', 'AIRWAY', 'BRONCH')) {
    return 'lung';
  }
  if (has('CARDIAC', 'HEART', 'CORONARY')) {
    return 'cardiac';
  }
  if (has('SOFT', 'MUSCLE', 'FAT', 'TISSUE', 'LIVER', 'BRAIN')) {
    return 'softTissue';
  }
  if (upper.startsWith('MR') || upper.startsWith('DTI')) {
    return 'mr';
  }
  return 'other';
}

/**
 * Friendly label for a stock preset name.
 *
 * `CT-Soft-Tissue` -> "Soft tissue": the modality prefix is dropped (the group
 * already carries it), hyphens become spaces, and only the first word is
 * capitalised so the picker does not shout.
 */
export function friendlyLabel(name: string): string {
  const raw = String(name ?? '').trim();
  if (!raw) {
    return '';
  }
  const withoutModality = raw.replace(/^(CT|MR|DTI|PT|US)[-_ ]/i, '');
  const words = withoutModality.replace(/[-_]+/g, ' ').trim();
  if (!words) {
    return raw;
  }
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

/**
 * Curates a stock preset list: RT-oriented order, clinical groups, friendly labels.
 *
 * Non-destructive — every input preset appears exactly once in the output.
 * Presets with no usable `name` are dropped, since a picker cannot show them, and
 * duplicates by name are collapsed keeping the first.
 */
export function curateVrPresets<T extends VrPresetLike>(presets: T[]): CuratedVrPreset<T>[] {
  const seen = new Set<string>();
  const entries: CuratedVrPreset<T>[] = [];

  for (const preset of presets ?? []) {
    const name = typeof preset?.name === 'string' ? preset.name.trim() : '';
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    const curatedGroup = CURATED_GROUP_BY_NAME.get(name);
    entries.push({
      preset,
      name,
      group: curatedGroup ?? guessGroup(name),
      label: friendlyLabel(name),
      curated: curatedGroup != null,
    });
  }

  const groupRank = (group: VrPresetGroup) => {
    const index = VR_PRESET_GROUP_ORDER.indexOf(group);
    return index === -1 ? VR_PRESET_GROUP_ORDER.length : index;
  };

  return entries.sort((a, b) => {
    const byGroup = groupRank(a.group) - groupRank(b.group);
    if (byGroup !== 0) {
      return byGroup;
    }
    // Inside a group: curated presets in their curated order, then the rest
    // alphabetically, so an upstream addition lands predictably at the end.
    const rankA = CURATED_RANK_BY_NAME.get(a.name);
    const rankB = CURATED_RANK_BY_NAME.get(b.name);
    if (rankA != null && rankB != null) {
      return rankA - rankB;
    }
    if (rankA != null) {
      return -1;
    }
    if (rankB != null) {
      return 1;
    }
    return a.name.localeCompare(b.name);
  });
}

/** Curated presets bucketed by group, groups in presentation order, empties dropped. */
export function groupVrPresets<T extends VrPresetLike>(
  presets: T[]
): Array<{ group: VrPresetGroup; label: string; presets: CuratedVrPreset<T>[] }> {
  const curated = curateVrPresets(presets);
  return VR_PRESET_GROUP_ORDER.map(group => ({
    group,
    label: VR_PRESET_GROUP_LABELS[group],
    presets: curated.filter(entry => entry.group === group),
  })).filter(bucket => bucket.presets.length > 0);
}

/** The stock preset objects in curated order — drop-in for `volumeRenderingPresets`. */
export function curatedVrPresetList<T extends VrPresetLike>(presets: T[]): T[] {
  return curateVrPresets(presets).map(entry => entry.preset);
}
