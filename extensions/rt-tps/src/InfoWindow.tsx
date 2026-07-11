import React, { useMemo, useState } from 'react';
import PlanFieldsTable from './components/PlanFieldsTable';
import PlanDoseTab from './components/PlanDoseTab';

/**
 * Eclipse-style "Info Window" — the bottom bar of the TPS layout (RTV Wave 4).
 *
 * Tabbed table region below the viewports, matching the Varian Eclipse External
 * Beam Planning Info Window (manual ref p28_i0.png). The leading tabs are native
 * Eclipse tables built here (Campos = per-beam field table, Dose = prescription /
 * fractionation); the remaining tabs compose the existing RT panels by module id
 * (DVH, Isodoses, Course, treatment Record). panelService only supports
 * Left/Right, so this bottom zone is rendered directly by the layout. Display-only.
 */

/** Guards one tab so a single panel error can't take down the whole layout. */
class PanelBoundary extends React.Component<{ children: React.ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    if (this.state.error) {
      return <div className="text-muted-foreground p-2 text-sm">Painel indisponível.</div>;
    }
    return this.props.children;
  }
}

interface InfoTab {
  key: string;
  label: string;
  /** Native component rendered here (Eclipse tables), OR ... */
  render?: (props: {
    servicesManager: any;
    extensionManager: any;
    commandsManager: any;
  }) => React.ReactNode;
  /** ... an extension panel module id to resolve + render. */
  panelId?: string;
}

const INFO_TABS: InfoTab[] = [
  { key: 'fields', label: 'Campos', render: p => <PlanFieldsTable servicesManager={p.servicesManager} /> },
  { key: 'dose', label: 'Dose', render: p => <PlanDoseTab servicesManager={p.servicesManager} /> },
  { key: 'dvh', label: 'DVH', panelId: '@ohif/extension-rt-dvh.panelModule.dvh' },
  { key: 'isodose', label: 'Isodoses', panelId: '@ohif/extension-rt-isodose.panelModule.isodose' },
  { key: 'course', label: 'Curso', panelId: '@ohif/extension-rt-timeline.panelModule.courseTimeline' },
  { key: 'record', label: 'Registro', panelId: '@ohif/extension-rt-record.panelModule.doseInformation' },
];

export default function InfoWindow({
  servicesManager,
  extensionManager,
  commandsManager,
}: {
  servicesManager: any;
  extensionManager: any;
  commandsManager: any;
}): React.ReactElement {
  const [active, setActive] = useState(INFO_TABS[0].key);

  const tab = useMemo(() => INFO_TABS.find(t => t.key === active), [active]);

  const ComposedPanel = useMemo(() => {
    if (!tab?.panelId) {
      return null;
    }
    const entry = extensionManager?.getModuleEntry?.(tab.panelId);
    return entry?.component ?? null;
  }, [tab, extensionManager]);

  return (
    <div
      className="border-input bg-background text-foreground flex h-[240px] flex-col border-t"
      data-cy="rt-tps-info-window"
    >
      {/* Eclipse Info Window tab strip */}
      <div className="border-input bg-muted/40 flex shrink-0 items-center gap-0.5 border-b px-1">
        {INFO_TABS.map(t => (
          <button
            key={t.key}
            type="button"
            data-cy={`rt-tps-tab-${t.key}`}
            onClick={() => setActive(t.key)}
            className={`px-3 py-1 text-sm ${
              active === t.key
                ? 'border-primary text-foreground border-b-2'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <PanelBoundary key={active}>
          {tab?.render ? (
            tab.render({ servicesManager, extensionManager, commandsManager })
          ) : ComposedPanel ? (
            <div className="h-full overflow-auto">
              <ComposedPanel
                servicesManager={servicesManager}
                commandsManager={commandsManager}
                extensionManager={extensionManager}
              />
            </div>
          ) : (
            <div className="text-muted-foreground p-2 text-sm">Sem dados para esta aba.</div>
          )}
        </PanelBoundary>
      </div>
    </div>
  );
}
