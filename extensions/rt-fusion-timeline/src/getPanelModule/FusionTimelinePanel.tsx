/**
 * Fusion Timeline right-panel (RTV-135): registration displacement over the
 * course, as an SVG chart + table.
 *
 * Pure model/geometry from {@link ../fusionTimeline}. Points are extracted from
 * loaded Spatial Registration Objects (Modality REG) when present. The legacy
 * per-fraction displacement *history* came from a backend fusion store — wiring
 * that is a follow-up. RTV-114: `@ohif/ui-next` only.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  parseRegistrationTranslation,
  buildFusionTimeline,
  buildFusionChart,
  FUSION_SERIES,
  FusionPointInput,
} from '../fusionTimeline';

interface ServicesManagerLike {
  services: Record<string, any>;
}
export interface FusionTimelinePanelProps {
  servicesManager: ServicesManagerLike;
}

const instanceOf = (ds: any) => ds?.instances?.[0] ?? ds?.instance ?? ds;

function toArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}
function toNumberArray(v: unknown): number[] {
  if (Array.isArray(v)) return v.map(Number).filter(n => Number.isFinite(n));
  if (typeof v === 'string') return v.split('\\').map(Number).filter(n => Number.isFinite(n));
  return [];
}

/** Pull a 4×4 transform matrix out of a naturalized REG instance. */
function matrixFromRegInstance(inst: Record<string, any>): number[] | undefined {
  for (const reg of toArray(inst?.RegistrationSequence)) {
    for (const mr of toArray((reg as any)?.MatrixRegistrationSequence)) {
      for (const m of toArray((mr as any)?.MatrixSequence)) {
        const mat = toNumberArray((m as any)?.FrameOfReferenceTransformationMatrix);
        if (mat.length >= 12) return mat;
      }
    }
  }
  return undefined;
}

function extractPoints(displaySetService: any): FusionPointInput[] {
  const all = displaySetService?.getActiveDisplaySets?.() ?? displaySetService?.activeDisplaySets ?? [];
  const points: FusionPointInput[] = [];
  let idx = 0;
  for (const ds of all as any[]) {
    if ((ds?.Modality || '').toUpperCase() !== 'REG') continue;
    const inst = instanceOf(ds);
    const mat = matrixFromRegInstance(inst);
    if (!mat) continue;
    const t = parseRegistrationTranslation(mat);
    const label = ds.SeriesDate || ds.SeriesNumber?.toString() || ds.SeriesDescription || `REG ${++idx}`;
    points.push({ label: String(label), ...t });
  }
  return points;
}

const fmt = (v?: number) => (v == null ? '—' : v.toFixed(2));

export function FusionTimelinePanel({ servicesManager }: FusionTimelinePanelProps): React.ReactElement {
  const displaySetService = servicesManager?.services?.displaySetService;
  const [points, setPoints] = useState<FusionPointInput[]>(() => extractPoints(displaySetService));

  useEffect(() => {
    if (!displaySetService?.subscribe) return undefined;
    const resync = () => setPoints(extractPoints(displaySetService));
    resync();
    const events = displaySetService.EVENTS ?? {};
    const subs = [events.DISPLAY_SETS_ADDED, events.DISPLAY_SETS_CHANGED, events.DISPLAY_SETS_REMOVED]
      .filter(Boolean)
      .map((e: string) => displaySetService.subscribe(e, resync));
    return () => subs.forEach((s: any) => s?.unsubscribe?.());
  }, [displaySetService]);

  const timeline = useMemo(() => buildFusionTimeline(points), [points]);
  const chart = useMemo(() => buildFusionChart(timeline), [timeline]);

  if (!timeline.points.length) {
    return (
      <div className="text-muted-foreground px-2 py-4 text-sm" data-cy="rt-fusion-timeline-panel">
        No registration (REG) objects loaded. Per-fraction displacement history
        (fusion store) is a backend follow-up.
      </div>
    );
  }

  return (
    <div className="ohif-scrollbar flex h-full flex-col overflow-auto px-2 py-2 text-sm text-white" data-cy="rt-fusion-timeline-panel">
      <span className="mb-1 text-base font-medium">Fusion Timeline</span>
      <div className="text-muted-foreground mb-2 text-xs">
        {timeline.summary.count} registration(s) · max |d| {fmt(timeline.summary.maxMagnitudeMm)} mm · mean {fmt(timeline.summary.meanMagnitudeMm)} mm
      </div>

      <svg viewBox={`0 0 ${chart.width} ${chart.height}`} className="w-full" xmlns="http://www.w3.org/2000/svg">
        <rect x={0} y={0} width={chart.width} height={chart.height} fill="#1a1a1a" />
        <line x1={chart.pad} y1={chart.zeroY} x2={chart.width - chart.pad} y2={chart.zeroY} stroke="#444" strokeDasharray="3 3" />
        {chart.series.map((s, i) => (
          <polyline key={i} points={s.polyline} fill="none" stroke={s.color} strokeWidth={1.5} />
        ))}
      </svg>
      <div className="mb-2 flex gap-3 text-xs">
        {FUSION_SERIES.map(s => (
          <span key={s.key} className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />{s.label}
          </span>
        ))}
        <span className="text-muted-foreground">(mm)</span>
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr className="text-muted-foreground text-left">
            <th className="py-1">Reg</th>
            <th className="text-right">X</th>
            <th className="text-right">Y</th>
            <th className="text-right">Z</th>
            <th className="text-right">|d|</th>
          </tr>
        </thead>
        <tbody>
          {timeline.points.map((p, i) => (
            <tr key={i} className="border-t border-white/10">
              <td className="py-1">{p.label}</td>
              <td className="text-right">{fmt(p.tx)}</td>
              <td className="text-right">{fmt(p.ty)}</td>
              <td className="text-right">{fmt(p.tz)}</td>
              <td className="text-right">{fmt(p.magnitudeMm)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default FusionTimelinePanel;
