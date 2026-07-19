import { KeyImageService, KeyImagesChangedEvent } from './KeyImageService';
import { KeyImageReference } from './types';

const ref = (
  SOPInstanceUID: string,
  extra: Partial<KeyImageReference> = {}
): KeyImageReference => ({
  StudyInstanceUID: '1.2.study',
  SeriesInstanceUID: '1.2.series',
  SOPInstanceUID,
  ...extra,
});

describe('KeyImageService.REGISTRATION', () => {
  it('exposes an OHIF-compatible registration descriptor', () => {
    expect(KeyImageService.REGISTRATION.name).toBe('rtmedicalKeyImageService');
    expect(typeof KeyImageService.REGISTRATION.create).toBe('function');
  });

  it('create() returns a service instance, with or without props', () => {
    expect(KeyImageService.REGISTRATION.create()).toBeInstanceOf(KeyImageService);
    expect(
      KeyImageService.REGISTRATION.create({ configuration: { clearOnModeExit: false } })
    ).toBeInstanceOf(KeyImageService);
  });

  it('publishes its EVENTS map on both the class and the instance', () => {
    const service = new KeyImageService();
    expect(KeyImageService.EVENTS.KEY_IMAGES_CHANGED).toMatch(/^event::/);
    expect(service.EVENTS).toBe(KeyImageService.EVENTS);
  });
});

describe('KeyImageService selection delegation', () => {
  it('adds, looks up, counts and removes references', () => {
    const service = new KeyImageService();
    expect(service.addKeyImage(ref('a'))).toBe(true);
    expect(service.addKeyImage(ref('a'))).toBe(false); // no-op re-add
    expect(service.addKeyImage(ref('b'))).toBe(true);

    expect(service.getCount()).toBe(2);
    expect(service.hasKeyImage(ref('a'))).toBe(true);
    expect(service.getKeyImages().map(r => r.SOPInstanceUID)).toEqual(['a', 'b']);

    expect(service.removeKeyImage(ref('a'))).toBe(true);
    expect(service.removeKeyImage(ref('a'))).toBe(false);
    expect(service.getCount()).toBe(1);
  });

  it('toggles membership and reports the resulting state', () => {
    const service = new KeyImageService();
    expect(service.toggleKeyImage(ref('a'))).toBe(true); // now selected
    expect(service.toggleKeyImage(ref('a'))).toBe(false); // now de-selected
    expect(service.getCount()).toBe(0);
  });

  it('clears the whole selection', () => {
    const service = new KeyImageService();
    service.addKeyImage(ref('a'));
    service.addKeyImage(ref('b'));
    service.clearKeyImages();
    expect(service.getCount()).toBe(0);
  });
});

describe('KeyImageService event bridging', () => {
  it('broadcasts a change + snapshot on every real mutation', () => {
    const service = new KeyImageService();
    const events: KeyImagesChangedEvent[] = [];
    service.subscribe(service.EVENTS.KEY_IMAGES_CHANGED, e => events.push(e));

    service.addKeyImage(ref('a'));
    service.addKeyImage(ref('b'));
    service.removeKeyImage(ref('a'));
    service.clearKeyImages();

    expect(events.map(e => e.change.type)).toEqual([
      'added',
      'added',
      'removed',
      'cleared',
    ]);
    // Snapshot reflects state *after* each change.
    expect(events[1].keyImages.map(r => r.SOPInstanceUID)).toEqual(['a', 'b']);
    expect(events[2].keyImages.map(r => r.SOPInstanceUID)).toEqual(['b']);
    expect(events[3].keyImages).toEqual([]);
  });

  it('does not broadcast on no-op mutations', () => {
    const service = new KeyImageService();
    const cb = jest.fn();
    service.subscribe(service.EVENTS.KEY_IMAGES_CHANGED, cb);

    service.addKeyImage(ref('a'));
    service.addKeyImage(ref('a')); // re-add: no-op
    service.removeKeyImage(ref('z')); // absent: no-op
    service.clearKeyImages();
    service.clearKeyImages(); // already empty: no-op

    expect(cb).toHaveBeenCalledTimes(2); // one add + one clear
  });

  it('fans out to multiple subscribers and stops after unsubscribe', () => {
    const service = new KeyImageService();
    const a = jest.fn();
    const b = jest.fn();
    const subA = service.subscribe(service.EVENTS.KEY_IMAGES_CHANGED, a);
    service.subscribe(service.EVENTS.KEY_IMAGES_CHANGED, b);

    service.addKeyImage(ref('a'));
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    subA.unsubscribe();
    subA.unsubscribe(); // idempotent
    service.addKeyImage(ref('b'));
    expect(a).toHaveBeenCalledTimes(1); // no longer notified
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('ignores broadcasts for events with no subscribers', () => {
    const service = new KeyImageService();
    expect(() =>
      service._broadcastEvent('event::nobody:listening', {
        change: { type: 'cleared', count: 0 },
        keyImages: [],
      })
    ).not.toThrow();
  });
});

describe('KeyImageService lifecycle', () => {
  it('clears the selection on mode exit by default', () => {
    const service = new KeyImageService();
    service.addKeyImage(ref('a'));
    service.onModeExit();
    expect(service.getCount()).toBe(0);
  });

  it('keeps the selection on mode exit when clearOnModeExit is false', () => {
    const service = new KeyImageService({ clearOnModeExit: false });
    service.addKeyImage(ref('a'));
    service.onModeExit();
    expect(service.getCount()).toBe(1);
  });

  it('reset() always empties the selection', () => {
    const service = new KeyImageService({ clearOnModeExit: false });
    service.addKeyImage(ref('a'));
    service.reset();
    expect(service.getCount()).toBe(0);
  });

  it('destroy() detaches the model bridge and is idempotent', () => {
    const service = new KeyImageService();
    const cb = jest.fn();
    service.subscribe(service.EVENTS.KEY_IMAGES_CHANGED, cb);

    service.destroy();
    service.destroy(); // idempotent
    service.addKeyImage(ref('a')); // model still works, but no broadcast
    expect(cb).not.toHaveBeenCalled();
    expect(service.getCount()).toBe(1);
  });
});
