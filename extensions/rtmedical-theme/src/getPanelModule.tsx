import React from 'react';
import LaudoPanel from './LaudoPanel/LaudoPanel';
import MeasurementsPanel from './measurements/MeasurementsPanel';
import RTTreePanel from './rtTree/RTTreePanel';
import SrTreePanel from './srTree/SrTreePanel';
import HpEditorPanel from './hpEditor/HpEditorPanel';
import BgTasksPanel from './bgTasks/BgTasksPanel';

/**
 * Panels contributed by the RT theme/shell extension:
 * - 'laudo' (RTV-118 placeholder; editor in RTV-121)
 * - 'rtMeasurements' custom measurements table with jump-to + CSV (RTV-151)
 * - 'hpEditor' graphical hanging-protocol editor (RTV-23)
 * - 'bgTasks' background-task history (RTV-159)
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
    {
      name: 'hpEditor',
      iconName: 'tab-4d',
      iconLabel: 'Protocolos',
      label: 'Protocolos',
      component: props => (
        <HpEditorPanel
          {...props}
          servicesManager={servicesManager}
          commandsManager={commandsManager}
        />
      ),
    },
    {
      // RTV-159: session history of background tasks (exports, uploads...).
      name: 'bgTasks',
      iconName: 'tab-studies',
      iconLabel: 'Tarefas',
      label: 'Tarefas',
      component: props => <BgTasksPanel {...props} servicesManager={servicesManager} />,
    },
    {
      name: 'srTree',
      iconName: 'tab-studies',
      iconLabel: 'SR',
      label: 'SR',
      component: props => (
        <SrTreePanel
          {...props}
          servicesManager={servicesManager}
          commandsManager={commandsManager}
        />
      ),
    },
  ];
}

export default getPanelModule;
