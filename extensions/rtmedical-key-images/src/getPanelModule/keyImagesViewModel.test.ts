import { buildKeyImagesViewModel } from './keyImagesViewModel';
import type { KeyImageReference } from '../types';

const ref = (over: Partial<KeyImageReference> = {}): KeyImageReference => ({
  StudyInstanceUID: 'study-1',
  SeriesInstanceUID: 'series-1',
  SOPInstanceUID: 'sop-1',
  ...over,
});

describe('buildKeyImagesViewModel', () => {
  it('reports an empty model for no selection', () => {
    const vm = buildKeyImagesViewModel([]);
    expect(vm.total).toBe(0);
    expect(vm.isEmpty).toBe(true);
    expect(vm.series).toEqual([]);
  });

  it('counts the total selection and is not empty', () => {
    const vm = buildKeyImagesViewModel([ref({ SOPInstanceUID: 'a' }), ref({ SOPInstanceUID: 'b' })]);
    expect(vm.total).toBe(2);
    expect(vm.isEmpty).toBe(false);
  });

  it('groups items by series and gives every item a stable id + label', () => {
    const vm = buildKeyImagesViewModel([
      ref({ SeriesInstanceUID: 's1', SOPInstanceUID: 'a', Modality: 'CT' }),
      ref({ SeriesInstanceUID: 's1', SOPInstanceUID: 'b', Modality: 'CT' }),
      ref({ SeriesInstanceUID: 's2', SOPInstanceUID: 'c', Modality: 'MR' }),
    ]);

    expect(vm.series).toHaveLength(2);
    const [first, second] = vm.series;
    expect(first.seriesInstanceUID).toBe('s1');
    expect(first.items).toHaveLength(2);
    expect(second.seriesInstanceUID).toBe('s2');

    const ids = vm.series.flatMap(s => s.items.map(i => i.id));
    expect(new Set(ids).size).toBe(ids.length); // ids unique
    vm.series.forEach(s =>
      s.items.forEach(i => {
        expect(typeof i.id).toBe('string');
        expect(i.label.length).toBeGreaterThan(0);
        expect(i.reference.SOPInstanceUID).toBeTruthy();
      })
    );
  });

  it('derives a series label from modality and description', () => {
    const vm = buildKeyImagesViewModel([
      ref({ SeriesInstanceUID: 's1', Modality: 'CT', SeriesDescription: 'Chest' }),
    ]);
    expect(vm.series[0].seriesLabel).toBe('CT · Chest');
  });

  it('falls back to the series UID when no descriptive metadata exists', () => {
    const vm = buildKeyImagesViewModel([ref({ SeriesInstanceUID: 'only-uid' })]);
    expect(vm.series[0].seriesLabel).toBe('Series only-uid');
  });
});
