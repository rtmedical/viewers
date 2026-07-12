/**
 * RT Plan "Ficha" right-panel (RTV-132).
 *
 * Thin React layer over the tested, framework-free {@link ../rtPlanParser}. It
 * reads RTPLAN display sets from the DisplaySetService (the SopClassHandler has
 * already parsed them onto `displaySet.rtPlan`), renders the plan/prescriptions/
 * beams tables, and offers CSV export + print-to-PDF. RTV-114: depends only on
 * `@ohif/ui-next` (public UI) and this extension's own primitives.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ohif/ui-next';
import { buildRtPlanCsv, RtPlan } from '../rtPlanParser';

interface ServicesManagerLike {
  services: Record<string, any>;
}

export interface RTPlanPanelProps {
  servicesManager: ServicesManagerLike;
}

interface RtPlanDisplaySet {
  displaySetInstanceUID: string;
  label?: string;
  SeriesDescription?: string;
  rtPlan?: RtPlan;
  Modality?: string;
}

function readRtPlanDisplaySets(displaySetService: any): RtPlanDisplaySet[] {
  const all = displaySetService?.getActiveDisplaySets?.() ?? displaySetService?.activeDisplaySets ?? [];
  return (all as RtPlanDisplaySet[]).filter(ds => ds?.rtPlan || ds?.Modality === 'RTPLAN');
}

function downloadCsv(plan: RtPlan, name: string): void {
  if (typeof document === 'undefined') {
    return;
  }
  const blob = new Blob([buildRtPlanCsv(plan)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name || 'rtplan'}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const num = (v?: number, digits = 1) => (v == null ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(digits));

export function RTPlanPanel({ servicesManager }: RTPlanPanelProps): React.ReactElement {
  const { t } = useTranslation('RTMedical');
  const displaySetService = servicesManager?.services?.displaySetService;
  const [displaySets, setDisplaySets] = useState<RtPlanDisplaySet[]>(() =>
    readRtPlanDisplaySets(displaySetService)
  );
  const [selectedUID, setSelectedUID] = useState<string | undefined>(
    () => readRtPlanDisplaySets(displaySetService)[0]?.displaySetInstanceUID
  );

  useEffect(() => {
    if (!displaySetService?.subscribe) {
      return undefined;
    }
    const resync = () => setDisplaySets(readRtPlanDisplaySets(displaySetService));
    resync();
    const events = displaySetService.EVENTS ?? {};
    const subs = [events.DISPLAY_SETS_ADDED, events.DISPLAY_SETS_CHANGED, events.DISPLAY_SETS_REMOVED]
      .filter(Boolean)
      .map(evt => displaySetService.subscribe(evt, resync));
    return () => subs.forEach(s => s?.unsubscribe?.());
  }, [displaySetService]);

  useEffect(() => {
    if (!selectedUID && displaySets.length) {
      setSelectedUID(displaySets[0].displaySetInstanceUID);
    }
  }, [displaySets, selectedUID]);

  const selected = useMemo(
    () => displaySets.find(ds => ds.displaySetInstanceUID === selectedUID) ?? displaySets[0],
    [displaySets, selectedUID]
  );
  const plan = selected?.rtPlan;

  const handleCsv = useCallback(() => {
    if (plan) {
      downloadCsv(plan, selected?.label || plan.label || 'rtplan');
    }
  }, [plan, selected]);
  const handlePrint = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.print();
    }
  }, []);

  if (!plan) {
    return (
      <div className="text-muted-foreground px-2 py-4 text-sm" data-cy="rt-plan-panel">
        {t('plan_empty')}
      </div>
    );
  }

  return (
    <div className="ohif-scrollbar flex h-full flex-col text-white" data-cy="rt-plan-panel">
      <div className="flex items-center justify-between px-2 py-2">
        <span className="text-base font-medium">{t('plan_title')}</span>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={handleCsv}>
            CSV
          </Button>
          <Button variant="ghost" size="sm" onClick={handlePrint}>
            {t('plan_print')}
          </Button>
        </div>
      </div>

      {displaySets.length > 1 && (
        <select
          className="mx-2 mb-2 rounded bg-black/30 p-1 text-sm"
          value={selected?.displaySetInstanceUID}
          onChange={e => setSelectedUID(e.target.value)}
        >
          {displaySets.map(ds => (
            <option key={ds.displaySetInstanceUID} value={ds.displaySetInstanceUID}>
              {ds.label || ds.SeriesDescription || ds.displaySetInstanceUID}
            </option>
          ))}
        </select>
      )}

      <div className="flex-1 overflow-auto px-2 pb-3 text-sm">
        <dl className="mb-3 grid grid-cols-2 gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">{t('plan_label')}</dt>
          <dd>{plan.label || '—'}</dd>
          <dt className="text-muted-foreground">{t('plan_machine')}</dt>
          <dd>{plan.machine || '—'}</dd>
          <dt className="text-muted-foreground">{t('plan_approval')}</dt>
          <dd>{plan.approvalStatus || '—'}</dd>
          <dt className="text-muted-foreground">{t('plan_total_dose')}</dt>
          <dd>{num(plan.totalPrescribedDoseGy)} Gy</dd>
          <dt className="text-muted-foreground">{t('plan_total_mu')}</dt>
          <dd>{num(plan.totalMeterset)}</dd>
        </dl>

        {plan.prescriptions.length > 0 && (
          <>
            <div className="mb-1 font-medium">{t('plan_prescriptions')}</div>
            <table className="mb-3 w-full border-collapse">
              <thead>
                <tr className="text-muted-foreground text-left">
                  <th className="py-1">{t('plan_type')}</th>
                  <th>{t('plan_description')}</th>
                  <th className="text-right">{t('plan_dose_gy')}</th>
                </tr>
              </thead>
              <tbody>
                {plan.prescriptions.map((p, i) => (
                  <tr key={i} className="border-t border-white/10">
                    <td className="py-1">{p.type || '—'}</td>
                    <td>{p.description || '—'}</td>
                    <td className="text-right">{num(p.targetPrescriptionDoseGy)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <div className="mb-1 font-medium">{t('plan_beams')}</div>
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-muted-foreground text-left">
              <th className="py-1">#</th>
              <th>{t('plan_name')}</th>
              <th>{t('plan_energy')}</th>
              <th className="text-right">{t('plan_gantry')}</th>
              <th className="text-right">MU</th>
            </tr>
          </thead>
          <tbody>
            {plan.beams.map((b, i) => (
              <tr key={i} className="border-t border-white/10">
                <td className="py-1">{b.number ?? '—'}</td>
                <td>{b.name || '—'}</td>
                <td>{b.energy || '—'}</td>
                <td className="text-right">{num(b.gantryAngle)}</td>
                <td className="text-right">{num(b.meterset)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default RTPlanPanel;
