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

  it('nests RTPLAN beams under the RTPLAN node (6th node type)', () => {
    const tree = buildRtTreeModel([
      {
        displaySetInstanceUID: 'rp2',
        Modality: 'RTPLAN',
        SeriesDescription: 'IMRT Plan',
        rtPlan: {
          beams: [
            { number: 1, name: 'AP' },
            { number: 2, name: 'PA' },
          ],
        },
      },
    ]);
    const rp = tree.find(n => n.type === 'rtplan');
    expect(rp?.children?.map(c => c.label)).toEqual(['AP', 'PA']);
    expect(rp?.children?.every(c => c.type === 'beam')).toBe(true);
  });

  it('falls back to synthetic beam labels', () => {
    const tree = buildRtTreeModel([
      { displaySetInstanceUID: 'rp3', Modality: 'RTPLAN', rtPlan: { beams: [{ number: 7 }] } },
    ]);
    expect(tree[0].children?.[0].label).toBe('Beam 7');
  });

  it('counts nodes recursively', () => {
    // rtstruct(1) + 2 ROIs + rtdose(1) + rtplan(1, no beams) = 5
    expect(countRtNodes(buildRtTreeModel(displaySets))).toBe(5);
  });

  it('handles empty / missing input', () => {
    expect(buildRtTreeModel([])).toEqual([]);
    expect(buildRtTreeModel(undefined as unknown as RtDisplaySetLike[])).toEqual([]);
  });
});
