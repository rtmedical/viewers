/**
 * `@cornerstonejs/core` is mocked so these tests never load the real ESM bundle:
 * the point here is the plumbing and the guards, not cornerstone itself.
 */
const mockCache = { getVolume: jest.fn() };
const mockVolumeLoader = { createAndCacheDerivedVolume: jest.fn() };

jest.mock('@cornerstonejs/core', () => ({
  get cache() {
    return mockCache;
  },
  get volumeLoader() {
    return mockVolumeLoader;
  },
}));

import getCommandsModule from './getCommandsModule';

/** A fake dynamic volume whose phases are plain arrays. */
function makeVolume(phases: number[][], options: { unloaded?: number[] } = {}) {
  let dimensionGroupNumber = 1;
  const unloaded = new Set(options.unloaded ?? []);
  const volume = {
    numDimensionGroups: phases.length,
    get dimensionGroupNumber() {
      return dimensionGroupNumber;
    },
    set dimensionGroupNumber(value: number) {
      dimensionGroupNumber = value;
    },
    isDimensionGroupLoaded: (n: number) => !unloaded.has(n),
    voxelManager: {
      getScalarDataLength: () => phases[0]?.length ?? 0,
      // Returns the *currently selected* phase, like the real API.
      getScalarData: () => phases[dimensionGroupNumber - 1],
    },
    modified: jest.fn(),
  };
  return volume;
}

function makeServices(volume: any, extra: Record<string, any> = {}) {
  const render = jest.fn();
  const services = {
    viewportGridService: {
      getActiveViewportId: () => 'vp-1',
      getState: () => ({ viewports: new Map([['vp-1', { displaySetInstanceUIDs: ['ds-1'] }]]) }),
    },
    cornerstoneViewportService: {
      getCornerstoneViewport: () => ({ getAllVolumeIds: () => ['vol-1'] }),
      getRenderingEngine: () => ({ render }),
    },
    uiNotificationService: { show: jest.fn() },
    displaySetService: { getDisplaySetByUID: () => ({ instances: [] }) },
    ...extra,
  };
  mockCache.getVolume.mockImplementation((id: string) => (id === 'vol-1' ? volume : undefined));
  return { manager: { services }, render, services };
}

beforeEach(() => {
  mockCache.getVolume.mockReset();
  mockVolumeLoader.createAndCacheDerivedVolume.mockReset();
});

describe('command registration', () => {
  it('registers every action as a definition', () => {
    const { actions, definitions } = getCommandsModule({ servicesManager: { services: {} } });
    for (const name of Object.keys(actions)) {
      expect(definitions[name]).toBeDefined();
      expect(definitions[name].commandFn).toBe(actions[name as keyof typeof actions]);
    }
    expect(Object.keys(definitions)).toEqual(
      expect.arrayContaining([
        'rt4dDetectGating',
        'rt4dSetPhase',
        'rt4dStepPhase',
        'rt4dTemporalProjection',
        'rt4dTemporalMip',
        'rt4dTemporalMinIp',
        'rt4dTemporalAvg',
      ])
    );
  });
});

describe('rt4dSetPhase', () => {
  it('selects a phase and renders', () => {
    const volume = makeVolume([[1], [2], [3]]);
    const { manager, render } = makeServices(volume);
    const { actions } = getCommandsModule({ servicesManager: manager });

    const result = actions.rt4dSetPhase({ phase: 2 });
    expect(result).toMatchObject({ ok: true, phase: 2, phaseCount: 3 });
    expect(volume.dimensionGroupNumber).toBe(2);
    expect(render).toHaveBeenCalled();
  });

  it('refuses a phase outside the cycle without throwing', () => {
    const volume = makeVolume([[1], [2]]);
    const { manager } = makeServices(volume);
    const { actions } = getCommandsModule({ servicesManager: manager });

    expect(actions.rt4dSetPhase({ phase: 0 }).ok).toBe(false);
    expect(actions.rt4dSetPhase({ phase: 3 }).ok).toBe(false);
    expect(actions.rt4dSetPhase({ phase: NaN }).ok).toBe(false);
    // The reader's phase is untouched by a rejected request.
    expect(volume.dimensionGroupNumber).toBe(1);
  });

  it('reports when there is no 4D volume', () => {
    const { manager } = makeServices(undefined);
    const { actions } = getCommandsModule({ servicesManager: manager });
    expect(actions.rt4dSetPhase({ phase: 1 })).toMatchObject({ ok: false });
  });

  it('does not treat a non-dynamic volume as 4D', () => {
    const single = makeVolume([[1]]); // numDimensionGroups === 1
    const { manager } = makeServices(single);
    const { actions } = getCommandsModule({ servicesManager: manager });
    expect(actions.rt4dSetPhase({ phase: 1 }).ok).toBe(false);
  });

  it('survives an empty services manager', () => {
    const { actions } = getCommandsModule({ servicesManager: undefined as never });
    expect(() => actions.rt4dSetPhase({ phase: 1 })).not.toThrow();
  });
});

