/**
 * Study tab bar (RTV-41).
 *
 * Renders the open studies, switches on click, closes on the × or middle-click,
 * reorders by drag, and binds the tab hotkeys. All behaviour comes from the pure
 * model and {@link ./tabsHotkeys}; this component decides nothing.
 *
 * Drag-and-drop uses the native HTML5 API rather than a library: a tab bar is a
 * single-axis reorder, the pure `moveTab` already handles the index arithmetic and
 * clamps a drop that lands off the bar, and adding a dnd dependency for that would
 * be a poor trade.
 *
 * RTV-114: `@ohif/ui-next` conventions only, no core imports.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { BindingSet, resolveTabAction } from './tabsHotkeys';
import { useStudyTabsStore } from './useStudyTabsStore';

export interface StudyTabsBarProps {
  /** Called when the reader asks for a new tab (Alt+T or the + button). */
  onRequestNewTab?: () => void;
  /** Called after the active tab changes, so the shell can route/restore. */
  onActivate?: (tabId: string) => void;
  /** Which hotkey set to bind. `app` (Alt) by default — see ./tabsHotkeys. */
  bindings?: BindingSet;
  /** Surfaces a rejection (tab limit) — usually uiNotificationService.show. */
  onError?: (message: string) => void;
}

export function StudyTabsBar({
  onRequestNewTab,
  onActivate,
  bindings = 'app',
  onError,
}: StudyTabsBarProps): React.ReactElement | null {
  const tabs = useStudyTabsStore(s => s.tabs);
  const activeTabId = useStudyTabsStore(s => s.activeTabId);
  const lastError = useStudyTabsStore(s => s.lastError);
  const close = useStudyTabsStore(s => s.close);
  const activate = useStudyTabsStore(s => s.activate);
  const activateAt = useStudyTabsStore(s => s.activateAt);
  const cycle = useStudyTabsStore(s => s.cycle);
  const move = useStudyTabsStore(s => s.move);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const isMac = useRef(
    typeof navigator !== 'undefined' && /mac/i.test(navigator.platform ?? '')
  ).current;

  useEffect(() => {
    if (lastError) {
      onError?.(lastError);
    }
  }, [lastError, onError]);

  const select = useCallback(
    (tabId: string) => {
      activate(tabId);
      onActivate?.(tabId);
    },
    [activate, onActivate]
  );

  // Hotkeys. Bound on the document because the reader is looking at a viewport,
  // not at the tab bar, when they press Alt+2.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = resolveTabAction(event as never, { bindings, isMac });
      if (!action) {
        return;
      }
      event.preventDefault();
      if (action.type === 'new') {
        onRequestNewTab?.();
      } else if (action.type === 'close') {
        if (activeTabId) {
          close(activeTabId);
        }
      } else if (action.type === 'select') {
        activateAt(action.position);
      } else {
        cycle(action.delta);
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [bindings, isMac, activeTabId, close, activateAt, cycle, onRequestNewTab]);

  if (!tabs.length) {
    return null;
  }

  return (
    <div
      className="flex h-9 items-stretch gap-px overflow-x-auto bg-black/40 text-sm"
      role="tablist"
      aria-label="Open studies"
      data-cy="rt-study-tabs"
    >
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            title={tab.sublabel ? `${tab.label} — ${tab.sublabel}` : tab.label}
            draggable
            onDragStart={() => setDragIndex(index)}
            onDragOver={event => event.preventDefault()}
            onDrop={() => {
              if (dragIndex != null) {
                move(dragIndex, index);
              }
              setDragIndex(null);
            }}
            onDragEnd={() => setDragIndex(null)}
            onClick={() => select(tab.id)}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                select(tab.id);
              }
            }}
            // Middle-click closes, as in a browser.
            onAuxClick={event => {
              if (event.button === 1) {
                event.preventDefault();
                close(tab.id);
              }
            }}
            className={[
              'group flex min-w-[9rem] max-w-[16rem] cursor-pointer select-none items-center gap-2 px-3',
              isActive ? 'bg-white/15 text-white' : 'text-white/70 hover:bg-white/10',
              dragIndex === index ? 'opacity-50' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <span className="truncate">{tab.label}</span>
            <button
              type="button"
              aria-label={`Close ${tab.label}`}
              className="ml-auto shrink-0 rounded px-1 text-white/50 opacity-0 hover:bg-white/20 hover:text-white group-hover:opacity-100 focus:opacity-100"
              onClick={event => {
                // Without this the click also selects the tab being closed.
                event.stopPropagation();
                close(tab.id);
              }}
            >
              ×
            </button>
          </div>
        );
      })}

      {onRequestNewTab && (
        <button
          type="button"
          aria-label="Open a study"
          className="shrink-0 px-3 text-white/60 hover:bg-white/10 hover:text-white"
          onClick={onRequestNewTab}
        >
          +
        </button>
      )}
    </div>
  );
}

export default StudyTabsBar;
