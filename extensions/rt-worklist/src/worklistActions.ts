/**
 * Per-study actions: hover row, overflow and context menu — pure core (RTV-190).
 *
 * A supervisor assigns an exam, bumps a priority, re-sends a study to another workstation
 * — all from the list, without opening the viewer. What action is offered, where, and
 * whether it is greyed out or absent is the whole substance of this ticket, so it lives
 * in a resolver rather than in JSX conditionals.
 *
 * ## Hidden and disabled are different answers
 *
 * - **Hidden** — this user can *never* do this. "Cancelar estudo" for a non-admin is not
 *   a greyed-out button; it is not there. A permanently forbidden control teaches the
 *   reader nothing, and it produces support tickets asking why it does not work.
 * - **Disabled, with a reason** — normally available, impossible *right now*. C-MOVE with
 *   no DICOM peers configured is disabled and says so; hiding it would leave the
 *   supervisor hunting for a feature they know exists.
 *
 * Every disabled action therefore carries a `disabledReason`. A greyed control with no
 * explanation is the worst of the three states.
 *
 * ## Destructive actions never appear on hover
 *
 * Hover buttons sit under a moving pointer, in a dense table, on rows that shift as the
 * list refreshes. "Cancelar estudo" one pixel from "Abrir no viewer" is a mis-click
 * waiting to happen — and its consequence is a cancelled exam, which the supervisor then
 * has to explain. Destructive actions are reachable only from the overflow and the
 * context menu, both of which require a deliberate second click, and they declare
 * `confirm: true`.
 *
 * ## Permissions come in through a predicate, not an import
 *
 * The access rules live in `@ohif/extension-rt-governance` (RTV-193). Importing them here
 * would be a cross-extension dependency, which the house rules forbid and which would
 * make this package unusable without that one. Instead the caller passes a
 * {@link CapabilityCheck}; the capability *names* are the contract between the two, and
 * they are exported here so the wiring can be checked at the seam.
 *
 * Framework-free, no React, no `@ohif/*`. Zero-fork per RTV-114.
 */

import { normalizePriority, StudyPriority } from './worklistSla';

export type ActionId =
  | 'open'
  | 'openNewTab'
  | 'openReport'
  | 'assign'
  | 'setPriority'
  | 'sendDicom'
  | 'copyAccession'
  | 'copyPatientId'
  | 'accessHistory'
  | 'cancelStudy';

/**
 * Capability names the host must answer for.
 *
 * Kept as a list so a wiring test can assert the governance side knows every one of
 * them; a capability that is silently unknown to the checker fails closed, which is
 * correct but invisible.
 */
export const ACTION_CAPABILITIES = [
  'study.open',
  'study.report',
  'study.assign',
  'study.setPriority',
  'study.send',
  'study.viewAudit',
  'study.cancel',
] as const;

export type ActionCapability = (typeof ACTION_CAPABILITIES)[number];

/** Answers whether the current user holds a capability. Fails closed when absent. */
export type CapabilityCheck = (capability: ActionCapability) => boolean;

export interface ActionStudy {
  studyInstanceUid: string;
  accessionNumber?: string;
  patientId?: string;
  priority?: unknown;
  assigneeId?: string;
  /** Set once the study is cancelled; a cancelled study accepts almost nothing. */
  cancelled?: boolean;
}

export interface ActionContext {
  study: ActionStudy;
  can: CapabilityCheck;
  /** AE titles configured in RTVW-16. Empty means C-MOVE has nowhere to go. */
  dicomPeers?: string[];
  /** Radiologists that can be assigned right now (presence-filtered by the caller). */
  assignees?: Array<{ id: string; label: string }>;
  /** False while the list is mid-refresh; write actions are held rather than raced. */
  online?: boolean;
}

export interface ResolvedAction {
  id: ActionId;
  label: string;
  icon: string;
  /** Shown on the row on hover. Destructive actions never are — see the module note. */
  hover: boolean;
  /** Opens a submenu (assignees, priorities, peers) instead of firing directly. */
  submenu?: 'assignees' | 'priorities' | 'peers';
  destructive?: boolean;
  /** Needs an explicit confirmation step before firing. */
  confirm?: boolean;
  enabled: boolean;
  /** Why it is greyed out. Always present when `enabled` is false. */
  disabledReason?: string;
}

