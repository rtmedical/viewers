/**
 * Lesion-tracker commands (RTV-10, RTV-150) — the glue.
 *
 * Holds the study's lesions and timepoints and delegates every judgement to the pure
 * {@link ./recist} core. Nothing here decides what a response is.
 */
import { kindForSite, organForSite } from './anatomies';
import {
  assessTimepoints,
  LesionMeasurement,
  Timepoint,
  TimepointResult,
  validateTargetSelection,
} from './recist';
import {
  advanceWorkflow,
  LabellingStep,
  nextIncompleteStep,
  WORKFLOW_STEPS,
  workflowProgress,
} from './labellingWorkflow';

interface ServicesManagerLike {
  services: Record<string, any>;
}

export interface TrackedLesion {
  lesionId: string;
  siteId: string;
  category: 'target' | 'nonTarget';
  label?: string;
}

export interface TrackerState {
  lesions: TrackedLesion[];
  timepoints: Timepoint[];
  step: LabellingStep;
}

export function createLesionTrackerActions({
  servicesManager,
}: {
  servicesManager?: ServicesManagerLike;
}) {
  const state: TrackerState = { lesions: [], timepoints: [], step: WORKFLOW_STEPS[0] };

  const notify = (message: string, type: 'info' | 'warning' = 'info') =>
    servicesManager?.services?.uiNotificationService?.show?.({
      title: 'Lesion tracker',
      message,
      type,
      duration: 4000,
    });

  const actions = {
    rtLesionGetState: (): TrackerState => ({
      lesions: state.lesions.map(l => ({ ...l })),
      timepoints: state.timepoints.map(t => ({ ...t })),
      step: state.step,
    }),

    /** Registers a lesion, deriving its measurement kind from the anatomic site. */
    rtLesionAdd: ({ lesionId, siteId, category = 'target', label }: Partial<TrackedLesion> = {}) => {
      const id = String(lesionId ?? '').trim();
      if (!id) {
        return { ok: false, reason: 'A lesion needs an id.' };
      }
      if (state.lesions.some(l => l.lesionId === id)) {
        return { ok: false, reason: `Lesion ${id} is already tracked.` };
      }
      state.lesions.push({
        lesionId: id,
        siteId: String(siteId ?? ''),
        category: category === 'nonTarget' ? 'nonTarget' : 'target',
        label,
      });
      return { ok: true, lesions: state.lesions.length };
    },

    rtLesionRemove: ({ lesionId }: { lesionId?: string } = {}) => {
      const before = state.lesions.length;
      state.lesions = state.lesions.filter(l => l.lesionId !== lesionId);
      state.timepoints = state.timepoints.map(t => ({
        ...t,
        measurements: (t.measurements ?? []).filter(m => m.lesionId !== lesionId),
      }));
      return { ok: state.lesions.length < before };
    },

    /**
     * Records a timepoint. Measurements arrive as raw numbers; the kind comes from
     * the lesion's anatomic site, so a caller cannot accidentally measure a node on
     * the wrong axis.
     */
    rtLesionRecordTimepoint: ({
      id,
      date,
      measurements = [],
      nonTarget,
      newLesions,
    }: {
      id?: string;
      date?: string;
      measurements?: Array<Partial<LesionMeasurement> & { lesionId: string }>;
      nonTarget?: Timepoint['nonTarget'];
      newLesions?: boolean;
    } = {}) => {
      const timepointId = String(id ?? '').trim();
      if (!timepointId) {
        return { ok: false, reason: 'A timepoint needs an id.' };
      }

      const resolved: LesionMeasurement[] = measurements.map(m => {
        const tracked = state.lesions.find(l => l.lesionId === m.lesionId);
        return {
          ...m,
          lesionId: m.lesionId,
          kind: m.kind ?? kindForSite(tracked?.siteId),
          organ: m.organ ?? organForSite(tracked?.siteId),
        };
      });

      const existing = state.timepoints.findIndex(t => t.id === timepointId);
      const timepoint: Timepoint = {
        id: timepointId,
        date,
        measurements: resolved,
        nonTarget,
        newLesions,
      };
      if (existing === -1) {
        state.timepoints.push(timepoint);
      } else {
        state.timepoints[existing] = timepoint;
      }
      return { ok: true, timepoints: state.timepoints.length };
    },

    /** Validates the baseline target selection against the RECIST limits. */
    rtLesionValidateTargets: () => {
      const baseline = state.timepoints[0];
      const targets = state.lesions.filter(l => l.category === 'target');
      const measurements = (baseline?.measurements ?? []).filter(m =>
        targets.some(t => t.lesionId === m.lesionId)
      );
      const issues = validateTargetSelection(measurements);
      issues.forEach(issue => notify(issue.message, 'warning'));
      return { ok: !issues.length, issues };
    },

    /** The response at every timepoint. */
    rtLesionAssess: (): { ok: boolean; results: TimepointResult[] } => ({
      ok: true,
      results: assessTimepoints(state.timepoints),
    }),

    // --- RTV-150: the labelling workflow -----------------------------------
    rtLesionWorkflowStep: () => ({ ok: true, step: state.step, steps: WORKFLOW_STEPS }),

    rtLesionWorkflowAdvance: () => {
      const next = advanceWorkflow(state, state.step);
      const moved = next !== state.step;
      state.step = next;
      return { ok: moved, step: state.step };
    },

    rtLesionWorkflowGoTo: ({ step }: { step?: LabellingStep } = {}) => {
      if (!step || !WORKFLOW_STEPS.includes(step)) {
        return { ok: false, reason: `Unknown step: ${String(step)}` };
      }
      // Any step is reachable: the reader may go back to fix a label at any time.
      state.step = step;
      return { ok: true, step };
    },

    rtLesionWorkflowProgress: () => ({ ok: true, ...workflowProgress(state) }),

    rtLesionWorkflowNextIncomplete: () => ({ ok: true, step: nextIncompleteStep(state) }),
  };

  return actions;
}

function getCommandsModule({ servicesManager }: { servicesManager?: ServicesManagerLike } = {}) {
  const actions = createLesionTrackerActions({ servicesManager });
  const definitions = Object.keys(actions).reduce(
    (acc, name) => {
      acc[name] = { commandFn: actions[name as keyof typeof actions], storeContexts: [], options: {} };
      return acc;
    },
    {} as Record<string, { commandFn: unknown; storeContexts: string[]; options: Record<string, never> }>
  );
  return { actions, definitions, defaultContext: 'VIEWER' };
}

export default getCommandsModule;
