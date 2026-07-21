import {
  buildCadRadsSr,
  getCadRadsCategory,
  formatCadRads,
  CAD_RADS_CATEGORIES,
  CAD_RADS_MODIFIERS,
} from './cadRadsSr';

const counter = () => {
  let n = 0;
  return () => `U${++n}`;
};

describe('CAD-RADS model', () => {
  it('covers categories 0–5 incl. 4A/4B', () => {
    expect(CAD_RADS_CATEGORIES.map(c => c.code)).toEqual(['0', '1', '2', '3', '4A', '4B', '5']);
  });
  it('looks up case-insensitively', () => {
    expect(getCadRadsCategory('4a')?.stenosis).toMatch(/70–99%/);
  });
  it('formats with modifiers', () => {
    expect(formatCadRads({ category: '4A', modifiers: ['HRP', 'I'] })).toBe('CAD-RADS 4A / HRP/I');
    expect(formatCadRads({ category: '1' })).toBe('CAD-RADS 1');
    // unknown modifiers dropped
    expect(formatCadRads({ category: '2', modifiers: ['ZZ'] })).toBe('CAD-RADS 2');
  });
});

describe('buildCadRadsSr', () => {
  it('throws without generateUID', () => {
    expect(() => buildCadRadsSr({ category: '1' }, {} as any)).toThrow(/generateUID/);
  });

  it('emits a TID 3000 SR with category + modifiers + management', () => {
    const ds: any = buildCadRadsSr(
      { category: '4A', modifiers: ['HRP'], stenosisDescription: 'Proximal LAD' },
      { generateUID: counter() }
    );
    expect(ds.SOPClassUID).toBe('1.2.840.10008.5.1.4.1.1.88.33');
    expect(ds.Modality).toBe('SR');
    expect(ds.ContentTemplateSequence[0]).toEqual({ MappingResource: 'DCMR', TemplateIdentifier: '3000' });
    expect(ds.ConceptNameCodeSequence[0].CodeMeaning).toBe('CAD-RADS Report');

    const cs: any[] = ds.ContentSequence;
    const overall = cs.find(c => c.ConceptNameCodeSequence?.[0]?.CodeMeaning === 'Overall Assessment');
    expect(overall.ConceptCodeSequence[0].CodeValue).toBe('CAD-RADS 4A');

    const modifier = cs.find(c => c.ConceptNameCodeSequence?.[0]?.CodeMeaning === 'CAD-RADS Modifier');
    expect(modifier.ConceptCodeSequence[0]).toMatchObject({ CodeValue: 'HRP', CodeMeaning: CAD_RADS_MODIFIERS.HRP });

    const finding = cs.find(c => c.ValueType === 'TEXT' && c.TextValue === 'Proximal LAD');
    expect(finding).toBeTruthy();
    const mgmt = cs.find(c => c.ConceptNameCodeSequence?.[0]?.CodeMeaning === 'Recommended Follow-up');
    expect(mgmt.TextValue).toMatch(/ICA/);
  });

  it('drops unknown modifiers', () => {
    const cs: any[] = (buildCadRadsSr({ category: '1', modifiers: ['ZZ'] }, { generateUID: counter() }) as any).ContentSequence;
    expect(cs.some(c => c.ConceptNameCodeSequence?.[0]?.CodeMeaning === 'CAD-RADS Modifier')).toBe(false);
  });

  it('emits the Type 2 patient/study fields as empty strings by default (M2)', () => {
    const ds: any = buildCadRadsSr({ category: '1' }, { generateUID: counter() });
    expect(ds.PatientBirthDate).toBe('');
    expect(ds.PatientSex).toBe('');
    expect(ds.StudyDate).toBe('');
    expect(ds.StudyTime).toBe('');
    expect(ds.ReferringPhysicianName).toBe('');
    expect(ds.StudyID).toBe('');
  });

  it('stamps the full study context when provided (M2)', () => {
    const ds: any = buildCadRadsSr(
      { category: '1' },
      {
        generateUID: counter(),
        PatientBirthDate: '19700101',
        PatientSex: 'M',
        StudyDate: '20260721',
        StudyTime: '101500',
        ReferringPhysicianName: 'Ref^Doc',
        StudyID: 'STU-7',
      }
    );
    expect(ds.PatientBirthDate).toBe('19700101');
    expect(ds.PatientSex).toBe('M');
    expect(ds.StudyDate).toBe('20260721');
    expect(ds.StudyTime).toBe('101500');
    expect(ds.ReferringPhysicianName).toBe('Ref^Doc');
    expect(ds.StudyID).toBe('STU-7');
  });
});
