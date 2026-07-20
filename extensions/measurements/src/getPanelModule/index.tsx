/**
 * getPanelModule (RTV-27 epic) — Advanced Measurements panel.
 * Opt in via '@ohif/extension-measurements.panelModule.measurements'.
 */
import React from 'react';
import i18n from 'i18next';
import MeasurementsPanel from './MeasurementsPanel';
import LineProfilePanel from './LineProfilePanel';

interface PanelModuleParams {
  servicesManager?: { services: Record<string, any> };
  commandsManager?: { runCommand: (name: string, options?: Record<string, unknown>) => unknown };
  extensionManager?: unknown;
}

function getPanelModule(_params: PanelModuleParams) {
  return [
    {
      name: 'measurements',
      iconName: 'tab-studies',
      iconLabel: 'Measurements',
      label: 'Advanced Measurements',
      component: () => <MeasurementsPanel />,
    },
    {
      name: 'lineProfile',
      iconName: 'tab-linear',
      // getPanelModule runs at mode setup (after rtmedical-theme registered
      // the RTMedical bundle in preRegistration), so i18n.t is safe here; the
      // defaultValue keeps English when the bundle is absent (e.g. tests).
      iconLabel: i18n.t('RTMedical:lineprofile_panel_iconlabel', { defaultValue: 'Profile' }),
      label: i18n.t('RTMedical:lineprofile_panel_label', { defaultValue: 'Density Profile' }),
      component: () => <LineProfilePanel />,
    },
  ];
}

export default getPanelModule;
