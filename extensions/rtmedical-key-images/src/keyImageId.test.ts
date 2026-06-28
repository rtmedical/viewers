import { getKeyImageId, parseKeyImageId } from './keyImageId';
import { KeyImageReference } from './types';

const base: KeyImageReference = {
  StudyInstanceUID: '1.2.3',
  SeriesInstanceUID: '1.2.3.4',
  SOPInstanceUID: '1.2.3.4.5',
};

describe('getKeyImageId', () => {
  it('builds a stable id from the three UIDs', () => {
    expect(getKeyImageId(base)).toBe('1.2.3|1.2.3.4|1.2.3.4.5');
  });

  it('appends the frame number when present', () => {
    expect(getKeyImageId({ ...base, frameNumber: 7 })).toBe('1.2.3|1.2.3.4|1.2.3.4.5:7');
  });

  it('ignores display metadata (identity is UID-only)', () => {
    const withMeta = { ...base, Modality: 'CT', SeriesNumber: 2, SeriesDescription: 'x' };
    expect(getKeyImageId(withMeta)).toBe(getKeyImageId(base));
  });

  it.each(['StudyInstanceUID', 'SeriesInstanceUID', 'SOPInstanceUID'] as const)(
    'throws when %s is missing',
    field => {
      const ref = { ...base, [field]: '' };
      expect(() => getKeyImageId(ref)).toThrow(/required/);
    }
  );

  it('throws on a non-positive or non-integer frame number', () => {
    expect(() => getKeyImageId({ ...base, frameNumber: 0 })).toThrow(/positive integer/);
    expect(() => getKeyImageId({ ...base, frameNumber: -1 })).toThrow(/positive integer/);
    expect(() => getKeyImageId({ ...base, frameNumber: 1.5 })).toThrow(/positive integer/);
  });
});

describe('parseKeyImageId', () => {
  it('round-trips a frameless id', () => {
    expect(parseKeyImageId(getKeyImageId(base))).toEqual(base);
  });

  it('round-trips an id with a frame number', () => {
    const ref = { ...base, frameNumber: 12 };
    expect(parseKeyImageId(getKeyImageId(ref))).toEqual(ref);
  });

  it('throws on a malformed id', () => {
    expect(() => parseKeyImageId('')).toThrow();
    expect(() => parseKeyImageId('only|two')).toThrow(/3/);
    expect(() => parseKeyImageId('a|b|c:0')).toThrow(/frame/);
  });
});
