/**
 * RTV-23 — hpBuilder unit tests: gridProtocol shape parity, weighted per-slot
 * rules, validateSpec guards, and the specFromProtocol round-trip.
 */
import { gridProtocol } from '../hangingProtocols/library';
import {
  buildCustomProtocol,
  specFromProtocol,
  validateSpec,
  slotHasRule,
  userProtocolId,
  SLOT_RULE_WEIGHTS,
  MAX_VIEWPORTS,
  type HpEditorSpec,
} from './hpBuilder';

const baseSpec = (overrides: Partial<HpEditorSpec> = {}): HpEditorSpec => ({
  id: 'my-layout',
  name: 'My layout',
  rows: 2,
  cols: 3,
  slots: [],
  ...overrides,
});

describe('buildCustomProtocol — shape parity with gridProtocol', () => {
  it('matches the gridProtocol shape when no slot has rules', () => {
    const built = buildCustomProtocol(baseSpec());
    const reference = gridProtocol({
      id: 'rt-user-my-layout',
      name: 'My layout',
      rows: 2,
      cols: 3,
      weight: 20,
    });
    expect(built).toEqual(reference);
  });

  it('emits a grid stage with rows/cols AND the canonical columns key', () => {
    const built = buildCustomProtocol(baseSpec({ rows: 3, cols: 4 }));
    const { viewportStructure, viewports } = built.stages[0];
    expect(viewportStructure.layoutType).toBe('grid');
    expect(viewportStructure.properties).toEqual({ rows: 3, cols: 4, columns: 4 });
    expect(viewports).toHaveLength(12);
  });

  it('wires empty slots to the shared ds selector with row-major indices', () => {
    const built = buildCustomProtocol(baseSpec({ rows: 2, cols: 2 }));
    built.stages[0].viewports.forEach((viewport, k) => {
      expect(viewport.displaySets).toEqual([{ id: 'ds', matchedDisplaySetsIndex: k }]);
    });
    expect(built.displaySetSelectors.ds).toEqual({
      allowUnmatchedView: true,
      seriesMatchingRules: [
        { weight: 10, attribute: 'numImageFrames', constraint: { greaterThan: { value: 0 } } },
      ],
    });
  });

  it('prefixes the id with rt-user- exactly once', () => {
    expect(buildCustomProtocol(baseSpec({ id: 'abc' })).id).toBe('rt-user-abc');
    expect(buildCustomProtocol(baseSpec({ id: 'rt-user-abc' })).id).toBe('rt-user-abc');
    expect(userProtocolId('x')).toBe('rt-user-x');
  });
});

describe('buildCustomProtocol — protocolMatchingRules', () => {
  it('unions the slot modalities into a single ModalitiesInStudy rule', () => {
    const built = buildCustomProtocol(
      baseSpec({
        rows: 1,
        cols: 3,
        slots: [{ modality: 'CT' }, { modality: 'MR' }, { modality: 'CT' }],
      })
    );
    expect(built.protocolMatchingRules).toEqual([
      {
        id: 'rt-user-my-layout-modality',
        weight: 20,
        attribute: 'ModalitiesInStudy',
        constraint: { containsAnyOf: ['CT', 'MR'] },
      },
    ]);
  });

  it('emits no protocol matching rules when no slot names a modality', () => {
    const built = buildCustomProtocol(
      baseSpec({ slots: [{ seriesDescriptionContains: 'AX' }, {}] })
    );
    expect(built.protocolMatchingRules).toEqual([]);
  });
});

describe('buildCustomProtocol — per-slot selectors and rule weights', () => {
  it('creates a slot<k> selector referenced by that viewport only', () => {
    const built = buildCustomProtocol(
      baseSpec({ rows: 1, cols: 2, slots: [{}, { modality: 'MR' }] })
    );
    expect(built.stages[0].viewports[0].displaySets).toEqual([
      { id: 'ds', matchedDisplaySetsIndex: 0 },
    ]);
    expect(built.stages[0].viewports[1].displaySets).toEqual([
      { id: 'slot1', matchedDisplaySetsIndex: 0 },
    ]);
    expect(built.displaySetSelectors.slot1).toBeDefined();
    expect(built.displaySetSelectors.slot0).toBeUndefined();
  });

  it('includes a SeriesInstanceUID equals rule when the slot pins a series', () => {
    const uid = '1.2.840.113619.2.55.3.1';
    const built = buildCustomProtocol(
      baseSpec({ rows: 1, cols: 1, slots: [{ seriesInstanceUID: uid }] })
    );
    const rules = (built.displaySetSelectors as any).slot0.seriesMatchingRules;
    expect(rules).toContainEqual({
      weight: SLOT_RULE_WEIGHTS.seriesInstanceUID,
      attribute: 'SeriesInstanceUID',
      constraint: { equals: { value: uid } },
    });
  });

  it('orders weights SeriesInstanceUID > SeriesDescription > Modality > BodyPart', () => {
    const built = buildCustomProtocol(
      baseSpec({
        rows: 1,
        cols: 1,
        slots: [
          {
            seriesInstanceUID: '1.2.3',
            seriesDescriptionContains: 'T1',
            modality: 'MR',
            bodyPart: 'HEAD',
          },
        ],
      })
    );
    const rules = (built.displaySetSelectors as any).slot0.seriesMatchingRules;
    const weightOf = (attribute: string) =>
      rules.find((rule: any) => rule.attribute === attribute).weight;
    expect(weightOf('SeriesInstanceUID')).toBeGreaterThan(weightOf('SeriesDescription'));
    expect(weightOf('SeriesDescription')).toBeGreaterThan(weightOf('Modality'));
    expect(weightOf('Modality')).toBeGreaterThan(weightOf('BodyPartExamined'));
    // Baseline image rule kept for parity with gridProtocol.
    expect(weightOf('numImageFrames')).toBe(10);
    expect(rules.find((rule: any) => rule.attribute === 'SeriesDescription').constraint).toEqual({
      containsI: { value: 'T1' },
    });
    expect(rules.find((rule: any) => rule.attribute === 'BodyPartExamined').constraint).toEqual({
      equals: { value: 'HEAD' },
    });
  });

  it('honours seriesIndex on both rule slots and empty slots', () => {
    const built = buildCustomProtocol(
      baseSpec({
        rows: 1,
        cols: 2,
        slots: [{ modality: 'CT', seriesIndex: 2 }, { seriesIndex: 5 }],
      })
    );
    expect(built.stages[0].viewports[0].displaySets).toEqual([
      { id: 'slot0', matchedDisplaySetsIndex: 2 },
    ]);
    expect(built.stages[0].viewports[1].displaySets).toEqual([
      { id: 'ds', matchedDisplaySetsIndex: 5 },
    ]);
  });

  it('ignores slots beyond rows*cols', () => {
    const built = buildCustomProtocol(
      baseSpec({ rows: 1, cols: 1, slots: [{}, { modality: 'MR' }] })
    );
    expect(built.stages[0].viewports).toHaveLength(1);
    expect(built.displaySetSelectors.slot1).toBeUndefined();
  });
});

