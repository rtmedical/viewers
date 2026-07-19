import type { BrandingConfig } from './types';
import { sanitizeBrandingPayload } from './sanitizeBranding';

export interface FetchBrandingOptions {
  /** Endpoint template; `{tenantId}` is replaced with the (encoded) tenant id. */
  endpoint: string;
  /** Tenant id to fetch branding for. */
  tenantId: string;
  /** Injectable fetch implementation (defaults to global fetch) — eases testing. */
  fetchImpl?: typeof fetch;
  /** Optional abort signal. */
  signal?: AbortSignal;
}

/**
 * Fetches per-tenant branding from the Connect API.
 *
 * Returns the parsed partial branding, or `null` on ANY failure (no fetch
 * available, network error, non-2xx response, or invalid JSON) so callers can
 * gracefully fall back to cache / defaults. This function never throws.
 */
export async function fetchBranding(
  options: FetchBrandingOptions
): Promise<Partial<BrandingConfig> | null> {
  const { endpoint, tenantId, fetchImpl, signal } = options;
  const doFetch = fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : undefined);

  if (!doFetch || !endpoint || !tenantId) {
    return null;
  }

  const url = endpoint.replace('{tenantId}', encodeURIComponent(tenantId));

  try {
    const response = await doFetch(url, {
      signal,
      headers: { Accept: 'application/json' },
    });
    if (!response || !response.ok) {
      return null;
    }
    const data = await response.json();
    return sanitizeBrandingPayload(data);
  } catch (error) {
    // Network failure, abort, or JSON parse error — fall back gracefully.
    // (Named binding kept: an optional catch binding breaks the repo's
    // @babel/plugin-transform-regenerator pass inside async functions.)
    void error;
    return null;
  }
}
