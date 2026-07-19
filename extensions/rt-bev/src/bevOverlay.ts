/**
 * BEV viewport overlay — cornerstone/DOM glue (Phase B).
 *
 * Draws the RTPLAN beam aperture (MLC leaves + jaws + central-ray crosshair)
 * over the STACK viewport displaying an RTIMAGE (the DRRs render on the stock
 * stack viewport). Zero-fork, same PROVEN pattern as rt-isodose's
 * isodoseLinesOverlay: an own `<svg class="rt-bev-layer">` appended into
 * cornerstone's `div.viewport-element` AFTER the tools' `svg.svg-layer`
 * (cornerstone's removeEnabledElement removes the FIRST svg it finds — ours
 * must not be it), styled exactly like that layer (absolute, 100%,
 * pointer-events:none). Redraws on STACK_NEW_IMAGE (slice change) and
 * CAMERA_MODIFIED (zoom/pan) coalesced through rAF, and self-cleans on the
 * global ELEMENT_DISABLED.
 *
 * Coordinate pipeline per point (all pure math from ./bevGeometry):
 *   mm at isocenter ──rotateAboutDeg(+collimatorAngleDeg about (0,0), in the
 *   ISOTROPIC mm frame — rotating BEFORE the possibly anisotropic pixel
 *   scaling keeps rotated apertures rectangular under non-square
 *   ImagePlanePixelSpacing; equals the legacy -collimatorAngle pixel-space
 *   rotation for square pixels)──▶ rotated mm ──isocenterMmToImagePx
 *   (mag = sid/sad, guarded)──▶ image px ──(+0.5, +0.5)──▶ CS3D continuous
 *   image coords (the center of the first pixel sits at [0.5, 0.5]:
 *   imageToWorldCoords maps `imageCoords - 0.5` onto ImagePositionPatient)
 *   ──affine──▶ canvas CSS px.
 * The affine image-coords → canvas map is built from 3 probes per redraw
 * ((0,0), (1,0), (0,1) through csUtils.imageToWorldCoords + worldToCanvas —
 * both CSS-px based), so every subsequent point is pure arithmetic.
 *
 * Draw order/colors mirror the legacy DrawBlockAndMlcTool: MLC leaf bodies
 * blue rgb(0,0,255) stroke 1.5 / fill rgba(0,0,255,0.10), jaw rectangle black
 * stroke 1.5 (same transform), central-ray crosshair red full-canvas lines
 * through the isocenter projection, rotated WITH the collimator (legacy
 * passes angle = -col to its "raio central" imagelines — the physical
 * reticle is mounted in the collimator head and turns with it). Display-only.
 */
import { eventTarget, Enums, metaData, utilities as csUtils } from '@cornerstonejs/core';
import type { BevBeam } from './rtBevParser';
import { parseRtImageBevGeometry, referencedBeamNumber } from './rtBevParser';
import {
  buildAffine2D,
  isocenterMmToImagePx,
  leafApertureRects,
  rotateAboutDeg,
} from './bevGeometry';

const LAYER_CLASS = 'rt-bev-layer';
const SVG_NS = 'http://www.w3.org/2000/svg';

// Legacy DrawBlockAndMlcTool palette.
const MLC_STROKE = 'rgb(0,0,255)';
const MLC_FILL = 'rgba(0,0,255,0.10)';
const JAW_STROKE = 'rgb(0,0,0)';
const CROSSHAIR_STROKE = 'rgb(255,0,0)';
const STROKE_WIDTH = '1.5';

export interface BevOverlayOptions {
  /** RTPLAN beams (parsed + cached by the caller — see getCommandsModule). */
  getBeams: () => BevBeam[];
  /**
   * Naturalized instance for an imageId. Optional — the overlay falls back to
   * cornerstone `metaData.get('instance', imageId)` (OHIF's MetadataProvider
   * answers the 'instance' query with the naturalized instance).
   */
  resolveInstance?: (imageId: string) => Record<string, any> | undefined;
}

