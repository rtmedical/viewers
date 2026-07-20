import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Placeholder for the inline radiology report (laudo) panel.
 *
 * The full rich-text editor + templates + distribution is RTV-121 / RTV-103,
 * which depends on the RT Connect (Laravel) backend — deferred behind a
 * mockable ILaudoClient (see Phase C plan). This stub keeps the radiology
 * mode's 4-panel layout (RTV-118) complete and gives RTV-121 a mount point.
 * Strings come from the RTMedical i18n bundle (en-US source, pt-BR).
 */
export function LaudoPanel(): React.ReactElement {
  const { t } = useTranslation('RTMedical');
  return (
    <div
      className="text-muted-foreground flex h-full flex-col gap-2 p-3 text-sm"
      data-cy="rtmedical-laudo-panel"
    >
      <span className="text-base font-medium text-white">{t('laudo_panel_title')}</span>
      <p>{t('LaudoComingSoon')}</p>
      <p>{t('laudo_backend_note')}</p>
    </div>
  );
}

export default LaudoPanel;
