import { defaultBranding } from './defaultBranding';
import { mergeBranding } from './mergeBranding';
import { resolveTenant } from './resolveTenant';
import type { BrandingConfig, TenantContext, WhiteLabelingConfig } from './types';

export interface ResolvedBranding {
  /** Active tenant id (null when RT Medical defaults are used). */
  tenantId: string | null;
  /** Fully resolved, ready-to-use branding. */
  branding: BrandingConfig;
}

/**
 * Synchronously resolves branding from the static config (no network). It picks
 * the tenant via {@link resolveTenant}, then merges that tenant's static
 * override (`config.tenants[tenantId]`) over the RT Medical defaults.
 *
 * Remote Connect-API branding (when configured) is layered on top of this result
 * later by the provider, again via {@link mergeBranding}.
 */
export function resolveBranding(
  config: WhiteLabelingConfig | undefined,
  context: TenantContext = {},
  base: BrandingConfig = defaultBranding
): ResolvedBranding {
  const tenantId = resolveTenant(config, context);
  const tenantOverride =
    tenantId && config?.tenants ? config.tenants[tenantId] : undefined;

  return {
    tenantId,
    branding: mergeBranding(base, tenantOverride),
  };
}
