import { buildMammographyCadSr, MAMMO_CAD_SR_SOP_CLASS_UID } from './mammographyCadSr';
import { BiradsAssessment } from './birads';

const counter = () => {
  let n = 0;
  return () => `U${++n}`;
};

const assessment: BiradsAssessment = {
  laterality: 'Right',
  density: 'c',
  findings: [{ type: 'Mass', descriptors: ['Irregular', 'Spiculated'], location: 'UOQ' }],
  category: '4B',
};

const build = (opts = {}) => buildMammographyCadSr(assessment, { generateUID: counter(), ...opts });

describe('buildMammographyCadSr', () => {
  it('throws without assessment or generateUID', () => {
    expect(() => buildMammographyCadSr(undefined as any, { generateUID: counter() })).toThrow();
    expect(() => buildMammographyCadSr(assessment, {} as any)).toThrow(/generateUID/);
  });

  it('emits the SR scaffolding (Mammography CAD SR, Modality SR, TID 2000)', () => {
    const ds: any = build();
    expect(ds.SOPClassUID).toBe(MAMMO_CAD_SR_SOP_CLASS_UID);
    expect(ds.Modality).toBe('SR');
    expect(ds.ValueType).toBe('CONTAINER');
    expect(ds.ContentTemplateSequence[0]).toEqual({ MappingResource: 'DCMR', TemplateIdentifier: '2000' });
    expect(ds.ConceptNameCodeSequence[0].CodeMeaning).toBe('Mammography CAD Report');
    expect(ds.CompletionFlag).toBe('COMPLETE');
  });

  it('uses the injected UID factory and honors a provided StudyInstanceUID', () => {
    expect((build() as any).SOPInstanceUID).toBe('U1');
    expect((build() as any).StudyInstanceUID).toBe('U2'); // generated when not provided
    expect((build({ StudyInstanceUID: 'S99' }) as any).StudyInstanceUID).toBe('S99');
  });

  it('encodes density, overall assessment, finding and management', () => {
    const cs: any[] = (build() as any).ContentSequence;
    const density = cs.find(c => c.ConceptNameCodeSequence?.[0]?.CodeMeaning === 'Breast Composition');
    expect(density.ConceptCodeSequence[0].CodeValue).toBe('c');

    const overall = cs.find(c => c.ConceptNameCodeSequence?.[0]?.CodeMeaning === 'Overall Assessment');
    expect(overall.ConceptCodeSequence[0]).toMatchObject({ CodeValue: '4B', CodeMeaning: 'Suspicious — moderate' });

    const finding = cs.find(c => c.ValueType === 'CONTAINER' && c.ConceptNameCodeSequence?.[0]?.CodeMeaning === 'Mass');
    expect(finding).toBeTruthy();
    const fTexts = finding.ContentSequence.map((x: any) => x.TextValue);
    expect(fTexts).toContain('Irregular, Spiculated');
    expect(fTexts).toContain('UOQ');

    const mgmt = cs.find(c => c.ConceptNameCodeSequence?.[0]?.CodeMeaning === 'Recommended Follow-up');
    expect(mgmt.TextValue).toMatch(/Tissue diagnosis/);
  });

  it('stamps patient identity from options', () => {
    const ds: any = build({ PatientName: 'X', PatientID: 'PID' });
    expect(ds.PatientName).toBe('X');
    expect(ds.PatientID).toBe('PID');
  });
});
