import { createGridActions } from './getCommandsModule';
import { GRID_OVERLAY_CLASS, GRID_SPACING_MM_DEFAULT } from './index';

/** A viewport whose image is 100x100 at the given pixel spacing. */
function makeServices(
  options: {
    spacing?: [number, number] | null;
    dims?: [number, number];
    noViewport?: boolean;
    noActive?: boolean;
  } = {}
) {
  const element = document.createElement('div');
  document.body.appendChild(element);

  const image = {
    dimensions: options.dims ?? [100, 100],
    spacing: options.spacing === null ? [] : (options.spacing ?? [1, 1]),
  };

  const services = {
    viewportGridService: {
      getActiveViewportId: () => (options.noActive ? undefined : 'vp-1'),
    },
    cornerstoneViewportService: {
      getCornerstoneViewport: () =>
        options.noViewport ? undefined : { element, getImageData: () => image },
    },
    uiNotificationService: { show: jest.fn() },
  };

  return { servicesManager: { services }, element, show: services.uiNotificationService.show };
}

beforeEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = '';
});

const overlays = (element: HTMLElement) =>
  element.querySelectorAll(`.${GRID_OVERLAY_CLASS}-svg`).length;

describe('rtGridToggle', () => {
  it('mounts the overlay when turned on and removes it when turned off', () => {
    const { servicesManager, element } = makeServices();
    const actions = createGridActions({ servicesManager });

    expect(actions.rtGridToggle().state?.visible).toBe(true);
    expect(overlays(element)).toBe(1);

    expect(actions.rtGridToggle().state?.visible).toBe(false);
    expect(overlays(element)).toBe(0);
  });

  it('does not stack overlays across refreshes', () => {
    const { servicesManager, element } = makeServices();
    const actions = createGridActions({ servicesManager });
    actions.rtGridToggle();
    actions.rtGridRefresh();
    actions.rtGridRefresh();
    expect(overlays(element)).toBe(1);
  });

  it('starts hidden with the default spacing', () => {
    const { servicesManager } = makeServices();
    const state = createGridActions({ servicesManager }).rtGridGetState();
    expect(state.visible).toBe(false);
    expect(state.spacingMm).toBe(GRID_SPACING_MM_DEFAULT);
  });
});

describe('spacing', () => {
  it('sets an explicit spacing, clamped', () => {
    const { servicesManager } = makeServices();
    const actions = createGridActions({ servicesManager });
    expect(actions.rtGridSetSpacing({ spacingMm: 25 }).state?.spacingMm).toBe(25);
    expect(actions.rtGridSetSpacing({ spacingMm: 9999 }).state?.spacingMm).toBe(200);
  });

  it('steps the spacing', () => {
    const { servicesManager } = makeServices();
    const actions = createGridActions({ servicesManager });
    expect(actions.rtGridAdjustSpacing({ deltaMm: 5 }).state?.spacingMm).toBe(15);
    expect(actions.rtGridAdjustSpacing({ deltaMm: -10 }).state?.spacingMm).toBe(5);
  });
});

describe('move / reset', () => {
  it('moves the lattice without announcing (it fires on every mouse move)', () => {
    const { servicesManager, show } = makeServices();
    const actions = createGridActions({ servicesManager });
    actions.rtGridToggle();
    show.mockClear();

    actions.rtGridMove({ deltaXMm: 3, deltaYMm: 4 });
    expect(actions.rtGridGetState().offsetMm).toEqual({ x: 3, y: 4 });
    expect(show).not.toHaveBeenCalled();
  });

  it('resets the offset', () => {
    const { servicesManager } = makeServices();
    const actions = createGridActions({ servicesManager });
    actions.rtGridMove({ deltaXMm: 3, deltaYMm: 4 });
    expect(actions.rtGridResetOffset().state?.offsetMm).toEqual({ x: 0, y: 0 });
  });

  it('hands back a copy of the state, not the live object', () => {
    const { servicesManager } = makeServices();
    const actions = createGridActions({ servicesManager });
    const snapshot = actions.rtGridGetState();
    snapshot.offsetMm.x = 999;
    expect(actions.rtGridGetState().offsetMm.x).toBe(0);
  });
});

describe('calibration', () => {
  it('reports a calibrated grid when the image has pixel spacing', () => {
    const { servicesManager } = makeServices({ spacing: [0.5, 0.5] });
    expect(createGridActions({ servicesManager }).rtGridToggle().calibrated).toBe(true);
  });

  it('reports an uncalibrated grid when pixel spacing is missing', () => {
    // Better an honest pixel grid than one labelled mm that is not calibrated.
    const { servicesManager, show } = makeServices({ spacing: null });
    const result = createGridActions({ servicesManager }).rtGridToggle();
    expect(result.calibrated).toBe(false);
    expect(show.mock.calls[0][0].message).toContain('uncalibrated');
  });

  it('warns when the grid had to be coarsened', () => {
    const { servicesManager, show } = makeServices({ spacing: [1, 1], dims: [2000, 2000] });
    const actions = createGridActions({ servicesManager });
    actions.rtGridSetSpacing({ spacingMm: 1 });
    show.mockClear();
    const result = actions.rtGridToggle();
    expect(result.truncated).toBe(true);
    expect(show.mock.calls[0][0].message).toContain('coarsened');
  });
});

describe('guards', () => {
  it('reports no active viewport instead of throwing', () => {
    const { servicesManager, show } = makeServices({ noActive: true });
    const result = createGridActions({ servicesManager }).rtGridToggle();
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no active viewport/i);
    expect(show).toHaveBeenCalled();
  });

  it('reports a viewport that is not rendering', () => {
    const { servicesManager } = makeServices({ noViewport: true });
    expect(createGridActions({ servicesManager }).rtGridToggle().ok).toBe(false);
  });

  it('reports an image that has not loaded', () => {
    const { servicesManager } = makeServices({ dims: [0, 0] });
    const result = createGridActions({ servicesManager }).rtGridToggle();
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not loaded/i);
  });

  it('survives an empty services manager', () => {
    const actions = createGridActions({ servicesManager: undefined });
    expect(() => actions.rtGridToggle()).not.toThrow();
    expect(actions.rtGridToggle().ok).toBe(false);
  });
});

describe('persistence', () => {
  it('restores the settings for the next session', () => {
    const first = makeServices();
    const a = createGridActions({ servicesManager: first.servicesManager });
    a.rtGridSetSpacing({ spacingMm: 40 });
    a.rtGridToggle();
    a.rtGridMove({ deltaXMm: 7, deltaYMm: 0 });

    // A fresh actions object reads what the previous one stored.
    const second = makeServices();
    const restored = createGridActions({ servicesManager: second.servicesManager }).rtGridGetState();
    expect(restored).toMatchObject({ visible: true, spacingMm: 40, offsetMm: { x: 7, y: 0 } });
  });

  it('ignores a corrupt stored payload', () => {
    window.localStorage.setItem('rt.referenceGrid.v1', 'not json');
    const { servicesManager } = makeServices();
    expect(createGridActions({ servicesManager }).rtGridGetState().spacingMm).toBe(
      GRID_SPACING_MM_DEFAULT
    );
  });
});
