/**
 * Commands for 4D phase navigation and temporal projection (RTV-93, RTV-51).
 *
 * ## What is reused, and what is here
 *
 * Phase navigation itself is **not** reimplemented: `StreamingDynamicImageVolume`
 * exposes a `dimensionGroupNumber` setter, the ui-next `CinePlayer` already
 * renders a phase slider from `displaySet.dynamicVolumeInfo`, and
 * `@cornerstonejs/tools` `playClip` already cines across phases instead of
 * slices. `rt4dSetPhase` is a thin, guarded wrapper so a panel, a hotkey or a
 * toolbar button can drive that same setter.
 *
 * `rt4dTemporalProjection` is the part that does not exist upstream. Cornerstone's
 * `DynamicOperatorType` offers SUM / AVERAGE / SUBTRACT only — no MAX, no MIN —
 * and 4D-CT planning is built on the MIP across the respiratory cycle. The
 * reduction is {@link ./temporalProjection}; this module is the plumbing.
 *
 * ## Reading one phase's voxels
 *
 * There is no public per-phase scalar accessor. `voxelManager.getScalarData()`
 * returns the data for whichever dimension group is *currently* selected, so the
 * only way to read phase N is to select it and read. That makes the read
 * **stateful and visible**: selecting a phase changes what the viewport shows.
 * `withPhaseRestored` therefore saves the reader's phase and puts it back, even
 * if the projection throws. `isDimensionGroupLoaded` is consulted first so an
 * unloaded phase is skipped rather than contributing a buffer of zeros — a
 * streaming volume may not have every phase in memory yet, and silently
 * averaging in zeros would corrupt the projection.
 *
 * Note `dimensionGroupNumber` is **1-based** while the phase indices in
 * {@link ./phaseDetect} are 0-based; the conversion happens here, once.
 */

import { cache, volumeLoader } from '@cornerstonejs/core';

import { detectGating, GatingInfo, PhaseInstanceLike } from './phaseDetect';
import {
  describeProjection,
  PhaseDataSource,
  projectOverPhases,
  resolvePhaseIndices,
  TemporalOperation,
} from './temporalProjection';

interface ServicesManagerLike {
  services: Record<string, any>;
}

export interface CommandResult {
  ok: boolean;
  reason?: string;
}

export interface SetPhaseResult extends CommandResult {
  /** 1-based, as cornerstone counts dimension groups. */
  phase?: number;
  phaseCount?: number;
}

export interface ProjectionResult extends CommandResult {
  description?: string;
  derivedVolumeId?: string;
  /** Phases that actually contributed (unloaded ones are excluded). */
  usedPhases?: number[];
}

interface ActiveDynamic {
  viewportId: string;
  volumeId: string;
  volume: any;
}

