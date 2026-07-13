/**
 * AHA 17-segment bullseye panel (RTV-48).
 *
 * Renders the polar map as raw `<svg>` from the pure {@link ../ahaBullseye}
 * core (no chart library — same pattern as rt-dvh's DvhPanel). Each of the 17
 * segments is clickable: the click resolves the ACTIVE viewport
 * (viewportGridService.getActiveViewportId → cornerstoneViewportService.
 * getCornerstoneViewport) and jumps it to the midpoint slice of the segment's
 * ring via `utilities.jumpToSlice` from @cornerstonejs/core, which handles
 * both stack and orthographic/volume viewports (the same utility the
 * cornerstone extension's `jumpToImage` command uses); a StackViewport
 * `setImageIdIndex` fallback covers rejections. Per-segment perfusion values
 * are editable inline and mapped through a selectable color scale; the chart
 * exports to SVG (XMLSerializer, mirroring DvhPanel.handleSvg) and PNG
 * (offscreen canvas rasterization).
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ohif/ui-next';
import { utilities as csUtils } from '@cornerstonejs/core';
import {
  AHA_SEGMENTS,
  AhaRing,
  AhaSegment,
  COLOR_SCALES,
  ColorScaleName,
  colorForValue,
  polarPoint,
  ringSliceRange,
  segmentArcPath,
} from '../ahaBullseye';

interface ServicesManagerLike {
  services: Record<string, any>;
}
export interface BullseyePanelProps {
  servicesManager: ServicesManagerLike;
}

const SIZE = 300;
const CX = SIZE / 2;
const CY = SIZE / 2;

/** [rInner, rOuter] per ring — apex disc at the center, basal outermost. */
const RING_RADII: Record<AhaRing, [number, number]> = {
  apex: [0, 36],
  apical: [36, 73],
  mid: [73, 110],
  basal: [110, 147],
};

const SCALE_NAMES = Object.keys(COLOR_SCALES) as ColorScaleName[];

function defaultValues(): Record<number, number> {
  const values: Record<number, number> = {};
  for (const seg of AHA_SEGMENTS) {
    values[seg.id] = 100;
  }
  return values;
}

/** Position for the small segment-number label (ring midpoint / apex center). */
function labelPoint(seg: AhaSegment): { x: number; y: number } {
  const [rInner, rOuter] = RING_RADII[seg.ring];
  if (seg.ring === 'apex') {
    return { x: CX, y: CY };
  }
  return polarPoint(CX, CY, (rInner + rOuter) / 2, (seg.startDeg + seg.endDeg) / 2);
}