interface OverlayEntry {
  viewportId: string;
  viewport: any;
  element: HTMLDivElement;
  svg: SVGSVGElement;
  options: BevOverlayOptions;
  redraw: () => void;
  onElementDisabled: (evt: any) => void;
  /** Beam drawn on the last render (drives CP clamping / panel info). */
  lastBeam?: BevBeam;
}

const overlays = new Map<string, OverlayEntry>();

/** Selected control point, shared by every attached overlay. */
let controlPointIndex = 0;

/** Whether any (or a specific) BEV overlay is attached. */
export function hasBevOverlay(viewportId?: string): boolean {
  return viewportId ? overlays.has(viewportId) : overlays.size > 0;
}

/** Ids of viewports currently carrying a BEV overlay (E2E/introspection). */
export function bevViewportIds(): string[] {
  return [...overlays.keys()];
}

/** The currently selected control point index. */
export function getBevControlPointIndex(): number {
  return controlPointIndex;
}

/** Per-attached-viewport beam summary (for the panel / E2E). */
export function bevBeamInfo(): Array<{
  viewportId: string;
  beamNumber?: number;
  name?: string;
  cpCount: number;
}> {
  return [...overlays.values()].map(e => ({
    viewportId: e.viewportId,
    beamNumber: e.lastBeam?.beamNumber,
    name: e.lastBeam?.name,
    cpCount: e.lastBeam?.controlPoints?.length ?? 0,
  }));
}

function detachEntry(entry: OverlayEntry) {
  entry.element.removeEventListener(Enums.Events.STACK_NEW_IMAGE, entry.redraw);
  entry.element.removeEventListener(Enums.Events.CAMERA_MODIFIED, entry.redraw);
  eventTarget.removeEventListener(Enums.Events.ELEMENT_DISABLED, entry.onElementDisabled);
  entry.svg.remove();
  overlays.delete(entry.viewportId);
}

/** Remove the overlay from one viewport, or from all when no id is given. */
export function detachBevOverlay(viewportId?: string): number {
  const targets = viewportId
    ? [overlays.get(viewportId)].filter(Boolean)
    : [...overlays.values()];
  targets.forEach(e => detachEntry(e as OverlayEntry));
  return targets.length;
}

/**
 * Select the control point every attached overlay renders. Clamped to the
 * largest CP count among the attached beams (when known) and re-rendered
 * synchronously. Returns the applied (clamped) index.
 */
export function setBevControlPointIndex(index: number): number {
  let next = Math.max(0, Math.round(Number(index) || 0));
  const cpCounts = [...overlays.values()]
    .map(e => e.lastBeam?.controlPoints?.length ?? 0)
    .filter(n => n > 0);
  if (cpCounts.length) {
    next = Math.min(next, Math.max(...cpCounts) - 1);
  }
  controlPointIndex = next;
  overlays.forEach(entry => {
    try {
      const { beam } = renderBev(entry.viewport, entry.options, entry.svg, controlPointIndex);
      entry.lastBeam = beam ?? entry.lastBeam;
    } catch (e) {
      /* never let a re-render break the caller */
    }
  });
  return controlPointIndex;
}

function appendPolygon(
  svg: SVGSVGElement,
  points: Array<[number, number]>,
  attrs: { fill: string; stroke: string; cls: string; dataAttrs?: Record<string, string> }
) {
  const polygon = document.createElementNS(SVG_NS, 'polygon');
  polygon.setAttribute('points', points.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' '));
  polygon.setAttribute('fill', attrs.fill);
  polygon.setAttribute('stroke', attrs.stroke);
  polygon.setAttribute('stroke-width', STROKE_WIDTH);
  polygon.setAttribute('class', attrs.cls);
  Object.entries(attrs.dataAttrs ?? {}).forEach(([k, v]) => polygon.setAttribute(k, v));
  svg.appendChild(polygon);
}

