import React from 'react';
import { render, screen } from '@testing-library/react';

import {
  createContextLogoComponentFn,
  WhiteLabelingRootProvider,
  WhiteLabelingService,
} from './WhiteLabelingRootProvider';

describe('WhiteLabelingRootProvider', () => {
  it('provides tenant branding to the native OHIF logo callback', () => {
    const service = new WhiteLabelingService({
      tenants: {
        clinic: {
          productName: 'Clinic Viewer',
          logoDarkUrl: 'https://clinic.example/logo.png',
        },
      },
      defaultTenant: 'clinic',
    });

    render(
      <WhiteLabelingRootProvider service={service}>
        {createContextLogoComponentFn(React)}
      </WhiteLabelingRootProvider>
    );

    expect(screen.getByAltText('Clinic Viewer').getAttribute('src')).toBe(
      'https://clinic.example/logo.png'
    );
  });

  it('creates a service from OHIF registration configuration', () => {
    const service = WhiteLabelingService.REGISTRATION.create({
      configuration: { defaultTenant: 'clinic' },
    });

    expect(service.config?.defaultTenant).toBe('clinic');
  });
});
