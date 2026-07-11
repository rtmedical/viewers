import React, { useMemo, useState } from 'react';

/**
 * Eclipse-style "Info Window" — the bottom bar of the TPS layout (RTV Wave 4).
 * Tabbed table region below the viewports that composes the existing RT panels
 * (Plan/Ficha, DVH, Isodoses, Course, Dose Info) by module id. panelService only
 * supports Left/Right, so this bottom zone is rendered directly by the layout.
 * Display-only.
 */

/** Guards one tab so a single panel error can't take down the whole layout. */
class PanelBoundary extends React.Component<{ children: React.ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    if (this.state.error) {
      return <div className="p-2 text-sm text-muted-foreground">Painel indisponível.</div>;
    }
    return this.props.children;
  }
}

interface InfoTab {
  key: string;
  label: string;
  /** Extension panel module id to resolve + render. */
  panelId: string;
}

const INFO_TABS: InfoTab[] = [
  { key: 'plan', label: 'Plano', panelId: '@ohif/extension-rt-plan.panelModule.rtPlan' },
  { key: 'dvh', label: 'DVH', panelId: '@ohif/extension-rt-dvh.panelModule.dvh' },
  { key: 'isodose', label: 'Isodoses', panelId: '@ohif/extension-rt-isodose.panelModule.isodose' },
  { key: 'course', label: 'Curso', panelId: '@ohif/extension-rt-timeline.panelModule.courseTimeline' },
  { key: 'doseInfo', label: 'Dose', panelId: '@ohif/extension-rt-record.panelModule.doseInformation' },
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

  const ActivePanel = useMemo(() => {
    const tab = INFO_TABS.find(t => t.key === active);
    if (!tab) {
      return null;
    }
    const entry = extensionManager?.getModuleEntry?.(tab.panelId);
    return entry?.component ?? null;
  }, [active, extensionManager]);

  return (
    <div
      className="flex h-[240px] flex-col border-t border-input bg-background text-foreground"
      data-cy="rt-tps-info-window"
    >
      {/* Eclipse Info Window tab strip */}
      <div className="flex shrink-0 items-center gap-0.5 border-b border-input bg-muted/40 px-1">
        {INFO_TABS.map(tab => (
          <button
            key={tab.key}
            type="button"
            data-cy={`rt-tps-tab-${tab.key}`}
            onClick={() => setActive(tab.key)}
            className={`px-3 py-1 text-sm ${
              active === tab.key
                ? 'border-b-2 border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <PanelBoundary key={active}>
          {ActivePanel ? (
            <ActivePanel
              servicesManager={servicesManager}
              commandsManager={commandsManager}
              extensionManager={extensionManager}
            />
          ) : (
            <div className="p-2 text-sm text-muted-foreground">Sem dados para esta aba.</div>
          )}
        </PanelBoundary>
      </div>
    </div>
  );
}
