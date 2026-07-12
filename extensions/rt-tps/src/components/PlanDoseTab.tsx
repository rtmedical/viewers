import React from 'react';
import { useTranslation } from 'react-i18next';
import { usePlanData } from '../hooks/usePlanData';
import { num } from '../format';

/**
 * Eclipse "Dose / Prescription" Info Window tab (RTV Wave 4 / Phase 2).
 *
 * Plan-level dose picture from the parsed RTPLAN: identity, the prescription /
 * dose-reference table, and per-fraction-group fractionation with the derived
 * plan totals (Σ MU, Σ prescribed dose). Display-only. Strings via the
 * `RTMedical` i18n namespace.
 */
export default function PlanDoseTab({
  servicesManager,
}: {
  servicesManager: any;
}): React.ReactElement {
  const { t } = useTranslation('RTMedical');
  const { plan, selected, displaySets, selectedUID, setSelectedUID } = usePlanData(servicesManager);

  if (!plan) {
    return (
      <div className="text-muted-foreground p-3 text-sm" data-cy="rt-tps-dose">
        {t('no_rt_plan')}
      </div>
    );
  }

  return (
    <div className="ohif-scrollbar h-full overflow-auto p-3 text-sm" data-cy="rt-tps-dose">
      {displaySets.length > 1 && (
        <div className="mb-2 flex items-center gap-2">
          <span className="text-sm font-medium">{t('dose_plan')}</span>
          <select
            className="border-input bg-muted/40 rounded border px-1 py-0.5 text-xs"
            value={selectedUID}
            onChange={e => setSelectedUID(e.target.value)}
            data-cy="rt-tps-dose-plan-select"
          >
            {displaySets.map(ds => (
              <option key={ds.displaySetInstanceUID} value={ds.displaySetInstanceUID}>
                {ds.label || ds.SeriesDescription || ds.rtPlan?.label || ds.displaySetInstanceUID}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="mb-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <span className="text-muted-foreground">{t('dose_plan')}</span>
        <span>{plan.label || selected?.label || '—'}</span>
        <span className="text-muted-foreground">{t('dose_machine')}</span>
        <span>{plan.machine || '—'}</span>
        <span className="text-muted-foreground">{t('dose_approval')}</span>
        <span>{plan.approvalStatus || '—'}</span>
        <span className="text-muted-foreground">{t('dose_manufacturer')}</span>
        <span>{plan.manufacturer || '—'}</span>
        <span className="text-muted-foreground">{t('dose_total_prescribed')}</span>
        <span className="font-medium">{num(plan.totalPrescribedDoseGy)} Gy</span>
        <span className="text-muted-foreground">{t('dose_total_mu')}</span>
        <span>{num(plan.totalMeterset)}</span>
      </div>

      {plan.prescriptions.length > 0 && (
        <>
          <div className="mb-1 font-medium">{t('dose_prescriptions')}</div>
          <table className="mb-3 w-full border-collapse text-xs">
            <thead className="text-muted-foreground text-left">
              <tr>
                <th className="py-1 pr-2">{t('dose_type')}</th>
                <th className="pr-2">{t('dose_structure')}</th>
                <th className="pr-2">{t('dose_description')}</th>
                <th className="text-right">{t('dose_dose_gy')}</th>
              </tr>
            </thead>
            <tbody>
              {plan.prescriptions.map((p, i) => (
                <tr key={i} className="border-input border-t">
                  <td className="py-1 pr-2">{p.type || '—'}</td>
                  <td className="pr-2">{p.structureType || '—'}</td>
                  <td className="pr-2">{p.description || '—'}</td>
                  <td className="text-right">{num(p.targetPrescriptionDoseGy)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {plan.fractionGroups.length > 0 && (
        <>
          <div className="mb-1 font-medium">{t('dose_fractionation')}</div>
          <table className="w-full border-collapse text-xs">
            <thead className="text-muted-foreground text-left">
              <tr>
                <th className="py-1 pr-2">{t('dose_group')}</th>
                <th className="pr-2 text-right">{t('dose_fractions')}</th>
                <th className="pr-2 text-right">{t('dose_beams')}</th>
                <th className="pr-2 text-right">{t('dose_per_fraction')}</th>
                <th className="text-right">{t('dose_group_dose')}</th>
              </tr>
            </thead>
            <tbody>
              {plan.fractionGroups.map((fg, i) => (
                <tr key={i} className="border-input border-t">
                  <td className="py-1 pr-2">{num(fg.number)}</td>
                  <td className="pr-2 text-right">{num(fg.numberOfFractionsPlanned)}</td>
                  <td className="pr-2 text-right">{num(fg.numberOfBeams)}</td>
                  <td className="pr-2 text-right">{num(fg.fractionDoseGy, 2)}</td>
                  <td className="text-right">
                    {fg.fractionDoseGy != null && fg.numberOfFractionsPlanned != null
                      ? num(fg.fractionDoseGy * fg.numberOfFractionsPlanned)
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
