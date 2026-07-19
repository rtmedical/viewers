/**
 * Viewport → 2D canvas composition (RTV-203) — DOM glue, validated E2E.
 *
 * Cornerstone3D renders each viewport's visible image into an ON-SCREEN **2D**
 * canvas (the rendering engine blits from its offscreen WebGL canvas —
 * BaseRenderingEngine `canvas.getContext('2d')`), so `drawImage(vpCanvas)` is
 * reliable without `preserveDrawingBuffer`. Annotations (measurements etc.)
 * live in a separate `svg.svg-layer` sibling; we rasterize it with the
 * XMLSerializer→Image pattern already used by the cardiology BullseyePanel and
 * draw it over the image so captures carry the burned-in annotations.
 */

/** Rasterize an SVG element onto `ctx` at the given rect. */
function drawSvg(
  ctx: CanvasRenderingContext2D,
  svg: SVGSVGElement,
  x: number,
  y: number,
  w: number,
  h: number
): Promise<void> {
  return new Promise(resolve => {
    try {
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      if (!clone.getAttribute('viewBox')) {
        const cw = svg.clientWidth || w;
        const ch = svg.clientHeight || h;
        clone.setAttribute('viewBox', `0 0 ${cw} ${ch}`);
      }
      clone.setAttribute('width', String(w));
      clone.setAttribute('height', String(h));
      const markup = new XMLSerializer().serializeToString(clone);
      const blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        try {
          ctx.drawImage(img, x, y, w, h);
        } catch (e) {
          /* tainted/failed SVG must not abort the capture */
        }
        URL.revokeObjectURL(url);
        resolve();
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      img.src = url;
    } catch (e) {
      resolve();
    }
  });
}

/** One cornerstone viewport (image canvas + annotation svg) onto a canvas. */
async function drawViewport(
  ctx: CanvasRenderingContext2D,
  viewport: { getCanvas: () => HTMLCanvasElement; element: HTMLElement },
  x: number,
  y: number,
  w: number,
  h: number
): Promise<void> {
  const canvas = viewport.getCanvas();
  ctx.fillStyle = '#000';
  ctx.fillRect(x, y, w, h);
  ctx.drawImage(canvas, x, y, w, h);
  const svg = viewport.element?.querySelector?.('svg.svg-layer') as SVGSVGElement | null;
  if (svg) {
    await drawSvg(ctx, svg, x, y, w, h);
  }
}

/** Capture ONE viewport (image + annotations) at its on-screen CSS size. */
export async function composeViewportCanvas(viewport: {
  getCanvas: () => HTMLCanvasElement;
  element: HTMLElement;
}): Promise<HTMLCanvasElement> {
  const el = viewport.element;
  const w = el?.clientWidth || viewport.getCanvas().width;
  const h = el?.clientHeight || viewport.getCanvas().height;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  if (!ctx) {
    throw new Error('2D canvas unavailable');
  }
  await drawViewport(ctx, viewport, 0, 0, w, h);
  return out;
}

/**
 * Capture the CURRENT LAYOUT: every given viewport drawn at its on-screen
 * position relative to their common bounding box (one composed image —
 * ticket item 2).
 */
export async function composeLayoutCanvas(
  viewports: Array<{ getCanvas: () => HTMLCanvasElement; element: HTMLElement }>
): Promise<HTMLCanvasElement> {
  const rects = viewports.map(vp => vp.element.getBoundingClientRect());
  const minX = Math.min(...rects.map(r => r.left));
  const minY = Math.min(...rects.map(r => r.top));
  const maxX = Math.max(...rects.map(r => r.right));
  const maxY = Math.max(...rects.map(r => r.bottom));
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(maxX - minX));
  out.height = Math.max(1, Math.round(maxY - minY));
  const ctx = out.getContext('2d');
  if (!ctx) {
    throw new Error('2D canvas unavailable');
  }
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, out.width, out.height);
  for (let i = 0; i < viewports.length; i++) {
    const r = rects[i];
    await drawViewport(
      ctx,
      viewports[i],
      Math.round(r.left - minX),
      Math.round(r.top - minY),
      Math.round(r.width),
      Math.round(r.height)
    );
  }
  return out;
}

/** Read a composed canvas back as rows/columns + interleaved RGBA bytes. */
export function canvasPixels(canvas: HTMLCanvasElement): {
  rows: number;
  columns: number;
  rgba: Uint8ClampedArray;
} {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2D canvas unavailable');
  }
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { rows: canvas.height, columns: canvas.width, rgba: data.data };
}
