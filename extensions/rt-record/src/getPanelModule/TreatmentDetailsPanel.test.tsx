/**
 * TreatmentDetailsPanel (RTV-173) — behavioral tests: record selector, beam
 * rows with MU delta, VERIFIED_OVR/OPERATOR badges and totals, with the
 * DisplaySetService duck-typed and i18n mocked (keys echo back).
 */
import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import TreatmentDetailsPanel from './TreatmentDetailsPanel';

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

const recordDs = (uid: string, treatmentDate: string, machine: string, sessions: any[]) => ({
  displaySetInstanceUID: uid,
  label: `REC ${uid}`,
  rtRecord: {
    recordType: 'BEAMS',
    treatmentDate,
    treatmentTime: '101530',
    machine,
    fractionNumber: 7,
    sessions,
  },
});

const cy = (container: HTMLElement, name: string) =>
  container.querySelectorAll(`[data-cy="${name}"]`);

describe('TreatmentDetailsPanel', () => {
  it('renders the empty state without records', () => {
    const { container, getByText } = render(
      <TreatmentDetailsPanel servicesManager={makeServicesManager([])} />
    );
    expect(cy(container, 'rt-treatment-details')).toHaveLength(1);
    expect(getByText('td_no_records')).toBeTruthy();
  });

  it('renders beam rows with delta, badges and totals for the newest record', () => {
    const ds = recordDs('ds-1', '20260110', 'TrueBeam-1', [
      {
        beamNumber: 1,
        beamName: 'AP',
        specifiedMeterset: 120,
        deliveredMeterset: 120,
        terminationStatus: 'NORMAL',
        verificationStatus: 'VERIFIED',
        overrides: [],
        corrections: [],
      },
      {
        beamNumber: 2,
        beamName: 'PA',
        specifiedMeterset: 100,
        deliveredMeterset: 60,
        terminationStatus: 'OPERATOR',
        verificationStatus: 'VERIFIED_OVR',
        overrides: [{ parameterPointer: '300A011E' }],
        corrections: [{ value: -0.5 }],
      },
    ]);
    const { container, getByText, getByTitle } = render(
      <TreatmentDetailsPanel servicesManager={makeServicesManager([ds])} />
    );

    expect(cy(container, 'rt-td-beam-row')).toHaveLength(2);
    expect(getByText('TrueBeam-1')).toBeTruthy();
    expect(getByText('-40')).toBeTruthy(); // Δ MU of beam 2
    expect(getByText('VERIFIED_OVR')).toBeTruthy();
    expect(getByTitle('td_badge_operator_title').textContent).toBe('OPERATOR');
    // Totals row: 220 specified / 180 delivered.
    const totals = cy(container, 'rt-td-totals-row')[0];
    expect(totals.textContent).toContain('220');
    expect(totals.textContent).toContain('180');
    // Single record → no selector.
    expect(cy(container, 'rt-td-record-select')).toHaveLength(0);
  });

  it('switches records through the selector (newest first)', () => {
    const older = recordDs('ds-old', '20260101', 'Machine-OLD', [
      { beamNumber: 1, specifiedMeterset: 10, deliveredMeterset: 10, overrides: [], corrections: [] },
    ]);
    const newer = recordDs('ds-new', '20260110', 'Machine-NEW', [
      { beamNumber: 1, specifiedMeterset: 20, deliveredMeterset: 20, overrides: [], corrections: [] },
      { beamNumber: 2, specifiedMeterset: 30, deliveredMeterset: 30, overrides: [], corrections: [] },
    ]);
    const { container, getByText } = render(
      <TreatmentDetailsPanel servicesManager={makeServicesManager([older, newer])} />
    );

    // Defaults to the newest record.
    expect(getByText('Machine-NEW')).toBeTruthy();
    expect(cy(container, 'rt-td-beam-row')).toHaveLength(2);

    const select = cy(container, 'rt-td-record-select')[0] as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'ds-old' } });
    expect(getByText('Machine-OLD')).toBeTruthy();
    expect(cy(container, 'rt-td-beam-row')).toHaveLength(1);
  });
});
