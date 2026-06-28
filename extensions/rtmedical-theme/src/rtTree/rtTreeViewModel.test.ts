import { buildRtTreeModel, countRtNodes, type RtDisplaySetLike } from './rtTreeViewModel';

const displaySets: RtDisplaySetLike[] = [
  { displaySetInstanceUID: 'ct1', Modality: 'CT', SeriesDescription: 'Planning CT' },
  {
    displaySetInstanceUID: 'rs1',
    Modality: 'RTSTRUCT',
    SeriesDescription: 'Structures',
    structureSet: {
      StructureSetLabel: 'Plan A',
      StructureSetROISequence: [
        { ROIName: 'PTV', ROINumber: 1 },
        { ROIName: 'Cord', ROINumber: 2 },
      ],
    },
  },
  { displaySetInstanceUID: 'rd1', Modality: 'RTDOSE', SeriesDescription: 'Dose' },
  { displaySetInstanceUID: 'rp1', Modality: 'RTPLAN', SeriesNumber: 3 },
];

describe('buildRtTreeModel', () => {
  it('includes only RT modalities (CT filtered out)', () => {
    const tree = buildRtTreeModel(displaySets);
    expect(tree.map(n => n.type).sort()).toEqual(['rtdose', 'rtplan', 'rtstruct']);
  });

  it('nests structure-set ROIs under the RTSTRUCT node', () => {
    const tree = buildRtTreeModel(displaySets);
    const rs = tree.find(n => n.type === 'rtstruct');
    expect(rs?.children?.map(c => c.label)).toEqual(['PTV', 'Cord']);
    expect(rs?.children?.every(c => c.type === 'roi')).toBe(true);
  });

  it('labels nodes from description / structure label / modality fallback', () => {
    const tree = buildRtTreeModel(displaySets);
    expect(tree.find(n => n.type === 'rtdose')?.label).toBe('Dose');
    expect(tree.find(n => n.type === 'rtplan')?.label).toBe('RTPLAN 3');
  });

  it('falls back to ROIContours and synthetic ROI labels', () => {
    const tree = buildRtTreeModel([
      {
        displaySetInstanceUID: 'rs2',
        Modality: 'RTSTRUCT',
        structureSet: { ROIContours: [{ ROINumber: 5 }] },
      },
    ]);
    expect(tree[0].children?.[0].label).toBe('ROI 5');
  });

  it('counts nodes recursively', () => {
    // rtstruct(1) + 2 ROIs + rtdose(1) + rtplan(1) = 5
    expect(countRtNodes(buildRtTreeModel(displaySets))).toBe(5);
  });

  it('handles empty / missing input', () => {
    expect(buildRtTreeModel([])).toEqual([]);
    expect(buildRtTreeModel(undefined as unknown as RtDisplaySetLike[])).toEqual([]);
  });
});