interface ActionSpec {
  id: ActionId;
  label: string;
  icon: string;
  capability: ActionCapability;
  hover: boolean;
  submenu?: ResolvedAction['submenu'];
  destructive?: boolean;
  confirm?: boolean;
  /** Whether it still makes sense on a cancelled study. */
  allowedWhenCancelled?: boolean;
  /** Returns a reason to disable, or null when it is fine. */
  blockedBy?: (context: ActionContext) => string | null;
}

const ACTION_SPECS: ActionSpec[] = [
  {
    id: 'open',
    label: 'Abrir no viewer',
    icon: 'eye',
    capability: 'study.open',
    hover: true,
    allowedWhenCancelled: true,
  },
  {
    id: 'openNewTab',
    label: 'Abrir em nova aba',
    icon: 'external-link',
    capability: 'study.open',
    hover: false,
    allowedWhenCancelled: true,
  },
  {
    id: 'openReport',
    label: 'Abrir laudo',
    icon: 'document',
    capability: 'study.report',
    hover: true,
    allowedWhenCancelled: true,
  },
  {
    id: 'assign',
    label: 'Atribuir a...',
    icon: 'person',
    capability: 'study.assign',
    hover: true,
    submenu: 'assignees',
    blockedBy: context =>
      (context.assignees ?? []).length ? null : 'Nenhum radiologista disponível.',
  },
  {
    id: 'setPriority',
    label: 'Mudar prioridade',
    icon: 'arrow-up',
    capability: 'study.setPriority',
    hover: true,
    submenu: 'priorities',
  },
  {
    id: 'sendDicom',
    label: 'Enviar DICOM...',
    icon: 'send',
    capability: 'study.send',
    hover: true,
    submenu: 'peers',
    allowedWhenCancelled: true,
    blockedBy: context =>
      (context.dicomPeers ?? []).length ? null : 'Nenhum destino DICOM configurado.',
  },
  {
    id: 'copyAccession',
    label: 'Copiar Accession',
    icon: 'copy',
    capability: 'study.open',
    hover: false,
    allowedWhenCancelled: true,
    blockedBy: context =>
      String(context.study?.accessionNumber ?? '').trim()
        ? null
        : 'Estudo sem Accession Number.',
  },
  {
    id: 'copyPatientId',
    label: 'Copiar Patient ID',
    icon: 'copy',
    capability: 'study.open',
    hover: false,
    allowedWhenCancelled: true,
    blockedBy: context =>
      String(context.study?.patientId ?? '').trim() ? null : 'Estudo sem Patient ID.',
  },
  {
    id: 'accessHistory',
    label: 'Histórico de acesso',
    icon: 'history',
    capability: 'study.viewAudit',
    hover: false,
    allowedWhenCancelled: true,
  },
  {
    id: 'cancelStudy',
    label: 'Cancelar estudo',
    icon: 'trash',
    capability: 'study.cancel',
    hover: false,
    destructive: true,
    confirm: true,
  },
];

const WRITE_ACTIONS: ActionId[] = ['assign', 'setPriority', 'cancelStudy'];

/**
 * Every action this user could ever perform on this study, with its current state.
 *
 * Actions the capability check refuses are **omitted**, not returned disabled — see the
 * module note on hidden versus disabled.
 */
export function resolveActions(context: ActionContext): ResolvedAction[] {
  const study = context?.study;
  if (!study?.studyInstanceUid) {
    return [];
  }
  const can: CapabilityCheck =
    typeof context.can === 'function' ? context.can : () => false;

  const out: ResolvedAction[] = [];
  for (const spec of ACTION_SPECS) {
    if (!can(spec.capability)) {
      continue;
    }

    let disabledReason: string | null = null;
    if (study.cancelled && !spec.allowedWhenCancelled) {
      disabledReason = 'Estudo cancelado.';
    } else if (context.online === false && WRITE_ACTIONS.includes(spec.id)) {
      disabledReason = 'Sem conexão com o RIS.';
    } else if (spec.blockedBy) {
      disabledReason = spec.blockedBy(context);
    }

    out.push({
      id: spec.id,
      label: spec.label,
      icon: spec.icon,
      hover: spec.hover && !spec.destructive,
      submenu: spec.submenu,
      destructive: spec.destructive,
      confirm: spec.confirm,
      enabled: !disabledReason,
      disabledReason: disabledReason ?? undefined,
    });
  }
  return out;
}

/** The default number of icons the row shows before collapsing into `⋯`. */
export const HOVER_ACTION_LIMIT = 5;

/**
 * The icons revealed on row hover.
 *
 * Capped, and disabled actions are pushed out first: a row of five greyed icons is
 * visual noise on every row of a 400-row table. Whatever does not fit stays reachable
 * through the overflow, which {@link overflowActions} returns.
 */
