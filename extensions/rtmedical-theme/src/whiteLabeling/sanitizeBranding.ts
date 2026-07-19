import type { BrandingConfig, BrandingThemeTokens } from './types';

const URL_BASE = 'https://branding.invalid/';
const MAX_URL_LENGTH = 2048;
const MAX_DATA_IMAGE_LENGTH = 256 * 1024;
const SAFE_DATA_IMAGE =
  /^data:image\/(?:avif|bmp|gif|jpe?g|png|webp|x-icon|vnd\.microsoft\.icon);base64,[a-z0-9+/]+={0,2}$/i;
const SAFE_HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

const TEXT_FIELDS = [
  'productName',
  'shortName',
  'logoAlt',
  'supportEmail',
  'websiteLabel',
] as const;
type TextField = (typeof TEXT_FIELDS)[number];

export const BRANDING_TEXT_LIMITS: Record<TextField, number> = {
  productName: 160,
  shortName: 80,
  logoAlt: 240,
  supportEmail: 254,
  websiteLabel: 160,
};

const NAVIGATION_URL_FIELDS = ['logoHref', 'websiteUrl'] as const;
const IMAGE_URL_FIELDS = ['logoUrl', 'logoDarkUrl', 'faviconUrl'] as const;
const THEME_FIELDS: (keyof BrandingThemeTokens)[] = [
  'primary',
  'secondary',
  'background',
  'foreground',
  'highlight',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.slice(0, maxLength);
}

/**
 * Allows same-app relative links and absolute HTTP(S) destinations. Executable
 * and application protocols are rejected before a value reaches an anchor.
 */
export function sanitizeNavigationUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const candidate = value.trim();
  if (!candidate || candidate.length > MAX_URL_LENGTH) {
    return undefined;
  }

  try {
    const parsed = new URL(candidate, URL_BASE);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? candidate : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Applies the navigation URL policy to image resources and additionally permits
 * base64 raster data URIs. SVG data URIs remain blocked because they can contain
 * active or externally-referencing content.
 */
export function sanitizeImageUrl(value: unknown, allowEmpty = false): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const candidate = value.trim();
  if (!candidate) {
    return allowEmpty ? '' : undefined;
  }

  if (candidate.length > MAX_DATA_IMAGE_LENGTH) {
    return undefined;
  }

  if (SAFE_DATA_IMAGE.test(candidate)) {
    return candidate;
  }

  return sanitizeNavigationUrl(candidate);
}

/**
 * Runtime schema for branding received from remote or persisted sources. Only
 * fields consumed by this module are retained, preventing unknown/prototype keys
 * and invalid runtime types from entering the branding merge.
 */
export function sanitizeBrandingPayload(value: unknown): Partial<BrandingConfig> | null {
  if (!isRecord(value)) {
    return null;
  }

  const sanitized: Record<string, unknown> = {};

  TEXT_FIELDS.forEach(field => {
    const fieldValue = sanitizeText(value[field], BRANDING_TEXT_LIMITS[field]);
    if (fieldValue !== undefined) {
      sanitized[field] = fieldValue;
    }
  });

  NAVIGATION_URL_FIELDS.forEach(field => {
    const fieldValue = sanitizeNavigationUrl(value[field]);
    if (fieldValue !== undefined) {
      sanitized[field] = fieldValue;
    }
  });

  IMAGE_URL_FIELDS.forEach(field => {
    const fieldValue = sanitizeImageUrl(value[field], field === 'faviconUrl');
    if (fieldValue !== undefined) {
      sanitized[field] = fieldValue;
    }
  });

  if (isRecord(value.theme)) {
    const theme: Partial<BrandingThemeTokens> = {};
    THEME_FIELDS.forEach(field => {
      const fieldValue = value.theme[field];
      if (typeof fieldValue === 'string') {
        const color = fieldValue.trim();
        if (SAFE_HEX_COLOR.test(color)) {
          theme[field] = color;
        }
      }
    });
    if (Object.keys(theme).length > 0) {
      sanitized.theme = theme;
    }
  }

  return sanitized as Partial<BrandingConfig>;
}
