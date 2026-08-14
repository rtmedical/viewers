import {
  curatedVrPresetList,
  curateVrPresets,
  friendlyLabel,
  groupVrPresets,
  guessGroup,
  VR_PRESET_GROUP_ORDER,
} from './vrPresets';

const p = (name: string) => ({ name, RGBPoints: [0, 0, 0, 0] });

/** A stand-in for the stock @cornerstonejs/core VIEWPORT_PRESETS list. */
const STOCK = [
  'MR-Default',
  'CT-Lung',
  'CT-Soft-Tissue',
  'CT-Bone',
  'CT-MIP',
  'CT-Coronary-Arteries-3',
  'CT-AAA',
  'CT-Cardiac',
  'DTI-FA-Brain',
].map(p);

describe('guessGroup', () => {
  it.each([
    ['CT-Bone', 'bone'],
    ['Some-Skeleton-Preset', 'bone'],
    ['CT-Chest-Vessels', 'vascular'],
    ['CT-Pulmonary-Arteries', 'vascular'],
    ['MR-Angio', 'vascular'],
    ['CT-Lung', 'lung'],
    ['CT-Air', 'lung'],
    ['CT-Cardiac', 'cardiac'],
    ['CT-Soft-Tissue', 'softTissue'],
    ['CT-MIP', 'projection'],
    ['MR-Something-New', 'mr'],
    ['DTI-FA-Brain', 'softTissue'],
    ['Totally-Unknown', 'other'],
  ])('groups %s as %s', (name, expected) => {
    expect(guessGroup(name)).toBe(expected);
  });

  it('checks MIP before the vascular keywords', () => {
    // MR-MIP contains no vascular word, but a future "CT-Angio-MIP" must read as
    // a projection, not as vascular.
    expect(guessGroup('CT-Angio-MIP')).toBe('projection');
  });

  it('handles empty input', () => {
    expect(guessGroup('')).toBe('other');
    expect(guessGroup(undefined as never)).toBe('other');
  });
});

describe('friendlyLabel', () => {
  it('drops the modality prefix and normalises case', () => {
    expect(friendlyLabel('CT-Soft-Tissue')).toBe('Soft tissue');
    expect(friendlyLabel('MR-Default')).toBe('Default');
    expect(friendlyLabel('CT-Coronary-Arteries-3')).toBe('Coronary arteries 3');
  });

  it('keeps the name when there is nothing after the prefix', () => {
    expect(friendlyLabel('CT-')).toBe('CT-');
  });

  it('handles empty input', () => {
    expect(friendlyLabel('')).toBe('');
    expect(friendlyLabel(undefined as never)).toBe('');
  });
});

describe('curateVrPresets', () => {
  it('never drops a named preset', () => {
    const curated = curateVrPresets(STOCK);
    expect(curated).toHaveLength(STOCK.length);
    expect(curated.map(c => c.name).sort()).toEqual(STOCK.map(s => s.name).sort());
  });

  it('puts bone first — what an RT physicist reaches for', () => {
    expect(curateVrPresets(STOCK)[0].name).toBe('CT-Bone');
  });

  it('orders by group, following the declared group order', () => {
    const groups = curateVrPresets(STOCK).map(c => c.group);
    const ranks = groups.map(g => VR_PRESET_GROUP_ORDER.indexOf(g));
    const sorted = [...ranks].sort((a, b) => a - b);
    expect(ranks).toEqual(sorted);
  });

  it('marks curated entries and keeps the stock object untouched', () => {
    const curated = curateVrPresets(STOCK);
    const bone = curated.find(c => c.name === 'CT-Bone');
    expect(bone?.curated).toBe(true);
    expect(bone?.preset).toBe(STOCK.find(s => s.name === 'CT-Bone'));
  });

  it('appends an unknown preset instead of losing it', () => {
    // Rename-proofing: upstream adding or renaming a preset must degrade to
    // "shows up at the end", never to "disappears".
    const curated = curateVrPresets([...STOCK, p('CT-Brand-New-Thing')]);
    const entry = curated.find(c => c.name === 'CT-Brand-New-Thing');
    expect(entry).toBeDefined();
    expect(entry?.curated).toBe(false);
  });

  it('sorts uncurated names alphabetically within their group', () => {
    const curated = curateVrPresets([p('CT-Zebra-Bone'), p('CT-Alpha-Bone'), p('CT-Bone')]);
    expect(curated.map(c => c.name)).toEqual(['CT-Bone', 'CT-Alpha-Bone', 'CT-Zebra-Bone']);
  });

  it('collapses duplicates by name, keeping the first', () => {
    const first = p('CT-Bone');
    const second = p('CT-Bone');
    const curated = curateVrPresets([first, second]);
    expect(curated).toHaveLength(1);
    expect(curated[0].preset).toBe(first);
  });

  it('drops entries a picker could not show', () => {
    expect(curateVrPresets([p('CT-Bone'), { RGBPoints: [] }, { name: '   ' }])).toHaveLength(1);
  });

  it('handles empty and nullish input', () => {
    expect(curateVrPresets([])).toEqual([]);
    expect(curateVrPresets(undefined as never)).toEqual([]);
  });
});

describe('groupVrPresets', () => {
  it('buckets by group and drops empty buckets', () => {
    const buckets = groupVrPresets(STOCK);
    expect(buckets.length).toBeGreaterThan(1);
    for (const bucket of buckets) {
      expect(bucket.presets.length).toBeGreaterThan(0);
      expect(bucket.label).toBeTruthy();
    }
    expect(buckets[0].group).toBe('bone');
  });

  it('covers every preset exactly once across the buckets', () => {
    const total = groupVrPresets(STOCK).reduce((sum, b) => sum + b.presets.length, 0);
    expect(total).toBe(STOCK.length);
  });
});

describe('curatedVrPresetList', () => {
  it('returns the stock objects, reordered', () => {
    const list = curatedVrPresetList(STOCK);
    expect(list).toHaveLength(STOCK.length);
    expect(list[0]).toBe(STOCK.find(s => s.name === 'CT-Bone'));
    // Same objects, so it is a drop-in for `volumeRenderingPresets`.
    for (const preset of list) {
      expect(STOCK).toContain(preset);
    }
  });
});
