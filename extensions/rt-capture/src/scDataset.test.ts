import {
  SC_SOP_CLASS_UID,
  SC_SERIES_DESCRIPTION,
  buildScNaturalizedDataset,
  rgbaToRgb,
  toEvenArrayBuffer,
} from './scDataset';

const uidFactory = () => {
  let n = 0;
  return () => `1.2.3.${++n}`;
};

const context = {
  PatientName: 'DOE^JANE',
  PatientID: 'P123',
  StudyInstanceUID: '1.2.840.999.1',
  StudyDate: '20260719',
  StudyTime: '101500',
  AccessionNumber: 'ACC1',
};

const image = (rows = 2, columns = 2) => ({
  rows,
  columns,
  rgb: new Uint8Array(rows * columns * 3).map((_, i) => i % 256),
});

const options = () => ({
  generateUID: uidFactory(),
  seriesInstanceUID: '1.2.840.999.2',
  now: { date: '20260719', time: '235959' },
});

describe('rgbaToRgb', () => {
  it('strips the alpha channel keeping pixel order', () => {
    const rgba = Uint8ClampedArray.from([10, 20, 30, 255, 40, 50, 60, 128]);
    expect(Array.from(rgbaToRgb(rgba))).toEqual([10, 20, 30, 40, 50, 60]);
  });
});

describe('toEvenArrayBuffer', () => {
  it('pads odd-length buffers with a trailing zero', () => {
    const buf = toEvenArrayBuffer(Uint8Array.from([1, 2, 3]));
    expect(buf.byteLength).toBe(4);
    expect(new Uint8Array(buf)[3]).toBe(0);
  });

  it('keeps even-length buffers as-is', () => {
    const buf = toEvenArrayBuffer(Uint8Array.from([1, 2]));
    expect(Array.from(new Uint8Array(buf))).toEqual([1, 2]);
  });
});

describe('buildScNaturalizedDataset (RTV-203)', () => {
  it('builds a valid SC IOD with the RGB pixel module', () => {
    const ds = buildScNaturalizedDataset(image(3, 5), context, options());
    expect(ds.SOPClassUID).toBe(SC_SOP_CLASS_UID);
    expect(ds.SOPInstanceUID).toBe('1.2.3.1');
    expect(ds.Modality).toBe('OT');
    expect(ds.ConversionType).toBe('WSD');
    expect(ds.SamplesPerPixel).toBe(3);
    expect(ds.PhotometricInterpretation).toBe('RGB');
    expect(ds.PlanarConfiguration).toBe(0);
    expect(ds.Rows).toBe(3);
    expect(ds.Columns).toBe(5);
    expect(ds.BitsAllocated).toBe(8);
    expect(ds.HighBit).toBe(7);
    expect(ds.ImageType).toEqual(['DERIVED', 'SECONDARY']);
    expect(ds.BurnedInAnnotation).toBe('YES');
    // 3*5*3 = 45 bytes → padded to 46
    expect((ds.PixelData as ArrayBuffer).byteLength).toBe(46);
    // explicit VR so dcmjs writes OB instead of guessing (console-error free)
    expect(ds._vrMap).toEqual({ PixelData: 'OB' });
  });

  it('files the SC under the SOURCE study and the dedicated capture series', () => {
    const ds = buildScNaturalizedDataset(image(), context, options());
    expect(ds.StudyInstanceUID).toBe(context.StudyInstanceUID);
    expect(ds.AccessionNumber).toBe('ACC1');
    expect(ds.PatientID).toBe('P123');
    expect(ds.SeriesInstanceUID).toBe('1.2.840.999.2');
    expect(ds.SeriesDescription).toBe(SC_SERIES_DESCRIPTION);
    expect(ds.SeriesNumber).toBe('9901');
    expect(ds.ContentDate).toBe('20260719');
    expect(ds.ContentTime).toBe('235959');
  });

  it('carries optional comments and source-image references', () => {
    const ds = buildScNaturalizedDataset(image(), context, {
      ...options(),
      imageComments: 'RT Medical SC - 2026-07-19',
      sourceImages: [
        { ReferencedSOPClassUID: '1.2.840.10008.5.1.4.1.1.2', ReferencedSOPInstanceUID: '1.9.9' },
        { ReferencedSOPClassUID: '', ReferencedSOPInstanceUID: 'dropped' },
      ],
    });
    expect(ds.ImageComments).toBe('RT Medical SC - 2026-07-19');
    expect(ds.SourceImageSequence).toEqual([
      { ReferencedSOPClassUID: '1.2.840.10008.5.1.4.1.1.2', ReferencedSOPInstanceUID: '1.9.9' },
    ]);
  });

  it('rejects empty images, mismatched buffers and missing study identity', () => {
    expect(() =>
      buildScNaturalizedDataset({ rows: 0, columns: 0, rgb: new Uint8Array(0) }, context, options())
    ).toThrow(/non-empty/);
    expect(() =>
      buildScNaturalizedDataset({ rows: 2, columns: 2, rgb: new Uint8Array(5) }, context, options())
    ).toThrow(/does not match/);
    expect(() =>
      buildScNaturalizedDataset(image(), { StudyInstanceUID: '' } as never, options())
    ).toThrow(/StudyInstanceUID/);
  });
});
