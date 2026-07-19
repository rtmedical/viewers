/**
 * Dose Information panel (RTV-170, epic RTV-162) — session detail (left) + dose
 * summary by counters (right) over the tested {@link ../doseSummary} model.
 * Reads RT Treatment Record display sets from the DisplaySetService. RTV-114:
 * `@ohif/ui-next` only, no `@ohif/core`. Click-from-timeline wiring + manual
 * dose-corrections input are follow-ups (RIS/backend).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseRtRecord, RtRecord } from '../rtRecordParser';
import { buildSessionDoseRows, buildDoseCounters } from '../doseSummary';

interface ServicesManagerLike {
  services: Record<string, any>;
}
export interface DoseInformationPanelProps {
  servicesManager: ServicesManagerLike;
}

const instanceOf = (ds: any) => ds?.instances?.[0] ?? ds?.instance ?? ds;
const num = (v?: number) => (v == null ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(1));

function readRecords(displaySetService: any): RtRecord[] {
  const all = displaySetService?.getActiveDisplaySets?.() ?? displaySetService?.activeDisplaySets ?? [];
  return (all as any[])
    .filter(ds => ds?.Modality === 'RTRECORD' || ds?.rtRecord)
    .map(ds => ds.rtRecord ?? parseRtRecord(instanceOf(ds)));
}

export function DoseInformationPanel({ servicesManager }: DoseInformationPanelProps): React.ReactElement {
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

  const rows = useMemo(() => buildSessionDoseRows(records), [records]);
  const counters = useMemo(() => buildDoseCounters(records), [records]);

  if (!records.length) {
    return (
      <div className="text-muted-foreground px-2 py-4 text-sm" data-cy="rt-dose-info-panel">
        {t('rec_no_records')}
      </div>
    );
  }

  const counterRows: Array<[string, number]> = [
    [t('rec_counter_delivered_from_fractions'), counters.deliveredFromFractions],
    [t('rec_counter_total_corrections'), counters.totalCorrections],
    [t('rec_counter_delivered_to_date'), counters.deliveredToDate],
    [t('rec_counter_dose_to_be_recorded'), counters.doseToBeRecorded],
  ];

  return (
    <div className="ohif-scrollbar flex h-full flex-col text-white" data-cy="rt-dose-info-panel">
      <div className="flex items-center justify-between px-2 py-2">
        <span className="text-base font-medium">{t('rec_dose_information')}</span>
        {counters.hasMuRounding && (
          <span
            className="text-muted-foreground text-xs"
            title={t('rec_mu_rounding_tooltip')}
          >
            {t('rec_mu_rounding_label')}
          </span>
        )}
      </div>

      <div className="grid flex-1 grid-cols-2 gap-2 overflow-auto px-2 pb-2 text-sm">
        <div>
          <div className="text-muted-foreground mb-1 text-xs uppercase">{t('rec_session_detail')}</div>
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-muted-foreground text-left">
                <th className="py-0.5">{t('rec_header_field')}</th>
                <th className="text-right">Fx</th>
                <th className="text-right">{t('rec_header_spec_mu')}</th>
                <th className="text-right">{t('rec_header_deliv_mu')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="py-0.5">
                    {r.field}
                    {r.muRounded && <span title={t('rec_mu_rounded_title')}> *</span>}
                  </td>
                  <td className="text-right">{r.fraction ?? '—'}</td>
                  <td className="text-right">{num(r.specifiedMU)}</td>
                  <td className="text-right">{num(r.deliveredMU)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <div className="text-muted-foreground mb-1 text-xs uppercase">{t('rec_dose_summary')}</div>
          <table className="w-full border-collapse">
            <tbody>
              {counterRows.map(([label, value]) => (
                <tr key={label}>
                  <td className="py-0.5">{label}</td>
                  <td className="text-right">{num(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="text-muted-foreground border-t border-white/10 px-2 py-1 text-xs">
        {t('rec_dose_corrections_footer')}
      </div>
    </div>
  );
}

export default DoseInformationPanel;