function downloadUrl(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function downloadBlob(content: string, type: string, filename: string): void {
  if (typeof document === 'undefined') {
    return;
  }
  const url = URL.createObjectURL(new Blob([content], { type }));
  downloadUrl(url, filename);
  URL.revokeObjectURL(url);
}

export function BullseyePanel({ servicesManager }: BullseyePanelProps): React.ReactElement {
  const { t } = useTranslation('RTMedical');
  const [values, setValues] = useState<Record<number, number>>(defaultValues);
  const [scale, setScale] = useState<ColorScaleName>('perfusion');
  const svgRef = useRef<SVGSVGElement>(null);

  const setValue = useCallback((id: number, raw: number) => {
    const v = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 0;
    setValues(prev => ({ ...prev, [id]: v }));
  }, []);

  /**
   * Acceptance (3): clicking a segment navigates the active viewport to the
   * midpoint slice of the segment's ring. No-op when there is no active /
   * compatible viewport.
   */
  const handleSegmentClick = useCallback(
    (seg: AhaSegment) => {
      try {
        const services = servicesManager?.services ?? {};
        const { viewportGridService, cornerstoneViewportService } = services;
        const viewportId = viewportGridService?.getActiveViewportId?.();
        if (!viewportId) {
          return;
        }
        const viewport = cornerstoneViewportService?.getCornerstoneViewport?.(viewportId);
        if (!viewport?.element) {
          return;
        }
        const numSlices: number =
          (typeof viewport.getNumberOfSlices === 'function' && viewport.getNumberOfSlices()) ||
          viewport.getImageIds?.()?.length ||
          0;
        if (!Number.isFinite(numSlices) || numSlices < 1) {
          return;
        }
        const [start, end] = ringSliceRange(seg.ring, numSlices, true);
        const mid = start >= end ? start : Math.floor((start + end - 1) / 2);
        const imageIndex = Math.max(0, Math.min(numSlices - 1, mid));
        // Stack + volume viewports alike (core utility; scrolls the viewport).
        const jump = csUtils.jumpToSlice(viewport.element, { imageIndex });
        jump?.catch?.(() => {
          // StackViewport fallback if the generic jump rejects.
          viewport.setImageIdIndex?.(imageIndex)?.catch?.(() => undefined);
        });
      } catch {
        // No active/compatible viewport — deliberate no-op.
      }
    },
    [servicesManager]
  );

  const serializeSvg = useCallback((): string | undefined => {
    if (!svgRef.current || typeof XMLSerializer === 'undefined') {
      return undefined;
    }
    return new XMLSerializer().serializeToString(svgRef.current);
  }, []);

  const handleExportSvg = useCallback(() => {
    const xml = serializeSvg();
    if (xml) {
      downloadBlob(xml, 'image/svg+xml', 'aha-bullseye.svg');
    }
  }, [serializeSvg]);

  const handleExportPng = useCallback(() => {
    const xml = serializeSvg();
    if (!xml || typeof document === 'undefined' || typeof Image === 'undefined') {
      return;
    }
    const svgUrl = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
      try {
        const px = SIZE * 2; // 2× raster for a crisp export
        const canvas = document.createElement('canvas');
        canvas.width = px;
        canvas.height = px;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return;
        }
        ctx.fillStyle = '#161616';
        ctx.fillRect(0, 0, px, px);
        ctx.drawImage(img, 0, 0, px, px);
        downloadUrl(canvas.toDataURL('image/png'), 'aha-bullseye.png');
      } finally {
        URL.revokeObjectURL(svgUrl);
      }
    };
    img.onerror = () => URL.revokeObjectURL(svgUrl);
    img.src = svgUrl;
  }, [serializeSvg]);

  const stops = COLOR_SCALES[scale];
  const legendGradient = useMemo(
    () => `linear-gradient(to right, ${stops.join(', ')})`,
    [stops]
  );

  return (
    <div
      className="ohif-scrollbar flex h-full flex-col overflow-auto text-white"
      data-cy="cardio-bullseye"
    >
      <div className="flex items-center justify-between px-2 py-2">
        <span className="text-base font-medium">{t('cardio_bullseye_title')}</span>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={handleExportSvg} data-cy="bullseye-export-svg">
            SVG
          </Button>
          <Button variant="ghost" size="sm" onClick={handleExportPng} data-cy="bullseye-export-png">
            PNG
          </Button>
        </div>
      </div>

      <div className="px-2">
        <svg
          ref={svgRef}
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="h-auto w-full"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect x={0} y={0} width={SIZE} height={SIZE} fill="#161616" />
          {AHA_SEGMENTS.map(seg => {
            const [rInner, rOuter] = RING_RADII[seg.ring];
            const value = values[seg.id] ?? 0;
            const pos = labelPoint(seg);
            return (
              <g key={seg.id}>
                <path
                  d={segmentArcPath(CX, CY, rInner, rOuter, seg.startDeg, seg.endDeg)}
                  fill={colorForValue(value, scale)}
                  stroke="#161616"
                  strokeWidth={1.5}
                  className="cursor-pointer"
                  data-cy={`bullseye-seg-${seg.id}`}
                  onClick={() => handleSegmentClick(seg)}
                >
                  <title>{`${seg.id} — ${t(seg.labelKey)}: ${value}%`}</title>
                </path>
                <text
                  x={pos.x}
                  y={pos.y + 3}
                  fontSize={8}
                  fontFamily="sans-serif"
                  fill="#ffffff"
                  stroke="#161616"
                  strokeWidth={0.4}
                  textAnchor="middle"
                  pointerEvents="none"
                >
                  {seg.id}
                </text>
              </g>
            );
          })}
        </svg>
        <div className="text-muted-foreground px-1 pt-1 text-xs">{t('cardio_click_hint')}</div>
      </div>

      <div className="flex items-center gap-2 px-2 pt-3">
        <label className="text-muted-foreground text-xs" htmlFor="bullseye-scale">
          {t('cardio_scale_label')}
        </label>
        <select
          id="bullseye-scale"
          data-cy="bullseye-scale"
          value={scale}
          onChange={ev => setScale(ev.target.value as ColorScaleName)}
          className="rounded border border-white/20 bg-black/30 px-1 py-0.5 text-xs text-white"
        >
          {SCALE_NAMES.map(name => (
            <option key={name} value={name}>
              {t(`cardio_scale_${name}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="px-2 pt-2">
        <div
          className="h-2 w-full rounded"
          style={{ background: legendGradient }}
          data-cy="bullseye-legend"
        />
        <div className="text-muted-foreground flex justify-between text-xs">
          <span>0%</span>
          <span>100%</span>
        </div>
      </div>

      <div className="px-2 pb-3 pt-3">
        <div className="text-muted-foreground pb-1 text-xs">{t('cardio_values_title')}</div>
        <div className="grid grid-cols-3 gap-1">
          {AHA_SEGMENTS.map(seg => (
            <label
              key={seg.id}
              className="flex items-center gap-1 text-xs"
              title={t(seg.labelKey)}
            >
              <span className="text-muted-foreground w-5 shrink-0 text-right">{seg.id}</span>
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={values[seg.id] ?? 0}
                onChange={ev => setValue(seg.id, ev.target.valueAsNumber)}
                className="w-full min-w-0 rounded border border-white/20 bg-black/30 px-1 py-0.5 text-xs text-white"
                data-cy={`bullseye-value-${seg.id}`}
              />
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

export default BullseyePanel;
