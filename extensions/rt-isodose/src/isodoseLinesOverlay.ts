/**
 * Isodose-lines viewport overlay — cornerstone/DOM glue.
 *
 * Draws vector isodose contours (Eclipse-style lines, not wash) over each MPR
 * viewport: samples the loaded RTDOSE volume on the current camera plane into a
 * CSS-pixel grid, runs the pure marching-squares core ({@link ./marchingSquares})
 * per level, and renders colored SVG polylines in an overlay layer owned by this
 * module. Zero-fork: the SVG is appended into cornerstone's `div.viewport-element`
 * AFTER the tools' `svg.svg-layer` (cornerstone's removeEnabledElement removes the
 * FIRST svg it finds — ours must not be it), styled exactly like that layer
 * (absolute, 100%, pointer-events:none). Redraws on CAMERA_MODIFIED (covers MPR
 * scroll/zoom/pan — VOLUME_NEW_IMAGE derives from it) coalesced through rAF, and
 * self-cleans on the global ELEMENT_DISABLED.
 */
import { eventTarget, Enums, utilities as csUtils } from '@cornerstonejs/core';
import { isodoseLinesForLevels, trilinearSample } from './marchingSquares';
import type { IsodoseLineLevel } from './isodoseLineLevels';

const LAYER_CLASS = 'rt-isodose-layer';
const SVG_NS = 'http://www.w3.org/2000/svg';
/** Sample-grid step in CSS pixels (resolution/perf trade-off). */
const SAMPLE_STEP_PX = 3;

interface OverlayEntry {
  viewportId: string;
  element: HTMLDivElement;
  svg: SVGSVGElement;
  onCameraModified: () => void;
  onElementDisabled: (evt: any) => void;
}

const overlays = new Map<string, OverlayEntry>();

/** Whether any (or a specific) isodose-lines overlay is attached. */
export function hasIsodoseLines(viewportId?: string): boolean {
  return viewportId ? overlays.has(viewportId) : overlays.size > 0;
}

/** Ids of viewports currently carrying an overlay (for E2E/introspection). */
export function isodoseLinesViewportIds(): string[] {
  return [...overlays.keys()];
}

function detachEntry(entry: OverlayEntry) {
  entry.element.removeEventListener(Enums.Events.CAMERA_MODIFIED, entry.onCameraModified);
  eventTarget.removeEventListener(Enums.Events.ELEMENT_DISABLED, entry.onElementDisabled);
  entry.svg.remove();
  overlays.delete(entry.viewportId);
}

/** Remove the overlay from one viewport, or from all when no id is given. */
export function detachIsodoseLines(viewportId?: string): number {
  const targets = viewportId
    ? [overlays.get(viewportId)].filter(Boolean)
    : [...overlays.values()];
  targets.forEach(e => detachEntry(e as OverlayEntry));
  return targets.length;
}

/**
 * Draw the isodose contours for the viewport's current camera into `svg`.
 * Exported for testability; normally driven by the CAMERA_MODIFIED listener.
 */
