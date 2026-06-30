import { buildMeasurementSr, COMPREHENSIVE_SR_SOP_CLASS_UID, SrMeasurement } from './measurementSr';

const counter = () => {
  let n = 0;
  return () => `U${++n}`;
};

const measurements: SrMeasurement[] = [
  { name: 'Long axis', value: 23.4, unit: 'mm' },
  {
    name: 'HU mean',
    nameCode: { value: '112031', scheme: 'DCM', meaning: 'Attenuation Coefficient' },
    value: 45,
    unit: "[hnsf'U]",
    unitMeaning: 'HU',
    trackingIdentifier: 'T1',
    referencedSopInstanceUID: '1.2.img',
  },
];

const build = (opts = {}) => buildMeasurementSr(measurements, { generateUID: counter(), ...opts });

describe('buildMeasurementSr (TID 1500)', () => {
  it('throws without generateUID', () => {
    expect(() => buildMeasurementSr(measurements, {} as any)).toThrow(/generateUID/);
  });

  it('emits the SR scaffolding (Comprehensive SR, Modality SR, TID 1500)', () => {
    const ds: any = build();
    expect(ds.SOPClassUID).toBe(COMPREHENSIVE_SR_SOP_CLASS_UID);
    expect(ds.Modality).toBe('SR');
    expect(ds.ValueType).toBe('CONTAINER');
    expect(ds.ContentTemplateSequence[0]).toEqual({ MappingResource: 'DCMR', TemplateIdentifier: '1500' });
    expect(ds.ConceptNameCodeSequence[0].CodeMeaning).toBe('Imaging Measurement Report');
    expect(ds.SOPInstanceUID).toBe('U1');
    expect(ds.StudyInstanceUID).toBe('U2');
  });

  it('nests Imaging Measurements → Measurement Group → NUM items', () => {
    const ds: any = build();
    const im = ds.ContentSequence[0];
    expect(im.ConceptNameCodeSequence[0].CodeMeaning).toBe('Imaging Measurements');
    const group = im.ContentSequence[0];
    expect(group.ConceptNameCodeSequence[0].CodeMeaning).toBe('Measurement Group');
    const nums = group.ContentSequence;
    expect(nums).toHaveLength(2);
    expect(nums[0]).toMatchObject({ ValueType: 'NUM' });
    expect(nums[0].ConceptNameCodeSequence[0].CodeMeaning).toBe('Long axis');
    expect(nums[0].MeasuredValueSequence[0].NumericValue).toBe('23.4');
    expect(nums[0].MeasuredValueSequence[0].MeasurementUnitsCodeSequence[0].CodeValue).toBe('mm');
  });

  it('uses a coded concept name + carries tracking id and referenced image', () => {
    const nums: any[] = (build() as any).ContentSequence[0].ContentSequence[0].ContentSequence;
    const hu = nums[1];
    expect(hu.ConceptNameCodeSequence[0].CodeValue).toBe('112031');
    expect(hu.MeasuredValueSequence[0].MeasurementUnitsCodeSequence[0]).toMatchObject({ CodeValue: "[hnsf'U]", CodeMeaning: 'HU' });
    const types = hu.ContentSequence.map((c: any) => c.ValueType);
    expect(types).toContain('TEXT'); // tracking identifier
    expect(types).toContain('IMAGE'); // referenced image
  });

  it('handles an empty measurement list', () => {
    const group: any = (buildMeasurementSr([], { generateUID: counter() }) as any).ContentSequence[0].ContentSequence[0];
    expect(group.ContentSequence).toEqual([]);
  });
});
