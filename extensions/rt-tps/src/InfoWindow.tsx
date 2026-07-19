import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PlanFieldsTable from './components/PlanFieldsTable';
import PlanDoseTab from './components/PlanDoseTab';

/**
 * Eclipse-style "Info Window" — the bottom bar of the TPS layout (RTV Wave 4).
 *
 * Tabbed table region below the viewports, matching the Varian Eclipse External
 * Beam Planning Info Window. Leading tabs are native Eclipse tables (Fields =
 * per-beam field table, Dose = prescription/fractionation); the rest compose the
 * existing RT panels by module id (DVH, Isodoses, Course, Record). Strings are
 * i18n via the `RTMedical` namespace. Display-only.
 */

/** Guards one tab so a single panel error can't take down the whole layout. */
class PanelBoundary extends React.Component<
  { children: React.ReactNode; fallback: string },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    if (this.state.error) {
      return <div className="text-muted-foreground p-2 text-sm">{this.props.fallback}</div>;
    }
    return this.props.children;
  }
}

interface InfoTab {
  key: string;
  /** i18n key (RTMedical namespace) for the tab label. */
  labelKey: string;
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
  { key: 'fields', labelKey: 'tab_fields', render: p => <PlanFieldsTable servicesManager={p.servicesManager} /> },
  { key: 'dose', labelKey: 'tab_dose', render: p => <PlanDoseTab servicesManager={p.servicesManager} /> },
  { key: 'dvh', labelKey: 'tab_dvh', panelId: '@ohif/extension-rt-dvh.panelModule.dvh' },
  { key: 'isodose', labelKey: 'tab_isodoses', panelId: '@ohif/extension-rt-isodose.panelModule.isodose' },
  { key: 'course', labelKey: 'tab_course', panelId: '@ohif/extension-rt-timeline.panelModule.courseTimeline' },
  { key: 'record', labelKey: 'tab_record', panelId: '@ohif/extension-rt-record.panelModule.doseInformation' },
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
  const { t } = useTranslation('RTMedical');
  const [active, setActive] = useState(INFO_TABS[0].key);

  const tab = useMemo(() => INFO_TABS.find(item => item.key === active), [active]);

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
        {INFO_TABS.map(item => (
          <button
            key={item.key}
            type="button"
            data-cy={`rt-tps-tab-${item.key}`}
            onClick={() => setActive(item.key)}
            className={`px-3 py-1 text-sm ${
              active === item.key
                ? 'border-primary text-foreground border-b-2'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <PanelBoundary key={active} fallback={t('tab_unavailable')}>
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
            <div className="text-muted-foreground p-2 text-sm">{t('tab_no_data')}</div>
          )}
        </PanelBoundary>
      </div>
    </div>
  );
}
