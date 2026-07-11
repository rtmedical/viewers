/**
 * RT Tree panel (RTV-133) — hierarchical browser of the study's RT objects
 * (RTSTRUCT/RTPLAN/RTDOSE/RTIMAGE + structure-set ROIs). Subscribes to the
 * native DisplaySetService and renders the tested buildRtTreeModel with
 * expand/collapse. RTV-114: public service APIs only; display logic in the
 * React-free view model. RTPLAN beam nodes are included (RTV-133); DVH nodes
 * and click-to-viewport navigation are follow-ups (dose computation / RT
 * viewport commands).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { buildRtTreeModel, type RtTreeNode } from './rtTreeViewModel';

interface DisplaySetServiceLike {
  EVENTS?: Record<string, string>;
  getActiveDisplaySets?: () => unknown[];
  activeDisplaySets?: unknown[];
  subscribe?: (event: string, cb: () => void) => { unsubscribe: () => void };
}
interface ServicesManagerLike {
  services: { displaySetService?: DisplaySetServiceLike } & Record<string, unknown>;
}
export interface RTTreePanelProps {
  servicesManager: ServicesManagerLike;
}

const NODE_ICON: Record<string, string> = {
  rtstruct: '◧',
  rtplan: '⚙',
  rtdose: '▦',
  rtimage: '▢',
  roi: '•',
  beam: '↯',
};

const readDisplaySets = (svc?: DisplaySetServiceLike): any[] => {
  if (!svc) {
    return [];
  }
  return (svc.getActiveDisplaySets?.() ?? svc.activeDisplaySets ?? []) as any[];
};

function TreeItem({ node, depth }: { node: RtTreeNode; depth: number }): React.ReactElement {
  const [open, setOpen] = useState(true);
  const hasChildren = !!node.children?.length;
  return (
    <li>
      <div
        className="flex cursor-default items-center gap-1 rounded px-1 py-0.5 text-sm hover:bg-black/30"
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={() => hasChildren && setOpen(o => !o)}
        data-cy={`rt-tree-node-${node.type}`}
      >
        <span className="w-3 text-xs opacity-70">{hasChildren ? (open ? '▾' : '▸') : ''}</span>
        <span className="opacity-80">{NODE_ICON[node.type] ?? '•'}</span>
        <span className="truncate">{node.label}</span>
      </div>
      {hasChildren && open && (
        <ul>
          {node.children!.map(child => (
            <TreeItem key={child.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function RTTreePanel({ servicesManager }: RTTreePanelProps): React.ReactElement {
  const displaySetService = servicesManager.services.displaySetService;
  const [tree, setTree] = useState<RtTreeNode[]>(() =>
    buildRtTreeModel(readDisplaySets(displaySetService))
  );

  const refresh = useCallback(
    () => setTree(buildRtTreeModel(readDisplaySets(displaySetService))),
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

  return (
    <div className="ohif-scrollbar flex h-full flex-col text-white" data-cy="rtmedical-rt-tree-panel">
      <div className="px-2 py-2 text-base font-medium">RT Tree</div>
      {tree.length === 0 ? (
        <div className="text-muted-foreground px-2 py-4 text-sm">Nenhum objeto RT carregado.</div>
      ) : (
        <ul className="flex-1 overflow-auto px-1">
          {tree.map(node => (
            <TreeItem key={node.id} node={node} depth={0} />
          ))}
        </ul>
      )}
    </div>
  );
}

export default RTTreePanel;
