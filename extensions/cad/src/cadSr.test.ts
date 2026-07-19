import { parseCadSr, isCadSr, CAD_SR_SOP_CLASS_UIDS } from './cadSr';

const sampleCadSr = () => ({
  SOPClassUID: CAD_SR_SOP_CLASS_UIDS.MAMMOGRAPHY_CAD,
  ConceptNameCodeSequence: [{ CodeMeaning: 'Mammography CAD Report' }],
  ContentSequence: [
    {
      ValueType: 'CONTAINER',
      ConceptNameCodeSequence: [{ CodeMeaning: 'Individual Impression' }],
      ContentSequence: [
        {
          ValueType: 'CODE',
          ConceptCodeSequence: [{ CodeValue: 'F-01', CodeMeaning: 'Calcification cluster' }],
        },
        {
          ValueType: 'NUM',
          ConceptNameCodeSequence: [{ CodeMeaning: 'Probability of malignancy' }],
          MeasuredValueSequence: [{ NumericValue: '0.82' }],
        },
        {
          ValueType: 'SCOORD',
          GraphicType: 'CIRCLE',
          GraphicData: [100, 120, 110, 120],
          ContentSequence: [
            {
              ValueType: 'IMAGE',
              ReferencedSOPSequence: [{ ReferencedSOPInstanceUID: '1.2.img' }],
            },
          ],
        },
      ],
    },
    {
      ValueType: 'CONTAINER',
      ConceptNameCodeSequence: [{ CodeMeaning: 'Individual Impression' }],
      ContentSequence: [
        { ValueType: 'CODE', ConceptCodeSequence: [{ CodeValue: 'F-02', CodeMeaning: 'Mass' }] },
        { ValueType: 'SCOORD', GraphicType: 'POINT', GraphicData: [200, 210] },
      ],
    },
  ],
});

describe('parseCadSr', () => {
  it('reads the report title', () => {
    expect(parseCadSr(sampleCadSr()).title).toBe('Mammography CAD Report');
  });

  it('extracts each finding (type/code/probability/region/ref image)', () => {
    const { findings } = parseCadSr(sampleCadSr());
    expect(findings).toHaveLength(2);
    expect(findings[0]).toEqual({
      type: 'Calcification cluster',
      codeValue: 'F-01',
      probability: 0.82,
      graphicType: 'CIRCLE',
      points: [100, 120, 110, 120],
      referencedSopInstanceUID: '1.2.img',
    });
    expect(findings[1]).toMatchObject({
      type: 'Mass',
      codeValue: 'F-02',
      graphicType: 'POINT',
      points: [200, 210],
    });
    expect(findings[1].probability).toBeUndefined();
  });

  it('recurses into nested containers', () => {
    const nested: any = {
      SOPClassUID: CAD_SR_SOP_CLASS_UIDS.CHEST_CAD,
      ContentSequence: [
        {
          ValueType: 'CONTAINER',
          ContentSequence: [
            {
              ValueType: 'CONTAINER',
              ConceptNameCodeSequence: [{ CodeMeaning: 'Nodule' }],
              ContentSequence: [{ ValueType: 'SCOORD', GraphicType: 'POINT', GraphicData: [5, 6] }],
            },
          ],
        },
      ],
    };
    const { findings } = parseCadSr(nested);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ type: 'Nodule', graphicType: 'POINT', points: [5, 6] });
  });

  it('is defensive about empty input / no findings', () => {
    expect(parseCadSr(undefined as any).findings).toEqual([]);
    expect(parseCadSr({ SOPClassUID: CAD_SR_SOP_CLASS_UIDS.MAMMOGRAPHY_CAD }).findings).toEqual([]);
  });
});

