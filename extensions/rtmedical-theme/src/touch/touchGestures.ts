/**
 * RTV-210 — touch/tablet gestures for the viewer viewports (iPad rounds).
 *
 * Zero-fork wiring on top of the stock Cornerstone3D 5.0.2 touch pipeline:
 *
 *  1. Pinch-to-zoom (2 fingers)  — the stock ZoomTool already binds
 *     `{ numTouchPoints: 2 }` in every tool group (modes/basic
 *     initToolGroups.ts:32/140/192/296) and defaults to
 *     `pinchToZoom: true` (ZoomTool.js:14), which routes its
 *     `touchDragCallback` to `_pinchCallback` (ZoomTool.js:134-135).
 *  2. One-finger drag — slice navigation. StackScroll is re-bound from the
 *     stock `{ numTouchPoints: 3 }` to `{ numTouchPoints: 1 }` and promoted to
 *     the front of the tool-group's toolOptions, because the touch dispatcher
 *     returns the FIRST Active tool whose binding matches — and tools bound to
 *     the primary mouse button (WindowLevel) also match one-finger events
 *     (getActiveToolForTouchEvent.js:17-27).
 *  3. Two-finger pan — ZoomTool's pinch callback also pans while zooming
 *     (`configuration.pan: true` by default, ZoomTool.js:15 + 159-161), the
 *     standard tablet UX.
 *  4. Double-tap → reset zoom/pan — element-level TOUCH_TAP
 *     ('CORNERSTONE_TOOLS_TAP', tools enums/Events.d.ts:46) with
 *     `detail.taps === 2`, running the stock 'resetViewport' command on the
 *     tapped viewport.
 *  5. Long-press → viewport context menu — element-level TOUCH_PRESS
 *     ('CORNERSTONE_TOOLS_TOUCH_PRESS', enums/Events.d.ts:43; fires after a
 *     700 ms hold with <5 px movement, touchStartListener.js:40-41). Runs the
 *     same command list the stock right-click runs (customization
 *     'cornerstoneViewportClickCommands'.button3 — right-click parity).
 *  6. Three-finger swipe → next/previous study — element-level TOUCH_SWIPE
 *     ('CORNERSTONE_TOOLS_SWIPE', enums/Events.d.ts:47; `detail.swipe`
 *     direction + native TouchEvent in `detail.event`), mapped through the
 *     pure ./touchGestureMap onto the RTV-120 worklist commands. The stock
 *     `{ numTouchPoints: 3 }` bindings (StackScroll / volume3d Pan) are
 *     removed so a three-finger swipe only navigates.
 *
 * All binding edits go through the public ToolGroup API and are ADDITIVE to
 * the existing mouse setup: `setToolActive` merges previous + new bindings
 * (ToolGroup.js:169-183) and `setToolPassive(tool, { removeAllBindings:
 * [binding] })` removes exactly the listed bindings, re-activating the tool
 * when other bindings remain (ToolGroup.js:235-244).
 */
// ⚠️ Do NOT import '@cornerstonejs/core' here: rtmedical-theme carries a
// NESTED node_modules copy of it (pulled in by the legacy @ohif/core peerDep),
// so eventTarget/getEnabledElements would bind to a DEAD second instance whose
// enabled-element store is always empty (same failure class as the historical
// nested-@ohif/core bundle break). Elements and lifecycle come from OHIF's
// cornerstoneViewportService instead, which always holds the app's instance.
// '@cornerstonejs/tools' is safe — it is NOT nested and resolves hoisted.
import { Enums as csToolsEnums } from '@cornerstonejs/tools';
import { commandForSwipe, commandForTap } from './touchGestureMap';

/** Static toolNames of the stock tools (e.g. StackScrollTool.js:77). */
const STACK_SCROLL = 'StackScroll';
const PAN = 'Pan';
const ZOOM = 'Zoom';

/** Guard against a single physical swipe double-navigating. */
const NAV_COOLDOWN_MS = 800;

export interface ApplyTouchGesturesParams {
  servicesManager: { services: Record<string, any> };
  commandsManager: {
    run: (input: unknown, options?: Record<string, unknown>) => unknown;
    runCommand: (name: string, options?: Record<string, unknown>, context?: string) => unknown;
  };
  /** Tool groups to receive the touch bindings (skips ids that don't exist). */
  toolGroupIds?: string[];
}

export type TeardownTouchGestures = () => void;

/** Module-level singleton so re-entering a mode never stacks listeners. */
let activeTeardown: TeardownTouchGestures | null = null;

/**
 * Re-bind one tool group for the tablet gesture set. Idempotent: binding
 * merges de-duplicate (ToolGroup.js:175-183) and the reorder is a no-op once
 * StackScroll is already first.
 */
