import { KeyImageManager } from './KeyImageManager';
import { getKeyImageId } from './keyImageId';
import { KeyImageReference, KeyImageEvent } from './types';

const ref = (over: Partial<KeyImageReference> = {}): KeyImageReference => ({
  StudyInstanceUID: 'ST1',
  SeriesInstanceUID: 'SE1',
  SOPInstanceUID: 'OB1',
  ...over,
});

describe('KeyImageManager', () => {
  it('adds a reference once and reports membership', () => {
    const m = new KeyImageManager();
    expect(m.add(ref())).toBe(true);
    expect(m.add(ref())).toBe(false); // already present
    expect(m.count()).toBe(1);
    expect(m.has(ref())).toBe(true);
    expect(m.has(getKeyImageId(ref()))).toBe(true);
  });

  it('first-add wins: re-adding does not overwrite metadata', () => {
    const m = new KeyImageManager();
    m.add(ref({ Modality: 'CT' }));
    m.add(ref({ Modality: 'MR' }));
    expect(m.get(getKeyImageId(ref()))!.Modality).toBe('CT');
  });

  it('removes by reference or id', () => {
    const m = new KeyImageManager();
    m.add(ref());
    expect(m.remove(getKeyImageId(ref()))).toBe(true);
    expect(m.remove(ref())).toBe(false); // already gone
    expect(m.count()).toBe(0);
  });

  it('toggle returns the resulting selection state', () => {
    const m = new KeyImageManager();
    expect(m.toggle(ref())).toBe(true); // now selected
    expect(m.toggle(ref())).toBe(false); // now de-selected
    expect(m.count()).toBe(0);
  });

  it('preserves insertion order in list()', () => {
    const m = new KeyImageManager();
    m.add(ref({ SOPInstanceUID: 'C' }));
    m.add(ref({ SOPInstanceUID: 'A' }));
    m.add(ref({ SOPInstanceUID: 'B' }));
    expect(m.list().map(r => r.SOPInstanceUID)).toEqual(['C', 'A', 'B']);
  });

  it('clear() empties and emits once only when non-empty', () => {
    const m = new KeyImageManager();
    const events: KeyImageEvent[] = [];
    m.subscribe(e => events.push(e));

    m.clear(); // no-op, empty
    expect(events).toHaveLength(0);

    m.add(ref({ SOPInstanceUID: 'A' }));
    m.add(ref({ SOPInstanceUID: 'B' }));
    events.length = 0;
    m.clear();

    expect(m.count()).toBe(0);
    expect(events).toEqual([{ type: 'cleared', count: 0 }]);
  });

  it('emits add/remove events with id and running count', () => {
    const m = new KeyImageManager();
    const events: KeyImageEvent[] = [];
    m.subscribe(e => events.push(e));

    m.add(ref());
    m.remove(ref());

    expect(events).toEqual([
      { type: 'added', id: getKeyImageId(ref()), ref: ref(), count: 1 },
      { type: 'removed', id: getKeyImageId(ref()), count: 0 },
    ]);
  });

  it('does not emit on no-op mutations', () => {
    const m = new KeyImageManager();
    const events: KeyImageEvent[] = [];
    m.subscribe(e => events.push(e));

    m.add(ref());
    m.add(ref()); // duplicate -> no event
    m.remove(ref({ SOPInstanceUID: 'absent' })); // absent -> no event

    expect(events.map(e => e.type)).toEqual(['added']);
  });

  it('unsubscribe stops delivery and is idempotent', () => {
    const m = new KeyImageManager();
    const events: KeyImageEvent[] = [];
    const sub = m.subscribe(e => events.push(e));

    m.add(ref({ SOPInstanceUID: 'A' }));
    sub.unsubscribe();
    sub.unsubscribe(); // idempotent, no throw
    m.add(ref({ SOPInstanceUID: 'B' }));

    expect(events).toHaveLength(1);
  });

  it('treats different frames of one instance as distinct selections', () => {
    const m = new KeyImageManager();
    m.add(ref({ SOPInstanceUID: 'MF', frameNumber: 1 }));
    m.add(ref({ SOPInstanceUID: 'MF', frameNumber: 2 }));
    expect(m.count()).toBe(2);
  });
});
