/**
 * DRR graticule — pure geometry + SVG (RTV-143).
 *
 * The graticule is the reticle a physicist reads a DRR against: a crosshair on the
 * beam axis plus tick marks every N millimetres **at the isocenter plane**, so
 * distances on the DRR can be judged directly in patient millimetres.
 *
 * ## Reuse, not reinvention
 *
 * Everything load-bearing already exists in this package and is reused as-is:
 * {@link ./bevGeometry}'s `isocenterMmToImagePx` (isocenter mm → RTIMAGE px,
 * including the SID/SAD magnification) and `rotateAboutDeg`, plus
 * {@link ./rtBevParser}'s `parseRtImageBevGeometry` (instance → geometry). This
 * module adds only the reticle itself.
 *
 * ## Why it rotates with the collimator and not the gantry
 *
 * The graticule is fixed to the **beam-limiting device**, so
 * BeamLimitingDeviceAngle (300A,0120) rotates it. Gantry angle does not: a DRR is
 * already rendered along the beam axis, so rotating the gantry changes *which*
 * projection you are looking at, not the orientation of the reticle within it.
 * Reporting the gantry angle alongside is still useful, which is why
 * {@link describeGraticule} takes it.
 *
 * Following the note in `rotateAboutDeg`, rotation happens in **mm space, before**
 * projecting — that stays correct for non-square ImagePlanePixelSpacing, where
 * rotation and anisotropic scaling do not commute.
 */

import { isocenterMmToImagePx, rotateAboutDeg, RtImageGeometry } from './bevGeometry';

/** Tick interval at the isocenter plane, mm. */
export const GRATICULE_SPACING_MM_DEFAULT = 10;
export const GRATICULE_SPACING_MM_MIN = 1;
export const GRATICULE_SPACING_MM_MAX = 100;
/** Half-length of each arm, mm. 150 covers a 30 cm field. */
export const GRATICULE_EXTENT_MM_DEFAULT = 150;
export const GRATICULE_EXTENT_MM_MAX = 500;
/** Every Nth tick is long and labelled — 5 x 10 mm = a label every 50 mm. */
export const GRATICULE_MAJOR_EVERY_DEFAULT = 5;
/** Minor tick half-length, mm. Major ticks are twice this. */
export const GRATICULE_TICK_MM_DEFAULT = 3;

export interface GraticuleOptions {
  spacingMm?: number;
  extentMm?: number;
  /** BeamLimitingDeviceAngle (300A,0120), degrees. */
  collimatorDeg?: number;
  majorEvery?: number;
  tickMm?: number;
}

export interface GraticuleSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  major: boolean;
}

export interface GraticuleLabel {
  px: number;
  py: number;
  /** Signed distance from the beam axis, mm at the isocenter plane. */
  mm: number;
  axis: 'x' | 'y';
}

export interface Graticule {
  /** The beam axis in image pixels — isocenter mm (0,0). */
  centerPx: [number, number];
  /** The two principal arms. */
  axes: GraticuleSegment[];
  ticks: GraticuleSegment[];
  labels: GraticuleLabel[];
  spacingMm: number;
  extentMm: number;
  collimatorDeg: number;
}

const clamp = (value: unknown, min: number, max: number, fallback: number): number => {
  const v = Number(value);
  if (!Number.isFinite(v)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, v));
};

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Builds the graticule for an RTIMAGE.
 *
 * Returns `null` when the geometry is unusable — a reticle drawn on guessed
 * geometry would put confident millimetre labels on the wrong pixels, which is
 * worse than no reticle.
 */
