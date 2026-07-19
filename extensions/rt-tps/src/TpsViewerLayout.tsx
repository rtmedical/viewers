import React, { useEffect, useState, useCallback } from 'react';
import { useAppConfig } from '@state';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle, InvestigationalUseDialog } from '@ohif/ui-next';
// Reuse the stock layout building blocks by source path (zero fork — we import,
// never edit them). Package-subpath imports don't resolve under rspack here, so
// use the workspace-relative path (extensions/default/src/...).
import ViewerHeader from '../../default/src/ViewerLayout/ViewerHeader';
import SidePanelWithServices from '../../default/src/Components/SidePanelWithServices';
import useResizablePanels from '../../default/src/ViewerLayout/ResizablePanelsHook';
import InfoWindow from './InfoWindow';

const resizableHandleClassName = 'mt-[1px] bg-background';

/**
 * TPS-style ViewerLayout (RTV — Wave 4, Eclipse-like, DISPLAY-ONLY).
 *
 * Same header + resizable left/center/right regions as the stock
 * `@ohif/extension-default` ViewerLayout (its ViewerHeader / SidePanelWithServices
 * / useResizablePanels are reused via source import — zero fork, RTV-114), but the
 * whole thing is stacked in a vertical flex so an Eclipse-style **Info Window**
 * bottom bar can be added below the viewports (panelService only supports
 * Left/Right, so the bottom zone is rendered by this layout — see InfoWindow).
 */
