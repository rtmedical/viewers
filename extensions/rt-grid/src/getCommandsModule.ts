/**
 * Reference-grid commands (RTV-142) — the toolbar glue.
 *
 * Every decision is in the pure {@link ./grid} model; the markup is the pure
 * {@link ./gridOverlay} builder. This file only holds the current state, reads the
 * active viewport's image geometry, and mounts the result — the same
 * pure-core/thin-glue split as `rtmedical-theme`'s mipSlabCommands.
 *
 * No '@cornerstonejs/core' import: the viewport is reached through the services
 * manager and duck-typed, so the module stays jest-testable with plain objects.
 */
import {
  adjustSpacingMm,
  buildGridLines,
  clampSpacingMm,
  defaultGridState,
  describeGrid,
  deserializeGrid,
  GRID_STORAGE_KEY,
  GridState,
  moveGridMm,
  resetGridOffset,
  resolvePixelSpacing,
  serializeGrid,
  toggleGrid,
} from './grid';
import { buildGridSvgDocument, mountGridOverlay, unmountGridOverlay } from './gridOverlay';

interface ServicesManagerLike {
  services: Record<string, any>;
}

export interface GridCommandResult {
  ok: boolean;
  reason?: string;
  state?: GridState;
  /** False when the image has no PixelSpacing, so the grid is in pixels. */
  calibrated?: boolean;
  truncated?: boolean;
}

/** localStorage, or null where it is unavailable. */
function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function createGridActions({ servicesManager }: { servicesManager?: ServicesManagerLike }) {
  let state: GridState = (() => {
    try {
      return deserializeGrid(storage()?.getItem(GRID_STORAGE_KEY));
    } catch {
      return defaultGridState();
    }
  })();

  const persist = () => {
    try {
      storage()?.setItem(GRID_STORAGE_KEY, serializeGrid(state));
    } catch {
      // A full quota must never break the toolbar.
    }
  };

  const services = () => servicesManager?.services ?? {};

  const notify = (message: string, type: 'info' | 'warning' = 'info') => {
    services().uiNotificationService?.show?.({
      title: 'Reference grid',
      message,
      type,
      duration: 3000,
    });
  };

  /** The active viewport plus what the grid needs from its image. */
  function activeImage(): {
    element: any;
    widthPx: number;
    heightPx: number;
    pixelSpacing?: [number, number];
  } | null {
    const { viewportGridService, cornerstoneViewportService } = services();
    const viewportId =
      viewportGridService?.getActiveViewportId?.() ??
      viewportGridService?.getState?.()?.activeViewportId;
    if (!viewportId) {
      return null;
    }
    const viewport = cornerstoneViewportService?.getCornerstoneViewport?.(viewportId);
    if (!viewport) {
      return null;
    }

    const image = viewport.getImageData?.();
    // Stack viewports expose dimensions/spacing on the image data; a volume
    // viewport reports the slice's in-plane dimensions the same way.
    const dims = image?.dimensions ?? [];
    const spacing = image?.spacing ?? [];
    const widthPx = Number(dims[0]) || Number(image?.columns) || 0;
    const heightPx = Number(dims[1]) || Number(image?.rows) || 0;
    const colMm = Number(spacing[0]);
    const rowMm = Number(spacing[1]);

    return {
      element: viewport.element ?? viewport.canvas?.parentElement ?? null,
      widthPx,
      heightPx,
      pixelSpacing:
        Number.isFinite(rowMm) && Number.isFinite(colMm) && rowMm > 0 && colMm > 0
          ? [rowMm, colMm]
          : undefined,
    };
  }

  /** Recomputes and remounts the overlay for the current state. */
  function render(): GridCommandResult {
    const image = activeImage();
    if (!image) {
      return { ok: false, reason: 'No active viewport.', state };
    }
    if (!state.visible) {
      unmountGridOverlay(image.element);
      return { ok: true, state, calibrated: !!image.pixelSpacing };
    }
    if (!image.widthPx || !image.heightPx) {
      return { ok: false, reason: 'The image is not loaded yet.', state };
    }

    const lines = buildGridLines({
      widthPx: image.widthPx,
      heightPx: image.heightPx,
      pixelSpacingMm: image.pixelSpacing,
      spacingMm: state.spacingMm,
      offsetMm: state.offsetMm,
      majorEvery: state.majorEvery,
    });
    mountGridOverlay(
      image.element,
      buildGridSvgDocument(lines, image.widthPx, image.heightPx)
    );
    return {
      ok: true,
      state,
      calibrated: !!resolvePixelSpacing(image.pixelSpacing),
      truncated: lines.truncated,
    };
  }

  const commit = (next: GridState, announce = true): GridCommandResult => {
    state = next;
    persist();
    const result = render();
    if (announce) {
      notify(
        result.truncated
          ? `${describeGrid(state, result.calibrated)} — coarsened to stay responsive`
          : describeGrid(state, result.calibrated)
      );
    }
    if (!result.ok && result.reason) {
      notify(result.reason, 'warning');
    }
    return result;
  };

  return {
    /** Current settings — for a panel to render. */
    rtGridGetState: (): GridState => ({ ...state, offsetMm: { ...state.offsetMm } }),

    /** Show/hide the grid (the DrawGridTool toggle). */
    rtGridToggle: (): GridCommandResult => commit(toggleGrid(state)),

    /** Sets an explicit spacing in mm. */
    rtGridSetSpacing: ({ spacingMm }: { spacingMm?: number } = {}): GridCommandResult =>
      commit({ ...state, spacingMm: clampSpacingMm(spacingMm) }),

    /** Steps the spacing (toolbar +/-). */
    rtGridAdjustSpacing: ({ deltaMm }: { deltaMm?: number } = {}): GridCommandResult =>
      commit({ ...state, spacingMm: adjustSpacingMm(state.spacingMm, deltaMm) }),

    /** Drags the lattice (the MoveGridTool). Silent: it fires on every mouse move. */
    rtGridMove: ({ deltaXMm, deltaYMm }: { deltaXMm?: number; deltaYMm?: number } = {}) =>
      commit(moveGridMm(state, deltaXMm, deltaYMm), false),

    /** Puts the lattice back on the image origin. */
    rtGridResetOffset: (): GridCommandResult => commit(resetGridOffset(state)),

    /** Redraws after a pan/zoom/series change. Silent. */
    rtGridRefresh: (): GridCommandResult => render(),
  };
}

export type GridActions = ReturnType<typeof createGridActions>;

function getCommandsModule({ servicesManager }: { servicesManager?: ServicesManagerLike } = {}) {
  const actions = createGridActions({ servicesManager });
  const definitions = Object.keys(actions).reduce(
    (acc, name) => {
      acc[name] = { commandFn: actions[name as keyof typeof actions], storeContexts: [], options: {} };
      return acc;
    },
    {} as Record<string, { commandFn: unknown; storeContexts: string[]; options: Record<string, never> }>
  );
  return { actions, definitions, defaultContext: 'CORNERSTONE' };
}

export default getCommandsModule;
