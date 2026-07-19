import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

jest.mock('@ohif/ui-next', () => {
  const ReactRuntime = require('react');
  const AboutModal: any = ({ children }) => ReactRuntime.createElement('div', null, children);
  AboutModal.ProductName = ({ children }) => ReactRuntime.createElement('div', null, children);
  AboutModal.ProductVersion = ({ children }) => ReactRuntime.createElement('div', null, children);
  AboutModal.ProductBeta = ({ children }) => ReactRuntime.createElement('div', null, children);
  AboutModal.Body = ({ children }) => ReactRuntime.createElement('div', null, children);
  AboutModal.DetailItem = ({ label, value }) =>
    ReactRuntime.createElement(
      'div',
      null,
      ReactRuntime.createElement('span', null, label),
      ReactRuntime.createElement('span', null, value)
    );
  return { AboutModal };
});

import { RtMedicalAboutModal } from './RtMedicalAboutModal';
import { WhiteLabelingProvider } from './WhiteLabelingContext';
import { WhiteLabelingRootProvider, WhiteLabelingService } from './WhiteLabelingRootProvider';
import getCustomizationModule from '../getCustomizationModule';

describe('RtMedicalAboutModal', () => {
  afterEach(() => {
    window.localStorage.clear();
    delete (global as { fetch?: unknown }).fetch;
  });

  it('uses tenant identity without inheriting RT support or website details', () => {
    render(
      <WhiteLabelingProvider
        config={{ tenants: { clinic: { productName: 'Clinic Viewer' } } }}
        context={{ tenantId: 'clinic' }}
      >
        <RtMedicalAboutModal />
      </WhiteLabelingProvider>
    );

    expect(screen.getAllByText('Clinic Viewer')).toHaveLength(2);
    expect(screen.queryByText('suporte@rtmedical.com.br')).toBeNull();
    expect(screen.queryByText('rtmedical.com.br')).toBeNull();
    expect(screen.queryByAltText('RT Medical Systems')).toBeNull();
  });

  it('renders explicitly configured tenant support and website details', () => {
    render(
      <WhiteLabelingProvider
        config={{
          tenants: {
            clinic: {
              productName: 'Clinic Viewer',
              supportEmail: 'support@clinic.example',
              websiteUrl: 'https://clinic.example',
              websiteLabel: 'clinic.example',
            },
          },
        }}
        context={{ tenantId: 'clinic' }}
      >
        <RtMedicalAboutModal />
      </WhiteLabelingProvider>
    );

    expect(screen.getByText('support@clinic.example')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'clinic.example' }).getAttribute('href')).toBe(
      'https://clinic.example'
    );
  });

  it('binds service configuration to the registered modal outside the root provider', () => {
    const whiteLabelingService = new WhiteLabelingService({
      defaultTenant: 'clinic',
      tenants: {
        clinic: {
          productName: 'Configured Clinic',
          supportEmail: 'support@configured.example',
        },
      },
    });
    const modules = getCustomizationModule({
      servicesManager: {
        services: {
          [WhiteLabelingService.REGISTRATION.name]: whiteLabelingService,
        },
      },
    });
    const RegisteredAboutModal = modules.find(module => module.name === 'ohif.aboutModal')
      ?.value as React.ComponentType;

    render(<RegisteredAboutModal />);

    expect(screen.getAllByText('Configured Clinic')).toHaveLength(2);
    expect(screen.getByText('support@configured.example')).toBeTruthy();
    expect(screen.queryByAltText('RT Medical Systems')).toBeNull();
    expect((RegisteredAboutModal as typeof RtMedicalAboutModal).title).toBe('About Viewer');
  });

  it('shares the root provider snapshot without issuing a modal fetch', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ productName: 'Remote Clinic' }),
    });
    (global as { fetch?: unknown }).fetch = fetchMock;
    const whiteLabelingService = new WhiteLabelingService({
      defaultTenant: 'clinic',
      apiEndpoint: 'https://connect/api/branding/{tenantId}',
      tenants: {
        clinic: {
          productName: 'Static Clinic',
        },
      },
    });
    const modules = getCustomizationModule({
      servicesManager: {
        services: {
          [WhiteLabelingService.REGISTRATION.name]: whiteLabelingService,
        },
      },
    });
    const RegisteredAboutModal = modules.find(module => module.name === 'ohif.aboutModal')
      ?.value as React.ComponentType;

    render(
      <>
        <WhiteLabelingRootProvider service={whiteLabelingService}>
          <span>Root</span>
        </WhiteLabelingRootProvider>
        <RegisteredAboutModal />
      </>
    );

    await waitFor(() => expect(screen.getByText('Remote Clinic')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not render an unsafe website URL from static tenant configuration', () => {
    render(
      <WhiteLabelingProvider
        config={{
          tenants: {
            clinic: {
              productName: 'Clinic Viewer',
              websiteUrl: 'javascript:alert(document.domain)',
              websiteLabel: 'Unsafe link',
            },
          },
        }}
        context={{ tenantId: 'clinic' }}
      >
        <RtMedicalAboutModal />
      </WhiteLabelingProvider>
    );

    expect(screen.queryByRole('link', { name: 'Unsafe link' })).toBeNull();
  });
});
