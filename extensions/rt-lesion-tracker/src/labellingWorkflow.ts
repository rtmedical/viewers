/**
 * RECIST labelling workflow — pure core (RTV-150).
 *
 * A state machine over the steps a reader walks to produce a RECIST assessment.
 * Migrated in spirit from the legacy connectviewer `Labelling` component.
 *
 * Two properties are deliberate:
 *
 * - **Every step is reachable at any time.** The machine gates *advancing* on
 *   completeness, but never traps the reader: they can jump back to fix a label after
 *   recording three follow-ups. A workflow that will not let you correct a mistake
 *   gets worked around, not followed.
 * - **Completeness is derived, never stored.** Each step asks the tracker state
 *   whether it is satisfied, so editing a lesion cannot leave a stale "complete"
 *   tick behind.
 *
 * Framework-free. Zero-fork per RTV-114.
 */

import { isMeasurable, LesionMeasurement, Timepoint } from './recist';

export type LabellingStep =
  | 'selectTargets'
  | 'measureBaseline'
  | 'classifyNonTarget'
  | 'followUp'
  | 'review';

export const WORKFLOW_STEPS: LabellingStep[] = [
  'selectTargets',
  'measureBaseline',
  'classifyNonTarget',
  'followUp',
  'review',
];

export const WORKFLOW_LABELS: Record<LabellingStep, string> = {
  selectTargets: 'Select target lesions',
  measureBaseline: 'Measure at baseline',
  classifyNonTarget: 'Classify non-target disease',
  followUp: 'Record follow-up',
  review: 'Review response',
};

/** What a step needs from the tracker to be considered done. */
export interface WorkflowState {
  lesions: Array<{ lesionId: string; category: 'target' | 'nonTarget'; siteId?: string }>;
  timepoints: Timepoint[];
}

export interface StepStatus {
  step: LabellingStep;
  label: string;
  complete: boolean;
  /** Why it is not complete yet. Empty when it is. */
  blockers: string[];
}

function baselineMeasurements(state: WorkflowState): LesionMeasurement[] {
  return state?.timepoints?.[0]?.measurements ?? [];
}

function targetIds(state: WorkflowState): string[] {
  return (state?.lesions ?? []).filter(l => l.category === 'target').map(l => l.lesionId);
}

/** Evaluates one step against the current state. */
export function evaluateStep(state: WorkflowState, step: LabellingStep): StepStatus {
  const blockers: string[] = [];
  const label = WORKFLOW_LABELS[step];

  switch (step) {
    case 'selectTargets': {
      if (!targetIds(state).length) {
        blockers.push('No target lesions selected.');
      }
      break;
    }

    case 'measureBaseline': {
      const ids = targetIds(state);
      const measurements = baselineMeasurements(state);
      if (!state?.timepoints?.length) {
        blockers.push('No baseline timepoint recorded.');
        break;
      }
      const missing = ids.filter(id => !measurements.some(m => m.lesionId === id));
      if (missing.length) {
        blockers.push(`Not measured at baseline: ${missing.join(', ')}.`);
      }
      // A target lesion below the measurability floor invalidates the whole
      // assessment, so it blocks here rather than surfacing later as a bad sum.
      const tooSmall = measurements
        .filter(m => ids.includes(m.lesionId) && !isMeasurable(m))
        .map(m => m.lesionId);
      if (tooSmall.length) {
        blockers.push(`Below the measurability floor: ${tooSmall.join(', ')}.`);
      }
      break;
    }

    case 'classifyNonTarget': {
      const baseline = state?.timepoints?.[0];
      if (!baseline) {
        blockers.push('No baseline timepoint recorded.');
        break;
      }
      // `undefined` means "not yet assessed"; an explicit `{ present: false }` is a
      // real answer (no non-target disease) and completes the step.
      if (baseline.nonTarget == null) {
        blockers.push('Non-target disease has not been assessed at baseline.');
      }
      break;
    }

    case 'followUp': {
      if ((state?.timepoints?.length ?? 0) < 2) {
        blockers.push('No follow-up timepoint recorded yet.');
      }
      break;
    }

    case 'review': {
      // Review is complete once every earlier step is.
      const earlier = WORKFLOW_STEPS.slice(0, WORKFLOW_STEPS.indexOf('review'));
      const incomplete = earlier.filter(s => !evaluateStep(state, s).complete);
      if (incomplete.length) {
        blockers.push(`Earlier steps incomplete: ${incomplete.map(s => WORKFLOW_LABELS[s]).join(', ')}.`);
      }
      break;
    }

    default:
      blockers.push(`Unknown step: ${String(step)}`);
  }

  return { step, label, complete: blockers.length === 0, blockers };
}

/** Status of every step, in order. */
export function workflowProgress(state: WorkflowState): {
  steps: StepStatus[];
  completed: number;
  total: number;
} {
  const steps = WORKFLOW_STEPS.map(step => evaluateStep(state, step));
  return { steps, completed: steps.filter(s => s.complete).length, total: steps.length };
}

/**
 * The first step that is not complete, or `review` when everything is.
 * This is what "resume from where I left off" uses.
 */
export function nextIncompleteStep(state: WorkflowState): LabellingStep {
  return WORKFLOW_STEPS.find(step => !evaluateStep(state, step).complete) ?? 'review';
}

/**
 * Advances past `current` when it is complete; otherwise stays put.
 * Staying put is the whole point — advancing from an incomplete step is how a
 * half-labelled study reaches the review screen looking finished.
 */
export function advanceWorkflow(state: WorkflowState, current: LabellingStep): LabellingStep {
  const index = WORKFLOW_STEPS.indexOf(current);
  if (index === -1) {
    return WORKFLOW_STEPS[0];
  }
  if (!evaluateStep(state, current).complete) {
    return current;
  }
  return WORKFLOW_STEPS[Math.min(index + 1, WORKFLOW_STEPS.length - 1)];
}

/** Whether the whole workflow is done. */
export function isWorkflowComplete(state: WorkflowState): boolean {
  return WORKFLOW_STEPS.every(step => evaluateStep(state, step).complete);
}
