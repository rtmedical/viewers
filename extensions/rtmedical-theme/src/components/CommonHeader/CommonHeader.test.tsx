import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

import { CommonHeader } from './CommonHeader';
import { WhiteLabelingProvider } from '../../whiteLabeling/WhiteLabelingContext';

describe('CommonHeader', () => {
  it('renders the default RT Medical Systems logo', () => {
    render(<CommonHeader />);
    const logo = screen.getByAltText('RT Medical Systems') as HTMLImageElement;
    expect(logo).toBeTruthy();
    expect(logo.getAttribute('src')).toBe('/assets/rtmedical-logo-white.png');
  });

  it('renders patient and study info when provided', () => {
    render(
      <CommonHeader
        patientName="DOE^JOHN"
        studyInfo="MRN 123 • CT TÓRAX"
      />
    );
    expect(screen.getByText('DOE^JOHN')).toBeTruthy();
    expect(screen.getByText('MRN 123 • CT TÓRAX')).toBeTruthy();
  });

  it('opens the Tarefas dropdown and fires a task handler', () => {
    const onExport = jest.fn();
    render(<CommonHeader tasks={[{ id: 'export', label: 'Exportar', onClick: onExport }]} />);
    fireEvent.click(screen.getByText('Tarefas'));
    fireEvent.click(screen.getByText('Exportar'));
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it('fires onReturn from the back affordance', () => {
    const onReturn = jest.fn();
    render(<CommonHeader onReturn={onReturn} />);
    fireEvent.click(screen.getByLabelText('Voltar'));
    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  it('hides the back affordance when onReturn is omitted', () => {
    render(<CommonHeader />);
    expect(screen.queryByLabelText('Voltar')).toBeNull();
  });

  it('renders the user name and reflects tenant branding from the provider', () => {
    render(
      <WhiteLabelingProvider
        config={{
          tenants: {
            'hospital-a': {
              logoAlt: 'Hosp A',
              logoDarkUrl: '/assets/hospital-a-logo.svg',
            },
          },
        }}
        context={{ tenantId: 'hospital-a' }}
      >
        <CommonHeader userName="dra. silva" />
      </WhiteLabelingProvider>
    );
    expect(screen.getByText('dra. silva')).toBeTruthy();
    const tenantLogo = screen.getByAltText('Hosp A') as HTMLImageElement;
    expect(tenantLogo.getAttribute('src')).toBe('/assets/hospital-a-logo.svg');
  });

  it('uses a tenant-neutral text fallback when a partial tenant has no logo', () => {
    render(
      <WhiteLabelingProvider
        config={{ tenants: { clinic: { productName: 'Clinic Viewer' } } }}
        context={{ tenantId: 'clinic' }}
      >
        <CommonHeader />
      </WhiteLabelingProvider>
    );

    expect(screen.getAllByText('Clinic Viewer')).toHaveLength(2);
    expect(screen.queryByAltText('RT Medical Systems')).toBeNull();
  });
});
