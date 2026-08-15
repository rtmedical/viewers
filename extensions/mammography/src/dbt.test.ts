import {
  BREAST_TOMOSYNTHESIS_SOP_CLASS_UID,
  DBT_HANGING_ORDER,
  describeDbtSet,
  detectDbtSet,
  expectedChestWallSide,
  frameCount,
  isTomosynthesis,
  parseLaterality,
  parseMammoView,
  parseView,
  tileFor,
} from './dbt';
import { dbtProtocol, DBT_PROTOCOL_ID, dbtViewportLabels } from './dbtProtocol';

const tomo = (over: Record<string, unknown> = {}) => ({
  Modality: 'MG',
  NumberOfFrames: 60,
  ...over,
});

describe('parseLaterality', () => {
  it('reads ImageLaterality, then Laterality', () => {
    expect(parseLaterality({ ImageLaterality: 'R' })).toBe('R');
    expect(parseLaterality({ Laterality: 'L' })).toBe('L');
    expect(parseLaterality({ ImageLaterality: 'L', Laterality: 'R' })).toBe('L');
  });

  it('falls back to whole tokens in the description', () => {
    expect(parseLaterality({ SeriesDescription: 'R MLO Tomo' })).toBe('R');
    expect(parseLaterality({ SeriesDescription: 'LEFT CC' })).toBe('L');
  });

  it('does not read a substring as laterality', () => {
    // "LM" is a projection, not "left".
    expect(parseLaterality({ SeriesDescription: 'LM view' })).toBeNull();
    expect(parseLaterality({ SeriesDescription: 'ROUTINE' })).toBeNull();
  });

  it('is null when nothing says', () => {
    expect(parseLaterality({})).toBeNull();
  });
});

describe('parseView', () => {
  it('reads ViewPosition', () => {
    expect(parseView({ ViewPosition: 'CC' })).toBe('CC');
    expect(parseView({ ViewPosition: 'mlo' })).toBe('MLO');
    expect(parseView({ ViewPosition: 'XCCL' })).toBe('XCCL');
  });

  it('falls back to the description', () => {
    expect(parseView({ SeriesDescription: 'R MLO tomo' })).toBe('MLO');
  });

  it('does not confuse XCCL with CC', () => {
    expect(parseView({ ViewPosition: 'XCCL' })).not.toBe('CC');
  });

  it('is null for an unknown projection', () => {
    expect(parseView({ ViewPosition: 'FOO' })).toBeNull();
    expect(parseView({})).toBeNull();
  });
});

describe('isTomosynthesis', () => {
  it('trusts the SOP Class', () => {
    expect(
      isTomosynthesis({ SOPClassUID: BREAST_TOMOSYNTHESIS_SOP_CLASS_UID, Modality: 'MG' })
    ).toBe(true);
  });

  it('accepts multi-frame MG', () => {
    // A conventional 2D mammogram is single-frame, so >1 frame on MG is the stack.
    expect(isTomosynthesis(tomo())).toBe(true);
  });

  it('rejects a single-frame mammogram', () => {
    expect(isTomosynthesis({ Modality: 'MG', NumberOfFrames: 1 })).toBe(false);
    expect(isTomosynthesis({ Modality: 'MG' })).toBe(false);
  });

  it('rejects multi-frame from another modality', () => {
    // A multi-frame CT is not tomosynthesis.
    expect(isTomosynthesis({ Modality: 'CT', NumberOfFrames: 300 })).toBe(false);
  });

  it('reads the frame count defensively', () => {
    expect(frameCount({ NumberOfFrames: '60' })).toBe(60);
    expect(frameCount({ NumberOfFrames: 'many' })).toBe(1);
    expect(frameCount({})).toBe(1);
  });
});

describe('tileFor', () => {
  it('maps the four standard projections', () => {
    expect(tileFor(parseMammoView(tomo({ ImageLaterality: 'R', ViewPosition: 'CC' })))).toBe('RCC');
    expect(tileFor(parseMammoView(tomo({ ImageLaterality: 'L', ViewPosition: 'MLO' })))).toBe('LMLO');
  });

  it('leaves supplementary projections out of the four-up', () => {
    // ML, LM, XCCL and AT are extra views; the reader opens them manually.
    for (const view of ['ML', 'LM', 'XCCL', 'AT']) {
      expect(tileFor(parseMammoView(tomo({ ImageLaterality: 'R', ViewPosition: view })))).toBeNull();
    }
  });

  it('is null without both laterality and view', () => {
    expect(tileFor(parseMammoView(tomo({ ViewPosition: 'CC' })))).toBeNull();
    expect(tileFor(parseMammoView(tomo({ ImageLaterality: 'R' })))).toBeNull();
  });
});

describe('hanging convention', () => {
  it('puts CC on top and the right breast on the viewer left', () => {
    // "As if facing the patient" — hanging the left breast on the left would mirror
    // the reader's mental model.
    expect(DBT_HANGING_ORDER).toEqual(['RCC', 'LCC', 'RMLO', 'LMLO']);
  });

  it('expects the chest walls to meet in the middle', () => {
    expect(expectedChestWallSide('R')).toBe('right');
    expect(expectedChestWallSide('L')).toBe('left');
  });
});

