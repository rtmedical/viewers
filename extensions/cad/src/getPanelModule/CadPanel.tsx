/**
 * CAD findings right-panel (RTV-79 + overlay follow-up): lists CAD SR findings
 * (type, probability, region) from loaded Mammography/Chest CAD SR objects.
 *
 * Rows jump to the finding's image ('jumpToCadFinding' command: display-set
 * swap + stack scroll + blue pulsing marker); the header eye toggles the
 * finding-marker overlay ('toggleCadFindings'). Pure parse from
 * {@link ../cadSr}. RTV-114: no @ohif/ui imports.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { eventTarget, Enums } from '@cornerstonejs/core';
import { View, ViewOff } from '@carbon/icons-react';
import { parseCadSr, CadFinding } from '../cadSr';
import { sameFinding } from '../findingsGeometry';
import { hasCadFindingsOverlay } from '../findingsOverlay';

interface ServicesManagerLike {
  services: Record<string, any>;
}
interface CommandsManagerLike {
  runCommand: (name: string, options?: Record<string, unknown>) => unknown;
}
export interface CadPanelProps {
  servicesManager: ServicesManagerLike;
  commandsManager?: CommandsManagerLike;
}

const instanceOf = (ds: any) => ds?.instances?.[0] ?? ds?.instance ?? ds;

interface CadItem {
  displaySetInstanceUID: string;
  label?: string;
  findings: CadFinding[];
}

function readCad(displaySetService: any): CadItem[] {
  const all =
    displaySetService?.getActiveDisplaySets?.() ?? displaySetService?.activeDisplaySets ?? [];
  return (all as any[])
    .filter(
      ds => ds?.cadSr || ds?.SOPClassHandlerId === '@ohif/extension-cad.sopClassHandlerModule.cadSr'
    )
    .map(ds => ({
      displaySetInstanceUID: ds.displaySetInstanceUID,
      label: ds.label || ds.SeriesDescription,
      findings: (ds.cadSr ?? parseCadSr(instanceOf(ds))).findings,
    }))
    .filter(i => i.findings.length);
}

const pct = (p?: number) => (p == null ? '—' : p <= 1 ? `${Math.round(p * 100)}%` : `${p}`);

export function CadPanel({ servicesManager, commandsManager }: CadPanelProps): React.ReactElement {
  const { t } = useTranslation('RTMedical');
  const displaySetService = servicesManager?.services?.displaySetService;
  const [items, setItems] = useState<CadItem[]>(() => readCad(displaySetService));
  const [markersOn, setMarkersOn] = useState<boolean>(() => hasCadFindingsOverlay());
  const [activeFinding, setActiveFinding] = useState<CadFinding | null>(null);

  useEffect(() => {
    if (!displaySetService?.subscribe) return undefined;
    const resync = () => setItems(readCad(displaySetService));
    resync();
    const events = displaySetService.EVENTS ?? {};
    const subs = [
      events.DISPLAY_SETS_ADDED,
      events.DISPLAY_SETS_CHANGED,
      events.DISPLAY_SETS_REMOVED,
    ]
      .filter(Boolean)
      .map((e: string) => displaySetService.subscribe(e, resync));
    return () => subs.forEach((s: any) => s?.unsubscribe?.());
  }, [displaySetService]);

  const refreshMarkersState = useCallback(() => setMarkersOn(hasCadFindingsOverlay()), []);

  useEffect(() => {
    // The overlay self-detaches on ELEMENT_DISABLED (viewport torn down by a
    // grid change) — keep the eye honest. Deferred one tick so the overlay's
    // own detach listener runs first regardless of registration order (same
    // recipe as BevPanel).
    const onElementDisabled = () => setTimeout(refreshMarkersState, 0);
    eventTarget.addEventListener(Enums.Events.ELEMENT_DISABLED, onElementDisabled);
    return () => eventTarget.removeEventListener(Enums.Events.ELEMENT_DISABLED, onElementDisabled);
  }, [refreshMarkersState]);

  const handleToggleMarkers = useCallback(() => {
    // jump/toggle commands may be async — refresh the eye from the overlay's
    // real attached state once they settle.
    Promise.resolve(commandsManager?.runCommand?.('toggleCadFindings')).finally(
      refreshMarkersState
    );
  }, [commandsManager, refreshMarkersState]);

  const handleRowClick = useCallback(
    (finding: CadFinding) => {
      setActiveFinding(finding);
      Promise.resolve(commandsManager?.runCommand?.('jumpToCadFinding', { finding })).finally(
        refreshMarkersState
      );
    },
    [commandsManager, refreshMarkersState]
  );

  const total = useMemo(() => items.reduce((n, i) => n + i.findings.length, 0), [items]);

  if (!total) {
    return (
      <div
        className="text-muted-foreground px-2 py-4 text-sm"
        data-cy="cad-panel"
      >
        {t('cad_none')}
      </div>
    );
  }

  return (
    <div
      className="ohif-scrollbar flex h-full flex-col overflow-auto px-2 py-2 text-sm text-white"
      data-cy="cad-panel"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-base font-medium">{t('cad_title', { count: total })}</span>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground shrink-0 p-1"
          title={markersOn ? t('cad_hide_markers') : t('cad_show_markers')}
          aria-label={markersOn ? t('cad_hide_markers') : t('cad_show_markers')}
          aria-pressed={markersOn}
          data-cy="cad-toggle-markers"
          onClick={handleToggleMarkers}
        >
          {markersOn ? (
            <View
              size={16}
              aria-hidden
            />
          ) : (
            <ViewOff
              size={16}
              aria-hidden
            />
          )}
        </button>
      </div>
      {items.map(item => (
        <div
          key={item.displaySetInstanceUID}
          className="mb-3"
        >
          {items.length > 1 && (
            <div className="text-muted-foreground mb-1 text-xs">{item.label}</div>
          )}
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-muted-foreground text-left">
                <th className="py-1 pl-1">{t('cad_col_finding')}</th>
                <th>{t('cad_col_region')}</th>
                <th className="text-right">{t('cad_col_probability')}</th>
              </tr>
            </thead>
            <tbody>
              {item.findings.map((f, i) => {
                const isActive = sameFinding(f, activeFinding);
                const findingName = f.type || f.codeValue || '—';
                return (
                  <tr
                    key={i}
                    data-cy="cad-row"
                    data-active={isActive || undefined}
                    title={t('cad_jump_hint')}
                    className={`cursor-pointer border-t border-l-2 border-white/10 ${
                      isActive
                        ? 'border-l-[#4589ff] bg-[#161616] hover:bg-[#161616]'
                        : 'border-l-transparent hover:bg-[#333333]'
                    }`}
                    onClick={() => handleRowClick(f)}
                  >
                    <td className="py-1 pl-1">
                      <button
                        type="button"
                        className="w-full text-left focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#4589ff]"
                        aria-label={`${t('cad_jump_hint')} ${findingName}`}
                        onClick={event => {
                          event.stopPropagation();
                          handleRowClick(f);
                        }}
                      >
                        {findingName}
                      </button>
                    </td>
                    <td>{f.graphicType || '—'}</td>
                    <td className="pr-1 text-right">{pct(f.probability)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

export default CadPanel;
