/**
 * Client-side **RT Structure Set (RTSTRUCT) parser** (RTV-146).
 *
 * Framework-free and `@ohif/*`-free: turns a *naturalized* RTSTRUCT instance into
 * a structure-summary model (name, display color, interpreted type, contour
 * counts, approximate volume) for a read-only "structures" panel. The contour
 * *editor* (drawing/editing) is a heavy viewport integration and is out of scope
 * here (follow-up).
 *
 * RTSTRUCT SOP Class UID: 1.2.840.10008.5.1.4.1.1.481.3. NOTE: the cornerstone
 * extension already registers a SopClassHandler for RTSTRUCT, so this extension
 * is panel-only (no handler) to avoid duplicating the display set.
 */

export const RT_STRUCT_SOP_CLASS_UID = '1.2.840.10008.5.1.4.1.1.481.3';

export interface RtStructStructure {
  roiNumber?: number;
  name?: string;
  /** RGB 0-255, from ROIDisplayColor. */
  color?: [number, number, number];
  /** RTROIInterpretedType (PTV, GTV, CTV, ORGAN, EXTERNAL, …). */
  interpretedType?: string;
  /** ROIGenerationAlgorithm (AUTOMATIC, SEMIAUTOMATIC, MANUAL). */
  algorithm?: string;
  numContours: number;
  numPoints: number;
  /** Approximate volume in cm³ (from planar contours), when computable. */
  approxVolumeCc?: number;
}

export interface RtStruct {
  label?: string;
  name?: string;
  date?: string;
  structures: RtStructStructure[];
}

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function toNum(value: unknown): number | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function toNumberArray(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(Number).filter(n => Number.isFinite(n));
  if (typeof value === 'string') return value.split('\\').map(Number).filter(n => Number.isFinite(n));
  return [];
}

/** Shoelace polygon area (mm²) for a planar contour given flat [x,y,z,…] data. */
export function contourArea(contourData: number[]): number {
  const n = Math.floor(contourData.length / 3);
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const x1 = contourData[i * 3];
    const y1 = contourData[i * 3 + 1];
    const j = (i + 1) % n;
    const x2 = contourData[j * 3];
    const y2 = contourData[j * 3 + 1];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

/**
 * Approximate a structure volume (cm³) from its planar contours: sum each
 * contour's area × the slice thickness, where thickness is the median gap
 * between distinct contour z-positions. Returns undefined when not computable.
 */
export function approximateVolumeCc(contours: number[][]): number | undefined {
  const planar = contours.filter(c => c.length >= 9); // ≥3 points
  if (!planar.length) return undefined;

  const zs = Array.from(
    new Set(planar.map(c => Math.round((c[2] ?? 0) * 100) / 100))
  ).sort((a, b) => a - b);
  let thickness = 1;
  if (zs.length >= 2) {
    const gaps = [];
    for (let i = 1; i < zs.length; i++) gaps.push(zs[i] - zs[i - 1]);
    gaps.sort((a, b) => a - b);
    thickness = gaps[Math.floor(gaps.length / 2)] || 1;
  }
  const areaMm2 = planar.reduce((sum, c) => sum + contourArea(c), 0);
  const volMm3 = areaMm2 * thickness;
  return volMm3 / 1000; // mm³ → cm³
}

/** Parse a naturalized RTSTRUCT instance into a structure-summary model. */
export function parseRtStruct(instance: Record<string, any>): RtStruct {
  const result: RtStruct = {
    label: instance?.StructureSetLabel,
    name: instance?.StructureSetName,
    date: instance?.StructureSetDate,
    structures: [],
  };
  if (!instance) return result;

  // Observations: ROINumber -> { interpretedType }
  const obsByRoi = new Map<number, { interpretedType?: string }>();
  for (const obs of toArray(instance.RTROIObservationsSequence)) {
    const roi = toNum((obs as any)?.ReferencedROINumber);
    if (roi != null) obsByRoi.set(roi, { interpretedType: (obs as any)?.RTROIInterpretedType });
  }

  // Contours: ROINumber -> { color, contours[] }
  const contourByRoi = new Map<number, { color?: [number, number, number]; contours: number[][] }>();
  for (const rc of toArray(instance.ROIContourSequence)) {
    const roi = toNum((rc as any)?.ReferencedROINumber);
    if (roi == null) continue;
    const rgb = toNumberArray((rc as any)?.ROIDisplayColor);
    const color = rgb.length >= 3 ? ([rgb[0], rgb[1], rgb[2]] as [number, number, number]) : undefined;
    const contours = toArray((rc as any)?.ContourSequence).map(c => toNumberArray((c as any)?.ContourData));
    contourByRoi.set(roi, { color, contours });
  }

  result.structures = toArray(instance.StructureSetROISequence).map((roi: any) => {
    const roiNumber = toNum(roi?.ROINumber);
    const contourInfo = roiNumber != null ? contourByRoi.get(roiNumber) : undefined;
    const contours = contourInfo?.contours ?? [];
    const numPoints = contours.reduce((s, c) => s + Math.floor(c.length / 3), 0);
    return {
      roiNumber,
      name: roi?.ROIName,
      color: contourInfo?.color,
      interpretedType: roiNumber != null ? obsByRoi.get(roiNumber)?.interpretedType : undefined,
      algorithm: roi?.ROIGenerationAlgorithm,
      numContours: contours.length,
      numPoints,
      approxVolumeCc: approximateVolumeCc(contours),
    };
  });

  return result;
}

/** Build a CSV (one row per structure). Pure and testable. */
export function buildRtStructCsv(rtstruct: RtStruct): string {
  const header = ['ROI', 'Name', 'Type', 'Algorithm', 'Contours', 'Points', 'Volume(cc)'];
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = rtstruct.structures.map(s =>
    [s.roiNumber, s.name, s.interpretedType, s.algorithm, s.numContours, s.numPoints, s.approxVolumeCc?.toFixed(2)]
      .map(esc)
      .join(',')
  );
  return [header.join(','), ...rows].join('\n');
}

/** "#rrggbb" from an RGB triple. */
export function rgbToHex(color?: [number, number, number]): string {
  if (!color) return '#888888';
  return '#' + color.map(c => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');
}

export default parseRtStruct;
