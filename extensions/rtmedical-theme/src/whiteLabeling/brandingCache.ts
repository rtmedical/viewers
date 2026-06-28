import type { BrandingConfig } from './types';

const CACHE_PREFIX = 'rt.whitelabel.branding.';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

interface CacheEntry {
  branding: Partial<BrandingConfig>;
  /** Epoch ms when the entry was stored. */
  storedAt: number;
  /** Time-to-live in ms. */
  ttlMs: number;
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

function keyFor(tenantId: string): string {
  return `${CACHE_PREFIX}${tenantId}`;
}

/**
 * Reads cached branding for a tenant. Returns null when absent, unparseable or
 * expired (expired entries are also removed). `now` is injectable for testing.
 */
export function readBrandingCache(
  tenantId: string,
  now: number = Date.now()
): Partial<BrandingConfig> | null {
  const storage = getStorage();
  if (!storage || !tenantId) {
    return null;
  }

  const raw = storage.getItem(keyFor(tenantId));
  if (!raw) {
    return null;
  }

  try {
    const entry = JSON.parse(raw) as CacheEntry;
    if (!entry || typeof entry.storedAt !== 'number') {
      return null;
    }
    const ttl = typeof entry.ttlMs === 'number' ? entry.ttlMs : DEFAULT_TTL_MS;
    if (now - entry.storedAt > ttl) {
      storage.removeItem(keyFor(tenantId));
      return null;
    }
    return entry.branding ?? null;
  } catch {
    storage.removeItem(keyFor(tenantId));
    return null;
  }
}

/** Writes branding to the cache for a tenant. Silent no-op when storage is absent. */
export function writeBrandingCache(
  tenantId: string,
  branding: Partial<BrandingConfig>,
  ttlMs: number = DEFAULT_TTL_MS,
  now: number = Date.now()
): void {
  const storage = getStorage();
  if (!storage || !tenantId) {
    return;
  }

  const entry: CacheEntry = { branding, storedAt: now, ttlMs };
  try {
    storage.setItem(keyFor(tenantId), JSON.stringify(entry));
  } catch {
    /* quota exceeded — ignore, cache is best-effort */
  }
}

/** Clears cached branding for one tenant, or all RT branding keys when omitted. */
export function clearBrandingCache(tenantId?: string): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  if (tenantId) {
    storage.removeItem(keyFor(tenantId));
    return;
  }

  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && key.startsWith(CACHE_PREFIX)) {
      keys.push(key);
    }
  }
  keys.forEach(key => storage.removeItem(key));
}

export { CACHE_PREFIX, DEFAULT_TTL_MS };
