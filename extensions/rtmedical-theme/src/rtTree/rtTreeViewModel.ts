/**
 * RT Tree view model (RTV-133) — framework-free, tested.
 *
 * Builds a hierarchical tree of the RT objects loaded in the study
 * (RTSTRUCT / RTPLAN / RTDOSE / RTIMAGE), with the structure-set ROIs as child
 * nodes. Reads only the public display-set fields the cornerstone-dicom-rt
 * handler exposes (Modality, SeriesDescription, structureSet.StructureSetROISequence)
 * — zero-fork (RTV-114).
 *
 * The full legacy RTTreeViewer also had DvhNode and detailed BeamLinesNode;
 * those need dose computation / RTPLAN beam geometry (RTV-130 + dose) and are
 * follow-ups. Click-to-viewport navigation is wired in the panel/integration layer.
 */
export type RtNodeType = 'rtstruct' | 'rtplan' | 'rtdose' | 'rtimage' | 'roi';

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
      }
      return node;
    });
}

export function countRtNodes(nodes: RtTreeNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + (n.children ? countRtNodes(n.children) : 0), 0);
}
