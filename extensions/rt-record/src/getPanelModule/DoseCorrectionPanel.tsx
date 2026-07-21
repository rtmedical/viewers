/**
 * Dose Correction Details panel (RTV-173, epic RTV-162) — the DICOM-derivable
 * parameter corrections/overrides of the loaded RT Treatment Records, one row
 * per event: type, beam, value/detail and operator. Reuses the tested
 * {@link ../overrideEvents} collector (RTV-168) over the per-beam
 * CorrectedParameterSequence (3008,0068) / OverrideSequence (3008,0060) /
 * TreatmentVerificationStatus (3008,002C) data. RTV-114: no `@ohif/core`.
 *
 * HONEST LIMIT — manual chart *dose* corrections (the values a physicist types
 * into the patient chart) are RIS/ARIA data, NOT part of the DICOM RT Treatment
 * Record; {@link ../doseSummary} already treats them as an explicit external
 * input. This panel lists only what the DICOM object itself carries; the
 * RIS-side corrections arrive with the backend integration (RTV-169).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseRtRecord, RtRecord } from '../rtRecordParser';
import { collectOverrideEvents, OverrideEvent } from '../overrideEvents';

interface ServicesManagerLike {
  services: Record<string, any>;
}
export interface DoseCorrectionPanelProps {
  servicesManager: ServicesManagerLike;
}

const instanceOf = (ds: any) => ds?.instances?.[0] ?? ds?.instance ?? ds;
const fmtDate = (d?: string) =>
  d && d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d || '—';

function readRecords(displaySetService: any): RtRecord[] {
  const all =
    displaySetService?.getActiveDisplaySets?.() ?? displaySetService?.activeDisplaySets ?? [];
  return (all as any[])
    .filter(ds => ds?.Modality === 'RTRECORD' || ds?.rtRecord)
    .map(ds => ds.rtRecord ?? parseRtRecord(instanceOf(ds)));
}

/** OverrideEventType → i18n suffix ('machine-override' → 'dc_type_machine_override'). */
const typeKey = (type: OverrideEvent['type']) => `dc_type_${type.replace(/-/g, '_')}`;

export function DoseCorrectionPanel({
  servicesManager,
}: DoseCorrectionPanelProps): React.ReactElement {
  const { t } = useTranslation('RTMedical');
  const displaySetService = servicesManager?.services?.displaySetService;
  const [records, setRecords] = useState<RtRecord[]>(() => readRecords(displaySetService));

  useEffect(() => {
    if (!displaySetService?.subscribe) {
      return undefined;
    }
    const resync = () => setRecords(readRecords(displaySetService));
    resync();
    const events = displaySetService.EVENTS ?? {};
    const subs = [events.DISPLAY_SETS_ADDED, events.DISPLAY_SETS_CHANGED, events.DISPLAY_SETS_REMOVED]
      .filter(Boolean)
      .map((e: string) => displaySetService.subscribe(e, resync));
    return () => subs.forEach((s: any) => s?.unsubscribe?.());
  }, [displaySetService]);

  const events = useMemo(
    () =>
      records
        .flatMap(r => collectOverrideEvents(r))
        // newest first when dated (record-level TreatmentDate)
        .sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    [records]
  );

  if (!records.length) {
    return (
      <div className="text-muted-foreground px-2 py-4 text-sm" data-cy="rt-dose-correction-panel">
        {t('dc_no_records')}
      </div>
    );
  }

  return (
    <div className="ohif-scrollbar flex h-full flex-col text-white" data-cy="rt-dose-correction-panel">
      <div className="px-2 py-2">
        <span className="text-base font-medium">{t('dc_title')}</span>
      </div>

      <div className="flex-1 overflow-auto px-2 pb-2 text-sm">
        {events.length ? (
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-muted-foreground text-left text-xs">
                <th className="py-0.5">{t('dc_header_date')}</th>
                <th>{t('dc_header_type')}</th>
                <th className="text-right">{t('dc_header_beam')}</th>
                <th>{t('dc_header_detail')}</th>
                <th>{t('dc_header_operator')}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e, i) => (
                <tr key={i} data-cy="rt-dc-event-row" className="border-t border-white/5">
                  <td className="py-0.5 whitespace-nowrap">{fmtDate(e.date)}</td>
                  <td>{t(typeKey(e.type))}</td>
                  <td className="text-right">{e.beamNumber ?? '—'}</td>
                  <td className="text-muted-foreground text-xs">{e.detail || '—'}</td>
                  <td>{e.operator || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-muted-foreground text-xs" data-cy="rt-dc-empty">
            {t('dc_no_events')}
          </div>
        )}
      </div>

      <div className="text-muted-foreground border-t border-white/10 px-2 py-1 text-xs">
        {t('dc_footer')}
      </div>
    </div>
  );
}

export default DoseCorrectionPanel;
