import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';

import { defaultBranding } from './defaultBranding';
import { resolveBranding } from './resolveBranding';
import { mergeBranding } from './mergeBranding';
import { applyThemeOverride } from './applyThemeOverride';
import { applyDocumentBranding } from './applyDocumentBranding';
import { readBrandingCache, writeBrandingCache } from './brandingCache';
import { fetchBranding } from './fetchBranding';
import type { BrandingConfig, TenantContext, WhiteLabelingConfig } from './types';

export interface WhiteLabelingContextValue {
  /** Fully resolved, ready-to-use branding. */
  branding: BrandingConfig;
  /** Active tenant id (null when RT Medical defaults are used). */
  tenantId: string | null;
  /** True while the Connect-API branding fetch is in flight. */
  loading: boolean;
}

const WhiteLabelingContext = createContext<WhiteLabelingContextValue | undefined>(undefined);
WhiteLabelingContext.displayName = 'WhiteLabelingContext';

function getDefaultHostname(): string | undefined {
  if (typeof window !== 'undefined' && window.location) {
    return window.location.hostname;
  }
  return undefined;
}

export interface WhiteLabelingProviderProps {
  /** White-labeling configuration (typically from the OHIF app config). */
  config?: WhiteLabelingConfig;
  /** Override request context — mainly for tests / SSR. */
  context?: TenantContext;
  /** Base branding to merge tenant overrides over (defaults to RT Medical defaults). */
  base?: BrandingConfig;
  children?: React.ReactNode;
}

/**
 * Provides multi-tenant white-labeling/branding to the React tree.
 *
 * Resolution order at render time:
 *   1. Static: pick tenant (explicit id / hostname matcher / default) and merge
 *      its static override over the RT Medical defaults — synchronous, no flash.
 *   2. Cache: if a cached Connect-API branding exists for the tenant, layer it
 *      on immediately (offline-friendly).
 *   3. Network: fetch fresh branding from the Connect API, layer it on, and
 *      refresh the local cache.
 *
 * Theme tokens are applied as CSS custom properties whenever branding changes.
 */
export function WhiteLabelingProvider({
  config,
  context,
  base = defaultBranding,
  children,
}: WhiteLabelingProviderProps) {
  const resolvedContext: TenantContext = useMemo(
    () => ({ hostname: getDefaultHostname(), ...context }),
    [context]
  );

  // Synchronous static resolution (tenant + static override merged on defaults).
  const initial = useMemo(
    () => resolveBranding(config, resolvedContext, base),
    [config, resolvedContext, base]
  );
  const { tenantId } = initial;

  // Seed with cached remote branding if present (instant, offline-friendly).
  const [remoteBranding, setRemoteBranding] = useState<Partial<BrandingConfig> | null>(() =>
    tenantId ? readBrandingCache(tenantId) : null
  );
  const [loading, setLoading] = useState<boolean>(false);

  // Fetch remote branding from the Connect API when configured.
  useEffect(() => {
    if (!config?.apiEndpoint || !tenantId || config.enabled === false) {
      return undefined;
    }

    const controller =
      typeof AbortController !== 'undefined' ? new AbortController() : undefined;
    let active = true;
    setLoading(true);

    fetchBranding({ endpoint: config.apiEndpoint, tenantId, signal: controller?.signal })
      .then(remote => {
        if (!active || !remote) {
          return;
        }
        setRemoteBranding(remote);
        writeBrandingCache(tenantId, remote, config.cacheTtlMs);
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
      controller?.abort();
    };
  }, [config?.apiEndpoint, config?.cacheTtlMs, config?.enabled, tenantId]);

  const branding = useMemo(
    () => mergeBranding(initial.branding, remoteBranding ?? undefined),
    [initial.branding, remoteBranding]
  );

  // Apply theme overrides as CSS custom properties on the document root.
  useEffect(() => {
    applyThemeOverride(branding.theme);
  }, [branding.theme]);

  // Apply document-level branding (page title + favicon).
  useEffect(() => {
    applyDocumentBranding(branding);
  }, [branding.productName, branding.faviconUrl]);

  const value = useMemo<WhiteLabelingContextValue>(
    () => ({ branding, tenantId, loading }),
    [branding, tenantId, loading]
  );

  return (
    <WhiteLabelingContext.Provider value={value}>{children}</WhiteLabelingContext.Provider>
  );
}

WhiteLabelingProvider.propTypes = {
  config: PropTypes.object,
  context: PropTypes.object,
  base: PropTypes.object,
  children: PropTypes.node,
};

/**
 * Hook returning the active white-labeling/branding value. When used outside a
 * provider it returns the RT Medical defaults so consumers never crash.
 */
export function useWhiteLabeling(): WhiteLabelingContextValue {
  const ctx = useContext(WhiteLabelingContext);
  if (!ctx) {
    return { branding: defaultBranding, tenantId: null, loading: false };
  }
  return ctx;
}

export { WhiteLabelingContext };