function getCommandsModule({ servicesManager }: { servicesManager: ServicesManagerLike }) {
  const services = () => servicesManager?.services ?? {};

  const notify = (message: string, type: 'warning' | 'error' | 'info' = 'warning') => {
    services().uiNotificationService?.show?.({ title: '4D', message, type });
  };

  const fail = (reason: string): CommandResult => {
    notify(reason);
    return { ok: false, reason };
  };

  /** The dynamic volume behind the active viewport, or `null`. */
  function activeDynamic(): ActiveDynamic | null {
    const { viewportGridService, cornerstoneViewportService, displaySetService } = services();
    const viewportId = viewportGridService?.getActiveViewportId?.();
    if (!viewportId) {
      return null;
    }

    // The volume id is derivable from the display set; ask the viewport first,
    // since that is what the reader is actually looking at.
    const viewport = cornerstoneViewportService?.getCornerstoneViewport?.(viewportId);
    const volumeIds: string[] = viewport?.getAllVolumeIds?.() ?? [];

    for (const volumeId of volumeIds) {
      const volume = cache?.getVolume?.(volumeId);
      if (volume && Number(volume.numDimensionGroups) > 1) {
        return { viewportId, volumeId, volume };
      }
    }

    // Fallback: a display set flagged dynamic by the SOP class handler.
    const state = viewportGridService?.getState?.();
    const uids: string[] = state?.viewports?.get?.(viewportId)?.displaySetInstanceUIDs ?? [];
    for (const uid of uids) {
      const displaySet = displaySetService?.getDisplaySetByUID?.(uid);
      if (!displaySet?.isDynamicVolume) {
        continue;
      }
      const volumeId = `${displaySet.volumeLoaderSchema}:${uid}`;
      const volume = cache?.getVolume?.(volumeId);
      if (volume) {
        return { viewportId, volumeId, volume };
      }
    }

    return null;
  }

  /** Runs `body` with the volume on `phase`, always restoring the reader's phase. */
  function withPhaseRestored<T>(volume: any, body: () => T): T {
    const original = volume.dimensionGroupNumber;
    try {
      return body();
    } finally {
      try {
        volume.dimensionGroupNumber = original;
      } catch {
        // Restoring is best-effort: a disposed volume must not mask the real error.
      }
    }
  }

  /**
   * A {@link PhaseDataSource} over a dynamic volume.
   *
   * `getPhaseData` selects the dimension group and returns the *live* scalar
   * buffer, which cornerstone may reuse between groups. That is safe only because
   * `projectOverPhases` consumes each phase fully before asking for the next.
   */
  function phaseSourceFor(volume: any): PhaseDataSource {
    const phaseCount = Math.max(0, Number(volume?.numDimensionGroups) || 0);
    const voxelManager = volume?.voxelManager;
    const voxelCount = Number(voxelManager?.getScalarDataLength?.() ?? 0);

    return {
      phaseCount,
      voxelCount,
      getPhaseData: (phaseIndex: number) => {
        const dimensionGroupNumber = phaseIndex + 1; // cornerstone counts from 1
        if (volume.isDimensionGroupLoaded?.(dimensionGroupNumber) === false) {
          return undefined;
        }
        volume.dimensionGroupNumber = dimensionGroupNumber;
        return voxelManager?.getScalarData?.();
      },
    };
  }

  const actions = {
    /** Reports the gating of the active viewport's display set. */
    rt4dDetectGating: (): GatingInfo => {
      const { viewportGridService, displaySetService } = services();
      const viewportId = viewportGridService?.getActiveViewportId?.();
      const state = viewportGridService?.getState?.();
      const uids: string[] = state?.viewports?.get?.(viewportId)?.displaySetInstanceUIDs ?? [];

      for (const uid of uids) {
        const displaySet = displaySetService?.getDisplaySetByUID?.(uid);
        const instances: PhaseInstanceLike[] = displaySet?.instances ?? [];
        const info = detectGating(instances);
        if (info.isGated) {
          return info;
        }
      }
      return detectGating([]);
    },

    /** Selects a phase (1-based) on the active dynamic volume. */
    rt4dSetPhase: ({ phase }: { phase: number }): SetPhaseResult => {
      const active = activeDynamic();
      if (!active) {
        return fail('No 4D volume in the active viewport.');
      }

      const phaseCount = Math.max(0, Number(active.volume.numDimensionGroups) || 0);
      const requested = Math.floor(Number(phase));
      if (!Number.isFinite(requested) || requested < 1 || requested > phaseCount) {
        return {
          ...fail(`Phase ${phase} is outside 1-${phaseCount}.`),
          phaseCount,
        };
      }

      try {
        active.volume.dimensionGroupNumber = requested;
        services().cornerstoneViewportService?.getRenderingEngine?.()?.render?.();
      } catch (error) {
        return fail(`Could not set the phase: ${(error as Error)?.message ?? 'unknown error'}`);
      }

      return { ok: true, phase: requested, phaseCount };
    },

    /** Steps the phase by `delta`, wrapping around the cycle. */
    rt4dStepPhase: ({ delta = 1 }: { delta?: number } = {}): SetPhaseResult => {
      const active = activeDynamic();
      if (!active) {
        return fail('No 4D volume in the active viewport.');
      }
      const phaseCount = Math.max(1, Number(active.volume.numDimensionGroups) || 1);
      const current = Math.max(1, Number(active.volume.dimensionGroupNumber) || 1);
      // Wrap, because a respiratory cycle is a loop — stopping at 100% is wrong.
      const next = ((current - 1 + Math.floor(delta || 0)) % phaseCount + phaseCount) % phaseCount + 1;
      return actions.rt4dSetPhase({ phase: next });
    },

    /**
     * Projects the selected phases into a derived volume (MIP / MinIP / AvgIP / SUM).
     * Async: creating the derived volume is.
     */
    rt4dTemporalProjection: async ({
      operation = 'MIP',
      phaseIndices,
    }: {
      operation?: TemporalOperation;
      phaseIndices?: number[];
    } = {}): Promise<ProjectionResult> => {
      const active = activeDynamic();
      if (!active) {
        return fail('No 4D volume in the active viewport.');
      }

      const source = phaseSourceFor(active.volume);
      const indices = resolvePhaseIndices(source, phaseIndices);
      if (!indices.length) {
        return fail('No phases selected.');
      }
      if (!source.voxelCount) {
        return fail('The 4D volume has no voxel data loaded yet.');
      }

      const derivedVolumeId = `${active.volumeId}-rt4d-${operation}`;

      try {
        let projected: Float32Array | undefined;
        const used: number[] = [];

        withPhaseRestored(active.volume, () => {
          // Track which phases were actually available, so the description does
          // not claim phases that were skipped for not being loaded.
          const tracking: PhaseDataSource = {
            ...source,
            getPhaseData: (i: number) => {
              const data = source.getPhaseData(i);
              if (data) {
                used.push(i);
              }
              return data;
            },
          };
          projected = projectOverPhases(tracking, operation, { phaseIndices: indices });
        });

        if (!used.length || !projected) {
          return fail('None of the selected phases are loaded yet.');
        }

        let derived = cache?.getVolume?.(derivedVolumeId);
        if (!derived) {
          derived = await volumeLoader.createAndCacheDerivedVolume(active.volumeId, {
            volumeId: derivedVolumeId,
          });
        }

        // `.set` converts into whatever scalar type the derived volume uses, which
        // is why the projection is computed into its own Float32Array first.
        derived.voxelManager?.getScalarData?.()?.set?.(projected);
        derived.modified?.();
        services().cornerstoneViewportService?.getRenderingEngine?.()?.render?.();

        return {
          ok: true,
          derivedVolumeId,
          usedPhases: used,
          description: describeProjection(operation, used),
        };
      } catch (error) {
        return fail(`Projection failed: ${(error as Error)?.message ?? 'unknown error'}`);
      }
    },

    /** MIP across every phase — the ITV view. */
    rt4dTemporalMip: () => actions.rt4dTemporalProjection({ operation: 'MIP' }),
    /** MinIP across every phase. */
    rt4dTemporalMinIp: () => actions.rt4dTemporalProjection({ operation: 'MinIP' }),
    /** Average across every phase. */
    rt4dTemporalAvg: () => actions.rt4dTemporalProjection({ operation: 'AvgIP' }),
  };

  const definitions = Object.keys(actions).reduce(
    (acc, name) => {
      acc[name] = { commandFn: actions[name as keyof typeof actions], storeContexts: [], options: {} };
      return acc;
    },
    {} as Record<string, { commandFn: unknown; storeContexts: string[]; options: Record<string, never> }>
  );

  return { actions, definitions, defaultContext: 'CORNERSTONE' };
}

export default getCommandsModule;
