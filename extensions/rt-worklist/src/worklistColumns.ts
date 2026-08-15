/**
 * Worklist column profiles — pure core (RTV-184).
 *
 * Different readers need different columns: a radiologist wants priority, report status
 * and time-to-deadline; an RT physicist wants plan, dose, machine and fraction; a
 * technologist wants scheduled time, room and acquisition status. One fixed column set
 * serves none of them well.
 *
 * A profile is *which columns, in what order, at what width*, resolved per group with a
 * personal override on top. Same persistence seam as the saved views: a `ProfileStore`
 * with two methods, localStorage today, the Connect endpoints
 * (`/api/worklist-profiles/{group}`) later, with no change to the logic here.
 *
 * Framework-free. Zero-fork per RTV-114.
 */

/** Where a column's value comes from. */
export type ColumnSource = 'dicom' | 'ris' | 'computed';

export interface ColumnDefinition {
  id: string;
  label: string;
  source: ColumnSource;
  /** Default width in px. */
  width: number;
  /** Cannot be hidden — without it a row is unidentifiable. */
  required?: boolean;
  sortable?: boolean;
}

/**
 * The full pool a profile can draw from.
 *
 * `patientName` and `studyDate` are required: a worklist row with neither is a row the
 * reader cannot act on, and letting a profile hide both would produce a table of
 * anonymous stripes.
 */
export const COLUMN_POOL: ColumnDefinition[] = [
  { id: 'patientName', label: 'Paciente', source: 'dicom', width: 220, required: true, sortable: true },
  { id: 'mrn', label: 'Prontuário', source: 'dicom', width: 120, sortable: true },
  { id: 'birthDate', label: 'Nascimento', source: 'dicom', width: 110, sortable: true },
  { id: 'accession', label: 'Accession', source: 'dicom', width: 140, sortable: true },
  { id: 'studyDate', label: 'Data', source: 'dicom', width: 110, required: true, sortable: true },
  { id: 'studyTime', label: 'Hora', source: 'dicom', width: 80, sortable: true },
  { id: 'modality', label: 'Modalidade', source: 'dicom', width: 100, sortable: true },
  { id: 'description', label: 'Descrição', source: 'dicom', width: 260 },
  { id: 'bodyPart', label: 'Região', source: 'dicom', width: 120, sortable: true },
  { id: 'numSeries', label: 'Séries', source: 'dicom', width: 80, sortable: true },
  { id: 'numInstances', label: 'Imagens', source: 'dicom', width: 90, sortable: true },
  { id: 'institution', label: 'Instituição', source: 'dicom', width: 180, sortable: true },
  { id: 'referrer', label: 'Solicitante', source: 'ris', width: 180, sortable: true },
  { id: 'assignee', label: 'Radiologista', source: 'ris', width: 160, sortable: true },
  { id: 'priority', label: 'Prioridade', source: 'ris', width: 110, sortable: true },
  { id: 'reportStatus', label: 'Laudo', source: 'ris', width: 120, sortable: true },
  { id: 'room', label: 'Sala', source: 'ris', width: 90, sortable: true },
  { id: 'scheduledAt', label: 'Agendado', source: 'ris', width: 130, sortable: true },
  { id: 'rtPlan', label: 'Plano', source: 'ris', width: 160 },
  { id: 'rtMachine', label: 'Máquina', source: 'ris', width: 120, sortable: true },
  { id: 'rtFraction', label: 'Fração', source: 'ris', width: 90, sortable: true },
  { id: 'rtDose', label: 'Dose', source: 'ris', width: 100, sortable: true },
  { id: 'sla', label: 'Prazo', source: 'computed', width: 110, sortable: true },
  { id: 'age', label: 'Idade', source: 'computed', width: 80, sortable: true },
];

const POOL_BY_ID = new Map(COLUMN_POOL.map(c => [c.id, c]));

export const REQUIRED_COLUMN_IDS = COLUMN_POOL.filter(c => c.required).map(c => c.id);

export const COLUMN_MIN_WIDTH = 60;
export const COLUMN_MAX_WIDTH = 600;

export interface ProfileColumn {
  id: string;
  visible: boolean;
  width: number;
}

