/**
 * Treatment Details panel (RTV-173, epic RTV-162) — per-record delivery detail
 * over the tested {@link ../treatmentDetails} view model: record selector,
 * per-beam table (specified/delivered/Δ MU, termination + verification status,
 * override/correction counts) and MU totals. Reads RT Treatment Record display
 * sets from the DisplaySetService (same pattern as DoseInformationPanel).
 * RTV-114: no `@ohif/core`.
 *
 * HONEST LIMIT — clinical treatment "notes" (the Varian journal column) do NOT
 * exist in the DICOM RT Treatment Record; they live in the ARIA/RIS journal and
 * arrive only with the backend integration (RTV-169). This panel shows what the
 * DICOM object carries — no notes column on purpose.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseRtRecord, RtRecord } from '../rtRecordParser';
import { buildTreatmentDetails } from '../treatmentDetails';

interface ServicesManagerLike {
  services: Record<string, any>;
}
export interface TreatmentDetailsPanelProps {
  servicesManager: ServicesManagerLike;
}

interface RtRecordItem {
  displaySetInstanceUID: string;
  label?: string;
  rtRecord: RtRecord;
}

const instanceOf = (ds: any) => ds?.instances?.[0] ?? ds?.instance ?? ds;
const num = (v?: number) => (v == null ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(1));
const fmtDate = (d?: string) =>
  d && d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d || '—';
const fmtTime = (t?: string) =>
  t && t.length >= 6 ? `${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}` : t || '—';
const fmtDelta = (v?: number) => {
  if (v == null) return '—';
  const s = Number.isInteger(v) ? String(v) : v.toFixed(1);
  return v > 0 ? `+${s}` : s;
};

function readRecords(displaySetService: any): RtRecordItem[] {
  const all =
    displaySetService?.getActiveDisplaySets?.() ?? displaySetService?.activeDisplaySets ?? [];
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

const isVerifiedOvr = (s?: string) => String(s ?? '').trim().toUpperCase() === 'VERIFIED_OVR';
const isOperator = (s?: string) => String(s ?? '').trim().toUpperCase() === 'OPERATOR';

function StatusBadge({ text, title, tone }: { text: string; title: string; tone: 'amber' | 'red' }) {
  const cls =
    tone === 'amber'
      ? 'bg-amber-500/20 text-amber-400'
      : 'bg-red-500/20 text-red-400';
  return (
    <span className={`rounded px-1 py-0.5 text-[10px] font-medium ${cls}`} title={title}>
      {text}
    </span>
  );
}

export function TreatmentDetailsPanel({
  servicesManager,
}: TreatmentDetailsPanelProps): React.ReactElement {
  const { t } = useTranslation('RTMedical');
  const displaySetService = servicesManager?.services?.displaySetService;
  const [items, setItems] = useState<RtRecordItem[]>(() => readRecords(displaySetService));
  const [selectedUid, setSelectedUid] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!displaySetService?.subscribe) {
      return undefined;
    }
    const resync = () => setItems(readRecords(displaySetService));
    resync();
    const events = displaySetService.EVENTS ?? {};
    const subs = [events.DISPLAY_SETS_ADDED, events.DISPLAY_SETS_CHANGED, events.DISPLAY_SETS_REMOVED]
      .filter(Boolean)
      .map((e: string) => displaySetService.subscribe(e, resync));
    return () => subs.forEach((s: any) => s?.unsubscribe?.());
  }, [displaySetService]);

  const selected =
    items.find(i => i.displaySetInstanceUID === selectedUid) ?? items[0];
  const details = useMemo(
    () => buildTreatmentDetails(selected?.rtRecord),
    [selected]
  );

  if (!items.length) {
    return (
      <div className="text-muted-foreground px-2 py-4 text-sm" data-cy="rt-treatment-details">
        {t('td_no_records')}
      </div>
    );
  }

  const headerFields: Array<[string, string]> = [
    [t('td_machine'), details.machine || '—'],
    [t('td_date'), fmtDate(details.date)],
    [t('td_time'), fmtTime(details.time)],
    [t('td_fraction'), details.fraction != null ? String(details.fraction) : '—'],
  ];

  return (
    <div className="ohif-scrollbar flex h-full flex-col text-white" data-cy="rt-treatment-details">
      <div className="flex items-center justify-between gap-2 px-2 py-2">
        <span className="text-base font-medium">{t('td_title')}</span>
        {items.length > 1 && (
          <select
            className="bg-background border-input max-w-[55%] rounded border px-1 py-0.5 text-xs"
            data-cy="rt-td-record-select"
            aria-label={t('td_record')}
            value={selected?.displaySetInstanceUID ?? ''}
            onChange={e => setSelectedUid(e.target.value)}
          >
            {items.map(i => (
              <option key={i.displaySetInstanceUID} value={i.displaySetInstanceUID}>
                {`${fmtDate(i.rtRecord.treatmentDate)}${i.label ? ` · ${i.label}` : ''}`}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-2 px-2 pb-2 text-xs">
        {headerFields.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2">
            <span className="text-muted-foreground">{label}</span>
            <span>{value}</span>
          </div>
        ))}
      </div>

      <div className="flex-1 overflow-auto px-2 pb-2 text-sm">
        {details.beams.length ? (
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-muted-foreground text-left text-xs">
                <th className="py-0.5">{t('td_header_beam')}</th>
                <th>{t('td_header_name')}</th>
                <th className="text-right">{t('td_header_spec_mu')}</th>
                <th className="text-right">{t('td_header_deliv_mu')}</th>
                <th className="text-right">{t('td_header_delta_mu')}</th>
                <th>{t('td_header_termination')}</th>
                <th>{t('td_header_verification')}</th>
                <th className="text-right" title={t('td_header_overrides')}>Ovr</th>
                <th className="text-right" title={t('td_header_corrections')}>Corr</th>
              </tr>
            </thead>
            <tbody>
              {details.beams.map((b, i) => (
                <tr key={i} data-cy="rt-td-beam-row" className="border-t border-white/5">
                  <td className="py-0.5">{b.beamNumber ?? '—'}</td>
                  <td>{b.name || '—'}</td>
                  <td className="text-right">{num(b.specifiedMu)}</td>
                  <td className="text-right">{num(b.deliveredMu)}</td>
                  <td className="text-right">{fmtDelta(b.deltaMu)}</td>
                  <td>
                    {isOperator(b.terminationStatus) ? (
                      <StatusBadge
                        text="OPERATOR"
                        title={t('td_badge_operator_title')}
                        tone="red"
                      />
                    ) : (
                      b.terminationStatus || '—'
                    )}
                  </td>
                  <td>
                    {isVerifiedOvr(b.verificationStatus) ? (
                      <StatusBadge
                        text="VERIFIED_OVR"
                        title={t('td_badge_verified_ovr_title')}
                        tone="amber"
                      />
                    ) : (
                      b.verificationStatus || '—'
                    )}
                  </td>
                  <td className="text-right">{b.overrideCount || '—'}</td>
                  <td className="text-right">{b.correctionCount || '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-white/10 font-medium" data-cy="rt-td-totals-row">
                <td className="py-0.5" colSpan={2}>{t('td_totals')}</td>
                <td className="text-right">{num(details.totals.specified)}</td>
                <td className="text-right">{num(details.totals.delivered)}</td>
                <td className="text-right" colSpan={5} />
              </tr>
            </tfoot>
          </table>
        ) : (
          <div className="text-muted-foreground text-xs">{t('rec_no_sessions')}</div>
        )}
      </div>
    </div>
  );
}

export default TreatmentDetailsPanel;