function appendLine(
  svg: SVGSVGElement,
  from: [number, number],
  to: [number, number],
  stroke: string,
  cls: string
) {
  const line = document.createElementNS(SVG_NS, 'line');
  line.setAttribute('x1', from[0].toFixed(1));
  line.setAttribute('y1', from[1].toFixed(1));
  line.setAttribute('x2', to[0].toFixed(1));
  line.setAttribute('y2', to[1].toFixed(1));
  line.setAttribute('stroke', stroke);
  line.setAttribute('stroke-width', '1');
  line.setAttribute('class', cls);
  svg.appendChild(line);
}

/**
 * Draw the beam aperture for the viewport's CURRENT image + control point
 * into `svg`. Exported for testability; normally driven by the
 * STACK_NEW_IMAGE / CAMERA_MODIFIED listeners. Returns the drawn-element
 * count and the resolved beam (undefined when nothing could be resolved —
 * e.g. the user scrolled the stack to a non-RTIMAGE frame).
 */
export function renderBev(
  viewport: any,
  options: BevOverlayOptions,
  svg: SVGSVGElement,
  cpIndex: number
): { drawn: number; beam?: BevBeam } {
  const element: HTMLDivElement = viewport?.element;
  const w = element?.clientWidth ?? 0;
  const h = element?.clientHeight ?? 0;
  while (svg.firstChild) {
    svg.removeChild(svg.firstChild);
  }
  if (!w || !h) {
    return { drawn: 0 };
  }
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

  // ---- resolve the current image → naturalized instance → geometry/beam ----
  let imageId: string | undefined;
  try {
    imageId = viewport?.getCurrentImageId?.();
  } catch (e) {
    imageId = undefined;
  }
  if (!imageId) {
    return { drawn: 0 };
  }
  const instance =
    options.resolveInstance?.(imageId) ?? (metaData.get('instance', imageId) as any);
  if (!instance) {
    return { drawn: 0 };
  }
  const geom = parseRtImageBevGeometry(instance);
  if (!geom) {
    return { drawn: 0 }; // current frame is not a placeable RTIMAGE
  }
  const beamNo = referencedBeamNumber(instance);
  const beam = (options.getBeams() ?? []).find(b => b.beamNumber === beamNo);
  if (!beam || !beam.controlPoints.length) {
    return { drawn: 0 };
  }
  const idx = Math.min(Math.max(0, cpIndex), beam.controlPoints.length - 1);
  const cp = beam.controlPoints[idx];

  // ---- affine image-coords → canvas CSS px, from 3 probes per redraw ----
  let pxToCanvas: (pt: [number, number]) => [number, number];
  try {
    const probe = (pt: [number, number]): [number, number] | undefined => {
      const world = csUtils.imageToWorldCoords(imageId as string, pt);
      return world ? (viewport.worldToCanvas(world) as [number, number]) : undefined;
    };
    const p00 = probe([0, 0]);
    const p10 = probe([1, 0]);
    const p01 = probe([0, 1]);
    if (!p00 || !p10 || !p01) {
      return { drawn: 0, beam };
    }
    const affine = buildAffine2D(p00, p10, p01);
    // Our image px puts the center of the first pixel at 0; CS3D continuous
    // image coords put it at 0.5 (imageToWorldCoords subtracts 0.5).
    pxToCanvas = ([px, py]) => affine.apply([px + 0.5, py + 0.5]);
  } catch (e) {
    return { drawn: 0, beam }; // no imagePlaneModule for this imageId
  }

  const collimatorAngleDeg = cp.collimatorAngleDeg ?? 0;
  // Rotate by +collimatorAngle about (0,0) in the ISOTROPIC mm frame, THEN
  // project — equivalent to the legacy -collimatorAngle pixel-space rotation
  // for square pixels, and still correct (no shear) for non-square
  // ImagePlanePixelSpacing, where rotation and the anisotropic scaling of
  // isocenterMmToImagePx do not commute (see rotateAboutDeg docs).
  const mmToCanvas = (pt: [number, number]): [number, number] =>
    pxToCanvas(isocenterMmToImagePx(rotateAboutDeg(pt, [0, 0], collimatorAngleDeg), geom));

  let drawn = 0;

  // 1) MLC aperture leaf rects (blue, translucent fill) — legacy draw order.
  for (const rect of leafApertureRects(beam, idx)) {
    appendPolygon(
      svg,
      [
        mmToCanvas([rect.xMm1, rect.yMm1]),
        mmToCanvas([rect.xMm2, rect.yMm1]),
        mmToCanvas([rect.xMm2, rect.yMm2]),
        mmToCanvas([rect.xMm1, rect.yMm2]),
      ],
      {
        fill: MLC_FILL,
        stroke: MLC_STROKE,
        cls: 'rt-bev-leaf',
        dataAttrs: { 'data-leaf': String(rect.leafIndex), 'data-bank': rect.bank },
      }
    );
    drawn++;
  }

  // 2) Jaw rectangle (black, same transform).
  if (cp.jawXmm && cp.jawYmm) {
    const [x1, x2] = cp.jawXmm;
    const [y1, y2] = cp.jawYmm;
    appendPolygon(
      svg,
      [
        mmToCanvas([x1, y1]),
        mmToCanvas([x2, y1]),
        mmToCanvas([x2, y2]),
        mmToCanvas([x1, y2]),
      ],
      { fill: 'none', stroke: JAW_STROKE, cls: 'rt-bev-jaw' }
    );
    drawn++;
  }

  // 3) Central-ray crosshair (red, full canvas) through the isocenter
  // projection, along the COLLIMATOR-ROTATED BEV axes (same mmToCanvas
  // transform as the jaws/leaves): the legacy tool draws its "raio central"
  // imagelines with angle = -col, matching the physical reticle mounted in
  // the collimator head. Identical to the image row/column axes at col 0.
  const c = mmToCanvas([0, 0]);
  const ex = mmToCanvas([1, 0]);
  const ey = mmToCanvas([0, 1]);
  const reach = (w + h) * 2;
  for (const dir of [
    [ex[0] - c[0], ex[1] - c[1]],
    [ey[0] - c[0], ey[1] - c[1]],
  ]) {
    const norm = Math.hypot(dir[0], dir[1]) || 1;
    const u: [number, number] = [dir[0] / norm, dir[1] / norm];
    appendLine(
      svg,
      [c[0] - u[0] * reach, c[1] - u[1] * reach],
      [c[0] + u[0] * reach, c[1] + u[1] * reach],
      CROSSHAIR_STROKE,
      'rt-bev-crosshair'
    );
    drawn++;
  }

  return { drawn, beam };
}

