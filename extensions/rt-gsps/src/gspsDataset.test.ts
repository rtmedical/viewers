import {
  GSPS_CONTENT_LABEL_MAX_LENGTH,
  GSPS_DEFAULT_CONTENT_LABEL,
  GSPS_GRAPHIC_LAYER,
  GSPS_SERIES_DESCRIPTION,
  GSPS_SOP_CLASS_UID,
  GspsInput,
  buildGspsNaturalizedDataset,
  sanitizeContentLabel,
} from './gspsDataset';

const uidFactory = () => {
  let n = 0;
  return () => `1.2.3.${++n}`;
};

const context = {
  PatientName: 'DOE^JANE',
  PatientID: 'P123',
  StudyInstanceUID: '1.2.840.999.1',
  StudyDate: '20260720',
  StudyTime: '101500',
  AccessionNumber: 'ACC1',
};

const ctImage = (n: number) => ({
  ReferencedSOPClassUID: '1.2.840.10008.5.1.4.1.1.2',
  ReferencedSOPInstanceUID: `1.9.${n}`,
});

const input = (overrides: Partial<GspsInput> = {}): GspsInput => ({
  referencedSeries: [{ SeriesInstanceUID: '1.2.840.999.3', images: [ctImage(1), ctImage(2)] }],
  // Displayed Area is a mandatory module — every fixture carries one.
  displayedAreas: [{ images: [ctImage(1), ctImage(2)], columns: 512, rows: 512 }],
  ...overrides,
});

const options = () => ({
  generateUID: uidFactory(),
  seriesInstanceUID: '1.2.840.999.2',
  now: { date: '20260720', time: '235959' },
});

describe('sanitizeContentLabel', () => {
  it('uppercases and collapses invalid runs to underscores', () => {
    expect(sanitizeContentLabel('W/L bone (axial)')).toBe('W_L_BONE_AXIAL');
  });

  it('truncates to the CS-safe maximum length', () => {
    const label = sanitizeContentLabel('a very long presentation label indeed');
    expect(label.length).toBeLessThanOrEqual(GSPS_CONTENT_LABEL_MAX_LENGTH);
    expect(label).toBe('A_VERY_LONG_PRES');
  });

  it('falls back to the default when nothing survives', () => {
    expect(sanitizeContentLabel('!!! ///')).toBe(GSPS_DEFAULT_CONTENT_LABEL);
    expect(sanitizeContentLabel(undefined)).toBe(GSPS_DEFAULT_CONTENT_LABEL);
  });
});

