/**
 * Radiation Dose Report panel (RTV-201) — per-acquisition CTDIvol/DLP/kVp,
 * accumulated totals, optional DRL comparison and CSV export, over the tested
 * {@link ../rdsrParser}. Reads RDSR display sets from the DisplaySetService.
 * RTV-114: `@ohif/ui-next` only, no `@ohif/core`. Cross-PACS dose history is a
 * follow-up. DRL thresholds are configurable; a conservative default is shown.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@ohif/ui-next';
import {
  parseRadiationDoseReport,
  compareToDrl,
  buildDoseReportCsv,
  DoseReport,
  DrlThresholds,
} from '../rdsrParser';

interface ServicesManagerLike {
  services: Record<string, any>;
}
export interface DoseReportPanelProps {
  servicesManager: ServicesManagerLike;
  /** Diagnostic Reference Levels; conservative CT defaults if unset. */
  drl?: DrlThresholds;
}

const DEFAULT_DRL: DrlThresholds = { dlp: 1000, ctdiVol: 20 };
const instanceOf = (ds: any) => ds?.instances?.[0] ?? ds?.instance ?? ds;
const num = (v?: number) => (v == null ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(1));

interface ReportItem {
  displaySetInstanceUID: string;
  label?: string;
  report: DoseReport;
}

function readReports(displaySetService: any): ReportItem[] {
  const all = displaySetService?.getActiveDisplaySets?.() ?? displaySetService?.activeDisplaySets ?? [];
  return (all as any[])
    .filter(ds => ds?.doseReport || ds?.SOPClassHandlerId === '@ohif/extension-dose-tracking.sopClassHandlerModule.radiationDoseSr')
    .map(ds => ({
      displaySetInstanceUID: ds.displaySetInstanceUID,
      label: ds.label || ds.SeriesDescription,
      report: ds.doseReport ?? parseRadiationDoseReport(instanceOf(ds)),
    }));
}

function downloadCsv(report: DoseReport, name: string): void {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(new Blob([buildDoseReportCsv(report)], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name || 'dose-report'}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function DoseReportPanel({ servicesManager, drl = DEFAULT_DRL }: DoseReportPanelProps): React.ReactElement {
  const displaySetService = servicesManager?.services?.displaySetService;
  const [items, setItems] = useState<ReportItem[]>(() => readReports(displaySetService));

  useEffect(() => {
    if (!displaySetService?.subscribe) return undefined;
    const resync = () => setItems(readReports(displaySetService));
    resync();
    const events = displaySetService.EVENTS ?? {};
    const subs = [events.DISPLAY_SETS_ADDED, events.DISPLAY_SETS_CHANGED, events.DISPLAY_SETS_REMOVED]
      .filter(Boolean)
      .map((e: string) => displaySetService.subscribe(e, resync));
    return () => subs.forEach((s: any) => s?.unsubscribe?.());
  }, [displaySetService]);

  const totalDlp = useMemo(() => items.reduce((s, i) => s + (i.report.totalDlp ?? 0), 0), [items]);

  if (!items.length) {
    return (
      <div className="text-muted-foreground px-2 py-4 text-sm" data-cy="dose-report-panel">
        No radiation dose reports (RDSR) loaded.
      </div>
    );
  }

  return (
    <div className="ohif-scrollbar flex h-full flex-col text-white" data-cy="dose-report-panel">
      <div className="flex items-center justify-between px-2 py-2">
        <span className="text-base font-medium">Dose Report ({items.length})</span>
        <span className="text-muted-foreground text-xs">Σ DLP {num(totalDlp)} mGy·cm</span>
      </div>

      <div className="flex-1 overflow-auto px-2 pb-3 text-sm">
        {items.map((item, i) => {
          const drlCmp = compareToDrl(item.report, drl);
          return (
            <div key={item.displaySetInstanceUID} className="mb-3 border-t border-white/10 pt-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-medium">{item.label || `RDSR ${i + 1}`}</span>
                <Button variant="ghost" size="sm" onClick={() => downloadCsv(item.report, item.label || `dose-${i + 1}`)}>
                  CSV
                </Button>
              </div>
              <table className="w-full border-collapse">
                <thead>
                  <tr className="text-muted-foreground text-left">
                    <th className="py-0.5">Acquisition</th>
                    <th className="text-right">CTDIvol</th>
                    <th className="text-right">DLP</th>
                    <th className="text-right">kVp</th>
                  </tr>
                </thead>
                <tbody>
                  {item.report.events.map((e, j) => (
                    <tr key={j}>
                      <td className="py-0.5">{e.label}</td>
                      <td className="text-right">{num(e.ctdiVol)}</td>
                      <td className="text-right">{num(e.dlp)}</td>
                      <td className="text-right">{num(e.kvp)}</td>
                    </tr>
                  ))}
                  <tr className="font-medium">
                    <td className="py-0.5">Total</td>
                    <td className="text-right">{num(item.report.totalCtdiVol)}</td>
                    <td className="text-right">{num(item.report.totalDlp)}</td>
                    <td className="text-right">—</td>
                  </tr>
                </tbody>
              </table>
              {drlCmp.map(c => (
                <div
                  key={c.metric}
                  className={`mt-1 text-xs ${c.exceeds ? 'text-red-400' : 'text-muted-foreground'}`}
                >
                  {c.exceeds ? '⚠' : '✓'} {c.metric} {num(c.value)} vs DRL {num(c.threshold)} (
                  {(c.ratio * 100).toFixed(0)}%)
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default DoseReportPanel;
