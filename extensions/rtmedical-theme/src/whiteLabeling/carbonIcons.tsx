/**
 * Carbon icon swap (RTV-7). Overrides OHIF's general-UI / chrome icons with the
 * IBM Carbon icon set (@carbon/icons-react), matching the autoseg look. Uses the
 * public `Icons.addIcon(name, component)` registry mutation (zero fork of
 * ui-next, RTV-114) — addIcon replaces an existing entry (it only warns).
 *
 * Scope: only chrome/general icons that have a faithful Carbon equivalent are
 * swapped. Medical tool icons (length/bidirectional/angle/ROI/window-level/
 * crosshairs/…) and CT/MR window presets have NO Carbon equivalent (Carbon is a
 * general design system), so they keep OHIF's glyphs — which already inherit the
 * Carbon colour + stroke weight from the theme. Carbon icons render
 * `fill="currentColor"`, so they follow `--foreground` automatically.
 */
import React from 'react';
import { Icons } from '@ohif/ui-next';
import {
  ChevronDown,
  ChevronRight,
  ArrowLeft,
  ArrowRight,
  ArrowDown,
  Close,
  Search,
  Settings,
  Information,
  WarningAlt,
  Play,
  Pause,
  Edit,
  TrashCan,
  Link,
  List,
  Launch,
  Copy,
  Camera,
  ZoomIn,
  Move,
  Reset,
  RotateClockwise,
  Rotate,
  Contrast,
  Layers,
  Grid,
  Checkbox,
  CheckboxChecked,
  CheckboxCheckedFilled,
  UserAvatar,
  UserMultiple,
  Power,
  SidePanelClose,
  OverflowMenuVertical,
  Tag,
  Ruler,
} from '@carbon/icons-react';

/**
 * Wrap a Carbon icon so it honours OHIF's `className` (Tailwind h-x w-x sizing,
 * which overrides Carbon's default 32px) and passes through the rest.
 */
const wrap = (Cmp: React.ComponentType<any>) => {
  const Wrapped = ({ className, ...rest }: { className?: string }) => (
    <Cmp
      className={className}
      {...rest}
    />
  );
  Wrapped.displayName = `Carbon(${Cmp.displayName || Cmp.name || 'icon'})`;
  return Wrapped;
};

/** OHIF icon name → Carbon component (chrome/general only). */
const CARBON_ICON_MAP: Record<string, React.ComponentType<any>> = {
  // chevrons / arrows / navigation
  'chevron-down': ChevronDown,
  ChevronDown: ChevronDown,
  'arrow-down': ArrowDown,
  ArrowDown: ArrowDown,
  ChevronRight: ChevronRight,
  'content-next': ChevronRight,
  'next-arrow': ChevronRight,
  'arrow-left': ArrowLeft,
  ArrowLeft: ArrowLeft,
  'content-prev': ArrowLeft,
  'prev-arrow': ArrowLeft,
  'arrow-right': ArrowRight,
  ArrowRightBold: ArrowRight,
  'chevron-menu': OverflowMenuVertical,
  'tool-more-menu': OverflowMenuVertical,
  // close / clear
  close: Close,
  'icon-clear': Close,
  // search
  'icon-search': Search,
  magnifier: Search,
  // settings
  settings: Settings,
  'icon-settings': Settings,
  'actions-setting': Settings,
  'cloud-settings': Settings,
  'settings-study-list': Settings,
  // info / alerts
  info: Information,
  'info-link': Information,
  'notifications-info': Information,
  'launch-info': Information,
  'icon-alert-outline': WarningAlt,
  'icon-alert-small': WarningAlt,
  'status-alert': WarningAlt,
  'status-alert-warning': WarningAlt,
  'icon-status-alert': WarningAlt,
  'notificationwarning-diamond': WarningAlt,
  // media
  play: Play,
  'icon-play': Play,
  pause: Pause,
  'icon-pause': Pause,
  // edit / trash / clipboard
  pencil: Edit,
  'old-trash': TrashCan,
  clipboard: Copy,
  // link / list / launch
  link: Link,
  'icon-link': Link,
  'icon-list-view': List,
  'external-link': Launch,
  // power
  'power-off': Power,
  // patients
  'icon-patient': UserAvatar,
  'tab-patient-info': UserAvatar,
  'icon-multiple-patients': UserMultiple,
  // panel / tag
  'panel-right': SidePanelClose,
  'dicom-tag-browser': Tag,
  // checkboxes
  'checkbox-checked': CheckboxChecked,
  'checkbox-unchecked': Checkbox,
  'checkbox-default': Checkbox,
  'checkbox-active': CheckboxCheckedFilled,
  // chrome-ish tools with faithful Carbon equivalents
  'tool-capture': Camera,
  'tool-zoom': ZoomIn,
  'tool-magnify': ZoomIn,
  'icon-tool-loupe': ZoomIn,
  'tool-quick-magnify': ZoomIn,
  'tool-move': Move,
  'tool-reset': Reset,
  'tool-rotate-right': RotateClockwise,
  'tool-3d-rotate': Rotate,
  'tool-invert': Contrast,
  'tool-layout': Grid,
  'tool-layout-default': Grid,
  'tab-linear': Ruler,
  'tab-segmentation': Layers,
};

/** Registers the Carbon icon overrides. Safe no-op if the registry is absent. */
export function applyCarbonIcons(): void {
  if (!Icons || typeof (Icons as any).addIcon !== 'function') {
    return;
  }
  Object.entries(CARBON_ICON_MAP).forEach(([name, Cmp]) => {
    try {
      (Icons as any).addIcon(name, wrap(Cmp));
    } catch (e) {
      /* non-fatal — keep OHIF's glyph for this one */
    }
  });
}

export { CARBON_ICON_MAP };
