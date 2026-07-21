import {
  buildPrescriptionTimeline,
  buildTreatmentTimeline,
  buildCourseTimeline,
  filterPlans,
  DEFAULT_PLAN_FILTERS,
  RtPlanLike,
  RtRecordLike,
} from './courseTimeline';

const plan: RtPlanLike = {
  label: 'Phase1',
  beams: [
    { energy: '6 MV', type: 'STATIC' },
    { energy: '6 MV', type: 'DYNAMIC' },
  ],
  fractionGroups: [{ number: 1, numberOfFractionsPlanned: 25, fractionDoseGy: 2 }],
};

const records: RtRecordLike[] = [
  { recordType: 'BEAMS', treatmentDate: '20260117', fractionNumber: 2, totalDeliveredMeterset: 220, sessions: [{}, {}] },
  { recordType: 'BEAMS', treatmentDate: '20260115', fractionNumber: 1, totalDeliveredMeterset: 219.8, sessions: [{}, {}] },
];

describe('buildPrescriptionTimeline (RTV-165)', () => {
  it('emits a row per fraction group with totals + dominant energy/technique', () => {
    const rows = buildPrescriptionTimeline([plan]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      phase: 'Phase1',
      fractions: 25,
      dosePerFractionGy: 2,
      totalDoseGy: 50,
      energy: '6 MV',
      technique: 'STATIC',
    });
  });

  it('suffixes the phase when a plan has multiple fraction groups', () => {
    const multi: RtPlanLike = {
      label: 'Boost',
      fractionGroups: [
        { number: 1, numberOfFractionsPlanned: 25, fractionDoseGy: 2 },
        { number: 2, numberOfFractionsPlanned: 8, fractionDoseGy: 2.5 },
      ],
    };
    const rows = buildPrescriptionTimeline([multi]);
    expect(rows.map(r => r.phase)).toEqual(['Boost (FG 1)', 'Boost (FG 2)']);
    expect(rows[1].totalDoseGy).toBe(20);
  });

  it('still emits a row for a plan with no fraction groups', () => {
    const rows = buildPrescriptionTimeline([{ label: 'P', beams: [{ energy: '10 MV', type: 'STATIC' }] }]);
    expect(rows).toEqual([{ phase: 'P', energy: '10 MV', technique: 'STATIC' }]);
  });

  it('carries plan date / approvalStatus / planIntent onto every row (RTV-164/174)', () => {
    const rows = buildPrescriptionTimeline([
      {
        ...plan,
        date: '20260102',
        approvalStatus: 'APPROVED',
        planIntent: 'CURATIVE',
      },
    ]);
    expect(rows[0]).toMatchObject({
      date: '20260102',
      approvalStatus: 'APPROVED',
      planIntent: 'CURATIVE',
    });
  });
});

describe('filterPlans (RTV-174)', () => {
  const curativeApproved: RtPlanLike = { label: 'A', approvalStatus: 'APPROVED', planIntent: 'CURATIVE' };
  const curativeUnapproved: RtPlanLike = { label: 'B', approvalStatus: 'UNAPPROVED' };
  const rejected: RtPlanLike = { label: 'C', approvalStatus: 'REJECTED' };
  const noStatus: RtPlanLike = { label: 'D' };
  const verificationApproved: RtPlanLike = { label: 'V', approvalStatus: 'APPROVED', planIntent: 'VERIFICATION' };
  const all = [curativeApproved, curativeUnapproved, rejected, noStatus, verificationApproved];

  it('defaults show everything', () => {
    expect(filterPlans(all)).toEqual(all);
    expect(filterPlans(all, DEFAULT_PLAN_FILTERS)).toEqual(all);
  });

  it('hides PlanIntent=VERIFICATION plans when showVerification is off', () => {
    const rows = filterPlans(all, { ...DEFAULT_PLAN_FILTERS, showVerification: false });
    expect(rows.map(p => p.label)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('hides ApprovalStatus=APPROVED plans when showApproved is off', () => {
    const rows = filterPlans(all, { ...DEFAULT_PLAN_FILTERS, showApproved: false });
    expect(rows.map(p => p.label)).toEqual(['B', 'C', 'D']);
  });

  it('treats UNAPPROVED, REJECTED and missing status as "unapproved" (DICOM-honest)', () => {
    const rows = filterPlans(all, { ...DEFAULT_PLAN_FILTERS, showUnapproved: false });
    expect(rows.map(p => p.label)).toEqual(['A', 'V']);
  });

  it('composes the verification and approval axes with AND', () => {
    const rows = filterPlans(all, {
      showVerification: true,
      showApproved: false,
      showUnapproved: true,
    });
    // V is APPROVED, so hiding approved plans hides it despite showVerification.
    expect(rows.map(p => p.label)).toEqual(['B', 'C', 'D']);
  });

  it('is defensive about empty input', () => {
    expect(filterPlans([] as RtPlanLike[])).toEqual([]);
    expect(filterPlans(undefined as unknown as RtPlanLike[])).toEqual([]);
  });
});

describe('buildTreatmentTimeline (RTV-166)', () => {
  it('sorts records chronologically and counts beams', () => {
    const rows = buildTreatmentTimeline(records);
    expect(rows.map(r => r.date)).toEqual(['20260115', '20260117']);
    expect(rows[0]).toMatchObject({ fraction: 1, beams: 2, deliveredMeterset: 219.8 });
  });
});

describe('buildCourseTimeline (RTV-164)', () => {
  it('merges prescription + treatment with a course summary', () => {
    const tl = buildCourseTimeline([plan], records);
    expect(tl.prescription).toHaveLength(1);
    expect(tl.treatment).toHaveLength(2);
    expect(tl.summary).toEqual({
      plans: 1,
      sessions: 2,
      totalDeliveredMeterset: 439.8,
      firstTreatmentDate: '20260115',
      lastTreatmentDate: '20260117',
    });
  });

  it('is defensive about empty inputs', () => {
    const tl = buildCourseTimeline([], []);
    expect(tl.prescription).toEqual([]);
    expect(tl.treatment).toEqual([]);
    expect(tl.summary.plans).toBe(0);
    expect(tl.summary.totalDeliveredMeterset).toBeUndefined();
  });
});
