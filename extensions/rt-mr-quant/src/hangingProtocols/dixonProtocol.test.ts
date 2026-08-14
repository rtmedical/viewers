import { DIXON_HANGING_ORDER } from '../dixon';
import { dixonProtocol, DIXON_PROTOCOL_ID, dixonProtocols, dixonViewportLabels } from './dixonProtocol';

describe('dixonProtocol', () => {
  it('is a 2x2 grid with one viewport per component', () => {
    const [stage] = dixonProtocol.stages;
    expect(stage.viewportStructure.properties).toMatchObject({ rows: 2, cols: 2, columns: 2 });
    expect(stage.viewports).toHaveLength(4);
  });

  it('hangs water and fat on top, in/out phase below', () => {
    const ids = dixonProtocol.stages[0].viewports.map(v => v.displaySets[0].id);
    expect(ids).toEqual(DIXON_HANGING_ORDER);
    expect(ids.slice(0, 2)).toEqual(['water', 'fat']);
  });

  it('declares a selector for every viewport it references', () => {
    const selectorIds = Object.keys(dixonProtocol.displaySetSelectors);
    for (const viewport of dixonProtocol.stages[0].viewports) {
      expect(selectorIds).toContain(viewport.displaySets[0].id);
    }
  });

  it('synchronises slice and window/level across all four viewports', () => {
    for (const viewport of dixonProtocol.stages[0].viewports) {
      const types = viewport.viewportOptions.syncGroups.map(g => g.type);
      expect(types).toEqual(expect.arrayContaining(['stack', 'voi']));
      // Every viewport both drives and follows, so scrolling any one moves all.
      for (const group of viewport.viewportOptions.syncGroups) {
        expect(group.source).toBe(true);
        expect(group.target).toBe(true);
      }
    }
  });

  it('gives every viewport a distinct id', () => {
    const ids = dixonProtocol.stages[0].viewports.map(v => v.viewportOptions.viewportId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('matches MR studies only', () => {
    const rule = dixonProtocol.protocolMatchingRules[0];
    expect(rule.attribute).toBe('ModalitiesInStudy');
    expect(rule.constraint).toEqual({ containsAnyOf: ['MR'] });
  });

  it('requires frames on every selector', () => {
    for (const selector of Object.values(dixonProtocol.displaySetSelectors)) {
      const frameRule = selector.seriesMatchingRules.find(r => r.attribute === 'numImageFrames');
      expect(frameRule).toBeDefined();
      expect(frameRule?.required).toBe(true);
    }
  });

  it('matches each component on both SeriesDescription and ImageType', () => {
    for (const component of DIXON_HANGING_ORDER) {
      const attributes = dixonProtocol.displaySetSelectors[component].seriesMatchingRules.map(
        r => r.attribute
      );
      expect(attributes).toEqual(expect.arrayContaining(['SeriesDescription', 'ImageType']));
    }
  });

  it('penalises fat-suppressed series on the fat selector', () => {
    const rules = dixonProtocol.displaySetSelectors.fat.seriesMatchingRules;
    const veto = rules.find(r => r.id === `${DIXON_PROTOCOL_ID}-fat-not-suppressed`);
    expect(veto).toBeDefined();
    expect(veto?.weight).toBeLessThan(0);
    expect(veto?.constraint.containsAnyOf).toContain('FS');
  });

  it('does not apply the suppression penalty to the other components', () => {
    for (const component of ['water', 'inPhase', 'outPhase'] as const) {
      const ids = dixonProtocol.displaySetSelectors[component].seriesMatchingRules.map(r => r.id);
      expect(ids).not.toContain(`${DIXON_PROTOCOL_ID}-fat-not-suppressed`);
    }
  });

  it('keeps every matching-rule id unique across the protocol', () => {
    const ids = Object.values(dixonProtocol.displaySetSelectors).flatMap(s =>
      s.seriesMatchingRules.map(r => r.id)
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('excludes the ambiguous abbreviations from the declarative rules', () => {
    // A bare `W` here would match every T1-weighted MR series, because a
    // declarative constraint cannot also require a DIXON technique marker.
    for (const component of DIXON_HANGING_ORDER) {
      for (const rule of dixonProtocol.displaySetSelectors[component].seriesMatchingRules) {
        const tokens = rule.constraint.containsAnyOf;
        if (!tokens) {
          continue;
        }
        expect(tokens).not.toContain('W');
        expect(tokens).not.toContain('F');
        expect(tokens).not.toContain('IP');
        expect(tokens).not.toContain('OP');
      }
    }
  });

  it('exports a label per viewport, in layout order', () => {
    expect(dixonViewportLabels).toHaveLength(4);
    expect(dixonViewportLabels[0]).toBe('Water only');
  });

  it('exports the protocol in a list, ready for the module', () => {
    expect(dixonProtocols).toEqual([dixonProtocol]);
  });
});
