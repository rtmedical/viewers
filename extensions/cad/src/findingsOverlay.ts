/**
 * CAD finding-marker viewport overlay (RTV-79/78 follow-up) — cornerstone/DOM
 * glue over the pure math in ./findingsGeometry.
 *
 * Zero-fork, same PROVEN pattern as rt-bev's bevOverlay: an own
 * `<svg class="cad-findings-layer">` appended into cornerstone's
 * `div.viewport-element` AFTER the tools' `svg.svg-layer` (cornerstone's
 * removeEnabledElement removes the FIRST svg it finds — ours must not be it),
 * styled exactly like that layer (absolute, 100%, pointer-events:none).
 * Redraws on STACK_NEW_IMAGE (slice change) and CAMERA_MODIFIED (zoom/pan)
 * coalesced through rAF, and self-cleans on the global ELEMENT_DISABLED.
 *
 * Per redraw: the viewport's current imageId resolves to its naturalized
 * instance (metaData.get('instance', imageId)) → SOPInstanceUID (+ 1-based
 * frame when the imageId is a multiframe frame id); markers are drawn for the
 * findings of EVERY loaded CAD display set that reference that image. The
 * image-coords → canvas affine is built from 3 probes
 * ((0,0),(1,0),(0,1) through csUtils.imageToWorldCoords + worldToCanvas), so
 * per-point math is pure arithmetic.
 *
 * Coordinate convention: SCOORD GraphicData is ALREADY in the continuous
 * (column,row) image coordinates CS3D's imageToWorldCoords expects — OHIF's
 * own SR renderer (cornerstone-dicom-sr getRenderableData) passes GraphicData
 * pairs straight through with no half-pixel shift, so unlike rt-bev (which
 * converts a pixel-INDEX frame and therefore adds +0.5) NO offset is applied.
 */
import { eventTarget, Enums, metaData, utilities as csUtils } from '@cornerstonejs/core';
import type { CadFinding } from './cadSr';
import {
  boundsOf,
  buildAffine2D,
  chunkPairs,
  circleFromCenterPerimeter,
  clampToBox,
  ellipseFromAxisEndpoints,
  estimateLabelBox,
  findingLabel,
  findingMatchesImage,
  frameNumberFromImageId,
  sameFinding,
  Point2,
} from './findingsGeometry';

const LAYER_CLASS = 'cad-findings-layer';
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Carbon alert orange — the default marker color. */
const MARKER_COLOR = '#ff832b';
/** Carbon blue-50 — the highlighted (jumped-to) finding. */
const HIGHLIGHT_COLOR = '#4589ff';
const MARKER_WIDTH = '2';
const HIGHLIGHT_WIDTH = '3';
const POINT_RADIUS = 12;
const CROSS_ARM = 5;
const LABEL_FONT_PX = 11;
const LABEL_BACKDROP = 'rgba(22, 22, 22, 0.85)';

export interface CadOverlayOptions {
  /** Findings of ALL loaded CAD display sets (read live on every redraw). */
  getFindings: () => CadFinding[];
}

interface OverlayEntry {
  viewportId: string;
  viewport: any;
  element: HTMLDivElement;
  svg: SVGSVGElement;
  options: CadOverlayOptions;
  redraw: () => void;
  onElementDisabled: (evt: any) => void;
}

const overlays = new Map<string, OverlayEntry>();

/** The finding the last jump selected — rendered blue + pulsing. */
let highlightedFinding: CadFinding | null = null;

/** Whether any (or a specific) CAD findings overlay is attached. */
export function hasCadFindingsOverlay(viewportId?: string): boolean {
  return viewportId ? overlays.has(viewportId) : overlays.size > 0;
}

/** Ids of viewports currently carrying the overlay (E2E/introspection). */
export function cadFindingsViewportIds(): string[] {
  return [...overlays.keys()];
}

/** The currently highlighted finding (or null). */
export function getHighlightedFinding(): CadFinding | null {
  return highlightedFinding;
}

/**
 * Select the finding every attached overlay renders highlighted (blue +
 * pulsing); `null` clears the highlight. Re-renders synchronously.
 */
export function setHighlightedFinding(finding: CadFinding | null): void {
  highlightedFinding = finding ?? null;
  overlays.forEach(entry => {
    try {
      renderCadFindings(entry.viewport, entry.options, entry.svg);
    } catch (e) {
      /* never let a re-render break the caller */
    }
  });
}

function detachEntry(entry: OverlayEntry) {
  entry.element.removeEventListener(Enums.Events.STACK_NEW_IMAGE, entry.redraw);
  entry.element.removeEventListener(Enums.Events.CAMERA_MODIFIED, entry.redraw);
  eventTarget.removeEventListener(Enums.Events.ELEMENT_DISABLED, entry.onElementDisabled);
  entry.svg.remove();
  overlays.delete(entry.viewportId);
}

