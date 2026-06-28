import { buildKosDescriptor, KOS_DOCUMENT_TITLES, KEY_OBJECT_SELECTION_SOP_CLASS_UID } from './kos';
import {
  buildKosNaturalizedDataset,
  SECONDARY_CAPTURE_SOP_CLASS_UID,
} from './kosDataset';
import { KeyImageReference } from './types';

/** Deterministic UID factory so the dataset is fully assertable. */
const counter = () => {
  let n = 0;
  return () => `UID-${++n}`;
};

const refs: KeyImageReference[] = [
  { StudyInstanceUID: 'S1', SeriesInstanceUID: 'Se1', SOPInstanceUID: 'I1', SOPClassUID: 'CT' },
  { StudyInstanceUID: 'S1', SeriesInstanceUID: 'Se1', SOPInstanceUID: 'I2' }, // no SOP Class
  { StudyInstanceUID: 'S1', SeriesInstanceUID: 'Se2', SOPInstanceUID: 'I3', frameNumber: 2, SOPClassUID: 'MF' },
  { StudyInstanceUID: 'S1', SeriesInstanceUID: 'Se2', SOPInstanceUID: 'I3', frameNumber: 5, SOPClassUID: 'MF' },
];

const build = (opts = {}) =>
  buildKosNaturalizedDataset(buildKosDescriptor(refs), { generateUID: counter(), ...opts });

describe('buildKosNaturalizedDataset', () => {
  it('throws on a descriptor with no evidence', () => {
    expect(() =>
      buildKosNaturalizedDataset({ sopClassUID: 'x', title: KOS_DOCUMENT_TITLES.OF_INTEREST, references: [], evidence: [] }, { generateUID: counter() })
    ).toThrow(/evidence/);
  });

  it('throws without a generateUID factory', () => {
    expect(() => buildKosNaturalizedDataset(buildKosDescriptor(refs), {} as any)).toThrow(/generateUID/);
  });

  it('emits the KOS IOD scaffolding (KO modality, TID 2010, CID 7010 title)', () => {
    const ds: any = build();
    expect(ds.SOPClassUID).toBe(KEY_OBJECT_SELECTION_SOP_CLASS_UID);
    expect(ds.Modality).toBe('KO');
    expect(ds.ValueType).toBe('CONTAINER');
    expect(ds.ContinuityOfContent).toBe('SEPARATE');
    expect(ds.ContentTemplateSequence[0]).toEqual({ MappingResource: 'DCMR', TemplateIdentifier: '2010' });
    expect(ds.ConceptNameCodeSequence[0].CodeValue).toBe(KOS_DOCUMENT_TITLES.OF_INTEREST.CodeValue);
  });

  it('uses the injected UID factory for SOP and Series instance UIDs', () => {
    const ds: any = build();
    expect(ds.SOPInstanceUID).toBe('UID-1');
    expect(ds.SeriesInstanceUID).toBe('UID-2');
  });

  it('files the document under the first referenced study by default, overridable', () => {
    expect((build() as any).StudyInstanceUID).toBe('S1');
    expect((build({ StudyInstanceUID: 'SX' }) as any).StudyInstanceUID).toBe('SX');
  });

  it('builds the evidence sequence with a SOP Class fallback', () => {
    const ev: any = (build() as any).CurrentRequestedProcedureEvidenceSequence;
    expect(ev).toHaveLength(1);
    expect(ev[0].StudyInstanceUID).toBe('S1');
    expect(ev[0].ReferencedSeriesSequence).toHaveLength(2);
    const se1 = ev[0].ReferencedSeriesSequence[0].ReferencedSOPSequence;
    expect(se1[0].ReferencedSOPClassUID).toBe('CT');
    expect(se1[1].ReferencedSOPClassUID).toBe(SECONDARY_CAPTURE_SOP_CLASS_UID);
  });

  it('emits one IMAGE content item per instance with aggregated frame numbers', () => {
    const cs: any = (build() as any).ContentSequence.filter((c: any) => c.ValueType === 'IMAGE');
    expect(cs).toHaveLength(3); // I1, I2, I3 (frames merged onto one instance)
    const i3 = cs[2].ReferencedSOPSequence[0];
    expect(i3.ReferencedSOPInstanceUID).toBe('I3');
    expect(i3.ReferencedFrameNumber).toEqual(['2', '5']);
    // single-frame instances carry no ReferencedFrameNumber
    expect(cs[0].ReferencedSOPSequence[0].ReferencedFrameNumber).toBeUndefined();
  });

  it('emits a TEXT description content item when a description is provided', () => {
    const cs: any = (build({ description: 'Tumor response' }) as any).ContentSequence;
    const text = cs.find((c: any) => c.ValueType === 'TEXT');
    expect(text.TextValue).toBe('Tumor response');
    expect(text.ConceptNameCodeSequence[0].CodeValue).toBe('113012');
  });
});
