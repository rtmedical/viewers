import React, { useCallback, useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';

export interface HeaderMenuItem {
  /** Stable id (used as React key and test hook). */
  id: string;
  /** Visible label. */
  label: string;
  /** Selection handler. */
  onClick: () => void;
  /** When true the item is rendered but not selectable. */
  disabled?: boolean;
}

export interface HeaderDropdownProps {
  /** Trigger label (text) — used when no `trigger` node is given. */
  label?: string;
  /** Custom trigger content (e.g. an icon). Overrides `label`. */
  trigger?: React.ReactNode;
  /** Menu items. */
  items: HeaderMenuItem[];
  /** Menu alignment relative to the trigger. */
  align?: 'left' | 'right';
  /** data-cy / test hook prefix. */
  testId?: string;
  className?: string;
}

/**
 * Minimal, accessible dropdown menu. Intentionally dependency-light (no Radix /
 * @ohif/ui-next) so it unit-tests cleanly and keeps the extension self-contained.
 * Carbon-inspired styling via Tailwind utility classes only — Carbon is NOT
 * imported. Closes on outside click and on Escape.
 */
export function HeaderDropdown({
  label,
  trigger,
  items,
  align = 'right',
  testId = 'header-dropdown',
  className = '',
}: HeaderDropdownProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onDocClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        close();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
      }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  const handleSelect = (item: HeaderMenuItem) => {
    if (item.disabled) {
      return;
    }
    item.onClick();
    close();
  };

  return (
    <div
      ref={containerRef}
      className={`relative inline-block ${className}`.trim()}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        data-cy={`${testId}-trigger`}
        onClick={() => setOpen(value => !value)}
        className="flex items-center gap-1 rounded px-2 py-1 text-sm text-white/90 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-[var(--rt-color-primary,#4589ff)]"
      >
        {trigger ?? label}
      </button>

      {open && (
        <ul
          role="menu"
          data-cy={`${testId}-menu`}
          className={`absolute z-50 mt-1 min-w-[200px] rounded border border-white/10 bg-neutral-900 py-1 shadow-lg ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {items.map(item => (
            <li
              key={item.id}
              role="none"
            >
              <button
                type="button"
                role="menuitem"
                disabled={item.disabled}
                data-cy={`${testId}-item-${item.id}`}
                onClick={() => handleSelect(item)}
                className="block w-full px-3 py-2 text-left text-sm text-white/90 hover:bg-[var(--rt-color-primary,#4589ff)]/20 disabled:cursor-not-allowed disabled:text-white/40"
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

HeaderDropdown.propTypes = {
  label: PropTypes.string,
  trigger: PropTypes.node,
  items: PropTypes.array.isRequired,
  align: PropTypes.oneOf(['left', 'right']),
  testId: PropTypes.string,
  className: PropTypes.string,
};
