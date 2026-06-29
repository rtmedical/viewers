/**
 * Client-side **RT Plan (RTPLAN) IOD parser** (RTV-132).
 *
 * Framework-free and `@ohif/*`-free: it turns a *naturalized* RTPLAN instance
 * (DICOM keyword -> value, as OHIF instance metadata / dcmjs produce) into a
 * flat, render-ready plan model. All logic is pure so it is unit-tested in
 * isolation; the panel and SopClassHandler are thin layers on top.
 *
 * RT Plan SOP Class UID: 1.2.840.10008.5.1.4.1.1.481.5.
 *
 * Scope note: the legacy connectviewer "Ficha" was a *manual MU recomputation*
 * QA sheet computed server-side (Sc/Sp factors, TMR/PDP, UMcalculada…). That
 * physics recompute is backend-dependent and out of scope here; this parser
 * exposes what the RTPLAN object itself carries (plan, prescriptions, fraction
 * groups, beams with meterset/energy/geometry).
 */

export const RT_PLAN_SOP_CLASS_UID = '1.2.840.10008.5.1.4.1.1.481.5';

export interface RtPlanPrescription {
  number?: number;
  description?: string;
  /** DoseReferenceStructureType (e.g. POINT, VOLUME, COORDINATES). */
  structureType?: string;
  /** DoseReferenceType (TARGET, ORGAN_AT_RISK). */
  type?: string;
  /** TargetPrescriptionDose, in Gy. */
  targetPrescriptionDoseGy?: number;
}

export interface RtPlanBeam {
  number?: number;
  name?: string;
  description?: string;
  /** BeamType (STATIC, DYNAMIC). */
  type?: string;
  /** RadiationType (PHOTON, ELECTRON, PROTON…). */
  radiationType?: string;
  /** TreatmentMachineName. */
  machine?: string;
  /** NominalBeamEnergy from the first control point. */
  nominalEnergy?: number;
  /** Human label, e.g. "6 MV" / "12 MeV". */
  energy?: string;
  gantryAngle?: number;
  /** BeamLimitingDeviceAngle (collimator). */
  collimatorAngle?: number;
  /** PatientSupportAngle (couch). */
  patientSupportAngle?: number;
  numberOfControlPoints?: number;
  numberOfWedges?: number;
  numberOfBlocks?: number;
  /** BeamMeterset (MU), joined from the fraction group. */
  meterset?: number;
  /** BeamDose per fraction (Gy), joined from the fraction group. */
  beamDoseGy?: number;
}

export interface RtPlanFractionGroup {
  number?: number;
  numberOfFractionsPlanned?: number;
  numberOfBeams?: number;
  /** Sum of referenced per-fraction beam doses (Gy). */
  fractionDoseGy?: number;
}

export interface RtPlan {
  label?: string;
  name?: string;
  date?: string;
  approvalStatus?: string;
  machine?: string;
  manufacturer?: string;
  prescriptions: RtPlanPrescription[];
  fractionGroups: RtPlanFractionGroup[];
  beams: RtPlanBeam[];
  /** Σ beam metersets (MU) across the plan. */
  totalMeterset?: number;
  /** Σ over fraction groups of fractions × fraction dose (Gy). */
  totalPrescribedDoseGy?: number;
}

/** dcmjs naturalizes sequences as arrays, but be defensive about scalars. */
function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

