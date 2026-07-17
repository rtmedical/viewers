/**
 * Hanging-protocol editor core (RTV-23) — pure spec ⇄ protocol conversion.
 *
 * `buildCustomProtocol` turns an editor spec (grid size + one rule slot per
 * viewport, row-major) into an OHIF v3.13 protocol with the exact shape the
 * RTV-25 `gridProtocol` factory emits (it composes gridProtocol and only
 * overrides the per-slot display-set selectors/wiring). Per-slot series
 * matching rules are weighted so that a more specific rule always wins:
 *   SeriesInstanceUID equals (100) > SeriesDescription containsI (40)
 *   > Modality equals (20) > BodyPartExamined equals (15),
 * on top of gridProtocol's numImageFrames>0 (10) baseline rule.
 *
 * `specFromProtocol` is the best-effort inverse (used to load a saved protocol
 * back into the editor) and `validateSpec` guards preview/save. Framework-free
 * and zero-fork (RTV-114): pure data in, pure data out.
 */
import { gridProtocol } from '../hangingProtocols/library';

export interface HpSlotSpec {
  modality?: string;
  bodyPart?: string;
  seriesDescriptionContains?: string;
  seriesInstanceUID?: string;
  /** Which of the slot's matched series to hang (matchedDisplaySetsIndex). */
  seriesIndex?: number;
}

export interface HpEditorSpec {
  id: string;
  name: string;
  rows: number;
  cols: number;
  /** One slot per viewport, row-major; an empty slot renders unmatched. */
  slots: HpSlotSpec[];
}

export const USER_PROTOCOL_PREFIX = 'rt-user-';
export const MAX_VIEWPORTS = 16;

/** Rule weights, strictly ordered most→least specific. */
export const SLOT_RULE_WEIGHTS = {
  seriesInstanceUID: 100,
  seriesDescriptionContains: 40,
  modality: 20,
  bodyPart: 15,
} as const;

/** True when the slot carries at least one editable matching rule. */
export function slotHasRule(slot: HpSlotSpec | undefined | null): boolean {
  return !!(
    slot &&
    (slot.seriesInstanceUID || slot.seriesDescriptionContains || slot.modality || slot.bodyPart)
  );
}

/** The protocol id the builder will emit for a given spec id. */
export function userProtocolId(id: string): string {
  return id.startsWith(USER_PROTOCOL_PREFIX) ? id : `${USER_PROTOCOL_PREFIX}${id}`;
}

function slotSeriesMatchingRules(slot: HpSlotSpec) {
  const rules: Array<Record<string, unknown>> = [
    // Baseline parity with gridProtocol's seriesWithImages selector.
    { weight: 10, attribute: 'numImageFrames', constraint: { greaterThan: { value: 0 } } },
  ];
  if (slot.seriesInstanceUID) {
    rules.push({
      weight: SLOT_RULE_WEIGHTS.seriesInstanceUID,
      attribute: 'SeriesInstanceUID',
      constraint: { equals: { value: slot.seriesInstanceUID } },
    });
  }
  if (slot.seriesDescriptionContains) {
    rules.push({
      weight: SLOT_RULE_WEIGHTS.seriesDescriptionContains,
      attribute: 'SeriesDescription',
      constraint: { containsI: { value: slot.seriesDescriptionContains } },
    });
  }
  if (slot.modality) {
    rules.push({
      weight: SLOT_RULE_WEIGHTS.modality,
      attribute: 'Modality',
      constraint: { equals: { value: slot.modality } },
    });
  }
  if (slot.bodyPart) {
    rules.push({
      weight: SLOT_RULE_WEIGHTS.bodyPart,
      attribute: 'BodyPartExamined',
      constraint: { equals: { value: slot.bodyPart } },
    });
  }
  return rules;
}

/**
 * Builds a structurally-valid protocol from an editor spec. The output is the
 * gridProtocol shape with per-slot selectors: rule slots get their own
 * `slot<k>` displaySetSelector; empty slots keep the shared 'ds' selector so
 * they spread the study's remaining image series (row-major).
 */
