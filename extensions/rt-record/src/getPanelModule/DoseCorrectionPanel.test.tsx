/**
 * DoseCorrectionPanel (RTV-173) — behavioral tests: DICOM-derivable
 * correction/override events listed with type/beam/detail/operator, plus the
 * honest RIS/ARIA footer. DisplaySetService duck-typed, i18n mocked.
 */
import React from 'react';
import { render } from '@testing-library/react';
import DoseCorrectionPanel from './DoseCorrectionPanel';

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

const cy = (container: HTMLElement, name: string) =>
  container.querySelectorAll(`[data-cy="${name}"]`);

describe('DoseCorrectionPanel', () => {
  it('renders the no-records state', () => {
    const { container, getByText } = render(
      <DoseCorrectionPanel servicesManager={makeServicesManager([])} />
    );
    expect(cy(container, 'rt-dose-correction-panel')).toHaveLength(1);
    expect(getByText('dc_no_records')).toBeTruthy();
  });

  it('renders the honest empty state when records carry no corrections/overrides', () => {
    const clean = {
      rtRecord: {
        recordType: 'BEAMS',
        treatmentDate: '20260110',
        sessions: [
          { beamNumber: 1, specifiedMeterset: 100, deliveredMeterset: 100, overrides: [], corrections: [] },
        ],
      },
    };
    const { container, getByText } = render(
      <DoseCorrectionPanel servicesManager={makeServicesManager([clean])} />
    );
    expect(cy(container, 'rt-dc-event-row')).toHaveLength(0);
    expect(getByText('dc_no_events')).toBeTruthy();
    expect(getByText('dc_footer')).toBeTruthy();
  });

  it('lists correction and override events with type/beam/detail/operator', () => {
    const ds = {
      rtRecord: {
        recordType: 'BEAMS',
        treatmentDate: '20260110',
        treatmentTime: '101530',
        sessions: [
          {
            beamNumber: 2,
            terminationStatus: 'OPERATOR',
            verificationStatus: 'VERIFIED_OVR',
            specifiedMeterset: 100,
            deliveredMeterset: 60,
            overrides: [{ parameterPointer: '300A011E', reason: 'Tolerance', operator: 'Doe^Jane' }],
            corrections: [{ value: -0.5, parameterPointer: '3008002B' }],
          },
        ],
      },
    };
    const { container, getByText } = render(
      <DoseCorrectionPanel servicesManager={makeServicesManager([ds])} />
    );

    // machine-override + parameter-correction + verify-override + manual-treatment.
    expect(cy(container, 'rt-dc-event-row')).toHaveLength(4);
    expect(getByText('dc_type_machine_override')).toBeTruthy();
    expect(getByText('dc_type_parameter_correction')).toBeTruthy();
    expect(getByText('dc_type_verify_override')).toBeTruthy();
    expect(getByText('dc_type_manual_treatment')).toBeTruthy();
    expect(getByText('Doe^Jane')).toBeTruthy();
    expect(getByText(/Δ -0\.5/)).toBeTruthy();
    expect(getByText('dc_footer')).toBeTruthy();
  });
});
