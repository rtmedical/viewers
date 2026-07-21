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

  it('emits the Type 2 patient/study fields as empty strings by default (M2)', () => {
    const ds: any = build();
    expect(ds.PatientBirthDate).toBe('');
    expect(ds.PatientSex).toBe('');
    expect(ds.StudyDate).toBe('');
    expect(ds.StudyTime).toBe('');
    expect(ds.ReferringPhysicianName).toBe('');
    expect(ds.StudyID).toBe('');
  });

  it('stamps the full study context when provided (M2)', () => {
    const ds: any = build({
      PatientBirthDate: '19700101',
      PatientSex: 'F',
      StudyDate: '20260721',
      StudyTime: '101500',
      ReferringPhysicianName: 'Ref^Doc',
      StudyID: 'STU-7',
    });
    expect(ds.PatientBirthDate).toBe('19700101');
    expect(ds.PatientSex).toBe('F');
    expect(ds.StudyDate).toBe('20260721');
    expect(ds.StudyTime).toBe('101500');
    expect(ds.ReferringPhysicianName).toBe('Ref^Doc');
    expect(ds.StudyID).toBe('STU-7');
  });
});

describe('image references + evidence sequence (M3)', () => {
  const imageRefOf = (ds: any, index = 0) => {
    const nums = ds.ContentSequence[0].ContentSequence[0].ContentSequence;
    return nums[index].ContentSequence?.find((c: any) => c.ValueType === 'IMAGE');
  };

  it('emits ReferencedSOPClassUID alongside the instance UID when provided', () => {
    const ds: any = buildMeasurementSr(
      [
        {
          name: 'L',
          value: 1,
          unit: 'mm',
          referencedSopInstanceUID: '1.2.img',
          referencedSopClassUID: '1.2.840.10008.5.1.4.1.1.2',
        },
      ],
      { generateUID: counter() }
    );
    expect(imageRefOf(ds).ReferencedSOPSequence[0]).toEqual({
      ReferencedSOPInstanceUID: '1.2.img',
      ReferencedSOPClassUID: '1.2.840.10008.5.1.4.1.1.2',
    });
  });

  it('emits the instance UID only (no SOP class fallback) when not provided', () => {
    const ds: any = build();
    const ref = imageRefOf(ds, 1).ReferencedSOPSequence[0];
    expect(ref).toEqual({ ReferencedSOPInstanceUID: '1.2.img' });
    expect(ref.ReferencedSOPClassUID).toBeUndefined();
  });

  it('emits CurrentRequestedProcedureEvidenceSequence for complete references, deduped per series', () => {
    const full = {
      name: 'L',
      value: 1,
      unit: 'mm',
      referencedSopInstanceUID: '1.2.img',
      referencedSopClassUID: '1.2.840.10008.5.1.4.1.1.2',
      referencedSeriesInstanceUID: '1.2.series',
    };
    const ds: any = buildMeasurementSr(
      [
        full,
        { ...full, name: 'W' }, // same image → deduped
        { name: 'H', value: 2, unit: 'mm', referencedSopInstanceUID: '1.2.other' }, // no series/class → inline only
      ],
      { generateUID: counter(), StudyInstanceUID: '1.2.study' }
    );
    expect(ds.CurrentRequestedProcedureEvidenceSequence).toEqual([
      {
        StudyInstanceUID: '1.2.study',
        ReferencedSeriesSequence: [
          {
            SeriesInstanceUID: '1.2.series',
            ReferencedSOPSequence: [
              {
                ReferencedSOPClassUID: '1.2.840.10008.5.1.4.1.1.2',
                ReferencedSOPInstanceUID: '1.2.img',
              },
            ],
          },
        ],
      },
    ]);
  });

  it('omits the evidence sequence when no reference has a known series (documented limit)', () => {
    const ds: any = buildMeasurementSr(
      [
        {
          name: 'L',
          value: 1,
          unit: 'mm',
          referencedSopInstanceUID: '1.2.img',
          referencedSopClassUID: '1.2.840.10008.5.1.4.1.1.2',
        },
      ],
      { generateUID: counter() }
    );
    expect(ds.CurrentRequestedProcedureEvidenceSequence).toBeUndefined();
    expect(ds).not.toHaveProperty('CurrentRequestedProcedureEvidenceSequence');
  });
});
