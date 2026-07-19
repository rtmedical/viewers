/**
 * Right-panel UI for the Key Images selection (RTV-148).
 *
 * Thin React layer over the tested core: it subscribes to KeyImageService for
 * live updates and dispatches every mutation through commandsManager (so the
 * same behaviour is reachable from hotkeys/toolbar). All display logic lives in
 * the React-free buildKeyImagesViewModel. RTV-114: depends only on @ohif/ui-next
 * (public UI) and this extension's own primitives — never on core internals.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@ohif/ui-next';
import { KeyImageService } from '../KeyImageService';
import type { KeyImageReference } from '../types';
import { buildKeyImagesViewModel } from './keyImagesViewModel';

interface CommandsManagerLike {
  runCommand: (commandName: string, options?: Record<string, unknown>) => unknown;
}

interface ServicesManagerLike {
  services: Record<string, unknown>;
}

export interface KeyImagesPanelProps {
  servicesManager: ServicesManagerLike;
  commandsManager: CommandsManagerLike;
}

export function KeyImagesPanel({
  servicesManager,
  commandsManager,
}: KeyImagesPanelProps): React.ReactElement {
  const keyImageService = servicesManager.services[KeyImageService.REGISTRATION.name] as
    | KeyImageService
    | undefined;

  const [keyImages, setKeyImages] = useState<KeyImageReference[]>(
    () => keyImageService?.getKeyImages() ?? []
  );

  useEffect(() => {
    if (!keyImageService) {
      return undefined;
    }
    // Re-sync immediately in case the selection changed before this mount.
    setKeyImages(keyImageService.getKeyImages());
    const subscription = keyImageService.subscribe(
      keyImageService.EVENTS.KEY_IMAGES_CHANGED,
      payload => setKeyImages(payload.keyImages ?? [])
    );
    return () => subscription.unsubscribe();
  }, [keyImageService]);

  const handleRemove = useCallback(
    (reference: KeyImageReference) => commandsManager.runCommand('removeKeyImage', { reference }),
    [commandsManager]
  );
  const handleClear = useCallback(
    () => commandsManager.runCommand('clearKeyImages'),
    [commandsManager]
  );
  const handleExport = useCallback(
    () => commandsManager.runCommand('exportKeyImagesToKOS'),
    [commandsManager]
  );

  const viewModel = buildKeyImagesViewModel(keyImages);

  return (
    <div
      className="ohif-scrollbar flex h-full flex-col text-white"
      data-cy="rtmedical-key-images-panel"
    >
      <div className="flex items-center justify-between px-2 py-2">
        <span className="text-base font-medium">Key Images ({viewModel.total})</span>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" disabled={viewModel.isEmpty} onClick={handleExport}>
            Export KOS
          </Button>
          <Button variant="ghost" size="sm" disabled={viewModel.isEmpty} onClick={handleClear}>
            Clear
          </Button>
        </div>
      </div>

      {viewModel.isEmpty ? (
        <div className="text-muted-foreground px-2 py-4 text-sm">No key images selected.</div>
      ) : (
        <div className="flex-1 overflow-auto px-2">
          {viewModel.series.map(series => (
            <div key={series.seriesInstanceUID} className="mb-3">
              <div className="text-muted-foreground mb-1 text-xs uppercase">
                {series.seriesLabel}
              </div>
              <ul className="space-y-1">
                {series.items.map(item => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between rounded bg-black/20 px-2 py-1 text-sm"
                  >
                    <span className="truncate" title={item.label}>
                      {item.label}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove ${item.label}`}
                      onClick={() => handleRemove(item.reference)}
                    >
                      ✕
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default KeyImagesPanel;