/** Coerce a DICOM numeric (DS/IS, possibly string or [string]) to a number. */
function toNum(value: unknown): number | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  if (v == null || v === '') {
    return undefined;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function energyLabel(radiationType?: string, nominalEnergy?: number): string | undefined {
  if (nominalEnergy == null) {
    return undefined;
  }
  const unit = (radiationType || '').toUpperCase() === 'PHOTON' ? 'MV' : 'MeV';
  return `${nominalEnergy} ${unit}`;
}

/** Parse a naturalized RTPLAN instance into a render-ready plan model. */
export function parseRtPlan(instance: Record<string, any>): RtPlan {
  const plan: RtPlan = {
    label: instance?.RTPlanLabel,
    name: instance?.RTPlanName,
    date: instance?.RTPlanDate,
    approvalStatus: instance?.ApprovalStatus,
    manufacturer: instance?.Manufacturer,
    prescriptions: [],
    fractionGroups: [],
    beams: [],
  };
  if (!instance) {
    return plan;
  }

  // ---- Prescriptions (Dose Reference Sequence) ----
  plan.prescriptions = toArray(instance.DoseReferenceSequence).map((dr: any) => ({
    number: toNum(dr?.DoseReferenceNumber),
    description: dr?.DoseReferenceDescription,
    structureType: dr?.DoseReferenceStructureType,
    type: dr?.DoseReferenceType,
    targetPrescriptionDoseGy: toNum(dr?.TargetPrescriptionDose),
  }));

  // ---- Beams (Beam Sequence) ----
  const beamByNumber = new Map<number, RtPlanBeam>();
  plan.beams = toArray(instance.BeamSequence).map((b: any) => {
    const cp0 = toArray(b?.ControlPointSequence)[0] as Record<string, any> | undefined;
    const nominalEnergy = toNum(cp0?.NominalBeamEnergy);
    const beam: RtPlanBeam = {
      number: toNum(b?.BeamNumber),
      name: b?.BeamName,
      description: b?.BeamDescription,
      type: b?.BeamType,
      radiationType: b?.RadiationType,
      machine: b?.TreatmentMachineName,
      nominalEnergy,
      energy: energyLabel(b?.RadiationType, nominalEnergy),
      gantryAngle: toNum(cp0?.GantryAngle),
      collimatorAngle: toNum(cp0?.BeamLimitingDeviceAngle),
      patientSupportAngle: toNum(cp0?.PatientSupportAngle),
      numberOfControlPoints: toNum(b?.NumberOfControlPoints),
      numberOfWedges: toNum(b?.NumberOfWedges),
      numberOfBlocks: toNum(b?.NumberOfBlocks),
    };
    if (beam.number != null) {
      beamByNumber.set(beam.number, beam);
    }
    return beam;
  });

  // ---- Fraction groups; join meterset/dose onto beams ----
  plan.fractionGroups = toArray(instance.FractionGroupSequence).map((fg: any) => {
    let fractionDoseGy: number | undefined;
    for (const rb of toArray(fg?.ReferencedBeamSequence)) {
      const refNum = toNum((rb as any)?.ReferencedBeamNumber);
      const meterset = toNum((rb as any)?.BeamMeterset);
      const beamDose = toNum((rb as any)?.BeamDose);
      if (refNum != null && beamByNumber.has(refNum)) {
        const beam = beamByNumber.get(refNum)!;
        if (meterset != null) beam.meterset = meterset;
        if (beamDose != null) beam.beamDoseGy = beamDose;
      }
      if (beamDose != null) {
        fractionDoseGy = (fractionDoseGy ?? 0) + beamDose;
      }
    }
    return {
      number: toNum(fg?.FractionGroupNumber),
      numberOfFractionsPlanned: toNum(fg?.NumberOfFractionsPlanned),
      numberOfBeams: toNum(fg?.NumberOfBeams),
      fractionDoseGy,
    };
  });

  // ---- Totals ----
  const metersets = plan.beams.map(b => b.meterset).filter((m): m is number => m != null);
  if (metersets.length) {
    plan.totalMeterset = metersets.reduce((a, b) => a + b, 0);
  }
  let total = 0;
  let hasTotal = false;
  for (const fg of plan.fractionGroups) {
    if (fg.fractionDoseGy != null && fg.numberOfFractionsPlanned != null) {
      total += fg.fractionDoseGy * fg.numberOfFractionsPlanned;
      hasTotal = true;
    }
  }
  if (hasTotal) {
    plan.totalPrescribedDoseGy = total;
  }

  plan.machine = plan.beams.find(b => b.machine)?.machine;
  return plan;
}

/** Build a CSV (one row per beam) for export. Pure and testable. */
export function buildRtPlanCsv(plan: RtPlan): string {
  const header = [
    'Beam',
    'Name',
    'Type',
    'Radiation',
    'Machine',
    'Energy',
    'Gantry',
    'Collimator',
    'Couch',
    'MU',
    'BeamDose(Gy)',
  ];
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = plan.beams.map(b =>
    [
      b.number,
      b.name,
      b.type,
      b.radiationType,
      b.machine,
      b.energy,
      b.gantryAngle,
      b.collimatorAngle,
      b.patientSupportAngle,
      b.meterset,
      b.beamDoseGy,
    ]
      .map(esc)
      .join(',')
  );
  return [header.join(','), ...rows].join('\n');
}

export default parseRtPlan;