describe('buildGspsNaturalizedDataset (RTV-200)', () => {
  it('builds the GSPS IOD modules for a W/L-only state', () => {
    const ds = buildGspsNaturalizedDataset(
      input({
        voi: [{ windowCenter: 40, windowWidth: 400 }],
        displayedAreas: [{ images: [ctImage(1), ctImage(2)], columns: 512, rows: 256 }],
      }),
      context,
      options()
    );
    expect(ds.SOPClassUID).toBe(GSPS_SOP_CLASS_UID);
    expect(ds.SOPInstanceUID).toBe('1.2.3.1');
    expect(ds.Modality).toBe('PR');
    expect(ds.SeriesDescription).toBe(GSPS_SERIES_DESCRIPTION);
    expect(ds.SeriesNumber).toBe('9902');
    expect(ds.PresentationLUTShape).toBe('IDENTITY');
    expect(ds.PresentationCreationDate).toBe('20260720');
    expect(ds.PresentationCreationTime).toBe('235959');
    expect(ds.ReferencedSeriesSequence).toEqual([
      {
        SeriesInstanceUID: '1.2.840.999.3',
        ReferencedImageSequence: [ctImage(1), ctImage(2)],
      },
    ]);
    expect(ds.DisplayedAreaSelectionSequence).toEqual([
      {
        ReferencedImageSequence: [ctImage(1), ctImage(2)],
        DisplayedAreaTopLeftHandCorner: [1, 1],
        DisplayedAreaBottomRightHandCorner: [512, 256],
        PresentationSizeMode: 'SCALE TO FIT',
      },
    ]);
    // W/L-only: no graphic modules emitted.
    expect(ds.GraphicLayerSequence).toBeUndefined();
    expect(ds.GraphicAnnotationSequence).toBeUndefined();
  });

  it('files the GSPS under the SOURCE study', () => {
    const ds = buildGspsNaturalizedDataset(input(), context, options());
    expect(ds.StudyInstanceUID).toBe(context.StudyInstanceUID);
    expect(ds.PatientID).toBe('P123');
    expect(ds.AccessionNumber).toBe('ACC1');
    expect(ds.SeriesInstanceUID).toBe('1.2.840.999.2');
  });

  it('emits the Softcopy VOI LUT with WC/WW, defaulting to all references', () => {
    const ds = buildGspsNaturalizedDataset(
      input({ voi: [{ windowCenter: -600, windowWidth: 1500 }] }),
      context,
      options()
    );
    expect(ds.SoftcopyVOILUTSequence).toEqual([
      {
        ReferencedImageSequence: [ctImage(1), ctImage(2)],
        WindowCenter: -600,
        WindowWidth: 1500,
      },
    ]);
  });

  it('flattens graphic points into GraphicData and stamps the RTMEDICAL layer', () => {
    const ds = buildGspsNaturalizedDataset(
      input({
        graphicAnnotations: [
          {
            images: [ctImage(1)],
            graphics: [
              {
                graphicType: 'POLYLINE',
                points: [
                  [10.5, 20.5],
                  [30, 40],
                ],
              },
            ],
            texts: [{ anchorPoint: [30, 40], text: 'L = 12.3 mm' }],
          },
        ],
      }),
      context,
      options()
    );
    expect(ds.GraphicLayerSequence).toEqual([
      expect.objectContaining({ GraphicLayer: GSPS_GRAPHIC_LAYER, GraphicLayerOrder: 1 }),
    ]);
    const [annotation] = ds.GraphicAnnotationSequence as any[];
    expect(annotation.GraphicLayer).toBe(GSPS_GRAPHIC_LAYER);
    expect(annotation.ReferencedImageSequence).toEqual([ctImage(1)]);
    expect(annotation.GraphicObjectSequence).toEqual([
      {
        GraphicAnnotationUnits: 'PIXEL',
        GraphicDimensions: 2,
        NumberOfGraphicPoints: 2,
        GraphicData: [10.5, 20.5, 30, 40],
        GraphicType: 'POLYLINE',
        // open polyline — GraphicFilled (Type 1C) intentionally absent
      },
    ]);
    expect(annotation.TextObjectSequence).toEqual([
      {
        AnchorPoint: [30, 40],
        AnchorPointAnnotationUnits: 'PIXEL',
        UnformattedTextValue: 'L = 12.3 mm',
        AnchorPointVisibility: 'Y',
      },
    ]);
  });

  it('sanitizes the user label into ContentLabel and keeps the description', () => {
    const ds = buildGspsNaturalizedDataset(input(), context, {
      ...options(),
      contentLabel: 'bone w/l',
      contentDescription: 'Bone window for the report',
    });
    expect(ds.ContentLabel).toBe('BONE_W_L');
    expect(ds.ContentDescription).toBe('Bone window for the report');
  });

  it('rejects missing references and missing study identity', () => {
    expect(() =>
      buildGspsNaturalizedDataset({ referencedSeries: [] }, context, options())
    ).toThrow(/referenced image/);
    expect(() =>
      buildGspsNaturalizedDataset(
        input({
          referencedSeries: [
            {
              SeriesInstanceUID: '1.2.840.999.3',
              images: [{ ReferencedSOPClassUID: '', ReferencedSOPInstanceUID: 'x' }],
            },
          ],
        }),
        context,
        options()
      )
    ).toThrow(/referenced image/);
    expect(() =>
      buildGspsNaturalizedDataset(input(), { StudyInstanceUID: '' } as never, options())
    ).toThrow(/StudyInstanceUID/);
  });
});

describe('buildGspsNaturalizedDataset — review hardening (RTV-200)', () => {
  it('rides the source Modality LUT along so WC/WW stays in post-rescale units', () => {
    const ds = buildGspsNaturalizedDataset(
      input({ rescale: { intercept: -1024, slope: 1, type: 'HU' } }),
      context,
      options()
    );
    expect(ds.RescaleIntercept).toBe(-1024);
    expect(ds.RescaleSlope).toBe(1);
    expect(ds.RescaleType).toBe('HU');
  });

  it('omits the Modality LUT when the source has none (identity)', () => {
    const ds = buildGspsNaturalizedDataset(input(), context, options());
    expect(ds.RescaleIntercept).toBeUndefined();
  });

  it('throws without a displayed area (mandatory module)', () => {
    expect(() =>
      buildGspsNaturalizedDataset(input({ displayedAreas: [] }), context, options())
    ).toThrow(/displayed area/);
  });

  it('emits GraphicFilled only for closed geometry', () => {
    const ds = buildGspsNaturalizedDataset(
      input({
        graphicAnnotations: [
          {
            images: [ctImage(1)],
            graphics: [
              { graphicType: 'POINT', points: [[10, 10]] },
              { graphicType: 'CIRCLE', points: [[10, 10], [20, 10]] },
              { graphicType: 'POLYLINE', points: [[0, 0], [5, 0], [5, 5], [0, 0]] },
              { graphicType: 'POLYLINE', points: [[0, 0], [5, 0]] },
            ],
            texts: [],
          },
        ],
      }),
      context,
      options()
    );
    const graphics = (ds.GraphicAnnotationSequence as any[])[0].GraphicObjectSequence;
    expect(graphics[0].GraphicFilled).toBeUndefined(); // POINT
    expect(graphics[1].GraphicFilled).toBe('N'); // CIRCLE
    expect(graphics[2].GraphicFilled).toBe('N'); // closed POLYLINE
    expect(graphics[3].GraphicFilled).toBeUndefined(); // open POLYLINE
  });
});