export function buildCustomProtocol(spec: HpEditorSpec) {
  const id = userProtocolId(spec.id);
  const modalities = Array.from(
    new Set((spec.slots ?? []).map(slot => slot?.modality).filter(Boolean))
  ) as string[];

  const protocol = gridProtocol({
    id,
    name: spec.name,
    modalities: modalities.length ? modalities : undefined,
    rows: spec.rows,
    cols: spec.cols,
    // Above the RTV-25 library defaults (15) so a user protocol wins matching.
    weight: 20,
  });

  const viewports = protocol.stages[0].viewports as Array<{
    viewportOptions: Record<string, unknown>;
    displaySets: Array<Record<string, unknown>>;
  }>;

  (spec.slots ?? []).slice(0, viewports.length).forEach((slot, k) => {
    if (slotHasRule(slot)) {
      const selectorId = `slot${k}`;
      (protocol.displaySetSelectors as Record<string, unknown>)[selectorId] = {
        allowUnmatchedView: true,
        seriesMatchingRules: slotSeriesMatchingRules(slot),
      };
      viewports[k].displaySets = [
        { id: selectorId, matchedDisplaySetsIndex: slot.seriesIndex ?? 0 },
      ];
    } else if (slot?.seriesIndex != null) {
      // Empty slot with an explicit series order — hang the n-th image series.
      viewports[k].displaySets = [{ id: 'ds', matchedDisplaySetsIndex: slot.seriesIndex }];
    }
  });

  return protocol;
}

function constraintValue(constraint: unknown): string | undefined {
  if (!constraint || typeof constraint !== 'object') {
    return undefined;
  }
  for (const key of ['equals', 'containsI', 'contains']) {
    const entry = (constraint as Record<string, unknown>)[key];
    if (entry == null) {
      continue;
    }
    const value =
      typeof entry === 'object' ? (entry as Record<string, unknown>).value : entry;
    return value == null ? undefined : String(value);
  }
  return undefined;
}

/**
 * Best-effort inverse of buildCustomProtocol so saved protocols can be loaded
 * back into the editor. Accepts both the canonical `columns` and the legacy
 * `cols` layout keys. Returns undefined when the protocol has no usable stage.
 */
export function specFromProtocol(protocol: any): HpEditorSpec | undefined {
  const stage = protocol?.stages?.[0];
  if (!stage) {
    return undefined;
  }
  const properties = stage.viewportStructure?.properties ?? {};
  const stageViewports: any[] = stage.viewports ?? [];
  const rows = Number(properties.rows) || 1;
  const cols =
    Number(properties.columns) ||
    Number(properties.cols) ||
    Math.max(1, Math.ceil(stageViewports.length / rows));

  const slots: HpSlotSpec[] = stageViewports.map((viewport, k) => {
    const slot: HpSlotSpec = {};
    const dsRef = viewport?.displaySets?.[0];
    if (!dsRef) {
      return slot;
    }
    const selector = dsRef.id !== 'ds' ? protocol?.displaySetSelectors?.[dsRef.id] : undefined;
    const matchedIndex = dsRef.matchedDisplaySetsIndex;
    if (selector) {
      for (const rule of selector.seriesMatchingRules ?? []) {
        const value = constraintValue(rule?.constraint);
        if (value == null) {
          continue;
        }
        switch (rule.attribute) {
          case 'SeriesInstanceUID':
            slot.seriesInstanceUID = value;
            break;
          case 'SeriesDescription':
            slot.seriesDescriptionContains = value;
            break;
          case 'Modality':
            slot.modality = value;
            break;
          case 'BodyPartExamined':
            slot.bodyPart = value;
            break;
          default:
            break;
        }
      }
      if (typeof matchedIndex === 'number' && matchedIndex > 0) {
        slot.seriesIndex = matchedIndex;
      }
    } else if (typeof matchedIndex === 'number' && matchedIndex !== k) {
      // gridProtocol's default for viewport k is matchedDisplaySetsIndex k;
      // only a deviation from that encodes an explicit series order.
      slot.seriesIndex = matchedIndex;
    }
    return slot;
  });

  return {
    id: String(protocol.id ?? ''),
    name: String(protocol.name ?? protocol.id ?? ''),
    rows,
    cols,
    slots,
  };
}

/**
 * Validates an editor spec. Returns a list of human-readable errors (empty =
 * valid). With `forSave` (default) the spec must also carry a name and at
 * least one non-empty rule; previews skip those two checks.
 */
export function validateSpec(
  spec: HpEditorSpec,
  { forSave = true }: { forSave?: boolean } = {}
): string[] {
  const errors: string[] = [];
  const rows = Number(spec?.rows);
  const cols = Number(spec?.cols);
  const total = rows * cols;

  if (!Number.isInteger(rows) || !Number.isInteger(cols) || total <= 0) {
    errors.push('Grid must have at least 1 row and 1 column.');
  } else if (total > MAX_VIEWPORTS) {
    errors.push(`Grid has ${total} viewports; the maximum is ${MAX_VIEWPORTS}.`);
  } else if ((spec?.slots?.length ?? 0) > total) {
    errors.push('There are more slots than viewports (slots must fit rows × cols).');
  }

  if (forSave) {
    if (!spec?.name || !String(spec.name).trim()) {
      errors.push('A protocol name is required to save.');
    }
    if (!(spec?.slots ?? []).some(slotHasRule)) {
      errors.push('At least one slot needs a matching rule before saving.');
    }
  }

  return errors;
}