describe('rt4dStepPhase', () => {
  it('advances one phase', () => {
    const volume = makeVolume([[1], [2], [3]]);
    const { manager } = makeServices(volume);
    const { actions } = getCommandsModule({ servicesManager: manager });

    actions.rt4dStepPhase({ delta: 1 });
    expect(volume.dimensionGroupNumber).toBe(2);
  });

  it('wraps forward at the end of the cycle', () => {
    // A respiratory cycle is a loop; stopping at the last phase is wrong.
    const volume = makeVolume([[1], [2], [3]]);
    volume.dimensionGroupNumber = 3;
    const { manager } = makeServices(volume);
    const { actions } = getCommandsModule({ servicesManager: manager });

    actions.rt4dStepPhase({ delta: 1 });
    expect(volume.dimensionGroupNumber).toBe(1);
  });

  it('wraps backward at the start of the cycle', () => {
    const volume = makeVolume([[1], [2], [3]]);
    const { manager } = makeServices(volume);
    const { actions } = getCommandsModule({ servicesManager: manager });

    actions.rt4dStepPhase({ delta: -1 });
    expect(volume.dimensionGroupNumber).toBe(3);
  });

  it('defaults to a single step forward', () => {
    const volume = makeVolume([[1], [2]]);
    const { manager } = makeServices(volume);
    const { actions } = getCommandsModule({ servicesManager: manager });

    actions.rt4dStepPhase();
    expect(volume.dimensionGroupNumber).toBe(2);
  });
});

