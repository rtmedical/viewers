/**
 * Pure **Course Timeline** transforms (RTV-164/165/166), the data layer of the
 * RT Summary / Course Timeline (epic RTV-162).
 *
 * Framework-free and `@ohif/*`-free. It consumes the *already-parsed* models the
 * sibling extensions attach to their display sets (`rtPlan` from
 * `@ohif/extension-rt-plan`, `rtRecord` from `@ohif/extension-rt-record`) — typed
 * here structurally so there is no cross-extension import — and produces:
 *   - a **prescription timeline** (RTV-165) from RTPLANs, and
 *   - a **treatment timeline** (RTV-166) from RT Treatment Records,
 * merged into one course model the CourseTimelinePanel (RTV-164) renders.
 */

// ---- Structural (duck-typed) inputs — subsets of the sibling parsers' models ----

export interface RtPlanLike {
  label?: string;
  name?: string;
  /** RTPlanDate (DICOM DA, YYYYMMDD) — places the plan on the calendar axis. */
  date?: string;
  /** ApprovalStatus (300E,0002): APPROVED | UNAPPROVED | REJECTED. */
  approvalStatus?: string;
  /** PlanIntent (300A,000A): CURATIVE | PALLIATIVE | … | VERIFICATION | MACHINE_QA. */
  planIntent?: string;
  prescriptions?: { targetPrescriptionDoseGy?: number; type?: string }[];
  fractionGroups?: { number?: number; numberOfFractionsPlanned?: number; fractionDoseGy?: number }[];
  beams?: { energy?: string; type?: string }[];
}

export interface RtRecordLike {
  recordType?: string;
  treatmentDate?: string;
  treatmentTime?: string;
  machine?: string;
  fractionNumber?: number;
  totalDeliveredMeterset?: number;
  sessions?: { beamName?: string; deliveredMeterset?: number }[];
}

// ---- Output rows ----

export interface PrescriptionTimelineRow {
  phase: string;
  /** RTPlanDate (DICOM DA) of the originating plan, for the calendar axis. */
  date?: string;
  fractions?: number;
  dosePerFractionGy?: number;
  totalDoseGy?: number;
  energy?: string;
  technique?: string;
  /** ApprovalStatus (300E,0002) of the originating plan. */
  approvalStatus?: string;
  /** PlanIntent (300A,000A) of the originating plan. */
  planIntent?: string;
}

export interface TreatmentTimelineRow {
  date?: string;
  time?: string;
  fraction?: number;
  recordType?: string;
  machine?: string;
  beams: number;
  deliveredMeterset?: number;
}

export interface CourseTimeline {
  prescription: PrescriptionTimelineRow[];
  treatment: TreatmentTimelineRow[];
  summary: {
    plans: number;
    sessions: number;
    /** Σ delivered MU across all treatment records. */
    totalDeliveredMeterset?: number;
    firstTreatmentDate?: string;
    lastTreatmentDate?: string;
  };
}

