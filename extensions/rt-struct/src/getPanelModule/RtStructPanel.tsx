/**
 * RT Structure Set summary right-panel (RTV-146).
 *
 * Read-only structures table over the pure {@link ../rtStructParser}. Reads
 * RTSTRUCT display sets from the DisplaySetService (the cornerstone extension's
 * SopClassHandler already creates them), parses the structure summary and renders
 * name / color / interpreted type / contour count / approximate volume, with CSV
 * export. RTV-114: `@ohif/ui-next` only. The contour *editor* is a follow-up.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@ohif/ui-next';
import { parseRtStruct, buildRtStructCsv, rgbToHex, RtStruct } from '../rtStructParser';

interface ServicesManagerLike {
  services: Record<string, any>;
}
export interface RtStructPanelProps {
  servicesManager: ServicesManagerLike;
}

const instanceOf = (ds: any) => ds?.instances?.[0] ?? ds?.instance ?? ds;

interface RtStructDisplaySet {
  displaySetInstanceUID: string;
  SeriesDescription?: string;
  rtStruct: RtStruct;
}

function readRtStructs(displaySetService: any): RtStructDisplaySet[] {
  const all = displaySetService?.getActiveDisplaySets?.() ?? displaySetService?.activeDisplaySets ?? [];
  return (all as any[])
    .filter(ds => ds?.Modality === 'RTSTRUCT')
    .map(ds => ({
      displaySetInstanceUID: ds.displaySetInstanceUID,
      SeriesDescription: ds.SeriesDescription,
      rtStruct: parseRtStruct(instanceOf(ds)),
    }))
    .filter(ds => ds.rtStruct.structures.length);
}

function downloadCsv(rtStruct: RtStruct, name: string): void {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(new Blob([buildRtStructCsv(rtStruct)], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name || 'rtstruct'}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function RtStructPanel({ servicesManager }: RtStructPanelProps): React.ReactElement {
  const displaySetService = servicesManager?.services?.displaySetService;
  const [items, setItems] = useState<RtStructDisplaySet[]>(() => readRtStructs(displaySetService));
  const [selectedUID, setSelectedUID] = useState<string | undefined>(() => readRtStructs(displaySetService)[0]?.displaySetInstanceUID);

  useEffect(() => {
    if (!displaySetService?.subscribe) return undefined;
    const resync = () => setItems(readRtStructs(displaySetService));
    resync();
    const events = displaySetService.EVENTS ?? {};
    const subs = [events.DISPLAY_SETS_ADDED, events.DISPLAY_SETS_CHANGED, events.DISPLAY_SETS_REMOVED]
      .filter(Boolean)
      .map((e: string) => displaySetService.subscribe(e, resync));
    return () => subs.forEach((s: any) => s?.unsubscribe?.());
  }, [displaySetService]);

  const selected = useMemo(
    () => items.find(i => i.displaySetInstanceUID === selectedUID) ?? items[0],
    [items, selectedUID]
  );
  const rtStruct = selected?.rtStruct;

  const handleCsv = useCallback(() => {
    if (rtStruct) downloadCsv(rtStruct, selected?.SeriesDescription || rtStruct.label || 'rtstruct');
  }, [rtStruct, selected]);

  if (!rtStruct) {
    return (
      <div className="text-muted-foreground px-2 py-4 text-sm" data-cy="rt-struct-panel">
        No RT Structure Set loaded.
      </div>
    );
  }

  return (
    <div className="ohif-scrollbar flex h-full flex-col text-white" data-cy="rt-struct-panel">
      <div className="flex items-center justify-between px-2 py-2">
        <span className="text-base font-medium">Structures ({rtStruct.structures.length})</span>
        <Button variant="ghost" size="sm" onClick={handleCsv}>CSV</Button>
      </div>

      {items.length > 1 && (
        <select
          className="mx-2 mb-2 rounded bg-black/30 p-1 text-sm"
          value={selected?.displaySetInstanceUID}
          onChange={e => setSelectedUID(e.target.value)}
        >
          {items.map(i => (
            <option key={i.displaySetInstanceUID} value={i.displaySetInstanceUID}>
              {i.SeriesDescription || i.rtStruct.label || i.displaySetInstanceUID}
            </option>
          ))}
        </select>
      )}

      <div className="flex-1 overflow-auto px-2 pb-3 text-sm">
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-muted-foreground text-left">
              <th className="py-1">Structure</th>
              <th>Type</th>
              <th className="text-right">Vol (cc)</th>
            </tr>
          </thead>
          <tbody>
            {rtStruct.structures.map((s, i) => (
              <tr key={i} className="border-t border-white/10">
                <td className="py-1">
                  <span
                    className="mr-2 inline-block h-3 w-3 rounded-sm align-middle"
                    style={{ backgroundColor: rgbToHex(s.color) }}
                  />
                  {s.name || (s.roiNumber != null ? `ROI ${s.roiNumber}` : '—')}
                </td>
                <td>{s.interpretedType || '—'}</td>
                <td className="text-right">{s.approxVolumeCc != null ? s.approxVolumeCc.toFixed(1) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-muted-foreground mt-2 text-xs">
          Volume is a planar-contour approximation (Σ area × slice thickness).
        </p>
      </div>
    </div>
  );
}

export default RtStructPanel;