/** Remove the overlay from one viewport, or from all when no id is given. */
export function detachCadFindingsOverlay(viewportId?: string): number {
  const targets = viewportId ? [overlays.get(viewportId)].filter(Boolean) : [...overlays.values()];
  targets.forEach(e => detachEntry(e as OverlayEntry));
  return targets.length;
}

// ---------------------------------------------------------------------------
// SVG helpers
// ---------------------------------------------------------------------------

function makeEl(name: string, attrs: Record<string, string>): SVGElement {
  const el = document.createElementNS(SVG_NS, name) as SVGElement;
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}

function appendLine(g: SVGElement, from: Point2, to: Point2, stroke: string, width: string) {
  g.appendChild(
    makeEl('line', {
      x1: from[0].toFixed(1),
      y1: from[1].toFixed(1),
      x2: to[0].toFixed(1),
      y2: to[1].toFixed(1),
      stroke,
      'stroke-width': width,
    })
  );
}

/** Small ×-free "+" cross used by MULTIPOINT and as the unknown-type fallback. */
function appendCross(
  g: SVGElement,
  [x, y]: Point2,
  stroke: string,
  width: string,
  arm = CROSS_ARM
) {
  appendLine(g, [x - arm, y], [x + arm, y], stroke, width);
  appendLine(g, [x, y - arm], [x, y + arm], stroke, width);
}

/** POINT marker: ~12px circle + center dot + 4 crosshair ticks outside it. */
function appendPointMarker(g: SVGElement, [x, y]: Point2, stroke: string, width: string) {
  g.appendChild(
    makeEl('circle', {
      cx: x.toFixed(1),
      cy: y.toFixed(1),
      r: String(POINT_RADIUS),
      fill: 'none',
      stroke,
      'stroke-width': width,
    })
  );
  // The only filled shape of the marker set: the POINT center dot.
  g.appendChild(
    makeEl('circle', {
      cx: x.toFixed(1),
      cy: y.toFixed(1),
      r: '2',
      fill: stroke,
      stroke: 'none',
    })
  );
  const inner = POINT_RADIUS + 2;
  const outer = POINT_RADIUS + 8;
  appendLine(g, [x - outer, y], [x - inner, y], stroke, width);
  appendLine(g, [x + inner, y], [x + outer, y], stroke, width);
  appendLine(g, [x, y - outer], [x, y - inner], stroke, width);
  appendLine(g, [x, y + inner], [x, y + outer], stroke, width);
}

function appendMarker(
  g: SVGElement,
  graphicType: string | undefined,
  pts: Point2[],
  stroke: string,
  width: string
) {
  switch ((graphicType ?? '').toUpperCase()) {
    case 'POINT': {
      appendPointMarker(g, pts[0], stroke, width);
      return;
    }
    case 'MULTIPOINT': {
      pts.forEach(pt => appendCross(g, pt, stroke, width));
      return;
    }
    case 'CIRCLE': {
      const circle = circleFromCenterPerimeter(pts);
      if (!circle) {
        break;
      }
      g.appendChild(
        makeEl('circle', {
          cx: circle.cx.toFixed(1),
          cy: circle.cy.toFixed(1),
          r: circle.r.toFixed(1),
          fill: 'none',
          stroke,
          'stroke-width': width,
        })
      );
      return;
    }
    case 'ELLIPSE': {
      const ellipse = ellipseFromAxisEndpoints(pts);
      if (!ellipse) {
        break;
      }
      g.appendChild(
        makeEl('ellipse', {
          cx: ellipse.cx.toFixed(1),
          cy: ellipse.cy.toFixed(1),
          rx: ellipse.rx.toFixed(1),
          ry: ellipse.ry.toFixed(1),
          fill: 'none',
          stroke,
          'stroke-width': width,
          transform: `rotate(${ellipse.rotationDeg.toFixed(2)} ${ellipse.cx.toFixed(1)} ${ellipse.cy.toFixed(1)})`,
        })
      );
      return;
    }
    case 'POLYLINE': {
      g.appendChild(
        makeEl('polyline', {
          points: pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' '),
          fill: 'none',
          stroke,
          'stroke-width': width,
        })
      );
      return;
    }
    default:
      break;
  }
  // Unknown/degenerate graphic type: mark every point we do have.
  pts.forEach(pt => appendCross(g, pt, stroke, width));
}

function appendLabel(
  g: SVGElement,
  finding: CadFinding,
  pts: Point2[],
  color: string,
  viewW: number,
  viewH: number
) {
  const bounds = boundsOf(pts);
  if (!bounds) {
    return;
  }
  const text = findingLabel(finding);
  const { w, h } = estimateLabelBox(text, LABEL_FONT_PX);
  // Offset right of the marker; POINT bounds collapse to the click point, so
  // clear its circle + crosshair ticks too.
  const isPoint = (finding.graphicType ?? '').toUpperCase() === 'POINT';
  const offsetX = isPoint ? POINT_RADIUS + 10 : 8;
  const [x, y] = clampToBox(
    bounds.maxX + offsetX,
    (bounds.minY + bounds.maxY) / 2 - h / 2,
    w,
    h,
    viewW,
    viewH
  );
  g.appendChild(
    makeEl('rect', {
      x: x.toFixed(1),
      y: y.toFixed(1),
      width: String(w),
      height: String(h),
      rx: '2',
      fill: LABEL_BACKDROP,
      class: 'cad-finding-label-backdrop',
    })
  );
  const textEl = makeEl('text', {
    x: (x + 4).toFixed(1),
    y: (y + h - 5).toFixed(1),
    fill: color,
    'font-size': String(LABEL_FONT_PX),
    'font-family': 'Inter, "Helvetica Neue", Arial, sans-serif',
    class: 'cad-finding-label',
  });
  textEl.textContent = text;
  g.appendChild(textEl);
}

