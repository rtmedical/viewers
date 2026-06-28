import { sortKeyImages, groupKeyImagesBySeries } from './utils';
import { KeyImageReference } from './types';

const ref = (over: Partial<KeyImageReference> = {}): KeyImageReference => ({
  StudyInstanceUID: 'ST1',
  SeriesInstanceUID: 'SE1',
  SOPInstanceUID: 'OB1',
  ...over,
});

describe('sortKeyImages', () => {
  it('orders by SeriesNumber, then InstanceNumber', () => {
    const out = sortKeyImages([
      ref({ SOPInstanceUID: 'b', SeriesNumber: 1, InstanceNumber: 2 }),
      ref({ SOPInstanceUID: 'a', SeriesNumber: 1, InstanceNumber: 1 }),
      ref({ SOPInstanceUID: 'c', SeriesNumber: 2, InstanceNumber: 1 }),
    ]);
    expect(out.map(r => r.SOPInstanceUID)).toEqual(['a', 'b', 'c']);
  });

  it('pushes references with missing numeric keys to the end', () => {
    const out = sortKeyImages([
      ref({ SOPInstanceUID: 'noNums' }),
      ref({ SOPInstanceUID: 'hasNums', SeriesNumber: 1, InstanceNumber: 1 }),
    ]);
    expect(out.map(r => r.SOPInstanceUID)).toEqual(['hasNums', 'noNums']);
  });

  it('breaks ties by SOPInstanceUID, with a missing frameNumber sorting last, and does not mutate input', () => {
    const input = [
      ref({ SOPInstanceUID: 'z', SeriesNumber: 1, InstanceNumber: 1 }),
      ref({ SOPInstanceUID: 'a', SeriesNumber: 1, InstanceNumber: 1, frameNumber: 2 }),
      ref({ SOPInstanceUID: 'a', SeriesNumber: 1, InstanceNumber: 1 }),
    ];
    const snapshot = input.map(r => r.SOPInstanceUID);
    const out = sortKeyImages(input);
    // 'a' before 'z' by SOPInstanceUID; within 'a', frame 2 before the frameless
    // ref (missing numeric keys sort last, per the documented contract).
    expect(out.map(r => `${r.SOPInstanceUID}:${r.frameNumber ?? ''}`)).toEqual(['a:2', 'a:', 'z:']);
    expect(input.map(r => r.SOPInstanceUID)).toEqual(snapshot); // untouched
  });
});

describe('groupKeyImagesBySeries', () => {
  it('groups by series preserving first-seen series order and item order', () => {
    const groups = groupKeyImagesBySeries([
      ref({ SeriesInstanceUID: 'SE2', SOPInstanceUID: 'a', Modality: 'CT' }),
      ref({ SeriesInstanceUID: 'SE1', SOPInstanceUID: 'b' }),
      ref({ SeriesInstanceUID: 'SE2', SOPInstanceUID: 'c' }),
    ]);
    expect(groups.map(g => g.SeriesInstanceUID)).toEqual(['SE2', 'SE1']);
    expect(groups[0].items.map(i => i.SOPInstanceUID)).toEqual(['a', 'c']);
    expect(groups[0].Modality).toBe('CT'); // metadata from first-seen ref
    expect(groups[1].items).toHaveLength(1);
  });

  it('returns an empty array for no input', () => {
    expect(groupKeyImagesBySeries([])).toEqual([]);
  });
});
