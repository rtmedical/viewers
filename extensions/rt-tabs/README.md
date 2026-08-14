# @ohif/extension-rt-tabs

Multi-tab inside one window — **RTV-41**. Several studies open at once, each keeping
its own state, switchable in one click or one keystroke.

Follows the **RTV-114** extension-first / zero-fork policy: it does **not** modify
`@ohif/core`, `@ohif/app` or `@ohif/ui`.

## Modules

| Module | Purpose |
| --- | --- |
| `tabsModel` (`openTab`, `closeTab`, `moveTab`, `serializeTabs`, …) | Pure, unit-tested state model — every decision lives here |
| `tabsHotkeys` (`resolveTabAction`, `describeBindings`) | Pure keystroke → intent mapping, two binding sets |
| `useStudyTabsStore` | zustand wrapper + the localStorage side effect. No logic |
| `StudyTabsBar` | The bar: click to switch, × or middle-click to close, drag to reorder |
| `getCommandsModule` | `rtTabsOpenStudy`, `rtTabsClose`, `rtTabsCloseOthers`, `rtTabsCloseAll`, `rtTabsSelect`, `rtTabsNext`, `rtTabsPrevious`, `rtTabsSaveSnapshot` |

The pure-core / thin-wrapper split mirrors `rtmedical-theme/src/mipSlab.ts`. It
matters here because the interesting behaviour of a tab bar is *all* edge cases —
closing the active tab, reopening an already-open study, restoring a corrupt
session — and none of it needs a DOM to verify.

## Decisions worth knowing

**Reopening an open study activates the existing tab.** It does not open a second
one. Two tabs on the same study would give the reader two divergent measurement
states for one patient.

**Hitting the tab limit is rejected, not absorbed.** With `TAB_LIMIT = 8`, opening a
ninth study returns `'rejected'` with a reason instead of evicting the oldest tab —
eviction could silently discard unsaved measurements. The caller surfaces the reason.

**Closing the active tab activates the tab to its right**, falling back to the left.
Browser behaviour, and it keeps the reader's place when closing through a run of tabs.

**The persisted session is treated as hostile input.** `localStorage` survives
upgrades, is shared with every app on the origin, and can be hand-edited. Bad JSON,
a foreign schema version or a junk array yields an *empty* session — a viewer that
will not start is far worse than one that forgot yesterday's tabs. Malformed
*entries* are dropped individually so one bad tab does not cost the session, and a
stale `activeTabId` falls back to the first tab.

### Why the default hotkeys are not ⌘T / ⌘W

The ticket asks for "⌘T/W/1-9". In a **browser** those are not ours to take:
`Ctrl/⌘+T` opens a browser tab, `Ctrl/⌘+W` closes the browser tab, and Chrome
reserves `Ctrl+1…8` for switching browser tabs. A page cannot reliably
`preventDefault` them — the browser sees them first — so shipping them as the
default would give a hotkey that works on the developer's machine and **loses the
reader's session** on someone else's.

So there are two sets:

| Set | Modifier | When |
| --- | --- | --- |
| `app` (default) | `Alt` | Any browser. Fully interceptable. |
| `desktop` | `⌘` on macOS, `Ctrl` elsewhere | Once the app owns the window — the Tauri shell (RTVW epic, gated on **RTV-8**). |

Both sets bind `T` (new), `W` (close), `1…9` (by position), `Tab` / `Shift+Tab` and
`←` / `→` (cycle, wrapping). Hotkeys never fire from an `input`, `textarea`,
`select` or `contenteditable`, so `Alt+W` inside the report editor types instead of
closing the study.

## Wiring it up

```tsx
import { StudyTabsBar, useStudyTabsStore } from '@ohif/extension-rt-tabs';

<StudyTabsBar
  onRequestNewTab={() => navigate('/worklist-rt')}
  onActivate={tabId => restoreStudy(tabId)}
  onError={message => uiNotificationService.show({ title: 'Study tabs', message, type: 'warning' })}
/>;
```

Add `'@ohif/extension-rt-tabs': '^3.0.0'` to the mode's `extensionDependencies` and
mount `StudyTabsBar` in the mode's `LayoutTemplate`, above the viewport grid.

## Scope / follow-ups

- **Per-tab state is carried, not captured.** Each tab has an opaque `snapshot`
  slot, and `rtTabsSaveSnapshot` stores whatever the shell puts in it. Actually
  *capturing* and *restoring* OHIF's viewport grid, presentation and measurement
  state into that slot is integration work against several services, and is not in
  this extension. The model never reads the snapshot, so that shape can evolve
  without touching any logic here.
- **Dragging a tab out into its own window** is `RTVW-8`, and needs the desktop
  shell.
- **Routing is the caller's job.** `onActivate` fires with the tab id; this
  extension does not navigate.
- **Not validated in a browser.** The DEV1 box has no memory headroom to build and
  serve the viewer (see `docker/README.md`), and the fork's CI is blocked by a
  GitHub billing lock. The evidence is the unit tests: the model and the hotkey
  mapping are covered, the React bar is not.

## Tests

```bash
node node_modules/.bin/jest --config extensions/rt-tabs/jest.config.js --ci
```
