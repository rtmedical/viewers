import type { TenantContext, WhiteLabelingConfig } from './types';

/**
 * Resolves the active tenant id from the white-labeling config and request
 * context. Precedence:
 *
 *   1. Explicit `context.tenantId` always wins (route / query / config).
 *   2. Matcher rules against the hostname, in order of specificity:
 *      exact hostname → hostname suffix → regex pattern.
 *   3. `config.defaultTenant`.
 *   4. `null` (the caller then falls back to RT Medical defaults).
 *
 * Pure and side-effect free.
 */
export function resolveTenant(
  config: WhiteLabelingConfig | undefined,
  context: TenantContext = {}
): string | null {
  if (!config || config.enabled === false) {
    return null;
  }

  const { tenantId, hostname } = context;

  // 1. Explicit tenant id always wins.
  if (tenantId) {
    return tenantId;
  }

  // 2. Hostname matchers, most specific first.
  if (hostname && config.matchers && config.matchers.length > 0) {
    const host = hostname.toLowerCase();

    // 2a. Exact hostname match.
    for (const matcher of config.matchers) {
      if (matcher.hostnames?.some(h => h.toLowerCase() === host)) {
        return matcher.tenantId;
      }
    }

    // 2b. Hostname suffix match (e.g. ".clinic.rtmedical.ai").
    for (const matcher of config.matchers) {
      if (matcher.hostnameSuffixes?.some(suffix => host.endsWith(suffix.toLowerCase()))) {
        return matcher.tenantId;
      }
    }

    // 2c. Regex pattern match.
    for (const matcher of config.matchers) {
      if (matcher.hostnamePattern) {
        try {
          if (new RegExp(matcher.hostnamePattern).test(hostname)) {
            return matcher.tenantId;
          }
        } catch {
          /* invalid regex in config — skip this matcher */
        }
      }
    }
  }

  // 3. Configured default tenant, else 4. null.
  return config.defaultTenant ?? null;
}