/** Pulsing-opacity highlight animation, self-contained inside the svg. */
function appendStyle(svg: SVGSVGElement) {
  const style = document.createElementNS(SVG_NS, 'style');
  style.textContent = [
    '@keyframes cad-finding-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }',
    '.cad-finding-highlighted { animation: cad-finding-pulse 1.2s ease-in-out infinite; }',
    '@media (prefers-reduced-motion: reduce) { .cad-finding-highlighted { animation: none; } }',
  ].join('\n');
  svg.appendChild(style);
}

// ---------------------------------------------------------------------------
// Render + attach
// ---------------------------------------------------------------------------

/**
 * Draw the markers of every finding referencing the viewport's CURRENT image
 * into `svg`. Exported for testability; normally driven by the
 * STACK_NEW_IMAGE / CAMERA_MODIFIED listeners.
 */
export function renderCadFindings(
  viewport: any,
  options: CadOverlayOptions,
  svg: SVGSVGElement
): { drawn: number } {
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

  // ---- resolve the current image → SOPInstanceUID (+ frame) ----
  let imageId: string | undefined;
  try {
    imageId = viewport?.getCurrentImageId?.();
  } catch (e) {
    imageId = undefined;
  }
  if (!imageId) {
    return { drawn: 0 };
  }
  const instance = metaData.get('instance', imageId) as any;
  const sopInstanceUID: string | undefined = instance?.SOPInstanceUID;
  if (!sopInstanceUID) {
    return { drawn: 0 };
  }
  let stackImageIds: string[] = [];
  try {
    stackImageIds = viewport?.getImageIds?.() ?? [];
  } catch (e) {
    stackImageIds = [];
  }
  const frameNumber = frameNumberFromImageId(imageId, stackImageIds) ?? 1;

  const findings = (options.getFindings() ?? []).filter(
    f => findingMatchesImage(f, sopInstanceUID, frameNumber) && (f.points?.length ?? 0) >= 2
  );
  if (!findings.length) {
    return { drawn: 0 };
  }

  // ---- affine image-coords → canvas CSS px, from 3 probes per redraw ----
  // No +0.5: SCOORD GraphicData already uses the continuous image-coordinate
  // convention imageToWorldCoords expects (see the module header).
  let toCanvas: (pt: Point2) => Point2;
  try {
    const probe = (pt: Point2): Point2 | undefined => {
      const world = csUtils.imageToWorldCoords(imageId as string, pt);
      return world ? (viewport.worldToCanvas(world) as Point2) : undefined;
    };
    const p00 = probe([0, 0]);
    const p10 = probe([1, 0]);
    const p01 = probe([0, 1]);
    if (!p00 || !p10 || !p01) {
      return { drawn: 0 };
    }
    const affine = buildAffine2D(p00, p10, p01);
    toCanvas = pt => affine.apply(pt);
  } catch (e) {
    return { drawn: 0 }; // no imagePlaneModule for this imageId
  }

  appendStyle(svg);
  let drawn = 0;
  for (const finding of findings) {
    const pts = chunkPairs(finding.points).map(toCanvas);
    if (!pts.length) {
      continue;
    }
    const isHighlighted = sameFinding(finding, highlightedFinding);
    const color = isHighlighted ? HIGHLIGHT_COLOR : MARKER_COLOR;
    const width = isHighlighted ? HIGHLIGHT_WIDTH : MARKER_WIDTH;
    const g = makeEl('g', {
      class: isHighlighted ? 'cad-finding cad-finding-highlighted' : 'cad-finding',
      'data-graphic-type': (finding.graphicType ?? '').toUpperCase(),
    });
    if (isHighlighted) {
      g.setAttribute('data-highlighted', 'true');
    }
    appendMarker(g, finding.graphicType, pts, color, width);
    appendLabel(g, finding, pts, color, w, h);
    svg.appendChild(g);
    drawn++;
  }
  return { drawn };
}

/**
 * Attach (or refresh) the CAD findings overlay on a stack viewport. Returns
 * false when the viewport has no usable DOM container.
 */
export function attachCadFindingsOverlay(viewport: any, options: CadOverlayOptions): boolean {
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
        renderCadFindings(viewport, options, svg);
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
    renderCadFindings(viewport, options, svg);
  } catch (e) {
    /* initial render best-effort — listeners will retry */
  }
  return true;
}