export interface WorklistProfile {
  /** Group/role key, or `__personal__` for the per-user override. */
  id: string;
  label?: string;
  columns: ProfileColumn[];
}

export const PERSONAL_PROFILE_ID = '__personal__';

/** The built-in profiles, one per role. */
export const DEFAULT_PROFILES: Record<string, string[]> = {
  radiologist: [
    'priority',
    'patientName',
    'mrn',
    'studyDate',
    'modality',
    'description',
    'reportStatus',
    'sla',
    'assignee',
  ],
  rtPhysicist: [
    'patientName',
    'mrn',
    'studyDate',
    'rtPlan',
    'rtMachine',
    'rtFraction',
    'rtDose',
    'modality',
  ],
  technologist: ['scheduledAt', 'room', 'patientName', 'mrn', 'modality', 'description', 'studyDate'],
  admin: COLUMN_POOL.map(c => c.id),
};

export function findColumn(id: string): ColumnDefinition | undefined {
  return POOL_BY_ID.get(id);
}

export function clampColumnWidth(width: unknown, fallback = 120): number {
  const value = Number(width);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(COLUMN_MAX_WIDTH, Math.max(COLUMN_MIN_WIDTH, Math.round(value)));
}

/** Builds a profile from a list of column ids, in that order. */
export function profileFromIds(id: string, ids: string[], label?: string): WorklistProfile {
  const seen = new Set<string>();
  const columns: ProfileColumn[] = [];
  for (const columnId of ids ?? []) {
    const definition = findColumn(columnId);
    if (!definition || seen.has(columnId)) {
      continue;
    }
    seen.add(columnId);
    columns.push({ id: columnId, visible: true, width: definition.width });
  }
  // Everything else stays in the profile but hidden, so the column editor can offer
  // it without needing a second list of "available" columns. Required columns are the
  // exception: they come back VISIBLE even when the caller left them out, so this
  // function upholds the same invariant as sanitizeProfile and a profile survives a
  // save/load round-trip unchanged.
  for (const definition of COLUMN_POOL) {
    if (!seen.has(definition.id)) {
      columns.push({ id: definition.id, visible: !!definition.required, width: definition.width });
    }
  }
  return { id, label, columns };
}

/** The default profile for a role, falling back to the radiologist set. */
export function defaultProfile(role?: string): WorklistProfile {
  const key = String(role ?? '').trim() || 'radiologist';
  const ids = DEFAULT_PROFILES[key] ?? DEFAULT_PROFILES.radiologist;
  return profileFromIds(key, ids, key);
}

/**
 * Drops junk and guarantees the required columns are visible.
 *
 * A stored profile can be hand-edited or come from an older build with a column this
 * one no longer has. Unknown ids are dropped; required ids are forced back to visible,
 * because a table of rows with no patient name and no date is not a worklist.
 */
export function sanitizeProfile(raw: unknown, id = PERSONAL_PROFILE_ID): WorklistProfile {
  const candidate = raw as Partial<WorklistProfile> | null;
  const seen = new Set<string>();
  const columns: ProfileColumn[] = [];

  for (const entry of candidate?.columns ?? []) {
    const columnId = typeof entry?.id === 'string' ? entry.id : '';
    const definition = findColumn(columnId);
    if (!definition || seen.has(columnId)) {
      continue;
    }
    seen.add(columnId);
    columns.push({
      id: columnId,
      visible: definition.required ? true : entry.visible !== false,
      width: clampColumnWidth(entry.width, definition.width),
    });
  }

  for (const definition of COLUMN_POOL) {
    if (!seen.has(definition.id)) {
      columns.push({
        id: definition.id,
        visible: !!definition.required,
        width: definition.width,
      });
    }
  }

  return {
    id: typeof candidate?.id === 'string' && candidate.id ? candidate.id : id,
    label: typeof candidate?.label === 'string' ? candidate.label : undefined,
    columns,
  };
}

/**
 * Merges a personal override onto a group profile.
 *
 * The personal profile wins on visibility and width, and its *order* wins for the
 * columns it mentions — but a column the group profile shows and the personal one has
 * never touched stays visible. A new column added to the group profile should appear
 * for everyone, not stay hidden because someone saved a personal layout last year.
 */
