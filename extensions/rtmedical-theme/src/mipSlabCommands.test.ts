import { createMipSlabActions } from './mipSlabCommands';

/** Numeric BlendModes values (≡ vtk.js VolumeMapper BlendMode constants). */
const COMPOSITE = 0;
const MIP = 1;
const MINIP = 2;
const AVG = 3;

/** Fake orthographic VolumeViewport with the public slab API. */
function makeVolumeViewport({ blendMode = COMPOSITE, slabMm = 0.05 } = {}) {
  return {
    type: 'orthographic',
    setBlendMode: jest.fn(),
    setSlabThickness: jest.fn(),
    resetSlabThickness: jest.fn(),
    getBlendMode: jest.fn(() => blendMode),
    getSlabThickness: jest.fn(() => slabMm),
    render: jest.fn(),
  };
}

/** Fake StackViewport: no volume slab/blend API at all. */
function makeStackViewport() {
  return {
    type: 'stack',
    render: jest.fn(),
  };
}

/** Fake VolumeViewport3D: the slab APIs exist but are stubbed no-ops. */
function makeVolume3dViewport() {
  return { ...makeVolumeViewport(), type: 'volume3d' };
}

function makeServices(viewport: unknown) {
  const show = jest.fn();
  const servicesManager = {
    services: {
      viewportGridService: { getActiveViewportId: jest.fn(() => 'vp-1') },
      cornerstoneViewportService: {
        getCornerstoneViewport: jest.fn(() => viewport),
      },
      uiNotificationService: { show },
    },
  };
  return { servicesManager, show };
}

