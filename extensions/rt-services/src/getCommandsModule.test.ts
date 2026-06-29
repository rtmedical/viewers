import { getCommandsModule } from './getCommandsModule';

describe('getCommandsModule', () => {
  const { actions, definitions, defaultContext } = getCommandsModule();

  it('exposes classify + summarize commands in DEFAULT', () => {
    expect(defaultContext).toBe('DEFAULT');
    expect(Object.keys(definitions).sort()).toEqual(['classifyLocalFiles', 'summarizeLocalFileDrop']);
  });

  it('classifyLocalFiles partitions a set', () => {
    const part = actions.classifyLocalFiles({ files: [{ name: 'a.dcm' }, { name: 'r.pdf' }] });
    expect(part.summary).toMatchObject({ total: 2, dicom: 1, pdf: 1, ingestible: true });
  });

  it('summarizeLocalFileDrop renders a human summary', () => {
    expect(actions.summarizeLocalFileDrop({ files: [{ name: 'a.dcm' }, { name: 'b.dcm' }, { name: 'p.png' }] }))
      .toBe('2 DICOM — 1 ignored');
    expect(actions.summarizeLocalFileDrop({ files: [] })).toBeNull();
  });
});