function bindTouchBindings(toolGroup: any): void {
  // Item 2 — one-finger drag scrolls the stack. Replace the stock 3-finger
  // binding with a 1-finger one, keeping the mouse-wheel binding intact.
  if (toolGroup.hasTool?.(STACK_SCROLL)) {
    toolGroup.setToolPassive?.(STACK_SCROLL, { removeAllBindings: [{ numTouchPoints: 3 }] });
    toolGroup.setToolActive?.(STACK_SCROLL, { bindings: [{ numTouchPoints: 1 }] });
    promoteToolForTouch(toolGroup, STACK_SCROLL);
  }

  // Item 6 prerequisite — volume3d binds Pan to { numTouchPoints: 3 }
  // (initToolGroups.ts:300); strip it so three-finger swipes only navigate.
  // Pan keeps its Auxiliary mouse binding and stays Active (ToolGroup.js:241-243).
  if (toolGroup.hasTool?.(PAN)) {
    const bindings = toolGroup.getToolOptions?.(PAN)?.bindings ?? [];
    if (bindings.some((b: any) => b?.numTouchPoints === 3)) {
      toolGroup.setToolPassive?.(PAN, { removeAllBindings: [{ numTouchPoints: 3 }] });
    }
  }

  // Items 1+3 — ensure the pinch binding exists (stock groups already carry
  // it; this is a safety net for customized groups). ZoomTool defaults
  // pinchToZoom + pan (ZoomTool.js:14-15), so two fingers zoom AND pan.
  if (toolGroup.hasTool?.(ZOOM)) {
    const bindings = toolGroup.getToolOptions?.(ZOOM)?.bindings ?? [];
    if (!bindings.some((b: any) => b?.numTouchPoints === 2)) {
      toolGroup.setToolActive?.(ZOOM, { bindings: [{ numTouchPoints: 2 }] });
    }
  }
}

/**
 * Move a tool to the FRONT of the tool group's `toolOptions` insertion order.
 * The CS3D touch dispatcher picks the first Active tool whose binding matches
 * the event, and a one-finger touch also matches any tool bound to the primary
 * mouse button (getActiveToolForTouchEvent.js:14-27). The stock groups insert
 * WindowLevel first, so without this promotion a one-finger drag would always
 * window-level instead of scrolling slices. `toolOptions` is a public plain
 * object on ToolGroup (ToolGroup.d.ts:8); later `setToolActive` calls reassign
 * existing keys and therefore preserve this order.
 */
function promoteToolForTouch(toolGroup: any, toolName: string): void {
  const options = toolGroup?.toolOptions;
  if (!options || !options[toolName]) {
    return;
  }
  const keys = Object.keys(options);
  if (keys[0] === toolName) {
    return;
  }
  const reordered: Record<string, unknown> = { [toolName]: options[toolName] };
  keys.forEach(key => {
    if (key !== toolName) {
      reordered[key] = options[key];
    }
  });
  toolGroup.toolOptions = reordered;
}

/**
 * Install the RTV-210 touch gesture layer. Returns a teardown function
 * (used by the modes' onModeExit). Safe to call repeatedly — a previous
 * installation is torn down first.
 */
