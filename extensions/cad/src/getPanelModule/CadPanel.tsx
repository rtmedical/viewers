/**
 * CAD findings right-panel (RTV-79): lists CAD SR findings (type, probability,
 * region) from loaded Mammography/Chest CAD SR objects.
 *
 * Pure parse from {@link ../cadSr}. Drawing the finding markers as an overlay on
 * the image is a cornerstone-viewport follow-up. RTV-114: `@ohif/ui-next` only.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { parseCadSr, CadFinding } from '../cadSr';

interface ServicesManagerLike {
  services: Record<string, any>;
}
export interface CadPanelProps {
  servicesManager: ServicesManagerLike;
}

const instanceOf = (ds: any) => ds?.instances?.[0] ?? ds?.instance ?? ds;

interface CadItem {
  displaySetInstanceUID: string;
  label?: string;
  findings: CadFinding[];
}

function readCad(displaySetService: any): CadItem[] {
  const all = displaySetService?.getActiveDisplaySets?.() ?? displaySetService?.activeDisplaySets ?? [];
  return (all as any[])
    .filter(ds => ds?.cadSr || ds?.SOPClassHandlerId === '@ohif/extension-cad.sopClassHandlerModule.cadSr')
    .map(ds => ({
      displaySetInstanceUID: ds.displaySetInstanceUID,
      label: ds.label || ds.SeriesDescription,
      findings: (ds.cadSr ?? parseCadSr(instanceOf(ds))).findings,
    }))
    .filter(i => i.findings.length);
}

const pct = (p?: number) => (p == null ? '—' : p <= 1 ? `${Math.round(p * 100)}%` : `${p}`);

export function CadPanel({ servicesManager }: CadPanelProps): React.ReactElement {
  const displaySetService = servicesManager?.services?.displaySetService;
  const [items, setItems] = useState<CadItem[]>(() => readCad(displaySetService));

  useEffect(() => {
    if (!displaySetService?.subscribe) return undefined;
    const resync = () => setItems(readCad(displaySetService));
    resync();
    const events = displaySetService.EVENTS ?? {};
    const subs = [events.DISPLAY_SETS_ADDED, events.DISPLAY_SETS_CHANGED, events.DISPLAY_SETS_REMOVED]
      .filter(Boolean)
      .map((e: string) => displaySetService.subscribe(e, resync));
    return () => subs.forEach((s: any) => s?.unsubscribe?.());
  }, [displaySetService]);

  const total = useMemo(() => items.reduce((n, i) => n + i.findings.length, 0), [items]);

  if (!total) {
    return (
      <div className="text-muted-foreground px-2 py-4 text-sm" data-cy="cad-panel">
        No CAD SR findings loaded.
      </div>
    );
  }

  return (
    <div className="ohif-scrollbar flex h-full flex-col overflow-auto px-2 py-2 text-sm text-white" data-cy="cad-panel">
      <span className="mb-2 text-base font-medium">CAD Findings ({total})</span>
      {items.map(item => (
        <div key={item.displaySetInstanceUID} className="mb-3">
          {items.length > 1 && <div className="text-muted-foreground mb-1 text-xs">{item.label}</div>}
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-muted-foreground text-left">
                <th className="py-1">Finding</th>
                <th>Region</th>
                <th className="text-right">Prob.</th>
              </tr>
            </thead>
            <tbody>
              {item.findings.map((f, i) => (
                <tr key={i} className="border-t border-white/10">
                  <td className="py-1">{f.type || f.codeValue || '—'}</td>
                  <td>{f.graphicType || '—'}</td>
                  <td className="text-right">{pct(f.probability)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <p className="text-muted-foreground mt-1 text-xs">
        Drawing finding markers as an image overlay is a viewport follow-up.
      </p>
    </div>
  );
}

export default CadPanel;
