/**
 * RT Treatment Record summary right-panel (RTV-163) — the first slice of the
 * Course Timeline (epic RTV-162).
 *
 * Read-only delivery summary over the pure {@link ../rtRecordParser}: lists RT
 * Treatment Record display sets (one per session), shows delivered vs specified
 * MU per beam, fraction, date and machine, with CSV export. RTV-114:
 * `@ohif/ui-next` only. Rich timelines (RTV-164+) are separate tickets.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ohif/ui-next';
import { parseRtRecord, buildRtRecordCsv, RtRecord } from '../rtRecordParser';

interface ServicesManagerLike {
  services: Record<string, any>;
}
export interface RtRecordPanelProps {
  servicesManager: ServicesManagerLike;
}

const instanceOf = (ds: any) => ds?.instances?.[0] ?? ds?.instance ?? ds;

interface RtRecordItem {
  displaySetInstanceUID: string;
  label?: string;
  rtRecord: RtRecord;
}

function readRecords(displaySetService: any): RtRecordItem[] {
  const all = displaySetService?.getActiveDisplaySets?.() ?? displaySetService?.activeDisplaySets ?? [];
  return (all as any[])
    .filter(ds => ds?.Modality === 'RTRECORD' || ds?.rtRecord)
    .map(ds => ({
      displaySetInstanceUID: ds.displaySetInstanceUID,
      label: ds.label || ds.SeriesDescription,
      rtRecord: ds.rtRecord ?? parseRtRecord(instanceOf(ds)),
    }))
    // newest first when a treatment date is present
    .sort((a, b) => (b.rtRecord.treatmentDate || '').localeCompare(a.rtRecord.treatmentDate || ''));
}

const fmtDate = (d?: string) => (d && d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d || '—');
const num = (v?: number) => (v == null ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(1));

function downloadCsv(record: RtRecord, name: string): void {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(new Blob([buildRtRecordCsv(record)], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name || 'rt-record'}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function RtRecordPanel({ servicesManager }: RtRecordPanelProps): React.ReactElement {
  const { t } = useTranslation('RTMedical');
  const displaySetService = servicesManager?.services?.displaySetService;
  const [items, setItems] = useState<RtRecordItem[]>(() => readRecords(displaySetService));

  useEffect(() => {
    if (!displaySetService?.subscribe) return undefined;
    const resync = () => setItems(readRecords(displaySetService));
    resync();
    const events = displaySetService.EVENTS ?? {};
    const subs = [events.DISPLAY_SETS_ADDED, events.DISPLAY_SETS_CHANGED, events.DISPLAY_SETS_REMOVED]
      .filter(Boolean)
      .map((e: string) => displaySetService.subscribe(e, resync));
    return () => subs.forEach((s: any) => s?.unsubscribe?.());
  }, [displaySetService]);

  const totalDelivered = useMemo(
    () => items.reduce((sum, i) => sum + (i.rtRecord.totalDeliveredMeterset ?? 0), 0),
    [items]
  );

  const handleCsvAll = useCallback(() => {
    items.forEach((i, idx) => downloadCsv(i.rtRecord, `${i.label || 'rt-record'}-${idx + 1}`));
  }, [items]);

  if (!items.length) {
    return (
      <div className="text-muted-foreground px-2 py-4 text-sm" data-cy="rt-record-panel">
        {t('rec_no_records')}
      </div>
    );
  }

  return (
    <div className="ohif-scrollbar flex h-full flex-col text-white" data-cy="rt-record-panel">
      <div className="flex items-center justify-between px-2 py-2">
        <span className="text-base font-medium">{t('rec_title', { count: items.length })}</span>
        <Button variant="ghost" size="sm" onClick={handleCsvAll}>CSV</Button>
      </div>
      <div className="text-muted-foreground px-2 pb-2 text-xs">
        {t('rec_total_delivered', { mu: num(totalDelivered) })}
      </div>

      <div className="flex-1 overflow-auto px-2 pb-3 text-sm">
        {items.map((item, i) => {
          const r = item.rtRecord;
          return (
            <div key={item.displaySetInstanceUID} className="mb-3 border-t border-white/10 pt-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-medium">{fmtDate(r.treatmentDate)}</span>
                <span className="text-muted-foreground text-xs">
                  {r.recordType}{r.fractionNumber != null ? ` · fx ${r.fractionNumber}` : ''}{r.machine ? ` · ${r.machine}` : ''}
                </span>
              </div>
              {r.sessions.length > 0 ? (
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="text-muted-foreground text-left">
                      <th className="py-0.5">{t('rec_header_beam')}</th>
                      <th className="text-right">{t('rec_header_spec_mu')}</th>
                      <th className="text-right">{t('rec_header_deliv_mu')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.sessions.map((s, j) => (
                      <tr key={j}>
                        <td className="py-0.5">{s.beamName || (s.beamNumber != null ? `#${s.beamNumber}` : '—')}</td>
                        <td className="text-right">{num(s.specifiedMeterset)}</td>
                        <td className="text-right">{num(s.deliveredMeterset)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="text-muted-foreground text-xs">{t('rec_no_sessions')}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default RtRecordPanel;
