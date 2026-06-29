/**
 * Client-side **DVH (Dose Volume Histogram) parser** (RTV-131).
 *
 * DICOM has no separate "DVH SOP class" — the DVH lives inside an **RTDOSE**
 * object (SOP Class 1.2.840.10008.5.1.4.1.1.481.2) under `DVHSequence`. So this
 * extension does NOT register a competing SopClassHandler (that would duplicate
 * the dose-grid display set handled by the cornerstone extension); instead it
 * reads RTDOSE display sets and parses their embedded DVH.
 *
 * Framework-free and `@ohif/*`-free so the curve extraction and Dx/Vx metrics
 * are unit-tested in isolation. Structure names come from the RTSTRUCT
 * (`StructureSetROISequence`, ROINumber -> ROIName) via {@link buildRoiNameMap}.
 */

export const RT_DOSE_SOP_CLASS_UID = '1.2.840.10008.5.1.4.1.1.481.2';

export interface DvhPoint {
  /** Absolute dose (Gy), already scaled by DVHDoseScaling. */
  dose: number;
  /** Volume in the curve's `volumeUnits` (CM3 or PERCENT). */
  volume: number;
}

export interface DvhCurve {
  roiNumber?: number;
  roiName?: string;
  /** DVHType: CUMULATIVE | DIFFERENTIAL. */
  type?: string;
  /** DoseUnits: GY | RELATIVE. */
  doseUnits?: string;
  /** DVHVolumeUnits: CM3 | PERCENT. */
  volumeUnits?: string;
  points: DvhPoint[];
  /** Volume at dose 0 (curve maximum for a cumulative DVH). */
  totalVolume?: number;
  minDose?: number;
  maxDose?: number;
  meanDose?: number;
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

/** DVHData may be a number[], or a backslash-joined DS string. */
function toNumberArray(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(Number).filter(n => Number.isFinite(n));
  if (typeof value === 'string') {
    return value.split('\\').map(Number).filter(n => Number.isFinite(n));
  }
  return [];
}

/** Map ROINumber -> ROIName from an RTSTRUCT instance (naturalized). */
export function buildRoiNameMap(rtstruct: Record<string, any> | undefined): Map<number, string> {
  const map = new Map<number, string>();
  for (const roi of toArray(rtstruct?.StructureSetROISequence)) {
    const n = toNum((roi as any)?.ROINumber);
    const name = (roi as any)?.ROIName;
    if (n != null && name) map.set(n, String(name));
  }
  return map;
}

/**
 * Parse the DVHSequence of an RTDOSE instance into one curve per ROI.
 *
 * `DVHData` is a flat `[Δdose, volume, Δdose, volume, …]` list; the dose axis is
 * the running sum of Δdose × `DVHDoseScaling`, and the paired value is the
 * (cumulative) volume.
 */
export function parseDvhFromInstance(
  rtdose: Record<string, any> | undefined,
  roiNameMap?: Map<number, string>
): DvhCurve[] {
  const curves: DvhCurve[] = [];
  for (const dvh of toArray(rtdose?.DVHSequence)) {
    const item = dvh as Record<string, any>;
    const scaling = toNum(item?.DVHDoseScaling) ?? 1;
    const data = toNumberArray(item?.DVHData);
    const points: DvhPoint[] = [];
    let cumulativeDose = 0;
    for (let i = 0; i + 1 < data.length; i += 2) {
      cumulativeDose += data[i] * scaling;
      points.push({ dose: cumulativeDose, volume: data[i + 1] });
    }
    const ref = toArray(item?.DVHReferencedROISequence)[0] as Record<string, any> | undefined;
    const roiNumber = toNum(ref?.ReferencedROINumber);
    curves.push({
      roiNumber,
      roiName: roiNumber != null ? roiNameMap?.get(roiNumber) : undefined,
      type: item?.DVHType,
      doseUnits: item?.DoseUnits,
      volumeUnits: item?.DVHVolumeUnits,
      points,
      totalVolume: points.length ? points[0].volume : undefined,
      minDose: toNum(item?.DVHMinimumDose),
      maxDose: toNum(item?.DVHMaximumDose),
      meanDose: toNum(item?.DVHMeanDose),
    });
  }
  return curves;
}

/** Linear-interpolate y at x across an ascending-x point list. */
function interpolate(points: { x: number; y: number }[], x: number): number | undefined {
  if (!points.length) return undefined;
  if (x <= points[0].x) return points[0].y;
  if (x >= points[points.length - 1].x) return points[points.length - 1].y;
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i].x) {
      const a = points[i - 1];
      const b = points[i];
      const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
      return a.y + t * (b.y - a.y);
    }
  }
  return points[points.length - 1].y;
}

/** Cumulative volume as a percentage of the total, keyed by dose (ascending). */
function cumulativePercentByDose(curve: DvhCurve): { x: number; y: number }[] {
  const total = curve.totalVolume ?? (curve.points.length ? curve.points[0].volume : 0);
  if (!total) return [];
  return curve.points.map(p => ({ x: p.dose, y: (p.volume / total) * 100 }));
}

/** V_x: percent of volume receiving at least `doseGy`. */
export function volumePercentAtDose(curve: DvhCurve, doseGy: number): number | undefined {
  return interpolate(cumulativePercentByDose(curve), doseGy);
}

/** D_x: the dose (Gy) at which cumulative volume falls to `volumePct` %. */
export function doseAtVolumePercent(curve: DvhCurve, volumePct: number): number | undefined {
  // Volume% is monotonically non-increasing with dose; invert by searching.
  const pts = cumulativePercentByDose(curve);
  if (!pts.length) return undefined;
  if (volumePct >= pts[0].y) return pts[0].x;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].y <= volumePct) {
      const a = pts[i - 1];
      const b = pts[i];
      const t = a.y === b.y ? 0 : (a.y - volumePct) / (a.y - b.y);
      return a.x + t * (b.x - a.x);
    }
  }
  return pts[pts.length - 1].x;
}

/** Build a CSV: one column block (Dose, Volume) per curve. Pure and testable. */
export function buildDvhCsv(curves: DvhCurve[]): string {
  const header: string[] = [];
  curves.forEach((c, i) => {
    const label = c.roiName || (c.roiNumber != null ? `ROI ${c.roiNumber}` : `Curve ${i + 1}`);
    header.push(`${label} Dose(${c.doseUnits || 'GY'})`, `${label} Vol(${c.volumeUnits || 'CM3'})`);
  });
  const maxLen = curves.reduce((m, c) => Math.max(m, c.points.length), 0);
  const lines = [header.join(',')];
  for (let r = 0; r < maxLen; r++) {
    const row: string[] = [];
    for (const c of curves) {
      const p = c.points[r];
      row.push(p ? String(p.dose) : '', p ? String(p.volume) : '');
    }
    lines.push(row.join(','));
  }
  return lines.join('\n');
}

export default parseDvhFromInstance;