export function resolveProfile(
  group: WorklistProfile,
  personal?: WorklistProfile | null
): WorklistProfile {
  const base = sanitizeProfile(group, group?.id ?? 'group');
  if (!personal?.columns?.length) {
    return base;
  }
  const overrides = new Map(
    sanitizeProfile(personal, PERSONAL_PROFILE_ID).columns.map(c => [c.id, c])
  );
  const personalOrder = (personal.columns ?? []).map(c => c.id).filter(id => findColumn(id));
  const ordered = [
    ...personalOrder,
    ...base.columns.map(c => c.id).filter(id => !personalOrder.includes(id)),
  ];

  const columns = ordered
    .map(id => {
      const fromBase = base.columns.find(c => c.id === id);
      const override = overrides.get(id);
      const definition = findColumn(id)!;
      if (!fromBase && !override) {
        return null;
      }
      const touchedPersonally = personalOrder.includes(id);
      return {
        id,
        visible: definition.required
          ? true
          : touchedPersonally
            ? !!override?.visible
            : !!fromBase?.visible,
        width: override?.width ?? fromBase?.width ?? definition.width,
      };
    })
    .filter(Boolean) as ProfileColumn[];

  return { id: base.id, label: base.label, columns };
}

/** Visible columns, in order, joined with their definitions. */
export function visibleColumns(profile: WorklistProfile): Array<ColumnDefinition & ProfileColumn> {
  return (profile?.columns ?? [])
    .filter(c => c.visible)
    .map(c => {
      const definition = findColumn(c.id);
      return definition ? { ...definition, ...c } : null;
    })
    .filter(Boolean) as Array<ColumnDefinition & ProfileColumn>;
}

/** Moves a column to a new index. Both indices are clamped. */
export function moveColumn(profile: WorklistProfile, fromIndex: number, toIndex: number): WorklistProfile {
  const columns = [...(profile?.columns ?? [])];
  const from = Math.floor(fromIndex);
  if (!columns.length || from < 0 || from >= columns.length) {
    return profile;
  }
  const to = Math.min(columns.length - 1, Math.max(0, Math.floor(toIndex)));
  if (from === to) {
    return profile;
  }
  const [moved] = columns.splice(from, 1);
  columns.splice(to, 0, moved);
  return { ...profile, columns };
}

/** Shows or hides a column. Required columns cannot be hidden. */
export function setColumnVisible(
  profile: WorklistProfile,
  id: string,
  visible: boolean
): WorklistProfile {
  const definition = findColumn(id);
  if (!definition) {
    return profile;
  }
  return {
    ...profile,
    columns: (profile?.columns ?? []).map(c =>
      c.id === id ? { ...c, visible: definition.required ? true : visible } : c
    ),
  };
}

/** Sets a column width, clamped. */
export function setColumnWidth(profile: WorklistProfile, id: string, width: number): WorklistProfile {
  const definition = findColumn(id);
  if (!definition) {
    return profile;
  }
  return {
    ...profile,
    columns: (profile?.columns ?? []).map(c =>
      c.id === id ? { ...c, width: clampColumnWidth(width, definition.width) } : c
    ),
  };
}

/** Persistence seam — localStorage today, `/api/worklist-profiles/{group}` later. */
export interface ProfileStore {
  load(id: string): WorklistProfile | null;
  save(profile: WorklistProfile): void;
}

export const PROFILE_STORAGE_PREFIX = 'rt.worklistProfile.v1.';

export function createLocalProfileStore(storage?: Storage): ProfileStore {
  const memory = new Map<string, WorklistProfile>();
  const resolve = (): Storage | null => {
    try {
      return storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
    } catch {
      return null;
    }
  };

  return {
    load(id: string): WorklistProfile | null {
      const target = resolve();
      if (!target) {
        return memory.get(id) ?? null;
      }
      try {
        const raw = target.getItem(PROFILE_STORAGE_PREFIX + id);
        return raw ? sanitizeProfile(JSON.parse(raw), id) : null;
      } catch {
        return null;
      }
    },
    save(profile: WorklistProfile): void {
      memory.set(profile.id, profile);
      try {
        resolve()?.setItem(PROFILE_STORAGE_PREFIX + profile.id, JSON.stringify(profile));
      } catch {
        // A full quota must not stop the reader from working.
      }
    },
  };
}
