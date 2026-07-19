/**
 * White-labeling / multi-tenant branding types for the RT Medical OHIF theme.
 *
 * RTV-156 — White-labeling Context (logos, branding multi-cliente).
 * Migrated and expanded from connectviewer's WhiteLabelingContext.js, redesigned
 * for OHIF v3's extension-first architecture (RTV-114): ZERO fork of @ohif/core,
 * @ohif/app or @ohif/ui — public APIs only.
 */

/** Visual theme tokens that can be overridden per tenant. */
export interface BrandingThemeTokens {
  /** Primary accent color (hex). Drives buttons, active tools and links. */
  primary?: string;
  /** Secondary accent color (hex). */
  secondary?: string;
  /** App background color (hex). */
  background?: string;
  /** Primary foreground / text color (hex). */
  foreground?: string;
  /** Highlight / focus-ring color (hex). */
  highlight?: string;
}

/** A single tenant/client branding definition. */
export interface BrandingConfig {
  /** Human-readable product name shown in the title bar / about dialog. */
  productName: string;
  /** Short product label for toolbar / compact areas. */
  shortName?: string;
  /** URL or data-URI of the primary logo (light surfaces). */
  logoUrl?: string;
  /** Optional logo variant for dark surfaces. */
  logoDarkUrl?: string;
  /** Logo link target (href) when clicked. */
  logoHref?: string;
  /** Alt text for the logo image. */
  logoAlt?: string;
  /** Favicon URL. */
  faviconUrl?: string;
  /** Theme color overrides. */
  theme?: BrandingThemeTokens;
  /** Support contact shown in footer / about. */
  supportEmail?: string;
  /** Optional product or institution website shown in the about dialog. */
  websiteUrl?: string;
  /** Optional human-readable website label. */
  websiteLabel?: string;
}

/** Rule to match a request context to a tenant id. */
export interface TenantMatcher {
  /** Tenant id this rule resolves to. */
  tenantId: string;
  /** Exact hostnames that map to this tenant. */
  hostnames?: string[];
  /** Hostname suffixes (e.g. ".rtmedical.ai") that map to this tenant. */
  hostnameSuffixes?: string[];
  /** Regex (as a string) tested against the hostname. */
  hostnamePattern?: string;
}

/** The full white-labeling configuration (provided via app config). */
export interface WhiteLabelingConfig {
  /** Whether white-labeling resolution is enabled (default: true). */
  enabled?: boolean;
  /** Default tenant id used when no matcher applies. */
  defaultTenant?: string;
  /** Per-tenant partial branding overrides (merged over defaultBranding). */
  tenants?: Record<string, Partial<BrandingConfig>>;
  /** Ordered rules to resolve a tenant from the request context. */
  matchers?: TenantMatcher[];
  /** Connect API endpoint template to fetch branding; `{tenantId}` placeholder. */
  apiEndpoint?: string;
  /** Local cache TTL in milliseconds (default 24h). */
  cacheTtlMs?: number;
}

/** Runtime context used to resolve the active tenant. */
export interface TenantContext {
  /** Explicit tenant id (e.g. from query string, route or config). */
  tenantId?: string;
  /** Current hostname (typically window.location.hostname). */
  hostname?: string;
}
