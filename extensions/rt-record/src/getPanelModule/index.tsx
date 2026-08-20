/**
 * getPanelModule (RTV-163) — RT Treatment Records summary panel.
 * Opt in via '@ohif/extension-rt-record.panelModule.rtRecord' in rightPanels.
 */
import React from 'react';
import RtRecordPanel from './RtRecordPanel';
import DoseInformationPanel from './DoseInformationPanel';
import TreatmentDetailsPanel from './TreatmentDetailsPanel';
import DoseCorrectionPanel from './DoseCorrectionPanel';
import CachedPlansPanel from './CachedPlansPanel';
import type { PlanCacheEntry } from '../cachedPlans';

interface PanelModuleParams {
  servicesManager: { services: Record<string, any> };
  commandsManager?: { runCommand: (name: string, options?: Record<string, unknown>) => unknown };
  extensionManager?: unknown;
}

function getPanelModule({ servicesManager }: PanelModuleParams) {
  return [
    {
      name: 'rtRecord',
      iconName: 'tab-studies',
      iconLabel: 'RT Records',
      label: 'RT Records',
      component: (props: Record<string, unknown>) => (
        <RtRecordPanel {...props} servicesManager={servicesManager} />
      ),
    },
    {
      name: 'doseInformation',
      iconName: 'tab-studies',
      iconLabel: 'Dose Info',
      label: 'Dose Information',
      component: (props: Record<string, unknown>) => (
        <DoseInformationPanel {...props} servicesManager={servicesManager} />
      ),
    },
    // RTV-173: per-record beam delivery detail (MU delta, statuses, counts).
    {
      name: 'treatmentDetails',
      iconName: 'tab-studies',
      iconLabel: 'Treatment',
      label: 'Treatment Details',
      component: (props: Record<string, unknown>) => (
        <TreatmentDetailsPanel {...props} servicesManager={servicesManager} />
      ),
    },
    // RTV-173: DICOM-derivable corrections/overrides (RIS corrections: RTV-169).
    {
      name: 'doseCorrection',
      iconName: 'tab-studies',
      iconLabel: 'Corrections',
      label: 'Dose Corrections',
      component: (props: Record<string, unknown>) => (
        <DoseCorrectionPanel {...props} servicesManager={servicesManager} />
      ),
    },
    // RTV-179: planos em cache externo e limpeza do cache.
    {
      name: 'cachedPlans',
      iconName: 'tab-studies',
      iconLabel: 'Cache',
      label: 'Planos em cache',
      /**
       * As entradas vem do hospedeiro, que sabe consultar o cache local e o daemon. Sem
       * elas o painel NAO renderiza uma lista vazia: "nenhum plano em cache" seria uma
       * afirmacao sobre o disco que ninguem verificou, e a partir dela alguem reimportaria.
       */
      component: (props: Record<string, unknown>) => {
        const entries = props.entries as readonly PlanCacheEntry[] | undefined;
        if (!entries) {
          return (
            <p data-testid="plan-no-entries">
              Inventario do cache nao informado. Isto nao significa que o cache esta vazio.
            </p>
          );
        }
        return (
          <CachedPlansPanel
            entries={entries}
            nowMs={props.nowMs as number}
            actorId={(props.actorId as string) ?? ''}
            usageProbe={props.usageProbe as never}
            onClear={props.onClear as never}
            servicesManager={servicesManager}
          />
        );
      },
    },
  ];
}

export default getPanelModule;
