import React from 'react';
import LaudoPanel from './LaudoPanel/LaudoPanel';
import MeasurementsPanel from './measurements/MeasurementsPanel';
import RTTreePanel from './rtTree/RTTreePanel';

/**
 * Panels contributed by the RT theme/shell extension:
 * - 'laudo' (RTV-118 placeholder; editor in RTV-121)
 * - 'rtMeasurements' custom measurements table with jump-to + CSV (RTV-151)
 * Referenced by modes as 'rtmedical-theme.panelModule.<name>'.
 */
function getPanelModule({ servicesManager, commandsManager }) {
  return [
    {
      name: 'laudo',
      iconName: 'tab-studies',
      iconLabel: 'Laudo',
      label: 'Laudo',
      component: () => <LaudoPanel />,
    },
    {
      name: 'rtMeasurements',
      iconName: 'tab-linear',
      iconLabel: 'Medidas',
      label: 'Medidas',
      component: props => (
        <MeasurementsPanel
          {...props}
          servicesManager={servicesManager}
          commandsManager={commandsManager}
        />
      ),
    },
    {
      name: 'rtTree',
      iconName: 'tab-segmentation',
      iconLabel: 'RT Tree',
      label: 'RT Tree',
      component: props => <RTTreePanel {...props} servicesManager={servicesManager} />,
    },
  ];
}

export default getPanelModule;