export function buildDrrGraticule(
  geom: RtImageGeometry | undefined | null,
  options: GraticuleOptions = {}
): Graticule | null {
  const spacing = geom?.pixelSpacingMm;
  if (
    !geom ||
    !Array.isArray(geom.rtImagePositionMm) ||
    !Array.isArray(spacing) ||
    !Number.isFinite(Number(spacing[0])) ||
    !Number.isFinite(Number(spacing[1])) ||
    Number(spacing[0]) <= 0 ||
    Number(spacing[1]) <= 0
  ) {
    return null;
  }

  const spacingMm = clamp(
    options.spacingMm,
    GRATICULE_SPACING_MM_MIN,
    GRATICULE_SPACING_MM_MAX,
    GRATICULE_SPACING_MM_DEFAULT
  );
  const extentMm = clamp(options.extentMm, spacingMm, GRATICULE_EXTENT_MM_MAX, GRATICULE_EXTENT_MM_DEFAULT);
  const collimatorDeg = Number.isFinite(Number(options.collimatorDeg))
    ? Number(options.collimatorDeg)
    : 0;
  const majorEvery = Math.max(0, Math.floor(Number(options.majorEvery ?? GRATICULE_MAJOR_EVERY_DEFAULT)));
  const tickMm = clamp(options.tickMm, 0.5, 20, GRATICULE_TICK_MM_DEFAULT);

  /** mm (isocenter, y-up) -> image px, rotating about the axis first. */
  const project = (xMm: number, yMm: number): [number, number] => {
    const rotated = rotateAboutDeg([xMm, yMm], [0, 0], collimatorDeg);
    const [px, py] = isocenterMmToImagePx(rotated, geom);
    return [round2(px), round2(py)];
  };

  const segment = (
    a: [number, number],
    b: [number, number],
    major: boolean
  ): GraticuleSegment => {
    const [x1, y1] = project(a[0], a[1]);
    const [x2, y2] = project(b[0], b[1]);
    return { x1, y1, x2, y2, major };
  };

  const centerPx = project(0, 0);

  const axes: GraticuleSegment[] = [
    segment([-extentMm, 0], [extentMm, 0], true),
    segment([0, -extentMm], [0, extentMm], true),
  ];

  const ticks: GraticuleSegment[] = [];
  const labels: GraticuleLabel[] = [];

  const steps = Math.floor(extentMm / spacingMm);
  for (let k = 1; k <= steps; k++) {
    const d = k * spacingMm;
    const major = majorEvery > 0 && k % majorEvery === 0;
    const half = major ? tickMm * 2 : tickMm;

    for (const sign of [1, -1] as const) {
      const distance = sign * d;
      // Tick on the X arm: a short segment perpendicular to it (along y).
      ticks.push(segment([distance, -half], [distance, half], major));
      // Tick on the Y arm: perpendicular along x.
      ticks.push(segment([-half, distance], [half, distance], major));

      if (major) {
        const [xpx, xpy] = project(distance, half * 1.6);
        labels.push({ px: xpx, py: xpy, mm: distance, axis: 'x' });
        const [ypx, ypy] = project(half * 1.6, distance);
        labels.push({ px: ypx, py: ypy, mm: distance, axis: 'y' });
      }
    }
  }

  return { centerPx, axes, ticks, labels, spacingMm, extentMm, collimatorDeg };
}

export const GRATICULE_OVERLAY_CLASS = 'rt-drr-graticule';

export interface GraticuleSvgStyle {
  color?: string;
  majorColor?: string;
  minorWidth?: number;
  majorWidth?: number;
  opacity?: number;
  labels?: boolean;
  /** Radius of the small circle marking the beam axis, in image px. 0 hides it. */
  centerRadiusPx?: number;
}

const DEFAULT_SVG_STYLE = {
  color: '#42be65',
  majorColor: '#42be65',
  minorWidth: 0.5,
  majorWidth: 1,
  opacity: 0.85,
  labels: true,
  centerRadiusPx: 3,
};

