import {
  buildSrTreeModel,
  srToText,
  describeSrMeasurement,
  type SrDisplaySetLike,
} from './srTreeViewModel';

const displaySets: SrDisplaySetLike[] = [
  { displaySetInstanceUID: 'ct', Modality: 'CT', SeriesDescription: 'CT' },
  {
    displaySetInstanceUID: 'sr1',
    Modality: 'SR',
    SeriesDescription: 'Measurement Report',
    measurements: [
      { uid: 'a', label: 'Length 24mm' },
      { uid: 'b', labels: [{ label: 'Long', value: '10mm' }, { label: 'Short', value: '8mm' }] },
      { uid: 'c', displayText: ['HU mean 45'] },
    ],
  },
];

describe('describeSrMeasurement', () => {
  it('prefers label, then labels, then displayText, then UID', () => {
    expect(describeSrMeasurement({ label: 'L' })).toBe('L');
    expect(describeSrMeasurement({ labels: [{ label: 'A', value: '1' }] })).toBe('A: 1');
    expect(describeSrMeasurement({ displayText: ['x', 'y'] })).toBe('x y');
    expect(describeSrMeasurement({ TrackingUniqueIdentifier: 't1' })).toBe('t1');
  });
});

describe('buildSrTreeModel', () => {
  it('includes only SR documents with their measurements as children', () => {
    const tree = buildSrTreeModel(displaySets);
    expect(tree).toHaveLength(1);
    expect(tree[0].type).toBe('sr');
    expect(tree[0].children?.map(c => c.label)).toEqual([
      'Length 24mm',
      'Long: 10mm, Short: 8mm',
      'HU mean 45',
    ]);
    expect(tree[0].children?.every(c => c.type === 'measurement')).toBe(true);
  });

  it('handles SR documents with no measurements', () => {
    const tree = buildSrTreeModel([{ displaySetInstanceUID: 'sr2', Modality: 'SR' }]);
    expect(tree[0].children).toBeUndefined();
  });

  it('handles empty input', () => {
    expect(buildSrTreeModel([])).toEqual([]);
  });
});

describe('srToText', () => {
  it('renders a plain-text outline', () => {
    expect(srToText(displaySets)).toBe(
      '# Measurement Report\n  - Length 24mm\n  - Long: 10mm, Short: 8mm\n  - HU mean 45'
    );
  });
});
