import { buildKosDescriptor, KOS_DOCUMENT_TITLES, KEY_OBJECT_SELECTION_SOP_CLASS_UID } from './kos';
import { buildKosNaturalizedDataset, SECONDARY_CAPTURE_SOP_CLASS_UID } from './kosDataset';
import { parseKosInstance, isKeyObjectSelection } from './parseKosInstance';
import { KeyImageReference } from './types';

const refs: KeyImageReference[] = [
  { StudyInstanceUID: 'S1', SeriesInstanceUID: 'Se1', SOPInstanceUID: 'I1', SOPClassUID: 'CT' },
  { StudyInstanceUID: 'S1', SeriesInstanceUID: 'Se1', SOPInstanceUID: 'I2' },
  { StudyInstanceUID: 'S1', SeriesInstanceUID: 'Se2', SOPInstanceUID: 'I3', frameNumber: 2, SOPClassUID: 'MF' },
  { StudyInstanceUID: 'S1', SeriesInstanceUID: 'Se2', SOPInstanceUID: 'I3', frameNumber: 5, SOPClassUID: 'MF' },
];

const counter = () => {
  let n = 0;
  return () => `UID-${++n}`;
};

const naturalizedKos = () =>
  buildKosNaturalizedDataset(buildKosDescriptor(refs, { title: KOS_DOCUMENT_TITLES.FOR_TEACHING }), {
    generateUID: counter(),
    description: 'Teaching set',
  });

describe('parseKosInstance', () => {
  it('round-trips: build -> parse recovers every reference with Study/Series identity', () => {
    const parsed = parseKosInstance(naturalizedKos() as any);
    expect(parsed.references).toEqual([
      { StudyInstanceUID: 'S1', SeriesInstanceUID: 'Se1', SOPInstanceUID: 'I1', SOPClassUID: 'CT' },
      { StudyInstanceUID: 'S1', SeriesInstanceUID: 'Se1', SOPInstanceUID: 'I2', SOPClassUID: SECONDARY_CAPTURE_SOP_CLASS_UID },
      { StudyInstanceUID: 'S1', SeriesInstanceUID: 'Se2', SOPInstanceUID: 'I3', SOPClassUID: 'MF', frameNumber: 2 },
      { StudyInstanceUID: 'S1', SeriesInstanceUID: 'Se2', SOPInstanceUID: 'I3', SOPClassUID: 'MF', frameNumber: 5 },
    ]);
  });

  it('recovers the document title and description', () => {
    const parsed = parseKosInstance(naturalizedKos() as any);
    expect(parsed.title?.CodeValue).toBe(KOS_DOCUMENT_TITLES.FOR_TEACHING.CodeValue);
    expect(parsed.description).toBe('Teaching set');
  });

  it('skips IMAGE references absent from the evidence sequence', () => {
    const instance = {
      SOPClassUID: KEY_OBJECT_SELECTION_SOP_CLASS_UID,
      CurrentRequestedProcedureEvidenceSequence: [
        { StudyInstanceUID: 'S1', ReferencedSeriesSequence: [{ SeriesInstanceUID: 'Se1', ReferencedSOPSequence: [{ ReferencedSOPInstanceUID: 'I1' }] }] },
      ],
      ContentSequence: [
        { ValueType: 'IMAGE', ReferencedSOPSequence: [{ ReferencedSOPInstanceUID: 'I1' }] },
        { ValueType: 'IMAGE', ReferencedSOPSequence: [{ ReferencedSOPInstanceUID: 'ORPHAN' }] },
      ],
    };
    const parsed = parseKosInstance(instance as any);
    expect(parsed.references.map(r => r.SOPInstanceUID)).toEqual(['I1']);
  });

  it('is defensive about single-item sequences naturalized as scalars', () => {
    const instance = {
      SOPClassUID: KEY_OBJECT_SELECTION_SOP_CLASS_UID,
      CurrentRequestedProcedureEvidenceSequence: {
        StudyInstanceUID: 'S1',
        ReferencedSeriesSequence: { SeriesInstanceUID: 'Se1', ReferencedSOPSequence: { ReferencedSOPInstanceUID: 'I1' } },
      },
      ContentSequence: { ValueType: 'IMAGE', ReferencedSOPSequence: { ReferencedSOPInstanceUID: 'I1' } },
    };
    const parsed = parseKosInstance(instance as any);
    expect(parsed.references.map(r => r.SOPInstanceUID)).toEqual(['I1']);
  });

  it('isKeyObjectSelection identifies KOS instances', () => {
    expect(isKeyObjectSelection({ SOPClassUID: KEY_OBJECT_SELECTION_SOP_CLASS_UID })).toBe(true);
    expect(isKeyObjectSelection({ SOPClassUID: '1.2.3' })).toBe(false);
  });
});
