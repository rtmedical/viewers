import type { BrandingConfig } from './types';
import { sanitizeBrandingPayload } from './sanitizeBranding';

const CACHE_PREFIX = 'rt.whitelabel.branding.';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

interface CacheEntry {
  branding: Partial<BrandingConfig>;
  /** Epoch ms when the entry was stored. */
  storedAt: number;
  /** Time-to-live in ms. */
  ttlMs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Returns localStorage when available, else null (privacy mode / SSR). */
function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    /* access denied (e.g. blocked third-party storage) */
  }
  return null;
}

function keyFor(tenantId: string, source?: string): string {
  const scopedTenantId = source
    ? `${encodeURIComponent(source)}::${encodeURIComponent(tenantId)}`
    : tenantId;
  return `${CACHE_PREFIX}${scopedTenantId}`;
}

function removeItem(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    /* cache cleanup is best-effort */
  }
}

/**
 * Reads cached branding for a tenant. Returns null when absent, unparseable or
 * expired (expired entries are also removed). `now` is injectable for testing.
 */
export function readBrandingCache(
  tenantId: string,
  now: number = Date.now(),
  source?: string
): Partial<BrandingConfig> | null {
  const storage = getStorage();
  if (!storage || !tenantId) {
    return null;
  }

  const key = keyFor(tenantId, source);
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) {
    return null;
  }

  try {
    const entry = JSON.parse(raw) as unknown;
    if (!isRecord(entry) || typeof entry.storedAt !== 'number') {
      removeItem(storage, key);
      return null;
    }
    const ttl = typeof entry.ttlMs === 'number' ? entry.ttlMs : DEFAULT_TTL_MS;
    if (now - entry.storedAt > ttl) {
      removeItem(storage, key);
      return null;
    }
    const branding = sanitizeBrandingPayload(entry.branding);
    if (!branding) {
      removeItem(storage, key);
      return null;
    }

    try {
      storage.setItem(key, JSON.stringify({ branding, storedAt: entry.storedAt, ttlMs: ttl }));
    } catch {
      /* cache cleanup is best-effort */
    }

    return branding;
  } catch {
    removeItem(storage, key);
    return null;
  }
}

/** Writes branding to the cache for a tenant. Silent no-op when storage is absent. */
export function writeBrandingCache(
  tenantId: string,
  branding: Partial<BrandingConfig>,
  ttlMs: number = DEFAULT_TTL_MS,
  now: number = Date.now(),
  source?: string
): void {
  const storage = getStorage();
  if (!storage || !tenantId) {
    return;
  }

  const safeBranding = sanitizeBrandingPayload(branding);
  if (!safeBranding) {
    return;
  }

  const entry: CacheEntry = { branding: safeBranding, storedAt: now, ttlMs };
  try {
    storage.setItem(keyFor(tenantId, source), JSON.stringify(entry));
  } catch {
    /* quota exceeded — ignore, cache is best-effort */
  }
}

/** Clears cached branding for one tenant, or all RT branding keys when omitted. */
export function clearBrandingCache(tenantId?: string, source?: string): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  if (tenantId) {
    if (source) {
      removeItem(storage, keyFor(tenantId, source));
      return;
    }

    const legacyKey = keyFor(tenantId);
    const scopedTenantSuffix = `::${encodeURIComponent(tenantId)}`;
    try {
      const keys: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (
          key &&
          (key === legacyKey || (key.startsWith(CACHE_PREFIX) && key.endsWith(scopedTenantSuffix)))
        ) {
          keys.push(key);
        }
      }
      keys.forEach(key => removeItem(storage, key));
    } catch {
      /* access denied while enumerating storage */
    }
    return;
  }

  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && key.startsWith(CACHE_PREFIX)) {
        keys.push(key);
      }
    }
    keys.forEach(key => removeItem(storage, key));
  } catch {
    /* access denied while enumerating storage */
  }
}

export { CACHE_PREFIX, DEFAULT_TTL_MS };
