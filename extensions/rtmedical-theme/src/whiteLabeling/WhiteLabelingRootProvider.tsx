import React, { useEffect, useSyncExternalStore } from 'react';

import { Logo } from './Logo';
import {
  WhiteLabelingContext,
  WhiteLabelingProvider,
  useWhiteLabeling,
  type WhiteLabelingContextValue,
} from './WhiteLabelingContext';
import { resolveBranding } from './resolveBranding';
import type { TenantContext, WhiteLabelingConfig } from './types';

interface CustomizationServiceLike {
  Scope?: {
    Mode?: unknown;
  };
  setCustomizations?: (customizations: Record<string, unknown>, scope?: unknown) => void;
}

function getInitialContext(): TenantContext {
  if (typeof window !== 'undefined' && window.location) {
    return { hostname: window.location.hostname };
  }
  return {};
}

export class WhiteLabelingService {
  static readonly REGISTRATION = {
    name: 'rtmedicalWhiteLabelingService',
    create: ({
      configuration,
      servicesManager,
    }: {
      configuration?: WhiteLabelingConfig;
      servicesManager?: { services?: Record<string, unknown> };
    }) =>
      new WhiteLabelingService(
        configuration,
        servicesManager?.services?.customizationService as CustomizationServiceLike | undefined
      ),
  };

  readonly config?: WhiteLabelingConfig;
  private listeners = new Set<() => void>();
  private snapshot: WhiteLabelingContextValue;
  private readonly customizationService?: CustomizationServiceLike;
  private aboutModal?: unknown;

  constructor(config?: WhiteLabelingConfig, customizationService?: CustomizationServiceLike) {
    this.config = config;
    this.customizationService = customizationService;
    const { branding, tenantId } = resolveBranding(config, getInitialContext());
    this.snapshot = { branding, tenantId, loading: false };
  }

  readonly getSnapshot = (): WhiteLabelingContextValue => this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setSnapshot(snapshot: WhiteLabelingContextValue): void {
    if (this.snapshot === snapshot) {
      return;
    }
    this.snapshot = snapshot;
    this.listeners.forEach(listener => listener());
  }

  setAboutModal(aboutModal: unknown): void {
    this.aboutModal = aboutModal;
  }

  installAboutModal(): void {
    if (!this.aboutModal || !this.customizationService?.setCustomizations) {
      return;
    }

    this.customizationService.setCustomizations(
      { 'ohif.aboutModal': this.aboutModal },
      this.customizationService.Scope?.Mode
    );
  }

  onModeEnter(): void {
    this.installAboutModal();
  }

  onModeExit(): void {
    this.installAboutModal();
  }
}

interface WhiteLabelingRootProviderProps {
  service?: WhiteLabelingService;
  children?: React.ReactNode;
}

function WhiteLabelingServicePublisher({ service }: { service?: WhiteLabelingService }) {
  const value = useWhiteLabeling();

  useEffect(() => {
    service?.setSnapshot(value);
  }, [service, value]);

  return null;
}

/**
 * Global extension provider registered through OHIF's ServiceProvidersManager.
 * It covers the worklist and auxiliary routes in addition to viewer modes.
 */
export function WhiteLabelingRootProvider({ service, children }: WhiteLabelingRootProviderProps) {
  useEffect(() => {
    service?.installAboutModal();
  }, [service]);

  return (
    <WhiteLabelingProvider config={service?.config}>
      <WhiteLabelingServicePublisher service={service} />
      {children}
    </WhiteLabelingProvider>
  );
}

/**
 * Re-exposes the root provider's live snapshot to React trees hosted above it,
 * such as OHIF's modal portal, without starting another resolver or fetch.
 */
export function WhiteLabelingServiceProvider({
  service,
  children,
}: {
  service: WhiteLabelingService;
  children?: React.ReactNode;
}) {
  const value = useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot);

  return <WhiteLabelingContext.Provider value={value}>{children}</WhiteLabelingContext.Provider>;
}

/** Native OHIF logo callback backed by the live white-labeling context. */
export function createContextLogoComponentFn(ReactRuntime: typeof React): JSX.Element {
  return ReactRuntime.createElement(Logo);
}
