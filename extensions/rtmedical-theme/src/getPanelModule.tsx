import React from 'react';
import LaudoPanel from './LaudoPanel/LaudoPanel';

/**
 * Panels contributed by the RT theme/shell extension. Currently the laudo
 * placeholder (RTV-118); the real editor lands in RTV-121.
 * Referenced by modes as 'rtmedical-theme.panelModule.laudo'.
 */
function getPanelModule() {
  return [
    {
      name: 'laudo',
      iconName: 'tab-studies',
      iconLabel: 'Laudo',
      label: 'Laudo',
      component: () => <LaudoPanel />,
    },
  ];
}

export default getPanelModule;
