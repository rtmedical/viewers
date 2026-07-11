/**
 * RT Tree view model (RTV-133) — framework-free, tested.
 *
 * Builds a hierarchical tree of the RT objects loaded in the study
 * (RTSTRUCT / RTPLAN / RTDOSE / RTIMAGE), with the structure-set ROIs as child
 * nodes. Reads only the public display-set fields the cornerstone-dicom-rt
 * handler exposes (Modality, SeriesDescription, structureSet.StructureSetROISequence)
 * — zero-fork (RTV-114).
 *
 * Six node types (RTV-133): the four RT-object roots (rtstruct/rtplan/rtdose/
 * rtimage) plus their leaf children — `roi` under an RTSTRUCT (from the
 * cornerstone-dicom-rt structure set) and `beam` under an RTPLAN (from the
 * rt-plan display set's parsed `rtPlan.beams`). The legacy RTTreeViewer's
 * DvhNode needs dose computation (RTV-130 + dose) and stays a follow-up.
 * Click-to-viewport navigation is wired in the panel/integration layer.
 */
export type RtNodeType = 'rtstruct' | 'rtplan' | 'rtdose' | 'rtimage' | 'roi' | 'beam';

export interface RtTreeNode {
  id: string;
  type: RtNodeType;
  label: string;
  displaySetInstanceUID?: string;
  children?: RtTreeNode[];
}

export interface RtDisplaySetLike {
  displaySetInstanceUID: string;
  Modality?: string;
  SeriesDescription?: string;
  SeriesNumber?: number | string;
  structureSet?: {
    StructureSetLabel?: string;
    StructureSetROISequence?: Array<{ ROIName?: string; ROINumber?: number | string }>;
    ROIContours?: Array<{ ROIName?: string; ROINumber?: number | string }>;
  };
  /** Parsed plan model attached by the rt-plan SopClassHandler (RTPLAN only). */
  rtPlan?: {
    beams?: Array<{ number?: number | string; name?: string }>;
  };
}

const RT_MODALITY_TO_TYPE: Record<string, RtNodeType> = {
  RTSTRUCT: 'rtstruct',
  RTPLAN: 'rtplan',
  RTDOSE: 'rtdose',
  RTIMAGE: 'rtimage',
};

function buildRoiNodes(ds: RtDisplaySetLike): RtTreeNode[] {
  const ss = ds.structureSet;
  const rois = ss?.StructureSetROISequence ?? ss?.ROIContours ?? [];
  if (!Array.isArray(rois)) {
    return [];
  }
  return rois.map((roi, index) => ({
    id: `${ds.displaySetInstanceUID}-roi-${roi.ROINumber ?? index}`,
    type: 'roi' as const,
    label: roi.ROIName || `ROI ${roi.ROINumber ?? index + 1}`,
    displaySetInstanceUID: ds.displaySetInstanceUID,
  }));
}

function buildBeamNodes(ds: RtDisplaySetLike): RtTreeNode[] {
  const beams = ds.rtPlan?.beams ?? [];
  if (!Array.isArray(beams)) {
    return [];
  }
  return beams.map((beam, index) => ({
    id: `${ds.displaySetInstanceUID}-beam-${beam.number ?? index}`,
    type: 'beam' as const,
    label: beam.name || `Beam ${beam.number ?? index + 1}`,
    displaySetInstanceUID: ds.displaySetInstanceUID,
  }));
}

export function buildRtTreeModel(displaySets: RtDisplaySetLike[]): RtTreeNode[] {
  return (displaySets || [])
    .filter(ds => ds && RT_MODALITY_TO_TYPE[String(ds.Modality || '').toUpperCase()])
    .map(ds => {
      const type = RT_MODALITY_TO_TYPE[String(ds.Modality).toUpperCase()];
      const label =
        ds.SeriesDescription ||
        ds.structureSet?.StructureSetLabel ||
        `${ds.Modality} ${ds.SeriesNumber ?? ''}`.trim();
      const node: RtTreeNode = {
        id: ds.displaySetInstanceUID,
        type,
        label,
        displaySetInstanceUID: ds.displaySetInstanceUID,
      };
      if (type === 'rtstruct') {
        const children = buildRoiNodes(ds);
        if (children.length) {
          node.children = children;
        }
      } else if (type === 'rtplan') {
        const children = buildBeamNodes(ds);
        if (children.length) {
          node.children = children;
        }
      }
      return node;
    });
}

export function countRtNodes(nodes: RtTreeNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + (n.children ? countRtNodes(n.children) : 0), 0);
}
