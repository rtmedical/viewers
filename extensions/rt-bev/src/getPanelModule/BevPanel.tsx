/**
 * BEV right-panel (Phase B).
 *
 * Shows the beam the visible RTIMAGE references (number/name/gantry/
 * collimator), a control-point slider driving `setBevControlPoint`, and
 * Show/Hide buttons for the overlay. Thin layer over getCommandsModule's
 * tested resolution helpers; RTV-114: depends only on `@ohif/ui-next`.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { eventTarget, Enums } from '@cornerstonejs/core';
import { Button } from '@ohif/ui-next';
import { BevPanelInfo, getBevPanelInfo } from '../getCommandsModule';

interface ServicesManagerLike {
  services: Record<string, any>;
}

interface CommandsManagerLike {
  runCommand: (name: string, options?: Record<string, unknown>) => unknown;
}

export interface BevPanelProps {
  servicesManager: ServicesManagerLike;
  commandsManager: CommandsManagerLike;
}

const deg = (v?: number) => (v == null ? '—' : `${Math.round(v * 10) / 10}°`);

export function BevPanel({ servicesManager, commandsManager }: BevPanelProps): React.ReactElement {
  const { t } = useTranslation('RTMedical');
  const [info, setInfo] = useState<BevPanelInfo>(() => getBevPanelInfo(servicesManager));

  const refresh = useCallback(() => {
    try {
      setInfo(getBevPanelInfo(servicesManager));
    } catch (e) {
      /* services not ready — keep the last snapshot */
    }
  }, [servicesManager]);

  useEffect(() => {
    const { displaySetService, viewportGridService, cornerstoneViewportService } =
      servicesManager?.services ?? {};
    const subscriptions: Array<{ unsubscribe?: () => void } | undefined> = [];
    const on = (service: any, event: string | undefined) => {
      if (service?.subscribe && event) {
        subscriptions.push(service.subscribe(event, refresh));
      }
    };
    // Pub-sub over effects (project convention): new/changed display sets or a
    // viewport/grid change can swap the RTIMAGE (and thus the linked beam).
    on(displaySetService, displaySetService?.EVENTS?.DISPLAY_SETS_ADDED);
    on(displaySetService, displaySetService?.EVENTS?.DISPLAY_SETS_CHANGED);
    on(displaySetService, displaySetService?.EVENTS?.DISPLAY_SETS_REMOVED);
    on(viewportGridService, viewportGridService?.EVENTS?.GRID_STATE_CHANGED);
    on(viewportGridService, viewportGridService?.EVENTS?.ACTIVE_VIEWPORT_ID_CHANGED);
    on(cornerstoneViewportService, cornerstoneViewportService?.EVENTS?.VIEWPORT_DATA_CHANGED);
    // Cornerstone events no service mirrors: scrolling a multi-field portal
    // series to a frame referencing ANOTHER beam fires STACK_NEW_IMAGE on the
    // viewport element as a NON-BUBBLING CustomEvent — a document listener in
    // the CAPTURE phase still sees it (capture descends to the target even
    // without bubbling). ELEMENT_DISABLED (overlay self-detach outside a grid
    // change → 'shown' would lag) is dispatched on the global eventTarget.
    // Deferred one tick so the overlay's own ELEMENT_DISABLED detach listener
    // runs first regardless of registration order.
    const onCornerstoneEvent = () => setTimeout(refresh, 0);
    document.addEventListener(Enums.Events.STACK_NEW_IMAGE, onCornerstoneEvent, true);
    eventTarget.addEventListener(Enums.Events.ELEMENT_DISABLED, onCornerstoneEvent);
    refresh();
    return () => {
      subscriptions.forEach(sub => sub?.unsubscribe?.());
      document.removeEventListener(Enums.Events.STACK_NEW_IMAGE, onCornerstoneEvent, true);
      eventTarget.removeEventListener(Enums.Events.ELEMENT_DISABLED, onCornerstoneEvent);
    };
  }, [servicesManager, refresh]);

  const handleShow = useCallback(() => {
    commandsManager?.runCommand?.('showBev', { controlPoint: info.controlPoint });
    refresh();
  }, [commandsManager, info.controlPoint, refresh]);

  const handleHide = useCallback(() => {
    commandsManager?.runCommand?.('hideBev');
    refresh();
  }, [commandsManager, refresh]);

  const handleControlPoint = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const index = Number(event.target.value) || 0;
      commandsManager?.runCommand?.('setBevControlPoint', { index });
      refresh();
    },
    [commandsManager, refresh]
  );

  const hasBeam = info.beamNumber != null;
  const maxCp = Math.max(0, info.cpCount - 1);

  return (
    <div
      className="flex flex-col gap-3 px-2 py-3 text-sm text-white"
      data-cy="rt-bev-panel"
    >
      <span className="text-base font-medium">{t('bev_panel_title')}</span>

      {!info.hasPlan && <div className="text-muted-foreground">{t('bev_no_plan')}</div>}
      {info.hasPlan && !info.hasRtImageViewport && (
        <div className="text-muted-foreground">{t('bev_no_rtimage')}</div>
      )}

      {hasBeam && (
        <div className="flex flex-col gap-1" data-cy="rt-bev-beam-info">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('bev_beam')}</span>
            <span>
              {info.beamNumber}
              {info.beamName ? ` — ${info.beamName}` : ''}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('bev_gantry')}</span>
            <span>{deg(info.gantryAngle)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('bev_collimator')}</span>
            <span>{deg(info.collimatorAngleDeg)}</span>
          </div>
        </div>
      )}

      {hasBeam && info.cpCount > 0 && (
        <div className="flex flex-col gap-1">
          <label className="text-muted-foreground" htmlFor="rt-bev-cp-slider">
            {t('bev_control_point')} {Math.min(info.controlPoint, maxCp) + 1}/{info.cpCount}
          </label>
          <input
            id="rt-bev-cp-slider"
            data-cy="rt-bev-cp-slider"
            type="range"
            min={0}
            max={maxCp}
            step={1}
            value={Math.min(info.controlPoint, maxCp)}
            onChange={handleControlPoint}
          />
        </div>
      )}

      <div className="flex gap-2">
        <Button
          variant="default"
          size="sm"
          onClick={handleShow}
          data-cy="rt-bev-show"
        >
          {t('bev_show')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleHide}
          data-cy="rt-bev-hide"
        >
          {t('bev_hide')}
        </Button>
      </div>
    </div>
  );
}

export default BevPanel;