describe('detectDbtSet', () => {
  const set = (over: Record<string, unknown>, n: number) =>
    tomo({ SeriesNumber: n, ...over });

  it('fills the four-up', () => {
    const result = detectDbtSet([
      set({ ImageLaterality: 'L', ViewPosition: 'MLO' }, 4),
      set({ ImageLaterality: 'R', ViewPosition: 'CC' }, 1),
      set({ ImageLaterality: 'L', ViewPosition: 'CC' }, 2),
      set({ ImageLaterality: 'R', ViewPosition: 'MLO' }, 3),
    ]);
    expect(result.isDbt).toBe(true);
    expect(result.present).toEqual(DBT_HANGING_ORDER);
    expect(result.maxFrameCount).toBe(60);
  });

  it('ignores the 2D mammogram that ships alongside', () => {
    // Hanging a 2D image in a slot whose slider does nothing is worse than empty.
    const result = detectDbtSet([
      { Modality: 'MG', NumberOfFrames: 1, ImageLaterality: 'R', ViewPosition: 'CC', SeriesNumber: 1 },
      set({ ImageLaterality: 'R', ViewPosition: 'CC' }, 2),
    ]);
    expect(result.tiles.RCC?.SeriesNumber).toBe(2);
    expect(result.present).toEqual(['RCC']);
  });

  it('keeps the lower SeriesNumber when a tile repeats', () => {
    const result = detectDbtSet([
      set({ ImageLaterality: 'R', ViewPosition: 'CC' }, 9),
      set({ ImageLaterality: 'R', ViewPosition: 'CC' }, 2),
    ]);
    expect(result.tiles.RCC?.SeriesNumber).toBe(2);
  });

  it('reports a partial study', () => {
    const result = detectDbtSet([set({ ImageLaterality: 'R', ViewPosition: 'CC' }, 1)]);
    expect(result.isDbt).toBe(true);
    expect(result.present).toEqual(['RCC']);
    expect(describeDbtSet(result)).toContain('missing');
  });

  it('handles a study with no tomosynthesis', () => {
    const result = detectDbtSet([
      { Modality: 'MG', NumberOfFrames: 1, ImageLaterality: 'R', ViewPosition: 'CC' },
    ]);
    expect(result.isDbt).toBe(false);
    expect(describeDbtSet(result)).toMatch(/no tomosynthesis/i);
  });

  it('handles empty and nullish input', () => {
    expect(detectDbtSet([]).isDbt).toBe(false);
    expect(detectDbtSet(undefined as never).present).toEqual([]);
  });

  it('summarises a complete study', () => {
    const result = detectDbtSet([
      set({ ImageLaterality: 'R', ViewPosition: 'CC' }, 1),
      set({ ImageLaterality: 'L', ViewPosition: 'CC' }, 2),
      set({ ImageLaterality: 'R', ViewPosition: 'MLO' }, 3),
      set({ ImageLaterality: 'L', ViewPosition: 'MLO' }, 4),
    ]);
    expect(describeDbtSet(result)).toBe('DBT 4/4 · 60 slices');
  });
});

describe('dbtProtocol', () => {
  it('is a 2x2 grid in hanging order', () => {
    const [stage] = dbtProtocol.stages;
    expect(stage.viewportStructure.properties).toMatchObject({ rows: 2, cols: 2, columns: 2 });
    expect(stage.viewports.map(v => v.displaySets[0].id)).toEqual(DBT_HANGING_ORDER);
  });

  it('syncs slice and window/level across every tile', () => {
    // Comparing slice 30 in one tile against slice 1 in another is the mistake the
    // sync exists to prevent.
    for (const viewport of dbtProtocol.stages[0].viewports) {
      const types = viewport.viewportOptions.syncGroups.map(g => g.type);
      expect(types).toEqual(expect.arrayContaining(['stack', 'voi']));
      for (const group of viewport.viewportOptions.syncGroups) {
        expect(group.source).toBe(true);
        expect(group.target).toBe(true);
      }
    }
  });

  it('requires more than one frame on every selector', () => {
    for (const selector of Object.values(dbtProtocol.displaySetSelectors)) {
      const rule = selector.seriesMatchingRules.find(r => r.attribute === 'numImageFrames');
      expect(rule?.required).toBe(true);
      expect(rule?.constraint).toEqual({ greaterThan: { value: 1 } });
    }
  });

  it('declares a selector for every viewport', () => {
    const ids = Object.keys(dbtProtocol.displaySetSelectors);
    for (const viewport of dbtProtocol.stages[0].viewports) {
      expect(ids).toContain(viewport.displaySets[0].id);
    }
  });

  it('gives every viewport and rule a unique id', () => {
    const viewportIds = dbtProtocol.stages[0].viewports.map(v => v.viewportOptions.viewportId);
    expect(new Set(viewportIds).size).toBe(viewportIds.length);
    const ruleIds = Object.values(dbtProtocol.displaySetSelectors).flatMap(s =>
      s.seriesMatchingRules.map(r => r.id)
    );
    expect(new Set(ruleIds).size).toBe(ruleIds.length);
  });

  it('matches MG studies', () => {
    expect(dbtProtocol.protocolMatchingRules[0].constraint).toEqual({ containsAnyOf: ['MG'] });
    expect(dbtProtocol.id).toBe(DBT_PROTOCOL_ID);
  });

  it('exports a label per tile', () => {
    expect(dbtViewportLabels).toEqual(['R CC', 'L CC', 'R MLO', 'L MLO']);
  });
});