export function renderIsodoseLines(
  viewport: any,
  volume: any,
  levels: IsodoseLineLevel[],
  svg: SVGSVGElement
): number {
  const element: HTMLDivElement = viewport?.element;
  const w = element?.clientWidth ?? 0;
  const h = element?.clientHeight ?? 0;
  const imageData = volume?.imageData;
  while (svg.firstChild) {
    svg.removeChild(svg.firstChild);
  }
  if (!w || !h || !imageData || !levels.length) {
    return 0;
  }
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

  // canvasToWorld/worldToCanvas are CSS-pixel based; both the canvas→world and
  // world→index maps are affine, so 3 anchor probes give index-space basis
  // vectors and every sample becomes pure arithmetic (no per-sample VTK calls).
  const step = SAMPLE_STEP_PX;
  const i00: number[] = imageData.worldToIndex(viewport.canvasToWorld([0, 0]));
  const iX: number[] = imageData.worldToIndex(viewport.canvasToWorld([step, 0]));
  const iY: number[] = imageData.worldToIndex(viewport.canvasToWorld([0, step]));
  const dix = [iX[0] - i00[0], iX[1] - i00[1], iX[2] - i00[2]];
  const diy = [iY[0] - i00[0], iY[1] - i00[1], iY[2] - i00[2]];

  const dims: [number, number, number] = volume.dimensions;
  const scalars: ArrayLike<number> | undefined =
    volume.voxelManager?.getCompleteScalarDataArray?.();

  const gw = Math.floor(w / step) + 1;
  const gh = Math.floor(h / step) + 1;
  const field = new Float32Array(gw * gh);
  for (let row = 0; row < gh; row++) {
    const bi = i00[0] + row * diy[0];
    const bj = i00[1] + row * diy[1];
    const bk = i00[2] + row * diy[2];
    for (let col = 0; col < gw; col++) {
      const i = bi + col * dix[0];
      const j = bj + col * dix[1];
      const k = bk + col * dix[2];
      let v: number;
      if (scalars) {
        v = trilinearSample(scalars, dims, i, j, k);
      } else {
        // Fallback sampler (silent NaN off-grid) when the complete array is unavailable.
        v = csUtils.VoxelManager?.sampleAtWorldCoordinates
          ? csUtils.VoxelManager.sampleAtWorldCoordinates(
              volume,
              ...(imageData.indexToWorld([i, j, k]) as [number, number, number])
            )
          : 0;
        if (!Number.isFinite(v)) {
          v = 0;
        }
      }
      field[col + row * gw] = v;
    }
  }

  let paths = 0;
  // low → high so hotter (clinically more important) lines draw on top
  const byRaw = [...levels].sort((a, b) => a.raw - b.raw);
  for (const level of byRaw) {
    const contours = isodoseLinesForLevels(field, gw, gh, [level.raw])[0];
    if (!contours) {
      continue;
    }
    for (const polyline of contours.polylines) {
      if (polyline.length < 2) {
        continue;
      }
      const d =
        `M ${(polyline[0][0] * step).toFixed(1)} ${(polyline[0][1] * step).toFixed(1)} ` +
        polyline
          .slice(1)
          .map(p => `L ${(p[0] * step).toFixed(1)} ${(p[1] * step).toFixed(1)}`)
          .join(' ');
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', level.hex);
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('stroke-opacity', '0.95');
      path.setAttribute('data-percent', String(level.percent));
      svg.appendChild(path);
      paths++;
    }
  }
  return paths;
}

/**
 * Attach (or refresh) the isodose-lines overlay on a viewport. Returns false
 * when the viewport has no usable DOM container.
 */
export function attachIsodoseLines(
  viewport: any,
  volume: any,
  levels: IsodoseLineLevel[]
): boolean {
  const element: HTMLDivElement | undefined = viewport?.element;
  const container: Element | null | undefined = element?.querySelector?.('div.viewport-element');
  if (!element || !container) {
    return false;
  }
  const viewportId: string = viewport.id;
  const existing = overlays.get(viewportId);
  if (existing) {
    detachEntry(existing);
  }

  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('class', LAYER_CLASS);
  svg.style.position = 'absolute';
  svg.style.top = '0';
  svg.style.left = '0';
  svg.style.width = '100%';
  svg.style.height = '100%';
  svg.style.pointerEvents = 'none';
  // append LAST: cornerstone's removeEnabledElement removes the first <svg>,
  // which must remain the tools' svg-layer.
  container.appendChild(svg);

  let rafPending = false;
  const redraw = () => {
    if (rafPending) {
      return;
    }
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      try {
        renderIsodoseLines(viewport, volume, levels, svg);
      } catch (e) {
        /* never let a redraw break the render loop */
      }
    });
  };

  const onElementDisabled = (evt: any) => {
    const disabledElement = evt?.detail?.element;
    const disabledId = evt?.detail?.viewportId;
    if (disabledElement === element || disabledId === viewportId) {
      const entry = overlays.get(viewportId);
      if (entry) {
        detachEntry(entry);
      }
    }
  };

  element.addEventListener(Enums.Events.CAMERA_MODIFIED, redraw);
  eventTarget.addEventListener(Enums.Events.ELEMENT_DISABLED, onElementDisabled);
  overlays.set(viewportId, {
    viewportId,
    element,
    svg,
    onCameraModified: redraw,
    onElementDisabled,
  });

  renderIsodoseLines(viewport, volume, levels, svg);
  return true;
}
