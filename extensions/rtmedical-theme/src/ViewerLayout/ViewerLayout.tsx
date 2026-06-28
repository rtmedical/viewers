// extensions/rtmedical-theme/src/ViewerLayout/index.jsx

import React from 'react';
// v3.13: SidePanel moved from @ohif/ui to @ohif/ui-next (RTV OHIF v3.13 upgrade).
import { SidePanel } from '@ohif/ui-next';

function Toolbar({ servicesManager }) {
  const { ToolBarService } = servicesManager.services;
  const toolbarButtons = ToolBarService.getButtonSection('primary');

  return (
    // v3.13 rspack parses .jsx via the TS path; a bare <> fragment reads as an
    // empty type-parameter list, so use an explicit React.Fragment.
    <React.Fragment>
      {toolbarButtons.map((toolDef, index) => {
        const { id, Component, componentProps } = toolDef;
        return (
          <Component
            key={id}
            id={id}
            {...componentProps}
            isActive={toolDef.isActive}
            onInteraction={args => ToolBarService.recordInteraction(args)}
          />
        );
      })}
    </React.Fragment>
  );
}

function ViewerLayout({
  extensionManager,
  servicesManager,
  hotkeysManager,
  commandsManager,
  leftPanels,
  rightPanels,
  viewports,
  ViewportGridComp,
}) {
  const getPanelData = id => {
    const entry = extensionManager.getModuleEntry(id);
    const content = entry.component;

    return {
      iconName: entry.iconName,
      iconLabel: entry.iconLabel,
      label: entry.label,
      name: entry.name,
      content,
    };
  };

  const getViewportComponentData = viewportComponent => {
    const entry = extensionManager.getModuleEntry(viewportComponent.namespace);

    return {
      component: entry.component,
      displaySetsToDisplay: viewportComponent.displaySetsToDisplay,
    };
  };

  const leftPanelComponents = leftPanels.map(getPanelData);
  const rightPanelComponents = rightPanels.map(getPanelData);
  const viewportComponents = viewports.map(getViewportComponentData);

  return (
    <div className="bg-dark text-dark min-h-screen">
      <Toolbar servicesManager={servicesManager} />

      <div className="flex">
        {/* LEFT SIDEPANELS */}
        <SidePanel
          side="left"
          defaultComponentOpen={leftPanelComponents[0].name}
          childComponents={leftPanelComponents}
          className="bg-secondary-dark"
        />

        {/* TOOLBAR + GRID */}
        <ViewportGridComp
          servicesManager={servicesManager}
          viewportComponents={viewportComponents}
          commandsManager={commandsManager}
          className="flex-1"
        />

        {/* RIGHT SIDEPANELS */}
        <SidePanel
          side="right"
          defaultComponentOpen={rightPanelComponents[0].name}
          childComponents={rightPanelComponents}
          className="bg-secondary-dark"
        />
      </div>
    </div>
  );
}

export default ViewerLayout;
