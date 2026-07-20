import { GspsInput, buildGspsNaturalizedDataset } from './gspsDataset';
import { isGrayscaleSoftcopyPresentationState, parseGspsInstance } from './parseGspsInstance';

const counter = () => {
  let n = 0;
  return () => `UID-${++n}`;
};

const ctImage = (n: number) => ({
  ReferencedSOPClassUID: '1.2.840.10008.5.1.4.1.1.2',
  ReferencedSOPInstanceUID: `1.9.${n}`,
});

const naturalizedGsps = (overrides: Partial<GspsInput> = {}) =>
  buildGspsNaturalizedDataset(
    {
      referencedSeries: [
        { SeriesInstanceUID: 'Se1', images: [ctImage(1), ctImage(2)] },
        { SeriesInstanceUID: 'Se2', images: [ctImage(3)] },
      ],
      displayedAreas: [{ images: [ctImage(1), ctImage(2), ctImage(3)], columns: 512, rows: 512 }],
      voi: [{ windowCenter: 40, windowWidth: 400 }],
      graphicAnnotations: [
        {
          images: [ctImage(1)],
          graphics: [
            { graphicType: 'POLYLINE', points: [[1, 2], [3, 4]] },
            { graphicType: 'POLYLINE', points: [[5, 6], [7, 8]] },
            { graphicType: 'ELLIPSE', points: [[0, 5], [10, 5], [5, 3], [5, 7]] },
          ],
          texts: [{ anchorPoint: [3, 4], text: 'finding' }],
        },
      ],
      ...overrides,
    },
    { StudyInstanceUID: 'S1' },
    {
      generateUID: counter(),
      seriesInstanceUID: 'PRSeries',
      contentLabel: 'bone w/l',
      contentDescription: 'Bone window',
      now: { date: '20260720', time: '120000' },
    }
  );

describe('parseGspsInstance', () => {
  it('round-trips: build -> parse recovers label, VOI, refs and graphic counts', () => {
    const parsed = parseGspsInstance(naturalizedGsps() as any);
    expect(parsed.sopInstanceUID).toBe('UID-1');
    expect(parsed.contentLabel).toBe('BONE_W_L');
    expect(parsed.contentDescription).toBe('Bone window');
    expect(parsed.voi).toEqual([{ windowCenter: 40, windowWidth: 400 }]);
    expect(parsed.referencedImages).toEqual([
      { SeriesInstanceUID: 'Se1', SOPInstanceUID: '1.9.1', SOPClassUID: ctImage(1).ReferencedSOPClassUID },
      { SeriesInstanceUID: 'Se1', SOPInstanceUID: '1.9.2', SOPClassUID: ctImage(2).ReferencedSOPClassUID },
      { SeriesInstanceUID: 'Se2', SOPInstanceUID: '1.9.3', SOPClassUID: ctImage(3).ReferencedSOPClassUID },
    ]);
    expect(parsed.graphicCounts).toEqual({ POLYLINE: 2, ELLIPSE: 1, TEXT: 1 });
  });

  it('parses a W/L-only state with empty graphic counts', () => {
    const parsed = parseGspsInstance(naturalizedGsps({ graphicAnnotations: [] }) as any);
    expect(parsed.voi).toEqual([{ windowCenter: 40, windowWidth: 400 }]);
    expect(parsed.graphicCounts).toEqual({});
  });

  it('handles scalar (non-array) sequences and multi-valued DS strings', () => {
    const parsed = parseGspsInstance({
      SOPInstanceUID: 'X',
      ContentLabel: 'LBL',
      ReferencedSeriesSequence: {
        SeriesInstanceUID: 'SeX',
        ReferencedImageSequence: { ReferencedSOPInstanceUID: 'I1', ReferencedSOPClassUID: 'C1' },
      },
      SoftcopyVOILUTSequence: { WindowCenter: ['40', '80'], WindowWidth: '400' },
      GraphicAnnotationSequence: {
        GraphicObjectSequence: { GraphicType: 'CIRCLE' },
        TextObjectSequence: { UnformattedTextValue: 'txt' },
      },
    });
    expect(parsed.referencedImages).toEqual([
      { SeriesInstanceUID: 'SeX', SOPInstanceUID: 'I1', SOPClassUID: 'C1' },
    ]);
    expect(parsed.voi).toEqual([{ windowCenter: 40, windowWidth: 400 }]);
    expect(parsed.graphicCounts).toEqual({ CIRCLE: 1, TEXT: 1 });
  });

  it('skips malformed items and tolerates empty/absent input', () => {
    const parsed = parseGspsInstance({
      ReferencedSeriesSequence: [{ ReferencedImageSequence: [{ ReferencedSOPInstanceUID: 'I' }] }],
      SoftcopyVOILUTSequence: [{ WindowCenter: 'abc', WindowWidth: '400' }],
    });
    expect(parsed.referencedImages).toEqual([]); // series without UID skipped
    expect(parsed.voi).toEqual([]); // non-numeric WC skipped
    expect(parseGspsInstance(undefined as any).referencedImages).toEqual([]);
  });

  it('de-duplicates repeated image references', () => {
    const parsed = parseGspsInstance({
      ReferencedSeriesSequence: [
        { SeriesInstanceUID: 'Se1', ReferencedImageSequence: [ctImage(1), ctImage(1)] },
      ],
    });
    expect(parsed.referencedImages).toHaveLength(1);
  });
});

describe('isGrayscaleSoftcopyPresentationState', () => {
  it('matches only the GSPS SOP class', () => {
    expect(isGrayscaleSoftcopyPresentationState(naturalizedGsps() as any)).toBe(true);
    expect(isGrayscaleSoftcopyPresentationState({ SOPClassUID: '1.2.840.10008.5.1.4.1.1.2' })).toBe(false);
  });
});
