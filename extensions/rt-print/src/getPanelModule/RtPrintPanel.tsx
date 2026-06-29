/**
 * RT Print right-panel (RTV-140): configure paper size / orientation / grid,
 * preview the zone layout, and print (Save-as-PDF for PDF export).
 *
 * The zone geometry comes from the pure {@link ../printLayout}. Populating zones
 * with live viewport screenshots / DVH / RTPlan captures is a viewport
 * integration follow-up (needs cornerstone screenshot capture); this panel
 * delivers the configurable layout + preview + print trigger. RTV-114:
 * `@ohif/ui-next` only.
 */
import React, { useMemo, useState } from 'react';
import { Button } from '@ohif/ui-next';
import {
  computePrintLayout,
  PaperSize,
  Orientation,
  GridPreset,
} from '../printLayout';

const PAPERS: PaperSize[] = ['A3', 'A4', 'A5'];
const ORIENTATIONS: Orientation[] = ['portrait', 'landscape'];
const GRIDS: GridPreset[] = ['1x1', '2x2', '3x3'];

export function RtPrintPanel(): React.ReactElement {
  const [paper, setPaper] = useState<PaperSize>('A4');
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [grid, setGrid] = useState<GridPreset>('2x2');
  const [paddingMm, setPaddingMm] = useState(10);
  const [gapMm, setGapMm] = useState(5);

  const layout = useMemo(
    () => computePrintLayout({ paper, orientation, grid, paddingMm, gapMm }),
    [paper, orientation, grid, paddingMm, gapMm]
  );

  // Scale the preview to a fixed pixel width, preserving the page aspect ratio.
  const previewW = 200;
  const scale = previewW / layout.pageWidthMm;
  const previewH = layout.pageHeightMm * scale;

  const select = <T extends string>(value: T, options: T[], onChange: (v: T) => void, label: string) => (
    <label className="mb-2 flex items-center justify-between gap-2">
      <span className="text-muted-foreground text-xs">{label}</span>
      <select
        className="rounded bg-black/30 p-1 text-sm"
        value={value}
        onChange={e => onChange(e.target.value as T)}
      >
        {options.map(o => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="ohif-scrollbar flex h-full flex-col overflow-auto px-2 py-2 text-sm text-white" data-cy="rt-print-panel">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-base font-medium">RT Print</span>
        <Button variant="ghost" size="sm" onClick={() => typeof window !== 'undefined' && window.print()}>
          Print / PDF
        </Button>
      </div>

      {select(paper, PAPERS, setPaper, 'Paper')}
      {select(orientation, ORIENTATIONS, setOrientation, 'Orientation')}
      {select(grid, GRIDS, setGrid, 'Grid')}
      <label className="mb-2 flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs">Padding (mm)</span>
        <input type="number" className="w-16 rounded bg-black/30 p-1 text-sm" value={paddingMm}
          min={0} max={40} onChange={e => setPaddingMm(Number(e.target.value) || 0)} />
      </label>
      <label className="mb-3 flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs">Gap (mm)</span>
        <input type="number" className="w-16 rounded bg-black/30 p-1 text-sm" value={gapMm}
          min={0} max={40} onChange={e => setGapMm(Number(e.target.value) || 0)} />
      </label>

      <div className="text-muted-foreground mb-1 text-xs">Preview ({layout.zones.length} zones)</div>
      <div
        className="relative mx-auto border border-white/20 bg-white/5"
        style={{ width: previewW, height: previewH }}
      >
        {layout.zones.map(z => (
          <div
            key={z.index}
            className="absolute flex items-center justify-center border border-sky-400/50 bg-sky-400/10 text-[10px] text-sky-200"
            style={{
              left: z.xMm * scale,
              top: z.yMm * scale,
              width: z.widthMm * scale,
              height: z.heightMm * scale,
            }}
          >
            {z.index + 1}
          </div>
        ))}
      </div>
      <p className="text-muted-foreground mt-2 text-xs">
        Zone capture (viewport screenshots / DVH / RTPlan) is a viewport-integration follow-up.
      </p>
    </div>
  );
}

export default RtPrintPanel;