describe('parseCadSr — frame + series references (marker-overlay follow-up)', () => {
  const srWithFrames = () => ({
    SOPClassUID: CAD_SR_SOP_CLASS_UIDS.CHEST_CAD,
    ConceptNameCodeSequence: [{ CodeMeaning: 'Chest CAD Report' }],
    CurrentRequestedProcedureEvidenceSequence: [
      {
        ReferencedSeriesSequence: [
          {
            SeriesInstanceUID: '1.2.series.ct',
            ReferencedSOPSequence: [
              {
                ReferencedSOPClassUID: '1.2.840.10008.5.1.4.1.1.2',
                ReferencedSOPInstanceUID: '1.2.img.mf',
              },
              {
                ReferencedSOPClassUID: '1.2.840.10008.5.1.4.1.1.2',
                ReferencedSOPInstanceUID: '1.2.img.sf',
              },
            ],
          },
        ],
      },
    ],
    ContentSequence: [
      {
        ValueType: 'CONTAINER',
        ConceptNameCodeSequence: [{ CodeMeaning: 'Nodule' }],
        ContentSequence: [
          {
            ValueType: 'SCOORD',
            GraphicType: 'POINT',
            GraphicData: [10, 20],
            ContentSequence: [
              {
                ValueType: 'IMAGE',
                ReferencedSOPSequence: [
                  { ReferencedSOPInstanceUID: '1.2.img.mf', ReferencedFrameNumber: 7 },
                ],
              },
            ],
          },
        ],
      },
      {
        ValueType: 'CONTAINER',
        ConceptNameCodeSequence: [{ CodeMeaning: 'Mass' }],
        ContentSequence: [
          {
            ValueType: 'SCOORD',
            GraphicType: 'POINT',
            GraphicData: [30, 40],
            ContentSequence: [
              {
                ValueType: 'IMAGE',
                // Multi-valued VM 1-n form — first value wins.
                ReferencedSOPSequence: [
                  { ReferencedSOPInstanceUID: '1.2.img.mf', ReferencedFrameNumber: [3, 4] },
                ],
              },
            ],
          },
        ],
      },
      {
        ValueType: 'CONTAINER',
        ConceptNameCodeSequence: [{ CodeMeaning: 'Scar' }],
        ContentSequence: [
          {
            ValueType: 'SCOORD',
            GraphicType: 'POINT',
            GraphicData: [50, 60],
            ContentSequence: [
              {
                ValueType: 'IMAGE',
                ReferencedSOPSequence: [{ ReferencedSOPInstanceUID: '1.2.img.sf' }],
              },
            ],
          },
        ],
      },
    ],
  });

  it('captures ReferencedFrameNumber (scalar and array-valued)', () => {
    const { findings } = parseCadSr(srWithFrames());
    expect(findings).toHaveLength(3);
    expect(findings[0].referencedFrameNumber).toBe(7);
    expect(findings[1].referencedFrameNumber).toBe(3);
    expect(findings[2].referencedFrameNumber).toBeUndefined();
  });

  it('parses a string-typed frame number (naturalized IS values)', () => {
    const sr: any = srWithFrames();
    sr.ContentSequence[0].ContentSequence[0].ContentSequence[0].ReferencedSOPSequence[0].ReferencedFrameNumber =
      '12';
    expect(parseCadSr(sr).findings[0].referencedFrameNumber).toBe(12);
  });

  it('keeps the first frame from a backslash-delimited IS value', () => {
    const sr: any = srWithFrames();
    sr.ContentSequence[0].ContentSequence[0].ContentSequence[0].ReferencedSOPSequence[0].ReferencedFrameNumber =
      '12\\13';
    expect(parseCadSr(sr).findings[0].referencedFrameNumber).toBe(12);
  });

  it('resolves referencedSeriesInstanceUID from the evidence sequence', () => {
    const { findings } = parseCadSr(srWithFrames());
    expect(findings[0].referencedSeriesInstanceUID).toBe('1.2.series.ct');
    expect(findings[2].referencedSeriesInstanceUID).toBe('1.2.series.ct');
  });

  it('leaves the series undefined when there is no evidence sequence', () => {
    const sr: any = srWithFrames();
    delete sr.CurrentRequestedProcedureEvidenceSequence;
    const { findings } = parseCadSr(sr);
    expect(findings[0].referencedSeriesInstanceUID).toBeUndefined();
    expect(findings[0].referencedSopInstanceUID).toBe('1.2.img.mf');
  });

  it('assigns stable identities from the report SOP and finding order', () => {
    const sr: any = srWithFrames();
    sr.SOPInstanceUID = '1.2.report';
    const { findings } = parseCadSr(sr);
    expect(findings[0]).toMatchObject({
      reportSopInstanceUID: '1.2.report',
      findingIndex: 0,
    });
    expect(findings[2]).toMatchObject({
      reportSopInstanceUID: '1.2.report',
      findingIndex: 2,
    });
  });
});

describe('isCadSr', () => {
  it('recognizes CAD SR SOP classes', () => {
    expect(isCadSr({ SOPClassUID: CAD_SR_SOP_CLASS_UIDS.MAMMOGRAPHY_CAD })).toBe(true);
    expect(isCadSr({ SOPClassUID: CAD_SR_SOP_CLASS_UIDS.CHEST_CAD })).toBe(true);
    expect(isCadSr({ SOPClassUID: '1.2.840.10008.5.1.4.1.1.88.11' })).toBe(false);
  });
});