function TpsViewerLayout({
  extensionManager,
  servicesManager,
  hotkeysManager,
  commandsManager,
  viewports,
  ViewportGridComp,
  leftPanelClosed = false,
  rightPanelClosed = false,
  leftPanelResizable = false,
  rightPanelResizable = false,
  leftPanelInitialExpandedWidth,
  rightPanelInitialExpandedWidth,
  leftPanelMinimumExpandedWidth,
  rightPanelMinimumExpandedWidth,
}: withAppTypes): React.FunctionComponent {
  const [appConfig] = useAppConfig();
  const { panelService, hangingProtocolService, customizationService } = servicesManager.services;

  const hasPanels = useCallback(
    (side): boolean => !!panelService.getPanels(side).length,
    [panelService]
  );

  const [hasRightPanels, setHasRightPanels] = useState(hasPanels('right'));
  const [hasLeftPanels, setHasLeftPanels] = useState(hasPanels('left'));
  const [leftPanelClosedState, setLeftPanelClosed] = useState(leftPanelClosed);
  const [rightPanelClosedState, setRightPanelClosed] = useState(rightPanelClosed);
  // RTV-212: the stock ViewerLayout shows a loading indicator until the
  // hanging protocol is applied; this layout didn't — the screen sat blank
  // while the study loaded. Mirror the stock behaviour (component comes from
  // the 'ui.loadingIndicatorProgress' customization, our RtLoadingIndicator).
  const [showLoadingIndicator, setShowLoadingIndicator] = useState(!!appConfig?.showLoadingIndicator);
  const LoadingIndicatorProgress = customizationService.getCustomization(
    'ui.loadingIndicatorProgress'
  );

  useEffect(() => {
    const { unsubscribe } = hangingProtocolService.subscribe(
      hangingProtocolService.EVENTS.PROTOCOL_CHANGED,
      () => setShowLoadingIndicator(false)
    );
    return () => unsubscribe();
  }, [hangingProtocolService]);

  const [
    leftPanelProps,
    rightPanelProps,
    resizablePanelGroupProps,
    resizableLeftPanelProps,
    resizableViewportGridPanelProps,
    resizableRightPanelProps,
    onHandleDragging,
  ] = useResizablePanels(
    leftPanelClosed,
    setLeftPanelClosed,
    rightPanelClosed,
    setRightPanelClosed,
    hasLeftPanels,
    hasRightPanels,
    leftPanelInitialExpandedWidth,
    rightPanelInitialExpandedWidth,
    leftPanelMinimumExpandedWidth,
    rightPanelMinimumExpandedWidth
  );

  useEffect(() => {
    document.body.classList.add('bg-background');
    document.body.classList.add('overflow-hidden');
    return () => {
      document.body.classList.remove('bg-background');
      document.body.classList.remove('overflow-hidden');
    };
  }, []);

  useEffect(() => {
    const { unsubscribe } = panelService.subscribe(
      panelService.EVENTS.PANELS_CHANGED,
      ({ options }) => {
        setHasLeftPanels(hasPanels('left'));
        setHasRightPanels(hasPanels('right'));
        if (options?.leftPanelClosed !== undefined) {
          setLeftPanelClosed(options.leftPanelClosed);
        }
        if (options?.rightPanelClosed !== undefined) {
          setRightPanelClosed(options.rightPanelClosed);
        }
      }
    );
    return () => unsubscribe();
  }, [panelService, hasPanels]);

  const getComponent = id => {
    const entry = extensionManager.getModuleEntry(id);
    if (!entry || !entry.component) {
      throw new Error(`${id} is not a valid layout viewport module entry.`);
    }
    return { entry };
  };

  const viewportComponents = viewports.map(viewportComponent => {
    const { entry } = getComponent(viewportComponent.namespace);
    return {
      component: entry.component,
      isReferenceViewable: entry.isReferenceViewable,
      displaySetsToDisplay: viewportComponent.displaySetsToDisplay,
    };
  });

  return (
    <div>
      <ViewerHeader
        hotkeysManager={hotkeysManager}
        extensionManager={extensionManager}
        servicesManager={servicesManager}
        appConfig={appConfig}
      />
      {/* Vertical stack: [ header (above) ] → [ left/center/right ] flex-1 → [ Info Window ] */}
      <div
        className="flex flex-col"
        style={{ height: 'calc(100vh - 52px)' }}
      >
        <div className="relative flex min-h-0 w-full flex-1 flex-row flex-nowrap items-stretch overflow-hidden bg-background">
          {showLoadingIndicator && LoadingIndicatorProgress && (
            <LoadingIndicatorProgress className="h-full w-full bg-background" />
          )}
          <ResizablePanelGroup {...resizablePanelGroupProps}>
            {hasLeftPanels ? (
              <>
                <ResizablePanel {...resizableLeftPanelProps}>
                  <SidePanelWithServices
                    side="left"
                    isExpanded={!leftPanelClosedState}
                    servicesManager={servicesManager}
                    {...leftPanelProps}
                  />
                </ResizablePanel>
                <ResizableHandle
                  onDragging={onHandleDragging}
                  disabled={!leftPanelResizable}
                  className={resizableHandleClassName}
                />
              </>
            ) : null}
            <ResizablePanel {...resizableViewportGridPanelProps}>
              <div className="flex h-full flex-1 flex-col">
                <div className="relative flex h-full flex-1 items-center justify-center overflow-hidden bg-background">
                  <ViewportGridComp
                    servicesManager={servicesManager}
                    viewportComponents={viewportComponents}
                    commandsManager={commandsManager}
                  />
                </div>
              </div>
            </ResizablePanel>
            {hasRightPanels ? (
              <>
                <ResizableHandle
                  onDragging={onHandleDragging}
                  disabled={!rightPanelResizable}
                  className={resizableHandleClassName}
                />
                <ResizablePanel {...resizableRightPanelProps}>
                  <SidePanelWithServices
                    side="right"
                    isExpanded={!rightPanelClosedState}
                    servicesManager={servicesManager}
                    {...rightPanelProps}
                  />
                </ResizablePanel>
              </>
            ) : null}
          </ResizablePanelGroup>
        </div>
        <InfoWindow
          servicesManager={servicesManager}
          extensionManager={extensionManager}
          commandsManager={commandsManager}
        />
      </div>
      <InvestigationalUseDialog dialogConfiguration={appConfig?.investigationalUseDialog} />
    </div>
  );
}

export default TpsViewerLayout;
