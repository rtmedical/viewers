import React from 'react';
import PropTypes from 'prop-types';

import { Logo } from '../../whiteLabeling/Logo';
import { useWhiteLabeling } from '../../whiteLabeling/WhiteLabelingContext';
import { HeaderDropdown, type HeaderMenuItem } from './HeaderDropdown';

export interface CommonHeaderProps {
  /** Patient display name (primary line). */
  patientName?: string;
  /** Secondary patient/study line (e.g. MRN • DOB • StudyDescription). */
  studyInfo?: string;
  /** Items for the "Tarefas" dropdown (export, key images, report, …). */
  tasks?: HeaderMenuItem[];
  /** Items for the settings/overflow menu (About, Preferences, Logout, …). */
  menuItems?: HeaderMenuItem[];
  /** Logged-in user's display name. */
  userName?: string;
  /** Center slot (e.g. toolbar) rendered between branding and the right cluster. */
  children?: React.ReactNode;
  /** Return-to-worklist handler; the back affordance is hidden when omitted. */
  onReturn?: () => void;
  className?: string;
}

/**
 * RT Medical CommonHeader (RTV-153) — a mode-shareable application header.
 *
 * Presentational: live patient/study/user data and task/menu handlers are passed
 * in as props (bind them to OHIF services at the mode level). Branding (logo,
 * product name) comes from the white-labeling context (RTV-156). Carbon-inspired
 * styling via Tailwind utilities only — Carbon is NOT imported, and no
 * @ohif/core / @ohif/app / @ohif/ui source is modified (RTV-114).
 */
export function CommonHeader({
  patientName,
  studyInfo,
  tasks = [],
  menuItems = [],
  userName,
  children,
  onReturn,
  className = '',
}: CommonHeaderProps) {
  const { branding } = useWhiteLabeling();

  return (
    <header
      data-cy="rt-common-header"
      className={`flex h-12 w-full items-center justify-between gap-4 border-b border-white/10 bg-black px-3 text-white ${className}`.trim()}
    >
      {/* Left cluster: optional return + branding + patient/study info. */}
      <div className="flex min-w-0 items-center gap-3">
        {onReturn && (
          <button
            type="button"
            aria-label="Voltar"
            data-cy="rt-common-header-return"
            onClick={onReturn}
            className="rounded px-1 py-1 text-white/80 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-[var(--rt-color-primary,#348cfd)]"
          >
            ←
          </button>
        )}

        <Logo />

        {(patientName || studyInfo) && (
          <div className="ml-1 flex min-w-0 flex-col leading-tight">
            {patientName && (
              <span
                data-cy="rt-common-header-patient"
                className="truncate text-sm font-semibold"
              >
                {patientName}
              </span>
            )}
            {studyInfo && (
              <span
                data-cy="rt-common-header-study"
                className="truncate text-xs text-white/60"
              >
                {studyInfo}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Center slot (toolbar, etc.). */}
      {children && <div className="flex min-w-0 flex-1 items-center justify-center">{children}</div>}

      {/* Right cluster: tasks, settings menu, user. */}
      <div className="flex flex-shrink-0 items-center gap-2">
        {tasks.length > 0 && (
          <HeaderDropdown
            label="Tarefas"
            items={tasks}
            testId="rt-tasks"
          />
        )}

        {menuItems.length > 0 && (
          <HeaderDropdown
            trigger={<span aria-hidden="true">⚙</span>}
            items={menuItems}
            testId="rt-menu"
          />
        )}

        {userName && (
          <span
            data-cy="rt-common-header-user"
            title={userName}
            className="max-w-[160px] truncate text-sm text-white/80"
          >
            {userName}
          </span>
        )}
      </div>

      {/* productName is kept accessible for screen readers even when a logo image is shown. */}
      <span className="sr-only">{branding.productName}</span>
    </header>
  );
}

CommonHeader.propTypes = {
  patientName: PropTypes.string,
  studyInfo: PropTypes.string,
  tasks: PropTypes.array,
  menuItems: PropTypes.array,
  userName: PropTypes.string,
  children: PropTypes.node,
  onReturn: PropTypes.func,
  className: PropTypes.string,
};

export { HeaderDropdown };
export type { HeaderMenuItem };
