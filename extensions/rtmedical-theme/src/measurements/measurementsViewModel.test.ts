import {
  buildMeasurementsViewModel,
  measurementsToCsv,
  summarizeDisplayText,
  type MeasurementLike,
} from './measurementsViewModel';

const measurements: MeasurementLike[] = [
  { uid: 'm2', label: 'Lesion B', toolName: 'Length', displayText: '24.1 mm' },
  { uid: 'm1', label: 'Lesion A', toolName: 'Bidirectional', displayText: { primary: ['10 x 8 mm'] } },
  { uid: 'm3', label: 'Lesion C', toolName: 'Length', displayText: ['12.0 mm', 'axial'] },
];

describe('summarizeDisplayText', () => {
  it('handles string, array and {primary} shapes', () => {
    expect(summarizeDisplayText('5 mm')).toBe('5 mm');
    expect(summarizeDisplayText(['a', 'b'])).toBe('a b');
    expect(summarizeDisplayText({ primary: ['x', 'y'] })).toBe('x y');
    expect(summarizeDisplayText(undefined)).toBe('');
  });
});

describe('buildMeasurementsViewModel', () => {
  it('maps and sorts by type then label', () => {
    const rows = buildMeasurementsViewModel(measurements);
    expect(rows.map(r => r.uid)).toEqual(['m1', 'm2', 'm3']); // Bidirectional < Length; then A,B,C
    expect(rows[0]).toEqual({ uid: 'm1', label: 'Lesion A', type: 'Bidirectional', summary: '10 x 8 mm' });
    expect(rows[2].summary).toBe('12.0 mm axial');
  });

  it('drops entries without a uid', () => {
    expect(buildMeasurementsViewModel([{ uid: '' } as MeasurementLike])).toEqual([]);
  });
});

describe('measurementsToCsv', () => {
  it('emits a header + one row per measurement, quoted', () => {
    const csv = measurementsToCsv([measurements[0]]);
    expect(csv.split('\n')[0]).toBe('uid,type,label,summary');
    expect(csv.split('\n')[1]).toBe('"m2","Length","Lesion B","24.1 mm"');
  });

  it('escapes embedded quotes', () => {
    const csv = measurementsToCsv([{ uid: 'm', toolName: 'T', label: 'say "hi"' }]);
    expect(csv.split('\n')[1]).toContain('"say ""hi"""');
  });
});
