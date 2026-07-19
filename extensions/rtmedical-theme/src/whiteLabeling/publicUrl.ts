const URL_SCHEME = /^[a-z][a-z\d+.-]*:/i;
let configuredRouterBasename: string | undefined;

function normalizePathname(value: string): string {
  const pathname = `/${value.replace(/^\/+/, '')}`;
  let pathnameEnd = pathname.length;

  while (pathnameEnd > 0 && pathname.charCodeAt(pathnameEnd - 1) === 47) {
    pathnameEnd -= 1;
  }

  return `${pathname.slice(0, pathnameEnd)}/`;
}

/** Ensures the deployment base has exactly one trailing slash. */
export function normalizePublicUrl(value: string | undefined): string {
  const base = value?.trim() || '/';
  if (base.includes('?') || base.includes('#') || base.includes('\\') || /\s/.test(base)) {
    throw new Error('PUBLIC_URL must not include a query string, hash, backslash, or whitespace');
  }

  if (URL_SCHEME.test(base)) {
    const parsed = new URL(base);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('PUBLIC_URL must use HTTP(S) or be an absolute path');
    }
    return `${parsed.origin}${normalizePathname(parsed.pathname)}`;
  }

  if (base.startsWith('//')) {
    throw new Error('PUBLIC_URL protocol-relative URLs are not supported');
  }

  return normalizePathname(base);
}

/** Returns the runtime OHIF deployment base, including its trailing slash. */
export function getPublicUrl(): string {
  const runtimeBase =
    typeof window !== 'undefined'
      ? (window as typeof window & { PUBLIC_URL?: string }).PUBLIC_URL
      : '';

  return normalizePublicUrl(runtimeBase);
}

/** Stores OHIF's resolved router basename for extension-owned navigation. */
export function setRouterBasename(value: string | undefined): void {
  configuredRouterBasename = value;
}

function getWindowRouterBasename(): string | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  const runtimeConfig = (
    window as typeof window & {
      config?: { routerBasename?: string } | (() => unknown);
    }
  ).config;

  return typeof runtimeConfig === 'object' ? runtimeConfig?.routerBasename : undefined;
}

/** Returns the same-origin route base even when assets are hosted on a CDN. */
export function getPublicUrlPath(value?: string): string {
  const normalized = normalizePublicUrl(
    value ?? configuredRouterBasename ?? getWindowRouterBasename() ?? getPublicUrl()
  );
  return normalizePathname(new URL(normalized, 'http://localhost').pathname);
}

/** Resolves a static asset without losing subpath deployments such as `/viewer/`. */
export function publicAssetUrl(path: string, base: string = getPublicUrl()): string {
  return `${normalizePublicUrl(base)}${path.replace(/^(?:\.?\/)+/, '')}`;
}
