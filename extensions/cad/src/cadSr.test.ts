import { parseCadSr, isCadSr, CAD_SR_SOP_CLASS_UIDS } from './cadSr';

const sampleCadSr = () => ({
  SOPClassUID: CAD_SR_SOP_CLASS_UIDS.MAMMOGRAPHY_CAD,
  ConceptNameCodeSequence: [{ CodeMeaning: 'Mammography CAD Report' }],
  ContentSequence: [
    {
      ValueType: 'CONTAINER',
      ConceptNameCodeSequence: [{ CodeMeaning: 'Individual Impression' }],
      ContentSequence: [
        { ValueType: 'CODE', ConceptCodeSequence: [{ CodeValue: 'F-01', CodeMeaning: 'Calcification cluster' }] },
        { ValueType: 'NUM', ConceptNameCodeSequence: [{ CodeMeaning: 'Probability of malignancy' }], MeasuredValueSequence: [{ NumericValue: '0.82' }] },
        {
          ValueType: 'SCOORD',
          GraphicType: 'CIRCLE',
          GraphicData: [100, 120, 110, 120],
          ContentSequence: [{ ValueType: 'IMAGE', ReferencedSOPSequence: [{ ReferencedSOPInstanceUID: '1.2.img' }] }],
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
    expect(findings[1]).toMatchObject({ type: 'Mass', codeValue: 'F-02', graphicType: 'POINT', points: [200, 210] });
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

describe('isCadSr', () => {
  it('recognizes CAD SR SOP classes', () => {
    expect(isCadSr({ SOPClassUID: CAD_SR_SOP_CLASS_UIDS.MAMMOGRAPHY_CAD })).toBe(true);
    expect(isCadSr({ SOPClassUID: CAD_SR_SOP_CLASS_UIDS.CHEST_CAD })).toBe(true);
    expect(isCadSr({ SOPClassUID: '1.2.840.10008.5.1.4.1.1.88.11' })).toBe(false);
  });
});