describe('validateSpec', () => {
  it('accepts a valid spec for saving', () => {
    expect(validateSpec(baseSpec({ slots: [{ modality: 'CT' }] }))).toEqual([]);
  });

  it('rejects rows*cols <= 0', () => {
    expect(validateSpec(baseSpec({ rows: 0, cols: 2 })).join(' ')).toMatch(/at least 1 row/i);
    expect(validateSpec(baseSpec({ rows: 1.5 as any, cols: 2 }))).not.toEqual([]);
  });

  it('rejects more than 16 viewports', () => {
    const errors = validateSpec(baseSpec({ rows: 4, cols: 5, slots: [{ modality: 'CT' }] }));
    expect(errors.join(' ')).toContain(String(MAX_VIEWPORTS));
  });

  it('rejects more slots than viewports', () => {
    const errors = validateSpec(
      baseSpec({ rows: 1, cols: 1, slots: [{ modality: 'CT' }, {}] })
    );
    expect(errors.join(' ')).toMatch(/more slots/i);
  });

  it('requires at least one non-empty rule (and a name) only when saving', () => {
    const noRules = baseSpec({ name: '', slots: [{}, {}] });
    const saveErrors = validateSpec(noRules);
    expect(saveErrors.join(' ')).toMatch(/matching rule/i);
    expect(saveErrors.join(' ')).toMatch(/name/i);
    expect(validateSpec(noRules, { forSave: false })).toEqual([]);
  });
});

describe('slotHasRule', () => {
  it('detects each rule kind and rejects empty/seriesIndex-only slots', () => {
    expect(slotHasRule({})).toBe(false);
    expect(slotHasRule(undefined)).toBe(false);
    expect(slotHasRule({ seriesIndex: 3 })).toBe(false);
    expect(slotHasRule({ modality: 'CT' })).toBe(true);
    expect(slotHasRule({ bodyPart: 'HEAD' })).toBe(true);
    expect(slotHasRule({ seriesDescriptionContains: 'T1' })).toBe(true);
    expect(slotHasRule({ seriesInstanceUID: '1.2' })).toBe(true);
  });
});

describe('specFromProtocol', () => {
  const richSpec = baseSpec({
    id: 'rt-user-round-trip',
    name: 'Round trip',
    rows: 2,
    cols: 2,
    slots: [
      { seriesInstanceUID: '1.2.3.4', seriesDescriptionContains: 'FLAIR' },
      { modality: 'MR', bodyPart: 'HEAD' },
      { seriesIndex: 7 },
      {},
    ],
  });

  it('recovers the editor spec from a built protocol', () => {
    const spec = specFromProtocol(buildCustomProtocol(richSpec));
    expect(spec).toEqual(richSpec);
  });

  it('round-trips: rebuild(specFromProtocol(built)) equals built', () => {
    const built = buildCustomProtocol(richSpec);
    const rebuilt = buildCustomProtocol(specFromProtocol(built) as HpEditorSpec);
    expect(rebuilt).toEqual(built);
  });

  it('reads the legacy cols key and bare-string constraints', () => {
    const spec = specFromProtocol({
      id: 'rt-user-legacy',
      name: 'Legacy',
      displaySetSelectors: {
        slot0: {
          seriesMatchingRules: [
            { weight: 5, attribute: 'SeriesDescription', constraint: { contains: 'DWI' } },
          ],
        },
      },
      stages: [
        {
          viewportStructure: { layoutType: 'grid', properties: { rows: 1, cols: 2 } },
          viewports: [
            { displaySets: [{ id: 'slot0' }] },
            { displaySets: [{ id: 'ds', matchedDisplaySetsIndex: 1 }] },
          ],
        },
      ],
    });
    expect(spec).toEqual({
      id: 'rt-user-legacy',
      name: 'Legacy',
      rows: 1,
      cols: 2,
      slots: [{ seriesDescriptionContains: 'DWI' }, {}],
    });
  });

  it('returns undefined for a protocol without stages', () => {
    expect(specFromProtocol({ id: 'x' })).toBeUndefined();
    expect(specFromProtocol(undefined)).toBeUndefined();
  });
});