describe('rt4dTemporalProjection', () => {
  const derived = () => {
    const scalarData = new Float32Array(3);
    return {
      voxelManager: { getScalarData: () => scalarData },
      modified: jest.fn(),
      scalarData,
    };
  };

  it('computes a MIP across the phases and writes it into a derived volume', async () => {
    const volume = makeVolume([
      [1, 9, 3],
      [4, 2, 3],
    ]);
    const target = derived();
    mockVolumeLoader.createAndCacheDerivedVolume.mockResolvedValue(target);
    const { manager } = makeServices(volume);
    const { actions } = getCommandsModule({ servicesManager: manager });

    const result = await actions.rt4dTemporalProjection({ operation: 'MIP' });

    expect(result.ok).toBe(true);
    expect([...target.scalarData]).toEqual([4, 9, 3]);
    expect(result.usedPhases).toEqual([0, 1]);
    expect(result.description).toContain('MIP');
    expect(target.modified).toHaveBeenCalled();
  });

  it("restores the reader's phase afterwards", async () => {
    // Reading a phase means *selecting* it, which is visible in the viewport.
    const volume = makeVolume([[1, 1, 1], [2, 2, 2], [3, 3, 3]]);
    volume.dimensionGroupNumber = 2;
    mockVolumeLoader.createAndCacheDerivedVolume.mockResolvedValue(derived());
    const { manager } = makeServices(volume);
    const { actions } = getCommandsModule({ servicesManager: manager });

    await actions.rt4dTemporalProjection({ operation: 'MIP' });
    expect(volume.dimensionGroupNumber).toBe(2);
  });

  it('skips phases that are not loaded yet, and says which it used', async () => {
    // Averaging in a buffer of zeros for an unloaded phase would corrupt the result.
    const volume = makeVolume([[2, 2, 2], [8, 8, 8], [4, 4, 4]], { unloaded: [2] });
    const target = derived();
    mockVolumeLoader.createAndCacheDerivedVolume.mockResolvedValue(target);
    const { manager } = makeServices(volume);
    const { actions } = getCommandsModule({ servicesManager: manager });

    const result = await actions.rt4dTemporalProjection({ operation: 'AvgIP' });

    expect(result.usedPhases).toEqual([0, 2]);
    expect([...target.scalarData]).toEqual([3, 3, 3]); // (2 + 4) / 2, phase 2 excluded
  });

  it('fails cleanly when no phase is loaded', async () => {
    const volume = makeVolume([[1], [2]], { unloaded: [1, 2] });
    const { manager } = makeServices(volume);
    const { actions } = getCommandsModule({ servicesManager: manager });

    const result = await actions.rt4dTemporalProjection({ operation: 'MIP' });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/loaded yet/i);
    expect(mockVolumeLoader.createAndCacheDerivedVolume).not.toHaveBeenCalled();
  });

  it('reuses an existing derived volume instead of recreating it', async () => {
    const volume = makeVolume([[1, 1, 1], [5, 5, 5]]);
    const target = derived();
    const { manager } = makeServices(volume);
    // makeServices installs its own implementation, so widen it afterwards to
    // also resolve the derived volume id.
    mockCache.getVolume.mockImplementation((id: string) =>
      id === 'vol-1' ? volume : id === 'vol-1-rt4d-MIP' ? target : undefined
    );
    const { actions } = getCommandsModule({ servicesManager: manager });

    const result = await actions.rt4dTemporalProjection({ operation: 'MIP' });
    expect(result.ok).toBe(true);
    expect(mockVolumeLoader.createAndCacheDerivedVolume).not.toHaveBeenCalled();
    expect([...target.scalarData]).toEqual([5, 5, 5]);
  });

  it('honours an explicit phase selection', async () => {
    const volume = makeVolume([[1, 1, 1], [9, 9, 9], [3, 3, 3]]);
    const target = derived();
    mockVolumeLoader.createAndCacheDerivedVolume.mockResolvedValue(target);
    const { manager } = makeServices(volume);
    const { actions } = getCommandsModule({ servicesManager: manager });

    const result = await actions.rt4dTemporalProjection({ operation: 'MIP', phaseIndices: [0, 2] });
    expect(result.usedPhases).toEqual([0, 2]);
    expect([...target.scalarData]).toEqual([3, 3, 3]);
  });

  it('reports a failure when there is no 4D volume', async () => {
    const { manager } = makeServices(undefined);
    const { actions } = getCommandsModule({ servicesManager: manager });
    await expect(actions.rt4dTemporalProjection()).resolves.toMatchObject({ ok: false });
  });

  it('turns a rejected derived-volume creation into a reported failure', async () => {
    const volume = makeVolume([[1], [2]]);
    mockVolumeLoader.createAndCacheDerivedVolume.mockRejectedValue(new Error('cache full'));
    const { manager } = makeServices(volume);
    const { actions } = getCommandsModule({ servicesManager: manager });

    const result = await actions.rt4dTemporalProjection({ operation: 'MIP' });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('cache full');
  });

  it('exposes MIP / MinIP / average shortcuts', async () => {
    const volume = makeVolume([[1, 1, 1], [7, 7, 7]]);
    const target = derived();
    mockVolumeLoader.createAndCacheDerivedVolume.mockResolvedValue(target);
    const { manager } = makeServices(volume);
    const { actions } = getCommandsModule({ servicesManager: manager });

    await actions.rt4dTemporalMinIp();
    expect([...target.scalarData]).toEqual([1, 1, 1]);
  });
});

describe('rt4dDetectGating', () => {
  it('reports gating from the active display set instances', () => {
    const volume = makeVolume([[1], [2]]);
    const { manager } = makeServices(volume, {
      displaySetService: {
        getDisplaySetByUID: () => ({
          instances: [
            { NominalPercentageOfRespiratoryPhase: 0 },
            { NominalPercentageOfRespiratoryPhase: 50 },
          ],
        }),
      },
    });
    const { actions } = getCommandsModule({ servicesManager: manager });

    const info = actions.rt4dDetectGating();
    expect(info.isGated).toBe(true);
    expect(info.kind).toBe('respiratory');
  });

  it('returns an ungated result when nothing matches', () => {
    const { manager } = makeServices(undefined);
    const { actions } = getCommandsModule({ servicesManager: manager });
    expect(actions.rt4dDetectGating().isGated).toBe(false);
  });
});
