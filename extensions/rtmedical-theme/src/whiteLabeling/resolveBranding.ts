import { defaultBranding } from './defaultBranding';
import { mergeBranding } from './mergeBranding';
import { resolveTenant } from './resolveTenant';
import { sanitizeBrandingPayload } from './sanitizeBranding';
import type { BrandingConfig, TenantContext, WhiteLabelingConfig } from './types';

export interface ResolvedBranding {
  /** Active tenant id (null when RT Medical defaults are used). */
  tenantId: string | null;
  /** Fully resolved, ready-to-use branding. */
  branding: BrandingConfig;
}

function tenantBase(
  base: BrandingConfig,
  tenantId: string,
  tenantOverride: Partial<BrandingConfig>
): BrandingConfig {
  const tenantLabel = tenantOverride.productName || tenantOverride.shortName || tenantId;

  return {
    productName: tenantLabel,
    shortName: tenantLabel,
    faviconUrl: '',
    theme: base.theme ? { ...base.theme } : undefined,
  };
}

/**
 * Synchronously resolves branding from the static config (no network). It picks
 * the tenant via {@link resolveTenant}, then merges that tenant's static
 * override (`config.tenants[tenantId]`) over theme defaults. Tenant identity
 * fields are cleared first so partial configurations cannot inherit RT assets.
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
  const configuredOverride = tenantId && config?.tenants ? config.tenants[tenantId] : undefined;
  const tenantOverride = sanitizeBrandingPayload(configuredOverride) ?? undefined;
  const brandingBase = tenantId ? tenantBase(base, tenantId, tenantOverride ?? {}) : base;

  return {
    tenantId,
    branding: mergeBranding(brandingBase, tenantOverride),
  };
}
