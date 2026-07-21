/**
 * IheInvokePage (RTV-157) — resolution/navigation behaviour with a mocked
 * data source inside a MemoryRouter (navigation must go through the router,
 * never location.href, so the router IS the observable surface).
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import IheInvokePage from './IheInvokePage';

function LocationProbe({ locations }: { locations: string[] }) {
  const location = useLocation();
  locations.push(`${location.pathname}${location.search}`);
  return <div data-testid="probe">{`${location.pathname}${location.search}`}</div>;
}

function makeExtensionManager(searchMock: jest.Mock, initialize = jest.fn()) {
  return {
    getActiveDataSource: () => [
      {
        initialize: initialize.mockResolvedValue(undefined),
        query: { studies: { search: searchMock } },
      },
    ],
  };
}

function renderAt(search: string, extensionManager: any): string[] {
  const locations: string[] = [];
  render(
    <MemoryRouter initialEntries={[`/ihe-invoke${search}`]}>
      <Routes>
        <Route
          path="/ihe-invoke"
          element={<IheInvokePage extensionManager={extensionManager} />}
        />
        <Route path="*" element={<LocationProbe locations={locations} />} />
      </Routes>
    </MemoryRouter>
  );
  return locations;
}

const lastLocation = (locations: string[]) => locations[locations.length - 1];

describe('IheInvokePage', () => {
  it('renders the error panel (data-cy=rt-ihe-error) for an invalid request', async () => {
    const searchMock = jest.fn();
    render(
      <MemoryRouter initialEntries={['/ihe-invoke?requestType=BOGUS']}>
        <Routes>
          <Route
            path="/ihe-invoke"
            element={<IheInvokePage extensionManager={makeExtensionManager(searchMock)} />}
          />
        </Routes>
      </MemoryRouter>
    );
    const error = await screen.findByText(/Unsupported requestType/);
    expect(error).toBeTruthy();
    expect(document.querySelector('[data-cy="rt-ihe-error"]')).toBeTruthy();
    expect(document.querySelector('[data-cy="rt-ihe-page"]')).toBeTruthy();
    // The worklist escape hatch is a router Link, not a raw href.
    expect(screen.getByText('Go to the worklist').getAttribute('href')).toBe('/worklist-rt');
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('opens STUDY sets in the radiotherapy mode when any study has an RT modality', async () => {
    const searchMock = jest
      .fn()
      .mockResolvedValueOnce([{ studyInstanceUid: '1.2.3', modalities: 'CT\\SR' }])
      .mockResolvedValueOnce([{ studyInstanceUid: '4.5.6', modalities: 'CT\\RTPLAN' }]);
    const initialize = jest.fn();
    const locations = renderAt(
      '?requestType=STUDY&studyUID=1.2.3,4.5.6&datasources=orthanc',
      makeExtensionManager(searchMock, initialize)
    );

    await waitFor(() =>
      expect(lastLocation(locations)).toBe(
        '/rtmedical-radiotherapy?StudyInstanceUIDs=1.2.3%2C4.5.6&datasources=orthanc'
      )
    );
    // initialize() before QIDO (direct-entry gotcha), one query per UID.
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(searchMock).toHaveBeenCalledWith({ studyInstanceUid: '1.2.3' });
    expect(searchMock).toHaveBeenCalledWith({ studyInstanceUid: '4.5.6' });
  });

  it('opens STUDY sets in the radiology mode when no RT modality is present', async () => {
    const searchMock = jest
      .fn()
      .mockResolvedValue([{ studyInstanceUid: '1.2.3', modalities: 'CT\\MR' }]);
    const locations = renderAt(
      '?requestType=STUDY&studyUID=1.2.3',
      makeExtensionManager(searchMock)
    );
    await waitFor(() =>
      expect(lastLocation(locations)).toBe('/rtmedical-radiology?StudyInstanceUIDs=1.2.3')
    );
  });

  it('still opens the studies (radiology default) when QIDO fails — best-effort', async () => {
    const searchMock = jest.fn().mockRejectedValue(new Error('QIDO down'));
    const locations = renderAt(
      '?requestType=STUDY&studyUID=1.2.3',
      makeExtensionManager(searchMock)
    );
    await waitFor(() =>
      expect(lastLocation(locations)).toBe('/rtmedical-radiology?StudyInstanceUIDs=1.2.3')
    );
  });

  it('opens a PATIENT with exactly one study directly, auto-selecting the mode', async () => {
    const searchMock = jest
      .fn()
      .mockResolvedValue([{ studyInstanceUid: '9.8.7', modalities: 'CT\\RTSTRUCT' }]);
    const locations = renderAt(
      '?requestType=PATIENT&patientID=P001',
      makeExtensionManager(searchMock)
    );
    await waitFor(() =>
      expect(lastLocation(locations)).toBe('/rtmedical-radiotherapy?StudyInstanceUIDs=9.8.7')
    );
    expect(searchMock).toHaveBeenCalledWith({ patientId: 'P001', disableWildcard: true });
  });

  it('sends a PATIENT with multiple studies to the MRN-filtered worklist', async () => {
    const searchMock = jest.fn().mockResolvedValue([
      { studyInstanceUid: '1.1', modalities: 'CT' },
      { studyInstanceUid: '2.2', modalities: 'MR' },
    ]);
    const locations = renderAt(
      '?requestType=PATIENT&patientID=P001',
      makeExtensionManager(searchMock)
    );
    await waitFor(() => expect(lastLocation(locations)).toBe('/worklist-rt?mrn=P001'));
  });

  it('sends a PATIENT with zero studies to the MRN-filtered worklist too', async () => {
    const searchMock = jest.fn().mockResolvedValue([]);
    const locations = renderAt(
      '?requestType=PATIENT&patientID=NOPE',
      makeExtensionManager(searchMock)
    );
    await waitFor(() => expect(lastLocation(locations)).toBe('/worklist-rt?mrn=NOPE'));
  });

  it('shows the error panel when no data source is available', async () => {
    render(
      <MemoryRouter initialEntries={['/ihe-invoke?requestType=STUDY&studyUID=1.2.3']}>
        <Routes>
          <Route path="/ihe-invoke" element={<IheInvokePage extensionManager={{}} />} />
        </Routes>
      </MemoryRouter>
    );
    await screen.findByText(/No active data source/);
    expect(document.querySelector('[data-cy="rt-ihe-error"]')).toBeTruthy();
  });
});
