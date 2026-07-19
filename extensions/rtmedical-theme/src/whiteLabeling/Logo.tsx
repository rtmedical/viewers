import React from 'react';
import PropTypes from 'prop-types';

import { useWhiteLabeling } from './WhiteLabelingContext';
import { getPublicUrlPath } from './publicUrl';
import { sanitizeImageUrl, sanitizeNavigationUrl } from './sanitizeBranding';
import type { BrandingConfig } from './types';

export interface LogoProps {
  /** Prefer the dark-surface logo variant when available (default true). */
  dark?: boolean;
  /** Extra className appended to the anchor. */
  className?: string;
  /** Extra className for an image logo. */
  imageClassName?: string;
}

/**
 * Renders the resolved branding logo. When no logo image is configured it uses
 * the tenant's text label, avoiding cross-tenant identity leakage.
 */
function renderLogo(
  branding: BrandingConfig,
  { dark = true, className = '', imageClassName = '' }: LogoProps
): JSX.Element {
  const darkSrc = sanitizeImageUrl(branding.logoDarkUrl);
  const lightSrc = sanitizeImageUrl(branding.logoUrl);
  const src = (dark && darkSrc) || lightSrc;
  const compactSrc = sanitizeImageUrl(branding.faviconUrl);
  const productName = typeof branding.productName === 'string' ? branding.productName : '';
  const alt = (typeof branding.logoAlt === 'string' && branding.logoAlt) || productName || 'Viewer';
  const href = sanitizeNavigationUrl(branding.logoHref) || getPublicUrlPath();

  const label =
    (typeof branding.shortName === 'string' && branding.shortName) || productName || 'Viewer';

  const inner = src ? (
    <picture className="flex items-center">
      {compactSrc && (
        <source
          media="(max-width: 639px)"
          srcSet={compactSrc}
        />
      )}
      <img
        src={src}
        alt={alt}
        className={`max-w-7 h-7 max-h-7 w-auto object-contain sm:h-10 sm:max-h-10 sm:max-w-[170px] ${imageClassName}`.trim()}
      />
    </picture>
  ) : (
    <span className="max-w-[170px] truncate text-base font-semibold text-white">{label}</span>
  );

  return (
    <a
      href={href}
      target="_self"
      rel="noopener noreferrer"
      aria-label={alt}
      className={`flex items-center ${className}`.trim()}
    >
      {inner}
    </a>
  );
}

/** Branded logo bound to the active white-labeling context. */
export function Logo({ dark = true, className = '', imageClassName = '' }: LogoProps) {
  const { branding } = useWhiteLabeling();
  return renderLogo(branding, { dark, className, imageClassName });
}

Logo.propTypes = {
  dark: PropTypes.bool,
  className: PropTypes.string,
  imageClassName: PropTypes.string,
};

/**
 * Adapter producing an OHIF-native `whiteLabeling.createLogoComponentFn`.
 *
 * This lets resolved branding integrate with @ohif/app's top navbar with ZERO
 * core changes (RTV-114). OHIF calls the returned function with `React`; the
 * branding is captured in the closure so the logo is rendered without needing
 * the provider in that position of the tree.
 */
export function createLogoComponentFn(branding: BrandingConfig) {
  return function whiteLabelLogo(): JSX.Element {
    return renderLogo(branding, { dark: true });
  };
}

export { renderLogo };
