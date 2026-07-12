import {
  parseDvhFromInstance,
  buildRoiNameMap,
  buildRoiColorMap,
  buildDvhCsv,
  volumePercentAtDose,
  doseAtVolumePercent,
  RT_DOSE_SOP_CLASS_UID,
} from './dvhParser';

// Cumulative DVH, 1 Gy steps: 100% up to 2 Gy, 50% at 3 Gy, 0% at 4 Gy.
const sampleRtdose = (roiNumber = 5) => ({
  SOPClassUID: RT_DOSE_SOP_CLASS_UID,
  Modality: 'RTDOSE',
  DVHSequence: [
    {
      DVHType: 'CUMULATIVE',
      DoseUnits: 'GY',
      DVHVolumeUnits: 'CM3',
      DVHDoseScaling: 1,
      DVHData: [1, 100, 1, 100, 1, 50, 1, 0],
      DVHMeanDose: '2.5',
      DVHMaximumDose: '4',
      DVHReferencedROISequence: [{ ReferencedROINumber: roiNumber }],
    },
  ],
});

describe('parseDvhFromInstance', () => {
  it('parses a cumulative curve and scales the dose axis', () => {
    const [curve] = parseDvhFromInstance(sampleRtdose());
    expect(curve.type).toBe('CUMULATIVE');
    expect(curve.doseUnits).toBe('GY');
    expect(curve.points).toEqual([
      { dose: 1, volume: 100 },
      { dose: 2, volume: 100 },
      { dose: 3, volume: 50 },
      { dose: 4, volume: 0 },
    ]);
    expect(curve.totalVolume).toBe(100);
    expect(curve.meanDose).toBe(2.5);
  });

  it('applies DVHDoseScaling to the dose axis', () => {
    const inst: any = sampleRtdose();
    inst.DVHSequence[0].DVHDoseScaling = 0.5;
    inst.DVHSequence[0].DVHData = [2, 100, 2, 0];
    const [curve] = parseDvhFromInstance(inst);
    expect(curve.points).toEqual([
      { dose: 1, volume: 100 },
      { dose: 2, volume: 0 },
    ]);
  });

  it('resolves the structure name via the ROI map', () => {
    const map = new Map([[5, 'PTV']]);
    const [curve] = parseDvhFromInstance(sampleRtdose(5), map);
    expect(curve.roiNumber).toBe(5);
    expect(curve.roiName).toBe('PTV');
  });

  it('resolves the structure display colour via the ROI colour map', () => {
    const colorMap = new Map<number, [number, number, number]>([[5, [255, 0, 0]]]);
    const [curve] = parseDvhFromInstance(sampleRtdose(5), undefined, colorMap);
    expect(curve.color).toEqual([255, 0, 0]);
  });

  it('leaves color undefined when no colour map (or no match) is given', () => {
    expect(parseDvhFromInstance(sampleRtdose(5))[0].color).toBeUndefined();
    const colorMap = new Map<number, [number, number, number]>([[9, [1, 2, 3]]]);
    expect(parseDvhFromInstance(sampleRtdose(5), undefined, colorMap)[0].color).toBeUndefined();
  });

  it('handles DVHData encoded as a backslash-joined string', () => {
    const inst: any = sampleRtdose();
    inst.DVHSequence[0].DVHData = '1\\100\\1\\0';
    const [curve] = parseDvhFromInstance(inst);
    expect(curve.points).toEqual([
      { dose: 1, volume: 100 },
      { dose: 2, volume: 0 },
    ]);
  });

  it('returns [] when there is no DVH sequence', () => {
    expect(parseDvhFromInstance({ Modality: 'RTDOSE' })).toEqual([]);
    expect(parseDvhFromInstance(undefined)).toEqual([]);
  });
});

describe('DVH metrics', () => {
  const [curve] = parseDvhFromInstance(sampleRtdose());

  it('volumePercentAtDose (V_x) interpolates the cumulative curve', () => {
    expect(volumePercentAtDose(curve, 2)).toBe(100);
    expect(volumePercentAtDose(curve, 3)).toBe(50);
    expect(volumePercentAtDose(curve, 3.5)).toBe(25);
  });

  it('doseAtVolumePercent (D_x) inverts the curve', () => {
    expect(doseAtVolumePercent(curve, 100)).toBe(1);
    expect(doseAtVolumePercent(curve, 75)).toBe(2.5);
    expect(doseAtVolumePercent(curve, 50)).toBe(3);
  });
});

describe('buildRoiNameMap', () => {
  it('maps ROINumber -> ROIName from an RTSTRUCT', () => {
    const map = buildRoiNameMap({
      StructureSetROISequence: [
        { ROINumber: 5, ROIName: 'PTV' },
        { ROINumber: 6, ROIName: 'Bladder' },
      ],
    });
    expect(map.get(5)).toBe('PTV');
    expect(map.get(6)).toBe('Bladder');
  });

  it('is defensive about a scalar (single-item) sequence', () => {
    const map = buildRoiNameMap({ StructureSetROISequence: { ROINumber: 1, ROIName: 'Body' } });
    expect(map.get(1)).toBe('Body');
  });
});

describe('buildRoiColorMap', () => {
  it('maps ROINumber -> [r,g,b] from ROIContourSequence.ROIDisplayColor', () => {
    const map = buildRoiColorMap({
      ROIContourSequence: [
        { ReferencedROINumber: 5, ROIDisplayColor: [255, 0, 0] },
        { ReferencedROINumber: 6, ROIDisplayColor: '0\\128\\255' },
      ],
    });
    expect(map.get(5)).toEqual([255, 0, 0]);
    expect(map.get(6)).toEqual([0, 128, 255]);
  });

  it('skips items without a colour or ROI number, and tolerates a scalar sequence', () => {
    const map = buildRoiColorMap({
      ROIContourSequence: { ReferencedROINumber: 1, ROIDisplayColor: [10, 20, 30] },
    });
    expect(map.get(1)).toEqual([10, 20, 30]);
    expect(buildRoiColorMap({ ROIContourSequence: [{ ReferencedROINumber: 2 }] }).size).toBe(0);
    expect(buildRoiColorMap(undefined).size).toBe(0);
  });
});

describe('buildDvhCsv', () => {
  it('emits a Dose/Volume column block per curve', () => {
    const curves = parseDvhFromInstance(sampleRtdose(5), new Map([[5, 'PTV']]));
    const csv = buildDvhCsv(curves);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('PTV Dose(GY),PTV Vol(CM3)');
    expect(lines[1]).toBe('1,100');
    expect(lines).toHaveLength(1 + 4); // header + 4 points
  });
});
