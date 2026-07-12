/**
 * DVH right-panel (RTV-131).
 *
 * Reads RTDOSE display sets from the DisplaySetService, parses their embedded
 * DVHSequence (pure {@link ../dvhParser}), resolves structure names from a loaded
 * RTSTRUCT, and renders a dose×volume chart (pure {@link ../dvhChart} geometry,
 * raw `<svg>` — no chart lib) plus a per-structure legend with Dmean/Dmax and a
 * CSV/SVG export. RTV-114: `@ohif/ui-next` only; no core internals.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ohif/ui-next';
import {
  parseDvhFromInstance,
  buildRoiNameMap,
  buildRoiColorMap,
  buildDvhCsv,
  DvhCurve,
} from '../dvhParser';
import { buildDvhChart } from '../dvhChart';

interface ServicesManagerLike {
  services: Record<string, any>;
}
export interface DvhPanelProps {
  servicesManager: ServicesManagerLike;
}

const instanceOf = (ds: any) => ds?.instances?.[0] ?? ds?.instance ?? ds;

function collectCurves(displaySetService: any): DvhCurve[] {
  const all = displaySetService?.getActiveDisplaySets?.() ?? displaySetService?.activeDisplaySets ?? [];
  const rtstruct = all.find((ds: any) => ds?.Modality === 'RTSTRUCT');
  const rtstructInst = rtstruct ? instanceOf(rtstruct) : undefined;
  const roiMap = rtstructInst ? buildRoiNameMap(rtstructInst) : undefined;
  const colorMap = rtstructInst ? buildRoiColorMap(rtstructInst) : undefined;
  const curves: DvhCurve[] = [];
  for (const ds of all) {
    if (ds?.Modality !== 'RTDOSE') continue;
    const inst = instanceOf(ds);
    if (inst?.DVHSequence) {
      curves.push(...parseDvhFromInstance(inst, roiMap, colorMap));
    }
  }
  return curves;
}

const fmt = (v?: number) => (v == null ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(2));

function downloadBlob(content: string, type: string, filename: string): void {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function DvhPanel({ servicesManager }: DvhPanelProps): React.ReactElement {
  const { t } = useTranslation('RTMedical');
  const displaySetService = servicesManager?.services?.displaySetService;
  const [curves, setCurves] = useState<DvhCurve[]>(() => collectCurves(displaySetService));
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!displaySetService?.subscribe) return undefined;
    const resync = () => setCurves(collectCurves(displaySetService));
    resync();
    const events = displaySetService.EVENTS ?? {};
    const subs = [events.DISPLAY_SETS_ADDED, events.DISPLAY_SETS_CHANGED, events.DISPLAY_SETS_REMOVED]
      .filter(Boolean)
      .map((evt: string) => displaySetService.subscribe(evt, resync));
    return () => subs.forEach((s: any) => s?.unsubscribe?.());
  }, [displaySetService]);

  const chart = useMemo(() => buildDvhChart(curves), [curves]);

  const handleCsv = useCallback(() => {
    if (curves.length) downloadBlob(buildDvhCsv(curves), 'text/csv;charset=utf-8', 'dvh.csv');
  }, [curves]);
  const handleSvg = useCallback(() => {
    if (svgRef.current) {
      downloadBlob(new XMLSerializer().serializeToString(svgRef.current), 'image/svg+xml', 'dvh.svg');
    }
  }, []);

  if (!curves.length) {
    return (
      <div className="text-muted-foreground px-2 py-4 text-sm" data-cy="rt-dvh-panel">
        {t('dvh_none_found')}
      </div>
    );
  }

  return (
    <div className="ohif-scrollbar flex h-full flex-col text-white" data-cy="rt-dvh-panel">
      <div className="flex items-center justify-between px-2 py-2">
        <span className="text-base font-medium">{t('dvh_title', { count: curves.length })}</span>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={handleCsv}>CSV</Button>
          <Button variant="ghost" size="sm" onClick={handleSvg}>SVG</Button>
        </div>
      </div>

      <div className="px-2">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${chart.width} ${chart.height}`}
          className="w-full"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect x={0} y={0} width={chart.width} height={chart.height} fill="#1a1a1a" />
          {chart.volTicks.map((tick, i) => (
            <g key={`v${i}`}>
              <line x1={chart.pad} y1={tick.y} x2={chart.width - chart.pad} y2={tick.y} stroke="#333" />
              <text x={chart.pad - 4} y={tick.y + 3} fontSize={9} fill="#999" textAnchor="end">{tick.value}</text>
            </g>
          ))}
          {chart.doseTicks.map((tick, i) => (
            <text key={`d${i}`} x={tick.x} y={chart.height - chart.pad + 12} fontSize={9} fill="#999" textAnchor="middle">{tick.value}</text>
          ))}
          <text x={chart.width / 2} y={chart.height - 4} fontSize={10} fill="#bbb" textAnchor="middle">{t('dvh_axis_dose')}</text>
          <text x={10} y={chart.height / 2} fontSize={10} fill="#bbb" textAnchor="middle" transform={`rotate(-90 10 ${chart.height / 2})`}>{t('dvh_axis_volume')}</text>
          {chart.series.map((s, i) => (
            <polyline key={i} points={s.polyline} fill="none" stroke={s.color} strokeWidth={1.5} />
          ))}
        </svg>
      </div>

      <div className="flex-1 overflow-auto px-2 pb-3 pt-2 text-sm">
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-muted-foreground text-left">
              <th className="py-1">{t('dvh_col_structure')}</th>
              <th className="text-right">{t('dvh_col_mean')}</th>
              <th className="text-right">{t('dvh_col_max')}</th>
            </tr>
          </thead>
          <tbody>
            {curves.map((c, i) => (
              <tr key={i} className="border-t border-white/10">
                <td className="py-1">
                  <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: chart.series[i]?.color }} />
                  {c.roiName || (c.roiNumber != null ? t('dvh_roi_label', { n: c.roiNumber }) : t('dvh_curve_label', { n: i + 1 }))}
                </td>
                <td className="text-right">{fmt(c.meanDose)}</td>
                <td className="text-right">{fmt(c.maxDose)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default DvhPanel;
