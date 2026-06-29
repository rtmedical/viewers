import { classifyFile, partitionLocalFiles } from './localFileClassifier';

describe('classifyFile', () => {
  it('classifies by MIME type first', () => {
    expect(classifyFile({ type: 'application/dicom' })).toBe('dicom');
    expect(classifyFile({ type: 'application/pdf' })).toBe('pdf');
    expect(classifyFile({ type: 'image/png' })).toBe('image');
  });

  it('falls back to extension', () => {
    expect(classifyFile({ name: 'a.dcm' })).toBe('dicom');
    expect(classifyFile({ name: 'scan.DICOM' })).toBe('dicom');
    expect(classifyFile({ name: 'report.pdf' })).toBe('pdf');
    expect(classifyFile({ name: 'photo.JPG' })).toBe('image');
    expect(classifyFile({ name: 'notes.txt' })).toBe('unknown');
  });

  it('treats extension-less files as DICOM', () => {
    expect(classifyFile({ name: 'IM0001' })).toBe('dicom');
    expect(classifyFile({})).toBe('dicom');
  });

  it('prefers MIME over a misleading extension', () => {
    expect(classifyFile({ name: 'x.txt', type: 'application/pdf' })).toBe('pdf');
  });
});

describe('partitionLocalFiles', () => {
  it('groups files and summarizes counts + ingestibility', () => {
    const files = [
      { name: 'a.dcm' },
      { name: 'b', type: 'application/dicom' },
      { name: 'r.pdf' },
      { name: 'p.png' },
      { name: 'notes.txt' },
    ];
    const part = partitionLocalFiles(files);
    expect(part.dicom).toHaveLength(2);
    expect(part.pdf).toHaveLength(1);
    expect(part.image).toHaveLength(1);
    expect(part.unknown).toHaveLength(1);
    expect(part.summary).toEqual({ total: 5, dicom: 2, pdf: 1, image: 1, unknown: 1, ingestible: true });
  });

  it('marks a set with no DICOM/PDF as not ingestible', () => {
    const part = partitionLocalFiles([{ name: 'a.png' }, { name: 'b.txt' }]);
    expect(part.summary.ingestible).toBe(false);
  });

  it('handles an empty/undefined list', () => {
    expect(partitionLocalFiles([]).summary.total).toBe(0);
    expect(partitionLocalFiles(undefined as any).summary.total).toBe(0);
  });
});
