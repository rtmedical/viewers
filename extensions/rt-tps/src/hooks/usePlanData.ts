import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { RtPlan } from '../../../rt-plan/src/rtPlanParser';

/**
 * Reads parsed RTPLAN display sets (RTV Wave 4 / Phase 2).
 *
 * The `@ohif/extension-rt-plan` SopClassHandler has already parsed each RTPLAN
 * instance onto `displaySet.rtPlan` (see rtPlanParser). This hook exposes those
 * display sets to the Eclipse-style Info Window tabs, keeps them in sync with the
 * DisplaySetService, and tracks the current selection. Type-only import of the
 * parser model — no runtime coupling (zero fork, RTV-114).
 */

export interface RtPlanDisplaySet {
  displaySetInstanceUID: string;
  label?: string;
  SeriesDescription?: string;
  SeriesNumber?: number | string;
  rtPlan?: RtPlan;
  Modality?: string;
}

function readPlans(displaySetService: any): RtPlanDisplaySet[] {
  const all =
    displaySetService?.getActiveDisplaySets?.() ?? displaySetService?.activeDisplaySets ?? [];
  return (all as RtPlanDisplaySet[]).filter(ds => ds?.rtPlan || ds?.Modality === 'RTPLAN');
}

/**
 * Module-level shared selection so every Info Window tab (Campos, Dose, …) reads
 * and writes the SAME selected RTPLAN. Local per-hook state would diverge: the
 * InfoWindow renders one tab at a time and remounts on switch, so a per-instance
 * selection silently reverts to the first plan and the two tabs could show
 * different plans. A tiny external store fixes that without a new dependency.
 */
let sharedUID: string | undefined;
const listeners = new Set<() => void>();
function setSharedUID(uid: string): void {
  if (uid === sharedUID) {
    return;
  }
  sharedUID = uid;
  listeners.forEach(l => l());
}
function subscribeShared(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
const getSharedUID = () => sharedUID;

export interface UsePlanData {
  displaySets: RtPlanDisplaySet[];
  selected?: RtPlanDisplaySet;
  selectedUID?: string;
  setSelectedUID: (uid: string) => void;
  plan?: RtPlan;
}

export function usePlanData(servicesManager: any): UsePlanData {
  const displaySetService = servicesManager?.services?.displaySetService;
  const [displaySets, setDisplaySets] = useState<RtPlanDisplaySet[]>(() =>
    readPlans(displaySetService)
  );
  // Shared across all Info Window tabs (survives tab remounts, keeps them in sync).
  const rawUID = useSyncExternalStore(subscribeShared, getSharedUID, getSharedUID);

  useEffect(() => {
    if (!displaySetService?.subscribe) {
      return undefined;
    }
    const resync = () => setDisplaySets(readPlans(displaySetService));
    resync();
    const events = displaySetService.EVENTS ?? {};
    const subs = [
      events.DISPLAY_SETS_ADDED,
      events.DISPLAY_SETS_CHANGED,
      events.DISPLAY_SETS_REMOVED,
    ]
      .filter(Boolean)
      .map(evt => displaySetService.subscribe(evt, resync));
    return () => subs.forEach(s => s?.unsubscribe?.());
  }, [displaySetService]);

  // Seed the shared selection once there are plans and nothing chosen yet.
  useEffect(() => {
    if (!rawUID && displaySets.length) {
      setSharedUID(displaySets[0].displaySetInstanceUID);
    }
  }, [displaySets, rawUID]);

  // Resolve to a valid display set: falls back to the first when the shared UID
  // is stale (e.g. after navigating to a different study).
  const selected = useMemo(
    () => displaySets.find(ds => ds.displaySetInstanceUID === rawUID) ?? displaySets[0],
    [displaySets, rawUID]
  );

  return {
    displaySets,
    selected,
    selectedUID: selected?.displaySetInstanceUID,
    setSelectedUID: setSharedUID,
    plan: selected?.rtPlan,
  };
}

export default usePlanData;