function escapeAttr(value: string | number): string {
  return String(value).replace(/[<>&"']/g, ch =>
    ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '&' ? '&amp;' : ch === '"' ? '&quot;' : '&#39;'
  );
}

/** The graticule as an SVG `<g>`, in image pixel coordinates. */
export function buildGraticuleSvg(
  graticule: Graticule | null,
  style: GraticuleSvgStyle = {}
): string {
  if (!graticule) {
    return '';
  }
  const s = { ...DEFAULT_SVG_STYLE, ...style };
  const majorColor = style.majorColor ?? s.color;

  const parts: string[] = [];
  const line = (seg: GraticuleSegment) =>
    `<line x1="${seg.x1}" y1="${seg.y1}" x2="${seg.x2}" y2="${seg.y2}" stroke="${escapeAttr(
      seg.major ? majorColor : s.color
    )}" stroke-width="${seg.major ? s.majorWidth : s.minorWidth}" />`;

  for (const seg of graticule.axes) {
    parts.push(line(seg));
  }
  for (const seg of graticule.ticks) {
    parts.push(line(seg));
  }

  if (s.centerRadiusPx > 0) {
    parts.push(
      `<circle cx="${graticule.centerPx[0]}" cy="${graticule.centerPx[1]}" r="${
        s.centerRadiusPx
      }" fill="none" stroke="${escapeAttr(majorColor)}" stroke-width="${s.majorWidth}" />`
    );
  }

  if (s.labels) {
    for (const label of graticule.labels) {
      parts.push(
        `<text x="${label.px}" y="${label.py}" fill="${escapeAttr(
          majorColor
        )}" font-size="9" text-anchor="middle">${escapeAttr(label.mm)}</text>`
      );
    }
  }

  return (
    `<g class="${GRATICULE_OVERLAY_CLASS}" opacity="${s.opacity}" ` +
    `pointer-events="none" shape-rendering="crispEdges">${parts.join('')}</g>`
  );
}

/**
 * Standalone `<svg>` sized to the image, so CSS scales it with the DRR.
 * Same approach as `@ohif/extension-rt-grid`: geometry in image pixels, one
 * transform to the screen.
 */
export function buildGraticuleSvgDocument(
  graticule: Graticule | null,
  widthPx: number,
  heightPx: number,
  style: GraticuleSvgStyle = {}
): string {
  const body = buildGraticuleSvg(graticule, style);
  if (!body) {
    return '';
  }
  const w = Math.max(0, Number(widthPx) || 0);
  const h = Math.max(0, Number(heightPx) || 0);
  if (!w || !h) {
    return '';
  }
  return (
    `<svg class="${GRATICULE_OVERLAY_CLASS}-svg" xmlns="http://www.w3.org/2000/svg" ` +
    `viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" ` +
    `style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none">${body}</svg>`
  );
}

/** Mounts (or replaces) the graticule in a host element. Idempotent. */
export function mountGraticule(
  host: { querySelector?: (s: string) => Element | null; insertAdjacentHTML?: (p: string, h: string) => void } | null,
  markup: string
): boolean {
  if (!host) {
    return false;
  }
  host.querySelector?.(`.${GRATICULE_OVERLAY_CLASS}-svg`)?.remove?.();
  if (!markup) {
    return false;
  }
  host.insertAdjacentHTML?.('beforeend', markup);
  return true;
}

/** Removes the graticule. Returns whether one was there. */
export function unmountGraticule(host: { querySelector?: (s: string) => Element | null } | null): boolean {
  const existing = host?.querySelector?.(`.${GRATICULE_OVERLAY_CLASS}-svg`);
  if (!existing) {
    return false;
  }
  existing.remove?.();
  return true;
}

/** One-line summary for the toolbar toast. */
export function describeGraticule(
  graticule: Graticule | null,
  gantryDeg?: number
): string {
  if (!graticule) {
    return 'Graticule unavailable — the RTIMAGE has no usable geometry';
  }
  const parts = [`Graticule ${graticule.spacingMm} mm`];
  if (graticule.collimatorDeg) {
    parts.push(`coll ${round2(graticule.collimatorDeg)}°`);
  }
  if (Number.isFinite(Number(gantryDeg))) {
    parts.push(`gantry ${round2(Number(gantryDeg))}°`);
  }
  return parts.join(' · ');
}