export function applyTouchGestures({
  servicesManager,
  commandsManager,
  toolGroupIds = ['default', 'mpr', 'SRToolGroup', 'volume3d'],
}: ApplyTouchGesturesParams): TeardownTouchGestures {
  // Idempotency: never stack listeners across repeated mode entries.
  activeTeardown?.();

  const { toolGroupService, viewportGridService, customizationService, cornerstoneViewportService } =
    servicesManager.services;

  // ---- 1) tool-group bindings (items 1/2/3 + swipe conflict removal) ------
  toolGroupIds.forEach(toolGroupId => {
    try {
      const toolGroup = toolGroupService?.getToolGroup?.(toolGroupId);
      if (toolGroup) {
        bindTouchBindings(toolGroup);
      }
    } catch (e) {
      /* tool group unavailable — non-fatal, others still bound */
    }
  });

  // ---- 2) element-level gesture listeners (items 4/5/6) -------------------
  let lastNavigationTs = 0;

  /** Item 4 — double-tap resets camera/props of the tapped viewport. */
  const onTap = (evt: any) => {
    const detail = evt?.detail;
    if (!detail) {
      return;
    }
    // TouchTapEventDetail: taps + currentPointsList (EventTypes.d.ts:168-172).
    const command = commandForTap({
      taps: detail.taps,
      pointerCount: detail.currentPointsList?.length ?? 1,
    });
    if (!command) {
      return;
    }
    try {
      // 'resetViewport' acts on the ACTIVE viewport (commandsModule.ts:1257),
      // so focus the tapped one first.
      viewportGridService?.setActiveViewportId?.(detail.viewportId);
    } catch (e) {
      /* fall through — reset still applies to the active viewport */
    }
    commandsManager.runCommand(command);
  };

  /**
   * Item 5 — long-press ≡ right-click. Runs the same customizable command
   * list the stock initContextMenu runs for button3 (initContextMenu.ts:41-64),
   * so the measurements context menu opens when pressing on/near an
   * annotation (menu 'measurementsContextMenu' requires nearbyToolData).
   */
  const onPress = (evt: any) => {
    const detail = evt?.detail;
    if (!detail) {
      return;
    }
    const toRun = customizationService?.getCustomization?.(
      'cornerstoneViewportClickCommands'
    )?.button3;
    if (!toRun) {
      return;
    }
    try {
      viewportGridService?.setActiveViewportId?.(detail.viewportId);
    } catch (e) {
      /* non-fatal */
    }
    // TouchPressEventDetail has startPoints/lastPoints but no currentPoints
    // (EventTypes.d.ts:176-181); synthesize the shape findNearbyToolData and
    // the ContextMenuController position logic expect (currentPoints.client).
    const syntheticEvent = { detail: { ...detail, currentPoints: detail.startPoints } };
    let nearbyToolData = null;
    if (Array.isArray(toRun) && toRun.some((c: any) => c?.commandOptions?.requireNearbyToolData)) {
      try {
        nearbyToolData = commandsManager.runCommand(
          'getNearbyAnnotation',
          { element: detail.element, canvasCoordinates: detail.startPoints?.canvas },
          'CORNERSTONE'
        );
      } catch (e) {
        /* no annotation lookup — menu selectors just won't match */
      }
    }
    commandsManager.run(toRun, { nearbyToolData, event: syntheticEvent });
  };

  /** Item 6 — three-finger horizontal swipe navigates the worklist. */
  const onSwipe = (evt: any) => {
    const detail = evt?.detail;
    if (!detail) {
      return;
    }
    // TouchSwipeEventDetail: swipe direction + native TouchEvent
    // (EventTypes.d.ts:173-175); finger count from event.touches.
    const command = commandForSwipe({
      swipe: detail.swipe,
      pointerCount: detail.event?.touches?.length ?? 0,
    });
    if (!command) {
      return;
    }
    const now = Date.now();
    if (now - lastNavigationTs < NAV_COOLDOWN_MS) {
      return;
    }
    lastNavigationTs = now;
    commandsManager.runCommand(command);
  };

  const listeners: Array<[string, (evt: any) => void]> = [
    [csToolsEnums.Events.TOUCH_TAP, onTap],
    [csToolsEnums.Events.TOUCH_PRESS, onPress],
    [csToolsEnums.Events.TOUCH_SWIPE, onSwipe],
  ];

  const attachedElements = new Set<HTMLElement>();

  const attach = (element?: HTMLElement | null) => {
    if (!element || attachedElements.has(element)) {
      return;
    }
    listeners.forEach(([name, handler]) => element.addEventListener(name, handler));
    attachedElements.add(element);
  };

  const detach = (element?: HTMLElement | null) => {
    if (!element || !attachedElements.has(element)) {
      return;
    }
    listeners.forEach(([name, handler]) => element.removeEventListener(name, handler));
    attachedElements.delete(element);
  };

  // Elements + lifecycle via OHIF's cornerstoneViewportService (the app's
  // cornerstone instance — see the import note at the top). attach() is
  // idempotent, so re-running on every VIEWPORT_DATA_CHANGED is safe and also
  // covers late-mounting viewports; DOM listeners on destroyed elements die
  // with the node.
  const attachAllViewports = () => {
    try {
      const re = cornerstoneViewportService?.getRenderingEngine?.();
      (re?.getViewports?.() ?? []).forEach((vp: any) => attach(vp?.element));
    } catch (e) {
      /* rendering engine not ready — the subscription below covers it */
    }
  };
  const vpDataChangedSub = cornerstoneViewportService?.subscribe?.(
    cornerstoneViewportService?.EVENTS?.VIEWPORT_DATA_CHANGED,
    () => attachAllViewports()
  );
  attachAllViewports();

  const teardown: TeardownTouchGestures = () => {
    vpDataChangedSub?.unsubscribe?.();
    Array.from(attachedElements).forEach(detach);
    if (activeTeardown === teardown) {
      activeTeardown = null;
    }
    // Tool-group bindings are not restored: onModeExit destroys the tool
    // groups and onModeEnter recreates them with the stock bindings.
  };

  activeTeardown = teardown;
  return teardown;
}

/** Command-friendly teardown (no-op when nothing is installed). */
export function removeTouchGestures(): void {
  activeTeardown?.();
}
