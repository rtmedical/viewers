import React from 'react';
import PropTypes from 'prop-types';

import { useWhiteLabeling } from './WhiteLabelingContext';
import type { BrandingConfig } from './types';

export interface LogoProps {
  /** Prefer the dark-surface logo variant when available (default true). */
  dark?: boolean;
  /** Extra className appended to the anchor. */
  className?: string;
}

/**
 * Renders the resolved branding logo. When no logo image is configured it falls
 * back to the RT Medical wordmark. Styling uses Tailwind utility classes already
 * present in OHIF — Carbon is NOT imported.
 */
function renderLogo(
  branding: BrandingConfig,
  { dark = true, className = '' }: LogoProps
): JSX.Element {
  const src = (dark && branding.logoDarkUrl) || branding.logoUrl;
  const alt = branding.logoAlt || branding.productName;
  const href = branding.logoHref || '/';

  const label = branding.shortName || branding.productName || 'RT Medical';

  const inner = src ? (
    <img
      src={src}
      alt={alt}
      className="h-8 w-auto"
    />
  ) : (
    <span className="inline-flex items-center gap-2 text-white">
      <span className="flex h-7 w-7 items-center justify-center border border-[#4589ff] bg-[#0f62fe] text-sm font-bold leading-none text-white">
        RT
      </span>
      <span className="text-lg font-semibold tracking-normal">
        {label}
      </span>
    </span>
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
export function Logo({ dark = true, className = '' }: LogoProps) {
  const { branding } = useWhiteLabeling();
  return renderLogo(branding, { dark, className });
}

Logo.propTypes = {
  dark: PropTypes.bool,
  className: PropTypes.string,
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
