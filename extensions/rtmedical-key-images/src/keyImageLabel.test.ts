import { toKeyImageReference, describeKeyImage, KeyImageSource } from './keyImageLabel';

const source = (over: Partial<KeyImageSource> = {}): KeyImageSource => ({
  StudyInstanceUID: 'ST1',
  SeriesInstanceUID: 'SE1',
  SOPInstanceUID: 'OB1',
  ...over,
});

describe('toKeyImageReference', () => {
  it('builds a clean reference from a full source', () => {
    const ref = toKeyImageReference(
      source({ Modality: 'CT', SeriesNumber: 2, InstanceNumber: 14, SeriesDescription: 'Brain', frameNumber: 3 })
    );
    expect(ref).toEqual({
      StudyInstanceUID: 'ST1',
      SeriesInstanceUID: 'SE1',
      SOPInstanceUID: 'OB1',
      frameNumber: 3,
      Modality: 'CT',
      SeriesNumber: 2,
      InstanceNumber: 14,
      SeriesDescription: 'Brain',
    });
  });

  it('coerces string DICOM numbers to integers', () => {
    const ref = toKeyImageReference(source({ SeriesNumber: '2', InstanceNumber: '14' }));
    expect(ref.SeriesNumber).toBe(2);
    expect(ref.InstanceNumber).toBe(14);
  });

  it('drops empty/absent optional fields rather than storing blanks', () => {
    const ref = toKeyImageReference(source({ Modality: '', SeriesNumber: '', SeriesDescription: undefined }));
    expect('Modality' in ref).toBe(false);
    expect('SeriesNumber' in ref).toBe(false);
    expect('SeriesDescription' in ref).toBe(false);
  });

  it('throws on a missing required UID (un-selectable target)', () => {
    expect(() => toKeyImageReference(source({ SOPInstanceUID: undefined }))).toThrow(/required/);
  });
});

describe('describeKeyImage', () => {
  it('renders all present parts in order', () => {
    expect(
      describeKeyImage({
        StudyInstanceUID: 'ST1',
        SeriesInstanceUID: 'SE1',
        SOPInstanceUID: 'OB1',
        Modality: 'CT',
        SeriesNumber: 2,
        InstanceNumber: 14,
        frameNumber: 3,
      })
    ).toBe('CT · Series 2 · Image 14 · Frame 3');
  });

  it('falls back to series description when no series number', () => {
    expect(
      describeKeyImage({
        StudyInstanceUID: 'ST1',
        SeriesInstanceUID: 'SE1',
        SOPInstanceUID: 'OB1',
        SeriesDescription: 'T1 AX',
        InstanceNumber: 5,
      })
    ).toBe('T1 AX · Image 5');
  });

  it('omits the frame for single-frame instances', () => {
    expect(
      describeKeyImage({ StudyInstanceUID: 'ST1', SeriesInstanceUID: 'SE1', SOPInstanceUID: 'OB1', Modality: 'MR' })
    ).toBe('MR');
  });

  it('never returns empty — falls back to a SOP suffix', () => {
    expect(
      describeKeyImage({ StudyInstanceUID: 'ST1', SeriesInstanceUID: 'SE1', SOPInstanceUID: '1.2.3.456789' })
    ).toBe('Instance …3.456789');
  });
});
