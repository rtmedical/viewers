import { deidentify, deidActions, PHI_ACTIONS } from './deidentify';

const sample = () => ({
  PatientName: 'Doe^John',
  PatientID: 'MRN12345',
  PatientSex: 'M',
  PatientAddress: '123 Main St',
  PatientTelephoneNumbers: '555-1234',
  AccessionNumber: 'ACC999',
  StudyDate: '20260115',
  StudyTime: '101500',
  Modality: 'CT',
  Rows: 512,
  StudyInstanceUID: '1.2.3.study',
  SeriesInstanceUID: '1.2.3.series',
  RequestAttributesSequence: [{ RequestedProcedureID: 'RP1' }],
  ReferencedImageSequence: [
    { ReferencedSOPInstanceUID: '1.2.3.img', PatientName: 'Doe^John' },
  ],
});

describe('deidentify — Basic Profile actions', () => {
  it('D: dummies PatientName; Z: zeroes PatientID/Accession; X: removes address/phone; K: keeps sex', () => {
    const out = deidentify(sample());
    expect(out.PatientName).toBe('ANONYMIZED');
    expect(out.PatientID).toBe('');
    expect(out.AccessionNumber).toBe('');
    expect(out).not.toHaveProperty('PatientAddress');
    expect(out).not.toHaveProperty('PatientTelephoneNumbers');
    expect(out.PatientSex).toBe('M');
  });

  it('keeps non-PHI tags untouched', () => {
    const out = deidentify(sample());
    expect(out.Modality).toBe('CT');
    expect(out.Rows).toBe(512);
  });

  it('zeroes dates by default, retains them with retainDates', () => {
    expect(deidentify(sample()).StudyDate).toBe('');
    expect(deidentify(sample()).StudyTime).toBe('');
    const kept = deidentify(sample(), { retainDates: true });
    expect(kept.StudyDate).toBe('20260115');
  });

  it('retains UIDs by default; remaps them when retainUids:false + remapUid', () => {
    expect(deidentify(sample()).StudyInstanceUID).toBe('1.2.3.study');
    const remapped = deidentify(sample(), { retainUids: false, remapUid: u => `R(${u})` });
    expect(remapped.StudyInstanceUID).toBe('R(1.2.3.study)');
    expect(remapped.SeriesInstanceUID).toBe('R(1.2.3.series)');
  });

  it('removes X-action sequences and recurses into kept sequences', () => {
    const out = deidentify(sample(), { retainUids: false, remapUid: u => `R(${u})` });
    expect(out).not.toHaveProperty('RequestAttributesSequence');
    // ReferencedImageSequence is recursed: nested PatientName dummied, UID remapped
    expect(out.ReferencedImageSequence[0].PatientName).toBe('ANONYMIZED');
    expect(out.ReferencedImageSequence[0].ReferencedSOPInstanceUID).toBe('R(1.2.3.img)');
  });

  it('stamps PatientIdentityRemoved + DeidentificationMethod', () => {
    const out = deidentify(sample());
    expect(out.PatientIdentityRemoved).toBe('YES');
    expect(out.DeidentificationMethod).toMatch(/Annex E/);
  });

  it('does not mutate the input', () => {
    const input = sample();
    deidentify(input);
    expect(input.PatientName).toBe('Doe^John');
    expect(input.PatientID).toBe('MRN12345');
    expect(input).toHaveProperty('PatientAddress');
  });

  it('is defensive about empty input', () => {
    expect(deidentify(undefined as any)).toEqual({});
  });
});

describe('deidActions', () => {
  it('lists every PHI keyword with its action', () => {
    const list = deidActions();
    expect(list.length).toBe(Object.keys(PHI_ACTIONS).length);
    expect(list.find(a => a.keyword === 'PatientName')).toEqual({ keyword: 'PatientName', action: 'D' });
  });
});
