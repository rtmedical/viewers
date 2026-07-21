/**
 * getCommandsModule (RTV-145) — command wiring tests over mocked services.
 * The world-point math itself lives in the pure ./isocenters module; here we
 * assert display-set resolution, viewport fan-out and honest toasts.
 */
jest.mock('i18next', () => ({
  __esModule: true,
  default: {
    t: (_key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : _key),
  },
}));

import getCommandsModule, { isocenterLabel, resolvePlanDisplaySet } from './getCommandsModule';

const rtPlanOf = (beams: any[]) => ({ prescriptions: [], fractionGroups: [], beams });

function makeViewport(jumpResult: boolean | 'throws' | 'none' = true) {
  if (jumpResult === 'none') {
    return { id: 'no-jump' };
  }
  return {
    jumpToWorld: jest.fn((_world: number[]) => {
      if (jumpResult === 'throws') {
        throw new Error('no image data');
      }
      return jumpResult;
    }),
  };
}

function makeServicesManager({
  displaySets = [] as any[],
  viewports = [] as any[],
} = {}) {
  return {
    services: {
      displaySetService: { getActiveDisplaySets: () => displaySets },
      cornerstoneViewportService: {
        getRenderingEngine: () => ({ getViewports: () => viewports }),
      },
      uiNotificationService: { show: jest.fn() },
    },
  };
}

const planDs = (uid: string, beams: any[]) => ({
  displaySetInstanceUID: uid,
  Modality: 'RTPLAN',
  rtPlan: rtPlanOf(beams),
});

describe('listIsocenters', () => {
  it('returns the deduped isocenters of the active RTPLAN display set', () => {
    const sm = makeServicesManager({
      displaySets: [
        { displaySetInstanceUID: 'ct', Modality: 'CT' },
        planDs('plan-1', [
          { number: 1, name: 'AP', isocenter: [1, 2, 3] },
          { number: 2, name: 'PA', isocenter: [1, 2, 3] },
        ]),
      ],
    });
    const { actions } = getCommandsModule({ servicesManager: sm });
    const entries = actions.listIsocenters();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ beamNumber: 1, beamNumbers: [1, 2] });
  });

  it('selects the plan by displaySetInstanceUID when given', () => {
    const sm = makeServicesManager({
      displaySets: [
        planDs('plan-1', [{ number: 1, isocenter: [1, 1, 1] }]),
        planDs('plan-2', [{ number: 9, isocenter: [9, 9, 9] }]),
      ],
    });
    const { actions } = getCommandsModule({ servicesManager: sm });
    const entries = actions.listIsocenters({ displaySetInstanceUID: 'plan-2' });
    expect(entries).toEqual([expect.objectContaining({ beamNumber: 9 })]);
  });
});

describe('resolvePlanDisplaySet', () => {
  it('prefers the first plan that carries isocenters', () => {
    const empty = planDs('plan-empty', [{ number: 1, name: 'no iso' }]);
    const withIso = planDs('plan-iso', [{ number: 1, isocenter: [0, 0, 0] }]);
    const displaySetService = { getActiveDisplaySets: () => [empty, withIso] };
    expect(resolvePlanDisplaySet(displaySetService)?.displaySetInstanceUID).toBe('plan-iso');
    expect(resolvePlanDisplaySet(displaySetService, 'plan-empty')?.displaySetInstanceUID).toBe(
      'plan-empty'
    );
  });
});

describe('navigateToIsocenter', () => {
  const beams = [
    { number: 1, name: 'AP', isocenter: [-12.5, 34, -105.1] },
    { number: 2, name: 'PA', isocenter: [10, 0, 55] },
  ];

  it('jumps every navigable viewport to the first isocenter by default', () => {
    const vp1 = makeViewport(true);
    const vp2 = makeViewport(true);
    const sm = makeServicesManager({
      displaySets: [planDs('plan-1', beams)],
      viewports: [vp1, vp2, makeViewport('none')],
    });
    const { actions } = getCommandsModule({ servicesManager: sm });
    expect(actions.navigateToIsocenter()).toBe(true);
    expect(vp1.jumpToWorld).toHaveBeenCalledWith([-12.5, 34, -105.1]);
    expect(vp2.jumpToWorld).toHaveBeenCalledWith([-12.5, 34, -105.1]);
    expect(sm.services.uiNotificationService.show).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', message: '#1 AP — -12.5, 34.0, -105.1 mm' })
    );
  });

  it('selects by beamNumber and survives a throwing viewport', () => {
    const bad = makeViewport('throws');
    const good = makeViewport(true);
    const sm = makeServicesManager({
      displaySets: [planDs('plan-1', beams)],
      viewports: [bad, good],
    });
    const { actions } = getCommandsModule({ servicesManager: sm });
    expect(actions.navigateToIsocenter({ beamNumber: 2 })).toBe(true);
    expect(good.jumpToWorld).toHaveBeenCalledWith([10, 0, 55]);
  });

  it('is honest when the plan, the beam or the viewports are missing', () => {
    const noPlan = makeServicesManager({ viewports: [makeViewport(true)] });
    expect(
      getCommandsModule({ servicesManager: noPlan }).actions.navigateToIsocenter()
    ).toBe(false);
    expect(noPlan.services.uiNotificationService.show).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'warning' })
    );

    const noBeam = makeServicesManager({
      displaySets: [planDs('plan-1', beams)],
      viewports: [makeViewport(true)],
    });
    expect(
      getCommandsModule({ servicesManager: noBeam }).actions.navigateToIsocenter({
        beamNumber: 99,
      })
    ).toBe(false);

    const noViewports = makeServicesManager({ displaySets: [planDs('plan-1', beams)] });
    expect(
      getCommandsModule({ servicesManager: noViewports }).actions.navigateToIsocenter()
    ).toBe(false);
    expect(noViewports.services.uiNotificationService.show).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'warning' })
    );
  });

  it('clamps an out-of-range index instead of failing', () => {
    const vp = makeViewport(true);
    const sm = makeServicesManager({
      displaySets: [planDs('plan-1', beams)],
      viewports: [vp],
    });
    const { actions } = getCommandsModule({ servicesManager: sm });
    expect(actions.navigateToIsocenter({ index: 99 })).toBe(true);
    expect(vp.jumpToWorld).toHaveBeenCalledWith([10, 0, 55]);
  });
});

describe('isocenterLabel', () => {
  it('joins beam numbers and the first beam name', () => {
    expect(
      isocenterLabel({
        beamNumber: 1,
        beamName: 'AP',
        beamNumbers: [1, 2],
        isocenter: [0, 0, 0],
        key: '0.00,0.00,0.00',
      })
    ).toBe('#1, #2 AP');
    expect(
      isocenterLabel({ beamNumbers: [], isocenter: [0, 0, 0], key: '0.00,0.00,0.00' })
    ).toBe('—');
  });
});
