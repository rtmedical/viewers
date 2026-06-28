import React from 'react';

/**
 * Placeholder for the inline radiology report (laudo) panel.
 *
 * The full rich-text editor + templates + distribution is RTV-121 / RTV-103,
 * which depends on the RT Connect (Laravel) backend — deferred behind a
 * mockable ILaudoClient (see Phase C plan). This stub keeps the radiology
 * mode's 4-panel layout (RTV-118) complete and gives RTV-121 a mount point.
 */
export function LaudoPanel(): React.ReactElement {
  return (
    <div
      className="text-muted-foreground flex h-full flex-col gap-2 p-3 text-sm"
      data-cy="rtmedical-laudo-panel"
    >
      <span className="text-base font-medium text-white">Laudo</span>
      <p>O editor de laudo inline será disponibilizado em RTV-121.</p>
      <p>Depende do backend RT Connect (laudo / templates), integrado via ILaudoClient.</p>
    </div>
  );
}

export default LaudoPanel;
