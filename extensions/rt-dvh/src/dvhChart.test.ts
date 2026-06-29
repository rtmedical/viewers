import { buildDvhChart, DVH_PALETTE } from './dvhChart';
import { parseDvhFromInstance, RT_DOSE_SOP_CLASS_UID } from './dvhParser';

const curves = parseDvhFromInstance(
  {
    SOPClassUID: RT_DOSE_SOP_CLASS_UID,
    DVHSequence: [
      {
        DVHType: 'CUMULATIVE',
        DVHData: [1, 100, 1, 50, 1, 0],
        DVHReferencedROISequence: [{ ReferencedROINumber: 1 }],
      },
      {
        DVHType: 'CUMULATIVE',
        DVHData: [2, 80, 2, 0],
        DVHReferencedROISequence: [{ ReferencedROINumber: 2 }],
      },
    ],
  },
  new Map([
    [1, 'PTV'],
    [2, 'Bladder'],
  ])
);

describe('buildDvhChart', () => {
  it('produces one series per curve with palette colors and labels', () => {
    const g = buildDvhChart(curves);
    expect(g.series).toHaveLength(2);
    expect(g.series[0].roiName).toBe('PTV');
    expect(g.series[0].color).toBe(DVH_PALETTE[0]);
    expect(g.series[1].color).toBe(DVH_PALETTE[1]);
    expect(g.series[0].polyline.split(' ')).toHaveLength(3); // 3 points
  });

  it('uses a nice dose max covering the data and a percent y-axis by default', () => {
    const g = buildDvhChart(curves);
    expect(g.asPercent).toBe(true);
    expect(g.volMax).toBe(100);
    expect(g.doseMax).toBeGreaterThanOrEqual(3); // data max dose is 3 Gy
  });

  it('maps the first point of a full-volume curve near the top-left of the plot', () => {
    const g = buildDvhChart(curves, { width: 480, height: 300, pad: 30 });
    const [x, y] = g.series[0].polyline.split(' ')[0].split(',').map(Number);
    // dose=1 of doseMax≈3 -> left-ish; volume=100% -> top (y near pad).
    expect(x).toBeLessThan(480 / 2);
    expect(y).toBeCloseTo(30, 0);
  });
});
