const URL_SCHEME = /^[a-z][a-z\d+.-]*:/i;

function normalizePathname(value) {
  const pathname = `/${value.replace(/^\/+/, '')}`;
  return `${pathname.replace(/\/+$/, '')}/`;
}

function normalizePublicUrl(value) {
  const base = typeof value === 'string' ? value.trim() : '';
  if (!base) {
    return '/';
  }
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

function getPublicUrlPath(value) {
  const normalized = normalizePublicUrl(value);
  return normalizePathname(new URL(normalized, 'http://localhost').pathname);
}

module.exports = normalizePublicUrl;
module.exports.normalizePublicUrl = normalizePublicUrl;
module.exports.getPublicUrlPath = getPublicUrlPath;
