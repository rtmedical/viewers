/**
 * CourseTimelinePanel (RTV-164/174/175/176) — behavioral tests over the lane
 * UI, plan filter, calendar options and complete-history gating, with the
 * DisplaySetService duck-typed and i18n mocked (keys echo back).
 */
import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import CourseTimelinePanel from './CourseTimelinePanel';
import { TIMELINE_PREFS_KEY } from '../timelinePrefs';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

function makeServicesManager(displaySets: any[]) {
  return {
    services: {
      displaySetService: {
        EVENTS: {
          DISPLAY_SETS_ADDED: 'added',
          DISPLAY_SETS_CHANGED: 'changed',
          DISPLAY_SETS_REMOVED: 'removed',
        },
        getActiveDisplaySets: () => displaySets,
        subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })),
      },
    },
  };
}

const approvedPlan = {
  rtPlan: {
    label: 'PROST',
    date: '20260105',
    approvalStatus: 'APPROVED',
    fractionGroups: [{ number: 1, numberOfFractionsPlanned: 25, fractionDoseGy: 2 }],
  },
};
const verificationPlan = {
  rtPlan: { label: 'QA', date: '20260106', planIntent: 'VERIFICATION' },
};
const record = (treatmentDate: string, fractionNumber: number) => ({
  rtRecord: {
    recordType: 'BEAMS',
    treatmentDate,
    fractionNumber,
    totalDeliveredMeterset: 200,
    sessions: [{}, {}],
  },
});

const cy = (container: HTMLElement, name: string) =>
  container.querySelectorAll(`[data-cy="${name}"]`);

describe('CourseTimelinePanel', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders the empty state without plans/records', () => {
    const { container, getByText } = render(
      <CourseTimelinePanel servicesManager={makeServicesManager([])} />
    );
    expect(cy(container, 'rt-timeline-panel')).toHaveLength(1);
    expect(getByText('tl_empty')).toBeTruthy();
  });

  it('renders 5 lanes (2 data + 3 honest placeholders) over the shared axis', () => {
    const { container, getAllByText } = render(
      <CourseTimelinePanel
        servicesManager={makeServicesManager([
          approvedPlan,
          record('20260107', 1),
          record('20260108', 2),
        ])}
      />
    );
    for (const lane of ['prescriptions', 'treatments', 'imaging', 'overrides', 'trends']) {
      expect(cy(container, `rt-tl-lane-${lane}`)).toHaveLength(1);
    }
    // Real events on the two data lanes.
    expect(cy(container, 'rt-tl-presc-event')).toHaveLength(1);
    expect(cy(container, 'rt-tl-tx-event')).toHaveLength(2);
    // Placeholder lanes are labeled as pending backend integration.
    expect(getAllByText('tl_lane_placeholder')).toHaveLength(3);
    // Short course → no complete-history checkbox (RTV-176 gate).
    expect(cy(container, 'rt-tl-complete-history')).toHaveLength(0);
  });

  it('collapses a lane from its header button', () => {
    const { container } = render(
      <CourseTimelinePanel servicesManager={makeServicesManager([record('20260107', 1)])} />
    );
    expect(cy(container, 'rt-tl-tx-event')).toHaveLength(1);
    fireEvent.click(cy(container, 'rt-tl-lane-treatments')[0]);
    expect(cy(container, 'rt-tl-tx-event')).toHaveLength(0);
  });

  it('exposes the calendar options (RTV-175) and persists them', () => {
    const { container } = render(
      <CourseTimelinePanel servicesManager={makeServicesManager([record('20260107', 1)])} />
    );
    fireEvent.click(cy(container, 'rt-tl-calendar-options')[0]);
    expect(cy(container, 'rt-tl-workweek')).toHaveLength(1);
    expect(cy(container, 'rt-tl-hide-empty')).toHaveLength(1);
    expect(cy(container, 'rt-tl-datepicker')).toHaveLength(1);
    // Hide empty weeks defaults ON.
    expect((cy(container, 'rt-tl-hide-empty')[0] as HTMLInputElement).checked).toBe(true);

    fireEvent.click(cy(container, 'rt-tl-workweek')[0]);
    const stored = JSON.parse(window.localStorage.getItem(TIMELINE_PREFS_KEY) as string);
    expect(stored.workWeekOnly).toBe(true);
    expect(stored.hideEmptyWeeks).toBe(true);
  });

  it('filters PlanIntent=VERIFICATION plans via the plan filter (RTV-174) and persists', () => {
    const { container } = render(
      <CourseTimelinePanel
        servicesManager={makeServicesManager([approvedPlan, verificationPlan])}
      />
    );
    expect(cy(container, 'rt-tl-presc-event')).toHaveLength(2);

    fireEvent.click(cy(container, 'rt-tl-plan-filter')[0]);
    expect(cy(container, 'rt-tl-filter-approved')).toHaveLength(1);
    expect(cy(container, 'rt-tl-filter-unapproved')).toHaveLength(1);
    fireEvent.click(cy(container, 'rt-tl-filter-verification')[0]);

    expect(cy(container, 'rt-tl-presc-event')).toHaveLength(1);
    const stored = JSON.parse(window.localStorage.getItem(TIMELINE_PREFS_KEY) as string);
    expect(stored.showVerification).toBe(false);
  });

  it('reloads persisted prefs on mount (localStorage, RTV-174/175)', () => {
    window.localStorage.setItem(
      TIMELINE_PREFS_KEY,
      JSON.stringify({ showVerification: false })
    );
    const { container } = render(
      <CourseTimelinePanel
        servicesManager={makeServicesManager([approvedPlan, verificationPlan])}
      />
    );
    expect(cy(container, 'rt-tl-presc-event')).toHaveLength(1);
  });

  it('offers "Display complete history" only when the span exceeds 180 days (RTV-176)', () => {
    const { container, queryByText } = render(
      <CourseTimelinePanel
        servicesManager={makeServicesManager([record('20250101', 1), record('20260101', 30)])}
      />
    );
    const checkbox = cy(container, 'rt-tl-complete-history');
    expect(checkbox).toHaveLength(1);
    // The notes line joins several notes — match by substring.
    expect(queryByText(/tl_truncated_note/)).toBeTruthy();

    fireEvent.click(checkbox[0]);
    expect(queryByText(/tl_truncated_note/)).toBeNull();
    // Both events visible in the full window.
    expect(cy(container, 'rt-tl-tx-event')).toHaveLength(2);
  });
});