/**
 * Attach (or refresh) the BEV overlay on a stack viewport. Returns false when
 * the viewport has no usable DOM container.
 */
export function attachBevOverlay(viewport: any, options: BevOverlayOptions): boolean {
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

  const entry: OverlayEntry = {
    viewportId,
    viewport,
    element,
    svg,
    options,
    redraw: () => undefined, // replaced below
    onElementDisabled: () => undefined, // replaced below
  };

  let rafPending = false;
  entry.redraw = () => {
    if (rafPending) {
      return;
    }
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      try {
        const { beam } = renderBev(viewport, options, svg, controlPointIndex);
        entry.lastBeam = beam ?? entry.lastBeam;
      } catch (e) {
        /* never let a redraw break the render loop */
      }
    });
  };

  entry.onElementDisabled = (evt: any) => {
    const disabledElement = evt?.detail?.element;
    const disabledId = evt?.detail?.viewportId;
    if (disabledElement === element || disabledId === viewportId) {
      const current = overlays.get(viewportId);
      if (current) {
        detachEntry(current);
      }
    }
  };

  element.addEventListener(Enums.Events.STACK_NEW_IMAGE, entry.redraw);
  element.addEventListener(Enums.Events.CAMERA_MODIFIED, entry.redraw);
  eventTarget.addEventListener(Enums.Events.ELEMENT_DISABLED, entry.onElementDisabled);
  overlays.set(viewportId, entry);

  try {
    const { beam } = renderBev(viewport, options, svg, controlPointIndex);
    entry.lastBeam = beam;
  } catch (e) {
    /* initial render best-effort — listeners will retry */
  }
  return true;
}
