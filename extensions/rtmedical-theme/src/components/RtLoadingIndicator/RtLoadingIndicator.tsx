import React from 'react';
import classNames from 'classnames';

export interface RtLoadingIndicatorProps {
  className?: string;
  /** Optional message rendered under the progress bar (stock contract). */
  textBlock?: React.ReactNode;
  /** 0–100; omitted/invalid → indeterminate sliding bar (stock contract). */
  progress?: number;
}

/**
 * RTV-212 — study-load indicator that replaces ui-next's
 * `LoadingIndicatorProgress` via the `'ui.loadingIndicatorProgress'`
 * customization (same props contract). Two differences from stock:
 *
 * - the spinner/progress block is ALWAYS viewport-centered (`inset-0` +
 *   flex centering — the stock `top-0 left-0` box collapses to the top-left
 *   corner whenever the caller forgets `h-full w-full`);
 * - a shell skeleton (left/right rails + 2×2 viewport grid) pulses behind it
 *   so the first paint reads as the upcoming layout instead of a blank page.
 *
 * Styling lives in the injected UI-polish stylesheet (see
 * whiteLabeling/uiPolish.ts) — no @ohif/ui-next imports, no Tailwind-JIT
 * dependency beyond layout utilities already in the app bundle.
 */
function RtLoadingIndicator({ className, textBlock, progress }: RtLoadingIndicatorProps) {
  const pct =
    typeof progress === 'number' && Number.isFinite(progress)
      ? Math.max(0, Math.min(100, progress))
      : null;
  return (
    <div
      className={classNames('absolute inset-0 z-50 overflow-hidden', className)}
      data-cy="rt-loading-indicator"
    >
      <div
        className="rt-skeleton"
        aria-hidden="true"
        data-cy="rt-loading-skeleton"
      >
        <div className="rt-skeleton-rail">
          <div className="rt-skeleton-block" />
          <div className="rt-skeleton-block" />
          <div className="rt-skeleton-block" />
          <div className="rt-skeleton-block" />
        </div>
        <div className="rt-skeleton-grid">
          <div className="rt-skeleton-block" />
          <div className="rt-skeleton-block" />
          <div className="rt-skeleton-block" />
          <div className="rt-skeleton-block" />
        </div>
        <div className="rt-skeleton-rail">
          <div className="rt-skeleton-block" />
          <div className="rt-skeleton-block" />
          <div className="rt-skeleton-block" />
        </div>
      </div>
      <div
        className="rt-loading-center"
        role="status"
        aria-live="polite"
      >
        <div
          className="rt-loading-spinner"
          data-cy="rt-loading-spinner"
        />
        <div className="rt-loading-bar-rail">
          <div
            className="rt-loading-bar"
            data-indeterminate={pct === null ? 'true' : 'false'}
            style={pct === null ? undefined : { width: `${pct}%` }}
          />
        </div>
        {textBlock}
      </div>
    </div>
  );
}

export default RtLoadingIndicator;
