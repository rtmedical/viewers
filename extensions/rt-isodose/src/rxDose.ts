/**
 * Prescription-dose (Rx) discovery shared by the Isodoses panel and the
 * isodose-line/wash commands: read the prescribed dose (Gy) from any loaded
 * RTPLAN display set (`ds.rtPlan`, attached by @ohif/extension-rt-plan's
 * SopClassHandler, duck-typed — no cross-extension import).
 */
export function derivePrescription(displaySetService: any): number | undefined {
  const all =
    displaySetService?.getActiveDisplaySets?.() ?? displaySetService?.activeDisplaySets ?? [];
  for (const ds of all as any[]) {
    const plan = ds?.rtPlan;
    if (!plan) {
      continue;
    }
    const fromRx = (plan.prescriptions ?? [])
      .map((p: any) => p?.targetPrescriptionDoseGy)
      .find((d: any) => d != null);
    if (fromRx != null) {
      return fromRx;
    }
    if (plan.totalPrescribedDoseGy != null) {
      return plan.totalPrescribedDoseGy;
    }
  }
  return undefined;
}

export default derivePrescription;
