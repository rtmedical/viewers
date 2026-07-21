/**
 * getPanelModule (RTV-163) — RT Treatment Records summary panel.
 * Opt in via '@ohif/extension-rt-record.panelModule.rtRecord' in rightPanels.
 */
import React from 'react';
import RtRecordPanel from './RtRecordPanel';
import DoseInformationPanel from './DoseInformationPanel';
import TreatmentDetailsPanel from './TreatmentDetailsPanel';
import DoseCorrectionPanel from './DoseCorrectionPanel';

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
  ];
}

export default getPanelModule;
