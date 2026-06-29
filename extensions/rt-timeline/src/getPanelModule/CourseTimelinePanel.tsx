/**
 * Course Timeline right-panel (RTV-164) hosting the prescription (RTV-165) and
 * treatment (RTV-166) sub-timelines.
 *
 * Reads the parsed models the sibling extensions attach to their display sets
 * (`rtPlan` from `@ohif/extension-rt-plan`, `rtRecord` from
 * `@ohif/extension-rt-record`), builds the course model with the pure
 * {@link ../courseTimeline} transform, and renders it. RTV-114: `@ohif/ui-next`
 * only; no cross-extension imports (models are duck-typed).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { buildCourseTimeline, RtPlanLike, RtRecordLike } from '../courseTimeline';

interface ServicesManagerLike {
  services: Record<string, any>;
}
export interface CourseTimelinePanelProps {
  servicesManager: ServicesManagerLike;
}

function collect(displaySetService: any): { plans: RtPlanLike[]; records: RtRecordLike[] } {
  const all = displaySetService?.getActiveDisplaySets?.() ?? displaySetService?.activeDisplaySets ?? [];
  const plans: RtPlanLike[] = [];
  const records: RtRecordLike[] = [];
  for (const ds of all as any[]) {
    if (ds?.rtPlan) plans.push(ds.rtPlan);
    if (ds?.rtRecord) records.push(ds.rtRecord);
  }
  return { plans, records };
}

const fmtDate = (d?: string) => (d && d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d || '—');
const num = (v?: number, d = 1) => (v == null ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(d));

export function CourseTimelinePanel({ servicesManager }: CourseTimelinePanelProps): React.ReactElement {
  const displaySetService = servicesManager?.services?.displaySetService;
  const [data, setData] = useState(() => collect(displaySetService));

  useEffect(() => {
    if (!displaySetService?.subscribe) return undefined;
    const resync = () => setData(collect(displaySetService));
    resync();
    const events = displaySetService.EVENTS ?? {};
    const subs = [events.DISPLAY_SETS_ADDED, events.DISPLAY_SETS_CHANGED, events.DISPLAY_SETS_REMOVED]
      .filter(Boolean)
      .map((e: string) => displaySetService.subscribe(e, resync));
    return () => subs.forEach((s: any) => s?.unsubscribe?.());
  }, [displaySetService]);

  const timeline = useMemo(() => buildCourseTimeline(data.plans, data.records), [data]);

  if (!timeline.prescription.length && !timeline.treatment.length) {
    return (
      <div className="text-muted-foreground px-2 py-4 text-sm" data-cy="rt-timeline-panel">
        No RT plan or treatment record loaded.
      </div>
    );
  }

  const { summary } = timeline;
  return (
    <div className="ohif-scrollbar flex h-full flex-col overflow-auto px-2 py-2 text-sm text-white" data-cy="rt-timeline-panel">
      <span className="mb-1 text-base font-medium">Course Timeline</span>
      <div className="text-muted-foreground mb-3 text-xs">
        {summary.plans} plan(s) · {summary.sessions} session(s)
        {summary.totalDeliveredMeterset != null ? ` · ${num(summary.totalDeliveredMeterset)} MU delivered` : ''}
        {summary.firstTreatmentDate ? ` · ${fmtDate(summary.firstTreatmentDate)} → ${fmtDate(summary.lastTreatmentDate)}` : ''}
      </div>

      {timeline.prescription.length > 0 && (
        <>
          <div className="mb-1 font-medium">Prescription</div>
          <table className="mb-3 w-full border-collapse">
            <thead>
              <tr className="text-muted-foreground text-left">
                <th className="py-1">Phase</th>
                <th className="text-right">Fx</th>
                <th className="text-right">Gy/fx</th>
                <th className="text-right">Total</th>
                <th>Energy</th>
              </tr>
            </thead>
            <tbody>
              {timeline.prescription.map((p, i) => (
                <tr key={i} className="border-t border-white/10">
                  <td className="py-1">{p.phase}</td>
                  <td className="text-right">{p.fractions ?? '—'}</td>
                  <td className="text-right">{num(p.dosePerFractionGy)}</td>
                  <td className="text-right">{num(p.totalDoseGy)}</td>
                  <td>{p.energy || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {timeline.treatment.length > 0 && (
        <>
          <div className="mb-1 font-medium">Treatment</div>
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-muted-foreground text-left">
                <th className="py-1">Date</th>
                <th className="text-right">Fx</th>
                <th className="text-right">Beams</th>
                <th className="text-right">MU</th>
              </tr>
            </thead>
            <tbody>
              {timeline.treatment.map((t, i) => (
                <tr key={i} className="border-t border-white/10">
                  <td className="py-1">{fmtDate(t.date)}</td>
                  <td className="text-right">{t.fraction ?? '—'}</td>
                  <td className="text-right">{t.beams}</td>
                  <td className="text-right">{num(t.deliveredMeterset)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

export default CourseTimelinePanel;
