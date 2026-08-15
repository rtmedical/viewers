import {
  advanceWorkflow,
  evaluateStep,
  isWorkflowComplete,
  nextIncompleteStep,
  WORKFLOW_LABELS,
  WORKFLOW_STEPS,
  WorkflowState,
} from './labellingWorkflow';

const target = (lesionId: string) => ({ lesionId, category: 'target' as const, siteId: 'liver' });

const measurement = (lesionId: string, mm = 25) => ({
  lesionId,
  kind: 'nonNodal' as const,
  longestDiameterMm: mm,
});

/** A state that satisfies every step. */
function completeState(): WorkflowState {
  return {
    lesions: [target('a'), target('b')],
    timepoints: [
      {
        id: 'baseline',
        measurements: [measurement('a'), measurement('b')],
        nonTarget: { present: false },
      },
      { id: 'fu1', measurements: [measurement('a', 20), measurement('b', 20)] },
    ],
  };
}

describe('workflow shape', () => {
  it('has a label for every step', () => {
    for (const step of WORKFLOW_STEPS) {
      expect(WORKFLOW_LABELS[step]).toBeTruthy();
    }
  });

  it('ends at review', () => {
    expect(WORKFLOW_STEPS[WORKFLOW_STEPS.length - 1]).toBe('review');
  });
});

describe('evaluateStep — selectTargets', () => {
  it('blocks with no targets', () => {
    const status = evaluateStep({ lesions: [], timepoints: [] }, 'selectTargets');
    expect(status.complete).toBe(false);
    expect(status.blockers[0]).toMatch(/no target lesions/i);
  });

  it('does not count non-target lesions as targets', () => {
    const state: WorkflowState = {
      lesions: [{ lesionId: 'x', category: 'nonTarget' }],
      timepoints: [],
    };
    expect(evaluateStep(state, 'selectTargets').complete).toBe(false);
  });

  it('completes with a target', () => {
    expect(evaluateStep({ lesions: [target('a')], timepoints: [] }, 'selectTargets').complete).toBe(
      true
    );
  });
});

describe('evaluateStep — measureBaseline', () => {
  it('blocks with no baseline', () => {
    const status = evaluateStep({ lesions: [target('a')], timepoints: [] }, 'measureBaseline');
    expect(status.blockers[0]).toMatch(/no baseline/i);
  });

  it('names the targets that were not measured', () => {
    const state: WorkflowState = {
      lesions: [target('a'), target('b')],
      timepoints: [{ id: 'baseline', measurements: [measurement('a')] }],
    };
    expect(evaluateStep(state, 'measureBaseline').blockers.join(' ')).toContain('b');
  });

  it('blocks a target below the measurability floor', () => {
    // Better here than surfacing later as a bad sum of diameters.
    const state: WorkflowState = {
      lesions: [target('a')],
      timepoints: [{ id: 'baseline', measurements: [measurement('a', 6)] }],
    };
    expect(evaluateStep(state, 'measureBaseline').blockers.join(' ')).toMatch(/measurability/i);
  });

  it('completes when every target is measured and measurable', () => {
    expect(evaluateStep(completeState(), 'measureBaseline').complete).toBe(true);
  });
});

describe('evaluateStep — classifyNonTarget', () => {
  it('blocks while non-target has not been assessed', () => {
    const state: WorkflowState = {
      lesions: [target('a')],
      timepoints: [{ id: 'baseline', measurements: [measurement('a')] }],
    };
    expect(evaluateStep(state, 'classifyNonTarget').complete).toBe(false);
  });

  it('accepts an explicit "no non-target disease" as a real answer', () => {
    // `{ present: false }` is an assessment; `undefined` is "not looked at yet".
    const state: WorkflowState = {
      lesions: [target('a')],
      timepoints: [
        { id: 'baseline', measurements: [measurement('a')], nonTarget: { present: false } },
      ],
    };
    expect(evaluateStep(state, 'classifyNonTarget').complete).toBe(true);
  });
});

describe('evaluateStep — followUp and review', () => {
  it('needs a second timepoint', () => {
    const state: WorkflowState = {
      lesions: [target('a')],
      timepoints: [{ id: 'baseline', measurements: [measurement('a')] }],
    };
    expect(evaluateStep(state, 'followUp').complete).toBe(false);
  });

  it('review lists which earlier steps are missing', () => {
    const status = evaluateStep({ lesions: [], timepoints: [] }, 'review');
    expect(status.complete).toBe(false);
    expect(status.blockers[0]).toMatch(/Select target lesions/);
  });

  it('review completes once everything else does', () => {
    expect(evaluateStep(completeState(), 'review').complete).toBe(true);
    expect(isWorkflowComplete(completeState())).toBe(true);
  });

  it('reports an unknown step instead of pretending it is done', () => {
    expect(evaluateStep(completeState(), 'nope' as never).complete).toBe(false);
  });
});

describe('advanceWorkflow', () => {
  it('stays put while the current step is incomplete', () => {
    // Advancing from an incomplete step is how a half-labelled study reaches the
    // review screen looking finished.
    const empty: WorkflowState = { lesions: [], timepoints: [] };
    expect(advanceWorkflow(empty, 'selectTargets')).toBe('selectTargets');
  });

  it('moves on once the step is satisfied', () => {
    expect(advanceWorkflow(completeState(), 'selectTargets')).toBe('measureBaseline');
  });

  it('stops at the last step', () => {
    expect(advanceWorkflow(completeState(), 'review')).toBe('review');
  });

  it('recovers from an unknown current step', () => {
    expect(advanceWorkflow(completeState(), 'nope' as never)).toBe(WORKFLOW_STEPS[0]);
  });
});

describe('nextIncompleteStep — resume', () => {
  it('points at the first thing missing', () => {
    expect(nextIncompleteStep({ lesions: [], timepoints: [] })).toBe('selectTargets');
  });

  it('skips the steps already done', () => {
    const state: WorkflowState = {
      lesions: [target('a')],
      timepoints: [
        { id: 'baseline', measurements: [measurement('a')], nonTarget: { present: false } },
      ],
    };
    // Targets, baseline and non-target are done; follow-up is not.
    expect(nextIncompleteStep(state)).toBe('followUp');
  });

  it('lands on review when everything is done', () => {
    expect(nextIncompleteStep(completeState())).toBe('review');
  });

  it('recomputes rather than trusting a stale tick', () => {
    // Editing a lesion must not leave a "complete" mark behind.
    const state = completeState();
    expect(nextIncompleteStep(state)).toBe('review');
    state.timepoints[0].measurements = [measurement('a', 4), measurement('b', 4)];
    expect(nextIncompleteStep(state)).toBe('measureBaseline');
  });
});
