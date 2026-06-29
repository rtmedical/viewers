import {
  parseRadiationDoseReport,
  compareToDrl,
  buildDoseReportCsv,
  RADIATION_DOSE_SR_SOP_CLASS_UID_LIST,
} from './rdsrParser';

const num = (code: string, meaning: string, value: string, unit?: string) => ({
  ValueType: 'NUM',
  ConceptNameCodeSequence: { CodeValue: code, CodeMeaning: meaning },
  MeasuredValueSequence: {
    NumericValue: value,
    ...(unit ? { MeasurementUnitsCodeSequence: { CodeValue: unit } } : {}),
  },
});

const instance = {
  SOPClassUID: '1.2.840.10008.5.1.4.1.1.88.67',
  ContentSequence: [
    num('113813', 'CT Dose Length Product Total', '600', 'mGycm'),
    {
      ValueType: 'CONTAINER',
      ConceptNameCodeSequence: { CodeMeaning: 'CT Acquisition' },
      ContentSequence: [
        num('113830', 'Mean CTDIvol', '12.5', 'mGy'),
        num('113838', 'DLP', '300', 'mGycm'),
        num('113733', 'KVP', '120'),
      ],
    },
    {
      ValueType: 'CONTAINER',
      ConceptNameCodeSequence: { CodeMeaning: 'CT Acquisition' },
      ContentSequence: [num('113830', 'Mean CTDIvol', '10', 'mGy'), num('113838', 'DLP', '250')],
    },
  ],
};

describe('parseRadiationDoseReport', () => {
  const report = parseRadiationDoseReport(instance);

  it('extracts one irradiation event per dose-bearing acquisition container', () => {
    expect(report.events).toHaveLength(2);
    expect(report.events[0]).toMatchObject({ ctdiVol: 12.5, dlp: 300, kvp: 120 });
    expect(report.events[1]).toMatchObject({ ctdiVol: 10, dlp: 250 });
  });

  it('prefers the accumulated DLP total over the per-event sum', () => {
    // per-event sum would be 550; explicit accumulated total is 600
    expect(report.totalDlp).toBe(600);
  });

  it('sums CTDIvol across events', () => {
    expect(report.totalCtdiVol).toBe(22.5);
  });

  it('collects every NUM measurement recursively', () => {
    expect(report.allMeasurements).toHaveLength(6); // 1 total + 3 + 2
  });

  it('handles a non-dose / empty instance', () => {
    expect(parseRadiationDoseReport({}).events).toEqual([]);
    expect(parseRadiationDoseReport(undefined as any).totalDlp).toBeUndefined();
  });
});

describe('compareToDrl', () => {
  it('flags metrics that exceed the DRL with ratios', () => {
    const report = parseRadiationDoseReport(instance);
    const cmp = compareToDrl(report, { dlp: 500, ctdiVol: 15 });
    expect(cmp.find(c => c.metric === 'DLP')).toMatchObject({ value: 600, threshold: 500, exceeds: true });
    expect(cmp.find(c => c.metric === 'DLP')?.ratio).toBeCloseTo(1.2);
    expect(cmp.find(c => c.metric === 'CTDIvol')).toMatchObject({ value: 22.5, exceeds: true });
  });

  it('does not flag when under the DRL', () => {
    const report = parseRadiationDoseReport(instance);
    expect(compareToDrl(report, { dlp: 1000 })[0].exceeds).toBe(false);
  });
});

describe('buildDoseReportCsv', () => {
  it('emits header + per-event rows + a TOTAL row', () => {
    const csv = buildDoseReportCsv(parseRadiationDoseReport(instance)).split('\n');
    expect(csv[0]).toBe('Acquisition,CTDIvol(mGy),DLP(mGy.cm),kVp');
    expect(csv).toHaveLength(4); // header + 2 events + total
    expect(csv[3]).toContain('TOTAL');
  });
});

describe('SOP class list', () => {
  it('includes the X-Ray Radiation Dose SR', () => {
    expect(RADIATION_DOSE_SR_SOP_CLASS_UID_LIST).toContain('1.2.840.10008.5.1.4.1.1.88.67');
  });
});
