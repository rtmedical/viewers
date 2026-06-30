/**
 * Client-side **CAD Structured Report parser** (RTV-79).
 *
 * Framework-free and `@ohif/*`-free: walks a *naturalized* Mammography/Chest CAD
 * SR content tree and extracts CAD findings (type, probability, spatial region),
 * unit-tested in isolation. Drawing the finding markers as an overlay on the
 * image is a cornerstone-viewport follow-up; this is the data layer the panel
 * lists. No native OHIF handler claims the CAD SR SOP classes, so the companion
 * SopClassHandler registers them (not a duplicate of cornerstone-dicom-sr, which
 * only handles Basic/Enhanced/Comprehensive SR).
 */

export const CAD_SR_SOP_CLASS_UIDS = {
  MAMMOGRAPHY_CAD: '1.2.840.10008.5.1.4.1.1.88.50',
  CHEST_CAD: '1.2.840.10008.5.1.4.1.1.88.65',
} as const;
export const CAD_SR_SOP_CLASS_UID_LIST = Object.values(CAD_SR_SOP_CLASS_UIDS);

export interface CadFinding {
  /** Finding type (CodeMeaning of the finding's CODE item, or container concept). */
  type?: string;
  codeValue?: string;
  /** Probability / likelihood / score (NUM value), if present. */
  probability?: number;
  /** SCOORD graphic type (POINT, CIRCLE, POLYLINE, ELLIPSE…). */
  graphicType?: string;
  /** SCOORD graphic data (flat coordinate list). */
  points?: number[];
  /** Referenced image the finding sits on. */
  referencedSopInstanceUID?: string;
}

export interface CadSr {
  title?: string;
  findings: CadFinding[];
}

function toArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}
function toNum(v: unknown): number | undefined {
  const x = Array.isArray(v) ? v[0] : v;
  if (x == null || x === '') return undefined;
  const n = Number(x);
  return Number.isFinite(n) ? n : undefined;
}
function toNumberArray(v: unknown): number[] {
  if (Array.isArray(v)) return v.map(Number).filter(n => Number.isFinite(n));
  if (typeof v === 'string') return v.split('\\').map(Number).filter(n => Number.isFinite(n));
  return [];
}
function conceptMeaning(node: any): string | undefined {
  return toArray(node?.ConceptNameCodeSequence)[0]?.CodeMeaning;
}

const PROBABILITY_RE = /probab|likelihood|score|malignan|confidence/i;

/** Extract a finding from a container node that holds a SCOORD child. */
function findingFromContainer(node: any, scoord: any): CadFinding {
  const children = toArray(node?.ContentSequence);
  // Type: a CODE child's coded value, else the container's own concept.
  const codeChild = children.find((c: any) => c?.ValueType === 'CODE');
  const codeItem = codeChild ? toArray(codeChild.ConceptCodeSequence)[0] : undefined;
  const type = codeItem?.CodeMeaning ?? conceptMeaning(node) ?? conceptMeaning(scoord);

  // Probability: a NUM child whose concept reads like a probability/score.
  let probability: number | undefined;
  for (const c of children) {
    if (c?.ValueType === 'NUM' && PROBABILITY_RE.test(conceptMeaning(c) || '')) {
      probability = toNum(toArray(c.MeasuredValueSequence)[0]?.NumericValue);
      break;
    }
  }

  // Referenced image: from the SCOORD's IMAGE child or the container's.
  const imageChild =
    toArray(scoord?.ContentSequence).find((c: any) => c?.ValueType === 'IMAGE') ??
    children.find((c: any) => c?.ValueType === 'IMAGE');
  const referencedSopInstanceUID = toArray(imageChild?.ReferencedSOPSequence)[0]?.ReferencedSOPInstanceUID;

  return {
    type,
    codeValue: codeItem?.CodeValue,
    probability,
    graphicType: scoord?.GraphicType,
    points: toNumberArray(scoord?.GraphicData),
    referencedSopInstanceUID,
  };
}

/** Recursively collect CAD findings from a content node. */
function collectFindings(node: any, out: CadFinding[]): void {
  const children = toArray(node?.ContentSequence);
  const scoord = children.find((c: any) => c?.ValueType === 'SCOORD' || c?.ValueType === 'SCOORD3D');
  if (scoord) {
    out.push(findingFromContainer(node, scoord));
  }
  // Recurse into child containers (findings can nest).
  for (const c of children) {
    if (c?.ValueType === 'CONTAINER') {
      collectFindings(c, out);
    }
  }
}

/** Parse a naturalized CAD SR instance into a list of findings. */
export function parseCadSr(instance: Record<string, any>): CadSr {
  const result: CadSr = { title: conceptMeaning(instance), findings: [] };
  if (!instance) return result;
  collectFindings(instance, result.findings);
  return result;
}

/** True when a naturalized instance is a CAD SR. */
export function isCadSr(instance: Record<string, any>): boolean {
  return CAD_SR_SOP_CLASS_UID_LIST.includes(instance?.SOPClassUID);
}

export default parseCadSr;