/** Most frequent non-empty value in a list (for a beam-level "technique"/energy). */
function mode(values: (string | undefined)[]): string | undefined {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestN = 0;
  for (const [v, n] of counts) {
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

/** RTV-165 — prescription timeline (one row per plan fraction group). */
export function buildPrescriptionTimeline(plans: RtPlanLike[]): PrescriptionTimelineRow[] {
  const rows: PrescriptionTimelineRow[] = [];
  for (const plan of plans ?? []) {
    const phase = plan.label || plan.name || 'Plan';
    const energy = mode((plan.beams ?? []).map(b => b.energy));
    const technique = mode((plan.beams ?? []).map(b => b.type));
    const { date, approvalStatus, planIntent } = plan;
    const groups = plan.fractionGroups ?? [];
    if (!groups.length) {
      rows.push({ phase, date, energy, technique, approvalStatus, planIntent });
      continue;
    }
    for (const g of groups) {
      const fractions = g.numberOfFractionsPlanned;
      const dosePerFractionGy = g.fractionDoseGy;
      rows.push({
        phase: groups.length > 1 ? `${phase} (FG ${g.number ?? '?'})` : phase,
        date,
        fractions,
        dosePerFractionGy,
        totalDoseGy:
          fractions != null && dosePerFractionGy != null ? fractions * dosePerFractionGy : undefined,
        energy,
        technique,
        approvalStatus,
        planIntent,
      });
    }
  }
  return rows;
}

// ---- RTV-174 — plan filter ----

export interface PlanFilterOptions {
  /** Show plans whose PlanIntent (300A,000A) is VERIFICATION. */
  showVerification: boolean;
  /** Show plans whose ApprovalStatus (300E,0002) is APPROVED. */
  showApproved: boolean;
  /** Show plans that are not APPROVED (UNAPPROVED, REJECTED, or absent). */
  showUnapproved: boolean;
}

export const DEFAULT_PLAN_FILTERS: PlanFilterOptions = {
  showVerification: true,
  showApproved: true,
  showUnapproved: true,
};

/**
 * RTV-174 — plan-filter predicate over *standard DICOM* RT Plan attributes.
 *
 * Honest DICOM semantics: TPS-specific approval states such as Varian ARIA's
 * "Planning Approved" / "Treatment Approved" do NOT exist in the standard
 * RTPLAN object — ApprovalStatus (300E,0002) enumerates only APPROVED /
 * UNAPPROVED / REJECTED. "Approved" here therefore means
 * `ApprovalStatus === APPROVED` and "Unapproved" means anything else
 * (UNAPPROVED, REJECTED or a missing attribute). Verification plans are
 * identified via PlanIntent (300A,000A) === VERIFICATION.
 *
 * The verification and approval axes compose with AND: an APPROVED
 * verification plan needs both `showVerification` and `showApproved`.
 * Works on any plan-shaped value (RtPlanLike or PrescriptionTimelineRow).
 */
export function filterPlans<T extends { approvalStatus?: string; planIntent?: string }>(
  plans: T[],
  filters: PlanFilterOptions = DEFAULT_PLAN_FILTERS
): T[] {
  return (plans ?? []).filter(p => {
    const isVerification = String(p.planIntent ?? '').trim().toUpperCase() === 'VERIFICATION';
    if (isVerification && !filters.showVerification) {
      return false;
    }
    const isApproved = String(p.approvalStatus ?? '').trim().toUpperCase() === 'APPROVED';
    return isApproved ? filters.showApproved : filters.showUnapproved;
  });
}

/** RTV-166 — treatment timeline (one row per record, chronological). */
export function buildTreatmentTimeline(records: RtRecordLike[]): TreatmentTimelineRow[] {
  return (records ?? [])
    .map(r => ({
      date: r.treatmentDate,
      time: r.treatmentTime,
      fraction: r.fractionNumber,
      recordType: r.recordType,
      machine: r.machine,
      beams: (r.sessions ?? []).length,
      deliveredMeterset: r.totalDeliveredMeterset,
    }))
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.time || '').localeCompare(b.time || ''));
}

/** RTV-164 — unified course timeline model (prescription + treatment + summary). */
export function buildCourseTimeline(plans: RtPlanLike[], records: RtRecordLike[]): CourseTimeline {
  const prescription = buildPrescriptionTimeline(plans);
  const treatment = buildTreatmentTimeline(records);
  const dated = treatment.map(t => t.date).filter((d): d is string => !!d).sort();
  const deliveredVals = treatment
    .map(t => t.deliveredMeterset)
    .filter((m): m is number => m != null);
  return {
    prescription,
    treatment,
    summary: {
      plans: (plans ?? []).length,
      sessions: treatment.length,
      totalDeliveredMeterset: deliveredVals.length ? deliveredVals.reduce((a, b) => a + b, 0) : undefined,
      firstTreatmentDate: dated[0],
      lastTreatmentDate: dated[dated.length - 1],
    },
  };
}

export default buildCourseTimeline;