export function hoverActions(
  actions: ResolvedAction[],
  limit = HOVER_ACTION_LIMIT
): ResolvedAction[] {
  const cap = Math.max(0, Math.floor(Number(limit) || 0));
  const candidates = (actions ?? []).filter(a => a.hover);
  const enabled = candidates.filter(a => a.enabled);
  const disabled = candidates.filter(a => !a.enabled);
  return [...enabled, ...disabled].slice(0, cap);
}

/** Everything not on the row: the `⋯` menu. */
export function overflowActions(
  actions: ResolvedAction[],
  limit = HOVER_ACTION_LIMIT
): ResolvedAction[] {
  const shown = new Set(hoverActions(actions, limit).map(a => a.id));
  return (actions ?? []).filter(a => !shown.has(a.id));
}

export interface MenuGroup {
  /** Rendered as a separator boundary; not shown as a heading. */
  id: 'open' | 'clipboard' | 'workflow' | 'transfer' | 'danger';
  actions: ResolvedAction[];
}

const GROUP_OF: Record<ActionId, MenuGroup['id']> = {
  open: 'open',
  openNewTab: 'open',
  openReport: 'open',
  copyAccession: 'clipboard',
  copyPatientId: 'clipboard',
  assign: 'workflow',
  setPriority: 'workflow',
  accessHistory: 'workflow',
  sendDicom: 'transfer',
  cancelStudy: 'danger',
};

const GROUP_ORDER: MenuGroup['id'][] = ['open', 'clipboard', 'workflow', 'transfer', 'danger'];

/**
 * The right-click menu, grouped and separated.
 *
 * The destructive group is last and alone, so the pointer never passes over "Cancelar
 * estudo" on its way to something benign.
 */
export function contextMenu(actions: ResolvedAction[]): MenuGroup[] {
  const groups: MenuGroup[] = [];
  for (const id of GROUP_ORDER) {
    const members = (actions ?? []).filter(a => GROUP_OF[a.id] === id);
    if (members.length) {
      groups.push({ id, actions: members });
    }
  }
  return groups;
}

/**
 * What the clipboard should receive.
 *
 * The **raw** value, never the truncated or formatted cell text: a Patient ID pasted
 * into the RIS search as `12345…` finds nothing, and the reader blames the RIS. Returns
 * null when there is nothing to copy, so the caller does not put an empty string on the
 * clipboard and overwrite whatever the user had there.
 */
export function clipboardValue(study: ActionStudy, actionId: ActionId): string | null {
  const raw =
    actionId === 'copyAccession'
      ? study?.accessionNumber
      : actionId === 'copyPatientId'
        ? study?.patientId
        : undefined;
  const text = String(raw ?? '').trim();
  return text || null;
}

/** Copying a Patient ID is PHI leaving the screen; the caller must audit these. */
export function isAuditableCopy(actionId: ActionId): boolean {
  return actionId === 'copyPatientId';
}

export interface PriorityOption {
  value: StudyPriority;
  label: string;
  /** Current value; shown checked and not re-submitted. */
  current: boolean;
  /**
   * Lowering the priority of an escalated study is a clinical decision someone should
   * own, so it is gated behind a justification rather than being one click.
   */
  requiresJustification: boolean;
}

const PRIORITY_LABELS: Record<StudyPriority, string> = {
  normal: 'Normal',
  urgent: 'Urgente',
  emergency: 'Emergente',
};

const PRIORITY_RANK: Record<StudyPriority, number> = { normal: 0, urgent: 1, emergency: 2 };

/**
 * The priority submenu for a study.
 *
 * Every level is offered, including the current one (shown as current rather than
 * hidden — a menu that omits the current value makes the reader unsure what it is).
 * Downgrades are flagged: see {@link PriorityOption.requiresJustification}.
 */
export function priorityOptions(study: ActionStudy): PriorityOption[] {
  const current = normalizePriority(study?.priority);
  return (['normal', 'urgent', 'emergency'] as StudyPriority[]).map(value => ({
    value,
    label: PRIORITY_LABELS[value],
    current: value === current,
    requiresJustification: PRIORITY_RANK[value] < PRIORITY_RANK[current],
  }));
}

/** Whether a priority change is a downgrade, for the confirmation copy. */
export function isPriorityDowngrade(from: unknown, to: unknown): boolean {
  return PRIORITY_RANK[normalizePriority(to)] < PRIORITY_RANK[normalizePriority(from)];
}