describe('mipSlabCommands (RTV-15/RTV-19 glue)', () => {
  describe('setSlabProjection', () => {
    it('applies MIP with the default 10 mm slab and renders', () => {
      const viewport = makeVolumeViewport();
      const { servicesManager } = makeServices(viewport);
      const actions = createMipSlabActions({ servicesManager });

      expect(actions.setSlabProjection({ mode: 'mip' })).toBe(true);
      expect(viewport.setBlendMode).toHaveBeenCalledWith(MIP, [], false);
      expect(viewport.setSlabThickness).toHaveBeenCalledWith(10, undefined);
      expect(viewport.render).toHaveBeenCalled();
    });

    it('maps minip/avg onto the right BlendModes values', () => {
      const viewport = makeVolumeViewport();
      const { servicesManager } = makeServices(viewport);
      const actions = createMipSlabActions({ servicesManager });

      actions.setSlabProjection({ mode: 'minip' });
      expect(viewport.setBlendMode).toHaveBeenLastCalledWith(MINIP, [], false);

      actions.setSlabProjection({ mode: 'AVG' });
      expect(viewport.setBlendMode).toHaveBeenLastCalledWith(AVG, [], false);
    });

    it('clamps an explicit thickness to 100 mm', () => {
      const viewport = makeVolumeViewport();
      const { servicesManager } = makeServices(viewport);
      const actions = createMipSlabActions({ servicesManager });

      actions.setSlabProjection({ mode: 'mip', slabMm: 250 });
      expect(viewport.setSlabThickness).toHaveBeenCalledWith(100, undefined);
    });

    it('keeps the current real slab when no thickness is requested', () => {
      const viewport = makeVolumeViewport({ blendMode: COMPOSITE, slabMm: 15 });
      const { servicesManager } = makeServices(viewport);
      const actions = createMipSlabActions({ servicesManager });

      actions.setSlabProjection({ mode: 'mip' });
      expect(viewport.setSlabThickness).toHaveBeenCalledWith(15, undefined);
    });

    it('re-requesting the active mode toggles the projection off', () => {
      const viewport = makeVolumeViewport({ blendMode: MIP, slabMm: 15 });
      const { servicesManager, show } = makeServices(viewport);
      const actions = createMipSlabActions({ servicesManager });

      expect(actions.setSlabProjection({ mode: 'mip' })).toBe(true);
      expect(viewport.setBlendMode).toHaveBeenCalledWith(COMPOSITE, [], false);
      expect(viewport.resetSlabThickness).toHaveBeenCalled();
      expect(viewport.render).toHaveBeenCalled();
      expect(show).toHaveBeenCalledWith(expect.objectContaining({ type: 'info' }));
    });

    it('does NOT toggle when an explicit thickness comes with the request', () => {
      const viewport = makeVolumeViewport({ blendMode: MIP, slabMm: 15 });
      const { servicesManager } = makeServices(viewport);
      const actions = createMipSlabActions({ servicesManager });

      actions.setSlabProjection({ mode: 'mip', slabMm: 20 });
      expect(viewport.setBlendMode).toHaveBeenCalledWith(MIP, [], false);
      expect(viewport.setSlabThickness).toHaveBeenCalledWith(20, undefined);
      expect(viewport.resetSlabThickness).not.toHaveBeenCalled();
    });

    it("mode 'none' turns the projection off", () => {
      const viewport = makeVolumeViewport({ blendMode: AVG, slabMm: 30 });
      const { servicesManager } = makeServices(viewport);
      const actions = createMipSlabActions({ servicesManager });

      expect(actions.setSlabProjection({ mode: 'none' })).toBe(true);
      expect(viewport.setBlendMode).toHaveBeenCalledWith(COMPOSITE, [], false);
      expect(viewport.resetSlabThickness).toHaveBeenCalled();
    });

    it('rejects unknown modes with an error toast', () => {
      const viewport = makeVolumeViewport();
      const { servicesManager, show } = makeServices(viewport);
      const actions = createMipSlabActions({ servicesManager });

      expect(actions.setSlabProjection({ mode: 'maximum' })).toBe(false);
      expect(viewport.setBlendMode).not.toHaveBeenCalled();
      expect(show).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', message: expect.stringContaining('maximum') })
      );
    });

    it('toasts honestly on a stack viewport', () => {
      const viewport = makeStackViewport();
      const { servicesManager, show } = makeServices(viewport);
      const actions = createMipSlabActions({ servicesManager });

      expect(actions.setSlabProjection({ mode: 'mip' })).toBe(false);
      expect(show).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          message: expect.stringContaining('MPR/volume viewport'),
        })
      );
    });

    it('toasts honestly on a 3D viewport (its slab APIs are no-op stubs)', () => {
      const viewport = makeVolume3dViewport();
      const { servicesManager, show } = makeServices(viewport);
      const actions = createMipSlabActions({ servicesManager });

      expect(actions.setSlabProjection({ mode: 'mip' })).toBe(false);
      expect(viewport.setBlendMode).not.toHaveBeenCalled();
      expect(show).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          message: expect.stringContaining('MPR/volume viewport'),
        })
      );
    });

    it('toasts when there is no active viewport', () => {
      const { servicesManager, show } = makeServices(undefined);
      const actions = createMipSlabActions({ servicesManager });

      expect(actions.setSlabProjection({ mode: 'mip' })).toBe(false);
      expect(show).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', message: 'No active viewport.' })
      );
    });

    it('falls back to viewportGridService state for the active viewport id', () => {
      const viewport = makeVolumeViewport();
      const { servicesManager } = makeServices(viewport);
      servicesManager.services.viewportGridService = {
        getState: () => ({ activeViewportId: 'vp-2' }),
      };
      const actions = createMipSlabActions({ servicesManager });

      expect(actions.setSlabProjection({ mode: 'mip' })).toBe(true);
      expect(
        servicesManager.services.cornerstoneViewportService.getCornerstoneViewport
      ).toHaveBeenCalledWith('vp-2');
    });

    it('survives a missing uiNotificationService', () => {
      const viewport = makeStackViewport();
      const { servicesManager } = makeServices(viewport);
      delete servicesManager.services.uiNotificationService;
      const actions = createMipSlabActions({ servicesManager });

      expect(actions.setSlabProjection({ mode: 'mip' })).toBe(false);
    });
  });

    describe('actor scoping (dose-wash / labelmap protection)', () => {
    it('scopes blend and slab to the DEFAULT actor when the viewport exposes it', () => {
      const viewport = makeVolumeViewport();
      (viewport as any).getDefaultActor = () => ({ uid: 'ct-volume-uid' });
      const { servicesManager, show } = makeServices(viewport);
      const actions = createMipSlabActions({ servicesManager });
      actions.setSlabProjection({ mode: 'mip' });
      expect(viewport.setBlendMode).toHaveBeenCalledWith(1, ['ct-volume-uid'], false);
      expect(viewport.setSlabThickness).toHaveBeenCalledWith(10, ['ct-volume-uid']);
      actions.clearSlabProjection();
      expect(viewport.setBlendMode).toHaveBeenLastCalledWith(0, ['ct-volume-uid'], false);
      // explicit hair-thin restore on the base actor (resetSlabThickness has no filter)
      expect(viewport.setSlabThickness).toHaveBeenLastCalledWith(0.05, ['ct-volume-uid']);
      expect(show).toHaveBeenCalled();
    });
  });

  describe('adjustSlabThickness', () => {
    it('steps the slab and renders', () => {
      const viewport = makeVolumeViewport({ slabMm: 10 });
      const { servicesManager, show } = makeServices(viewport);
      const actions = createMipSlabActions({ servicesManager });

      expect(actions.adjustSlabThickness({ deltaMm: 5 })).toBe(true);
      expect(viewport.setSlabThickness).toHaveBeenCalledWith(15, undefined);
      expect(viewport.render).toHaveBeenCalled();
      expect(show).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'info', message: expect.stringContaining('15 mm') })
      );
    });

    it('first + from an idle viewport lands on 5 mm', () => {
      const viewport = makeVolumeViewport({ slabMm: 0.05 });
      const { servicesManager } = makeServices(viewport);
      const actions = createMipSlabActions({ servicesManager });

      actions.adjustSlabThickness({ deltaMm: 5 });
      expect(viewport.setSlabThickness).toHaveBeenCalledWith(5, undefined);
    });

    it('clamps at the 0.5–100 mm bounds', () => {
      const viewport = makeVolumeViewport({ slabMm: 98 });
      const { servicesManager } = makeServices(viewport);
      const actions = createMipSlabActions({ servicesManager });

      actions.adjustSlabThickness({ deltaMm: 5 });
      expect(viewport.setSlabThickness).toHaveBeenLastCalledWith(100, undefined);

      actions.adjustSlabThickness({ deltaMm: -500 });
      expect(viewport.setSlabThickness).toHaveBeenLastCalledWith(0.5, undefined);
    });

    it('toasts honestly on a stack viewport', () => {
      const viewport = makeStackViewport();
      const { servicesManager, show } = makeServices(viewport);
      const actions = createMipSlabActions({ servicesManager });

      expect(actions.adjustSlabThickness({ deltaMm: 5 })).toBe(false);
      expect(show).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          message: expect.stringContaining('MPR/volume viewport'),
        })
      );
    });
  });

  describe('clearSlabProjection', () => {
    it('restores composite blending and the default slab', () => {
      const viewport = makeVolumeViewport({ blendMode: MIP, slabMm: 20 });
      const { servicesManager } = makeServices(viewport);
      const actions = createMipSlabActions({ servicesManager });

      expect(actions.clearSlabProjection()).toBe(true);
      expect(viewport.setBlendMode).toHaveBeenCalledWith(COMPOSITE, [], false);
      expect(viewport.resetSlabThickness).toHaveBeenCalled();
      expect(viewport.render).toHaveBeenCalled();
    });

    it('returns false without an active viewport', () => {
      const { servicesManager } = makeServices(undefined);
      const actions = createMipSlabActions({ servicesManager });

      expect(actions.clearSlabProjection()).toBe(false);
    });

    it('tolerates a viewport without resetSlabThickness', () => {
      const viewport = makeVolumeViewport({ blendMode: MIP, slabMm: 20 });
      delete (viewport as any).resetSlabThickness;
      const { servicesManager } = makeServices(viewport);
      const actions = createMipSlabActions({ servicesManager });

      expect(actions.clearSlabProjection()).toBe(true);
      expect(viewport.setBlendMode).toHaveBeenCalledWith(COMPOSITE, [], false);
    });
  });
});
