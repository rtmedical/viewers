import getCommandsModule from './getCommandsModule';

/** Builds a services manager with only the pieces a test cares about. */
function makeServices(overrides: Record<string, any> = {}) {
  return { services: overrides };
}

describe('getCommandsModule', () => {
  it('registers both commands', () => {
    const { definitions, actions } = getCommandsModule({ servicesManager: makeServices() });
    expect(Object.keys(definitions).sort()).toEqual(['rtApplyParametricMap', 'rtDetectDixon']);
    expect(typeof actions.rtApplyParametricMap).toBe('function');
    expect(typeof actions.rtDetectDixon).toBe('function');
  });

  it('wires every definition to its action', () => {
    const { definitions, actions } = getCommandsModule({ servicesManager: makeServices() });
    expect(definitions.rtApplyParametricMap.commandFn).toBe(actions.rtApplyParametricMap);
    expect(definitions.rtDetectDixon.commandFn).toBe(actions.rtDetectDixon);
  });
});

describe('rtApplyParametricMap', () => {
  const options = { lut: 'viridis' as const, range: { min: 0, max: 3000 } };

  it('reports a failure instead of throwing when there is no active viewport', () => {
    const show = jest.fn();
    const { actions } = getCommandsModule({
      servicesManager: makeServices({
        uiNotificationService: { show },
        viewportGridService: { getActiveViewportId: () => undefined },
      }),
    });

    const result = actions.rtApplyParametricMap(options);
    expect(result.applied).toBe(false);
    expect(result.reason).toMatch(/no active viewport/i);
    expect(show).toHaveBeenCalled();
  });

  it('reports a failure when the viewport is not rendering yet', () => {
    const { actions } = getCommandsModule({
      servicesManager: makeServices({
        viewportGridService: { getActiveViewportId: () => 'vp-1' },
        cornerstoneViewportService: { getCornerstoneViewport: () => undefined },
      }),
    });

    const result = actions.rtApplyParametricMap(options);
    expect(result.applied).toBe(false);
    expect(result.reason).toMatch(/not rendering/i);
  });

  it('survives a services manager with nothing in it', () => {
    const { actions } = getCommandsModule({ servicesManager: undefined as never });
    expect(() => actions.rtApplyParametricMap(options)).not.toThrow();
    expect(actions.rtApplyParametricMap(options).applied).toBe(false);
  });

  it('applies the colormap and VOI to the active viewport', () => {
    const setProperties = jest.fn();
    const render = jest.fn();
    const { actions } = getCommandsModule({
      servicesManager: makeServices({
        viewportGridService: { getActiveViewportId: () => 'vp-1' },
        cornerstoneViewportService: {
          getCornerstoneViewport: () => ({ setProperties, render }),
        },
      }),
    });

    const result = actions.rtApplyParametricMap(options);

    expect(result.applied).toBe(true);
    expect(result.colormapName).toBe('Viridis');
    expect(result.windowWidth).toBe(3000);
    expect(result.windowCenter).toBe(1500);
    expect(render).toHaveBeenCalled();

    const [properties] = setProperties.mock.calls[0];
    expect(properties.voiRange).toEqual({ lower: 0, upper: 3000 });
    expect(properties.colormap.Name).toBe('Viridis');
    // The ramp travels as data, so extensions/cornerstone is never edited.
    expect(Array.isArray(properties.colormap.RGBPoints)).toBe(true);
  });

  it('orders an inverted range before applying it', () => {
    const setProperties = jest.fn();
    const { actions } = getCommandsModule({
      servicesManager: makeServices({
        viewportGridService: { getActiveViewportId: () => 'vp-1' },
        cornerstoneViewportService: {
          getCornerstoneViewport: () => ({ setProperties, render: jest.fn() }),
        },
      }),
    });

    actions.rtApplyParametricMap({ lut: 'magma', range: { min: 80, max: 10 } });
    expect(setProperties.mock.calls[0][0].voiRange).toEqual({ lower: 10, upper: 80 });
  });

  it('turns a throwing viewport into a reported failure', () => {
    const { actions } = getCommandsModule({
      servicesManager: makeServices({
        viewportGridService: { getActiveViewportId: () => 'vp-1' },
        cornerstoneViewportService: {
          getCornerstoneViewport: () => ({
            setProperties: () => {
              throw new Error('actor not ready');
            },
          }),
        },
      }),
    });

    const result = actions.rtApplyParametricMap(options);
    expect(result.applied).toBe(false);
    expect(result.reason).toContain('actor not ready');
  });
});

describe('rtDetectDixon', () => {
  it('reports the quartet found in the loaded display sets', () => {
    const { actions } = getCommandsModule({
      servicesManager: makeServices({
        displaySetService: {
          getActiveDisplaySets: () => [
            { Modality: 'MR', SeriesNumber: 1, SeriesDescription: 'T1 Dixon WATER' },
            { Modality: 'MR', SeriesNumber: 2, SeriesDescription: 'T1 Dixon FAT' },
            { Modality: 'MR', SeriesNumber: 3, SeriesDescription: 'AX T2 TSE' },
          ],
        },
      }),
    });

    const set = actions.rtDetectDixon();
    expect(set.isDixon).toBe(true);
    expect(set.present).toEqual(['water', 'fat']);
  });

  it('returns a non-Dixon result when nothing is loaded', () => {
    const { actions } = getCommandsModule({ servicesManager: makeServices({}) });
    expect(actions.rtDetectDixon().isDixon).toBe(false);
  });
});
