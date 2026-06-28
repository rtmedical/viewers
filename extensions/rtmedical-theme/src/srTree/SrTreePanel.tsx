/**
 * SR tree panel (RTV-35) — navigable tree of the study's Structured Reports and
 * their measurements (parsed upstream by cornerstone-dicom-sr), with TXT export
 * and click-to-jump on a measurement (native jumpToMeasurement). Subscribes to
 * the DisplaySetService. RTV-114: public APIs + tested view model only.
 * Graphics-annotation rendering + HTML export are follow-ups.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@ohif/ui-next';
import { buildSrTreeModel, srToText, type SrTreeNode } from './srTreeViewModel';

interface DisplaySetServiceLike {
  EVENTS?: Record<string, string>;
  getActiveDisplaySets?: () => unknown[];
  activeDisplaySets?: unknown[];
  subscribe?: (event: string, cb: () => void) => { unsubscribe: () => void };
}
interface CommandsManagerLike {
  runCommand: (commandName: string, options?: Record<string, unknown>) => unknown;
}
interface ServicesManagerLike {
  services: { displaySetService?: DisplaySetServiceLike } & Record<string, unknown>;
}
export interface SrTreePanelProps {
  servicesManager: ServicesManagerLike;
  commandsManager: CommandsManagerLike;
}

const readDisplaySets = (svc?: DisplaySetServiceLike): any[] =>
  svc ? ((svc.getActiveDisplaySets?.() ?? svc.activeDisplaySets ?? []) as any[]) : [];

export function SrTreePanel({ servicesManager, commandsManager }: SrTreePanelProps): React.ReactElement {
  const displaySetService = servicesManager.services.displaySetService;
  const [tree, setTree] = useState<SrTreeNode[]>(() =>
    buildSrTreeModel(readDisplaySets(displaySetService))
  );

  const refresh = useCallback(
    () => setTree(buildSrTreeModel(readDisplaySets(displaySetService))),
    [displaySetService]
  );

  useEffect(() => {
    if (!displaySetService) {
      return undefined;
    }
    refresh();
    const events = displaySetService.EVENTS;
    const subs =
      events && displaySetService.subscribe
        ? [events.DISPLAY_SETS_ADDED, events.DISPLAY_SETS_CHANGED, events.DISPLAY_SETS_REMOVED]
            .filter(Boolean)
            .map(evt => displaySetService.subscribe!(evt, refresh))
        : [];
    return () => subs.forEach(s => s.unsubscribe && s.unsubscribe());
  }, [displaySetService, refresh]);

  const exportTxt = useCallback(() => {
    const text = srToText(readDisplaySets(displaySetService));
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'structured-report.txt';
    a.click();
    URL.revokeObjectURL(url);
  }, [displaySetService]);

  const jumpTo = useCallback(
    (uid?: string) => uid && commandsManager.runCommand('jumpToMeasurement', { uid }),
    [commandsManager]
  );

  return (
    <div className="ohif-scrollbar flex h-full flex-col text-white" data-cy="rtmedical-sr-tree-panel">
      <div className="flex items-center justify-between px-2 py-2">
        <span className="text-base font-medium">SR</span>
        <Button variant="ghost" size="sm" disabled={tree.length === 0} onClick={exportTxt}>
          TXT
        </Button>
      </div>
      {tree.length === 0 ? (
        <div className="text-muted-foreground px-2 py-4 text-sm">Nenhum SR carregado.</div>
      ) : (
        <ul className="flex-1 overflow-auto px-1">
          {tree.map(sr => (
            <li key={sr.id}>
              <div className="px-1 py-0.5 text-sm font-medium">▾ {sr.label}</div>
              <ul>
                {(sr.children || []).map(m => (
                  <li key={m.id}>
                    <button
                      type="button"
                      className="w-full truncate rounded px-1 py-0.5 pl-5 text-left text-sm hover:bg-black/30"
                      onClick={() => jumpTo(m.uid)}
                      title={m.label}
                    >
                      • {m.label}
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default SrTreePanel;
