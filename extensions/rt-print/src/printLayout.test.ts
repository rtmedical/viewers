import { computePrintLayout, zoneCount, PAPER_SIZES_MM } from './printLayout';

describe('computePrintLayout', () => {
  it('defaults to A4 portrait 2x2 with 4 zones', () => {
    const l = computePrintLayout();
    expect(l).toMatchObject({ paper: 'A4', orientation: 'portrait', grid: '2x2', pageWidthMm: 210, pageHeightMm: 297 });
    expect(l.zones).toHaveLength(4);
  });

  it('swaps width/height for landscape', () => {
    const l = computePrintLayout({ paper: 'A3', orientation: 'landscape' });
    expect(l.pageWidthMm).toBe(PAPER_SIZES_MM.A3.height); // 420
    expect(l.pageHeightMm).toBe(PAPER_SIZES_MM.A3.width); // 297
  });

  it('computes a single full zone for 1x1 honoring padding', () => {
    const l = computePrintLayout({ paper: 'A4', grid: '1x1', paddingMm: 10, gapMm: 5 });
    expect(l.zones).toHaveLength(1);
    expect(l.zones[0]).toMatchObject({ index: 0, row: 0, col: 0, xMm: 10, yMm: 10 });
    expect(l.zones[0].widthMm).toBeCloseTo(190, 2); // 210 - 2*10
    expect(l.zones[0].heightMm).toBeCloseTo(277, 2); // 297 - 2*10
  });

  it('lays out a 3x3 grid with gaps (9 zones, evenly divided)', () => {
    const l = computePrintLayout({ paper: 'A4', grid: '3x3', paddingMm: 10, gapMm: 5 });
    expect(l.zones).toHaveLength(9);
    // usable width 190, minus 2 gaps (10) = 180 / 3 = 60
    expect(l.zones[0].widthMm).toBeCloseTo(60, 2);
    // second column x = 10 + 60 + 5 = 75
    expect(l.zones[1].xMm).toBeCloseTo(75, 2);
    // last zone is row 2 col 2
    expect(l.zones[8]).toMatchObject({ row: 2, col: 2 });
  });

  it('zoneCount matches the grid preset', () => {
    expect(zoneCount('1x1')).toBe(1);
    expect(zoneCount('2x2')).toBe(4);
    expect(zoneCount('3x3')).toBe(9);
  });
});
