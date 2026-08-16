/**
 * Remote query and retrieve — pure core (RTV-98).
 *
 * The associations are adapters. What is here is the part that decides whether a query is
 * safe to run, whether a retrieve went where it was meant to, and whether it finished.
 *
 * ## C-MOVE does not send the images to you
 *
 * It sends them to an **AE title**, which the archive resolves through its own
 * configuration. Ask for a study and give a destination the archive maps to the wrong host
 * — a stale entry, a title that belongs to another department's node — and the images are
 * transferred, successfully, to somewhere else. The response says success, because from the
 * archive's point of view it was one.
 *
 * The requester cannot detect this from the response at all. The only evidence is the
 * images arriving, so {@link retrievalOutcome} takes what the local node actually stored
 * and refuses to call a retrieve complete on the archive's word.
 *
 * A privacy consequence follows: sending a patient's study to the wrong AE is a disclosure,
 * and it happens on a successful operation with no error anywhere.
 *
 * ## A truncated result looks exactly like a small one
 *
 * Archives cap result sets. A query that hits the cap comes back as a list, not as an
 * error, and a reader who searched for a patient and got twenty studies has no way to know
 * there were two hundred. {@link assessResults} flags a count that sits exactly on a
 * configured limit, because that is the only signal available.
 *
 * ## Picking from a wildcard result is the wrong-patient risk again
 *
 * `SILVA*` returns hundreds of rows across different people. Choosing from that list has
 * the same shape as choosing from an over-broad worklist in `modalityWorklist.ts`
 * (RTV-99) — and the same absence of any downstream contradiction once the wrong one is
 * opened.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export type QueryLevel = 'patient' | 'study' | 'series' | 'image';

export const LEVEL_LABELS: Record<QueryLevel, string> = {
  patient: 'paciente',
  study: 'estudo',
  series: 'série',
  image: 'imagem',
};

export interface QueryKeys {
  patientName?: string;
  patientId?: string;
  accessionNumber?: string;
  studyInstanceUid?: string;
  /** YYYYMMDD or YYYYMMDD-YYYYMMDD. */
  studyDate?: string;
  modality?: string;
}

export interface QueryPlan {
  level: QueryLevel;
  keys: QueryKeys;
  remoteAe: string;
}

const text = (value: unknown): string => String(value ?? '').trim();
const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};

export interface QueryAssessment {
  ok: boolean;
  /** Keys that actually narrow the search. */
  identifyingKeys: string[];
  wildcards: string[];
  refusals: string[];
  warnings: string[];
}

/** A name wildcard shorter than this matches most of the archive. */
export const MIN_WILDCARD_STEM = 3;

/**
 * Whether a query may be sent.
 *
 * Refuses a query with no identifying key at all: an open study-level C-FIND against a
 * hospital archive returns the institution's work and hands whoever ran it a list of other
 * patients, which is a privacy event before anything is retrieved.
 */
export function assessQuery(plan: QueryPlan): QueryAssessment {
  const keys = plan?.keys ?? {};
  const refusals: string[] = [];
  const warnings: string[] = [];
  const wildcards: string[] = [];

  const identifying = [
    ['patientId', text(keys.patientId)],
    ['accessionNumber', text(keys.accessionNumber)],
    ['studyInstanceUid', text(keys.studyInstanceUid)],
  ]
    .filter(([, v]) => v)
    .map(([k]) => k as string);

  const name = text(keys.patientName);
  const date = text(keys.studyDate);

  if (name.includes('*') || name.includes('?')) {
    wildcards.push('patientName');
    const stem = name.replace(/[*?]/g, '');
    if (stem.length < MIN_WILDCARD_STEM) {
      refusals.push(
        `Curinga de nome com apenas ${stem.length} caractere(s). Isso casa com boa parte do arquivo e devolve uma lista ` +
          'de pacientes que ninguém pediu para ver — é evento de privacidade antes de qualquer recuperação.'
      );
    } else {
      warnings.push(
        `Busca por curinga "${name}": a lista vai misturar pessoas diferentes, e escolher da lista errada tem a mesma forma ` +
          'do erro de selecionar a entrada errada na lista de trabalho — depois de aberto, nada contradiz.'
      );
    }
  }

  if (!identifying.length && !name && !date) {
    refusals.push(
      'Consulta sem nenhuma chave. Um C-FIND aberto contra o arquivo do hospital devolve o trabalho da instituição inteira.'
    );
  }
  if (!identifying.length && !date && name && !wildcards.length) {
    warnings.push('Só nome, sem data: homônimos vêm juntos.');
  }
  if (plan?.level === 'image' && !text(keys.studyInstanceUid)) {
    refusals.push('Consulta em nível de imagem exige o Study Instance UID.');
  }
  if (!text(plan?.remoteAe)) {
    refusals.push('Consulta sem AE remoto.');
  }

  return { ok: refusals.length === 0, identifyingKeys: identifying, wildcards, refusals, warnings };
}

export interface ResultAssessment {
  count: number;
  possiblyTruncated: boolean;
  /** Distinct patients in the result. */
  distinctPatients: number;
  warnings: string[];
  message: string;
}

/**
 * What the result set can and cannot be trusted to say.
 *
 * A result sitting exactly on the archive's cap is the only observable sign of truncation:
 * the archive returns a list, not an error, and twenty studies for a patient who has two
 * hundred looks like a patient with twenty.
 */
export function assessResults(
  results: Array<{ patientId?: string }>,
  archiveLimit?: number
): ResultAssessment {
  const list = (results ?? []).filter(Boolean);
  const count = list.length;
  const limit = num(archiveLimit);
  const distinctPatients = new Set(list.map(r => text(r.patientId)).filter(Boolean)).size;
  const warnings: string[] = [];

  const possiblyTruncated = Number.isFinite(limit) && limit > 0 && count >= limit;
  if (possiblyTruncated) {
    warnings.push(
      `${count} resultado(s), exatamente o limite do arquivo. Resultado truncado volta como lista e não como erro — ` +
        'vinte estudos de um paciente que tem duzentos parecem um paciente com vinte. Estreite a consulta em vez de rolar a lista.'
    );
  }
  if (distinctPatients > 1) {
    warnings.push(`${distinctPatients} pacientes diferentes na mesma lista — confira o identificador, não o nome.`);
  }

  return {
    count,
    possiblyTruncated,
    distinctPatients,
    warnings,
    message: `${count} resultado(s), ${distinctPatients} paciente(s).`,
  };
}

export type RetrieveMethod = 'c-move' | 'c-get' | 'wado';

export const METHOD_LABELS: Record<RetrieveMethod, string> = {
  'c-move': 'C-MOVE (o arquivo envia para um AE configurado)',
  'c-get': 'C-GET (o arquivo devolve na mesma associação)',
  wado: 'WADO-RS (o arquivo devolve na mesma requisição)',
};

/** Methods where the images come back to the requester itself. */
export const SELF_ADDRESSED: RetrieveMethod[] = ['c-get', 'wado'];

export interface DestinationCheck {
  ok: boolean;
  verified: boolean;
  warnings: string[];
  reason?: string;
}

/**
 * Whether a retrieve destination may be used.
 *
 * For C-MOVE the destination is an AE title the **archive** resolves, so the only thing the
 * requester can do beforehand is confirm the title is the one it thinks it is. An
 * unverified destination is refused rather than tried: a successful move to the wrong node
 * is a disclosure that leaves no error behind.
 */
export function checkDestination(input: {
  method: RetrieveMethod;
  destinationAe?: string;
  /** Whether a C-ECHO to that title succeeded, and when. */
  echoedAt?: number;
  now: number;
  echoValidityMs?: number;
}): DestinationCheck {
  const warnings: string[] = [];
  if (SELF_ADDRESSED.includes(input?.method)) {
    return {
      ok: true,
      verified: true,
      warnings: [
        `${METHOD_LABELS[input.method]}: as imagens voltam para quem pediu, então não há destino a errar.`,
      ],
    };
  }

  const destination = text(input?.destinationAe);
  if (!destination) {
    return { ok: false, verified: false, warnings, reason: 'C-MOVE sem AE de destino.' };
  }

  const echoedAt = num(input?.echoedAt);
  const validity = Number.isFinite(num(input?.echoValidityMs)) ? num(input.echoValidityMs) : 24 * 3_600_000;
  const fresh = Number.isFinite(echoedAt) && num(input.now) - echoedAt <= validity;

  if (!fresh) {
    return {
      ok: false,
      verified: false,
      warnings,
      reason:
        `Destino ${destination} não verificado. No C-MOVE o arquivo resolve o AE pela CONFIGURAÇÃO DELE: uma entrada velha ou ` +
        'um título que pertence ao nó de outro setor faz as imagens serem transferidas com sucesso para outro lugar. ' +
        'A resposta diz sucesso, porque do ponto de vista do arquivo foi. Enviar estudo de paciente para o AE errado é divulgação, ' +
        'e acontece numa operação bem-sucedida sem erro nenhum.',
    };
  }

  warnings.push(
    'Verificação do destino confirma que o título responde, não que ele é o nó certo. A evidência final é a imagem chegar.'
  );
  return { ok: true, verified: true, warnings };
}

export type RetrieveState = 'requested' | 'archive-reported' | 'received' | 'incomplete' | 'failed';

export const RETRIEVE_LABELS: Record<RetrieveState, string> = {
  requested: 'solicitado',
  'archive-reported': 'arquivo relatou envio',
  received: 'recebido',
  incomplete: 'incompleto',
  failed: 'falhou',
};

export interface RetrieveOutcome {
  state: RetrieveState;
  /** What the archive said it sent. */
  reportedInstances: number | null;
  /** What the local node actually stored. */
  storedInstances: number;
  missing: number | null;
  complete: boolean;
  message: string;
}

/**
 * Whether a retrieve finished.
 *
 * Decided on what the local node stored, never on the archive's response. The archive
 * reporting a completed sub-operation count means it sent them; where they went is a
 * different question, and it is the question that matters.
 */
export function retrievalOutcome(input: {
  method: RetrieveMethod;
  /** Completed sub-operations reported by the archive, when it reported any. */
  reportedInstances?: number;
  /** Instances the local node has after the transfer. */
  storedInstances: number;
  /** Instances that were expected, from the query result. */
  expectedInstances?: number;
  failed?: boolean;
}): RetrieveOutcome {
  const stored = Math.max(0, Math.floor(num(input?.storedInstances) || 0));
  const reportedRaw = num(input?.reportedInstances);
  const reportedInstances = Number.isFinite(reportedRaw) ? reportedRaw : null;
  const expected = num(input?.expectedInstances);

  if (input?.failed) {
    return {
      state: 'failed',
      reportedInstances,
      storedInstances: stored,
      missing: null,
      complete: false,
      message: 'O arquivo recusou a recuperação.',
    };
  }

  const target = Number.isFinite(expected) && expected > 0 ? expected : reportedInstances;

  if (stored === 0) {
    return {
      state: reportedInstances && reportedInstances > 0 ? 'archive-reported' : 'requested',
      reportedInstances,
      storedInstances: 0,
      missing: target,
      complete: false,
      message:
        reportedInstances && reportedInstances > 0
          ? `O arquivo relatou ${reportedInstances} instância(s) enviada(s) e nada chegou aqui. Num C-MOVE isso é o sintoma ` +
            'de destino errado: a transferência foi bem-sucedida, para outro nó.'
          : 'Nada recebido ainda.',
    };
  }

  if (target !== null && Number.isFinite(target) && stored < target) {
    return {
      state: 'incomplete',
      reportedInstances,
      storedInstances: stored,
      missing: target - stored,
      complete: false,
      message: `${stored} de ${target} instância(s) armazenada(s) — faltam ${target - stored}.`,
    };
  }

  return {
    state: 'received',
    reportedInstances,
    storedInstances: stored,
    missing: 0,
    complete: true,
    message: `${stored} instância(s) armazenada(s) localmente.`,
  };
}

export interface MethodAdvice {
  preferred: RetrieveMethod;
  message: string;
}

/**
 * Which retrieval method to prefer.
 *
 * C-GET and WADO return the images to the requester, which removes the whole class of
 * wrong-destination failure. C-MOVE remains necessary against archives that do not support
 * them, and then the destination has to be verified.
 */
export function preferredMethod(supported: RetrieveMethod[]): MethodAdvice {
  const available = (supported ?? []).filter(m => METHOD_LABELS[m]);
  const selfAddressed = available.find(m => SELF_ADDRESSED.includes(m));
  if (selfAddressed) {
    return {
      preferred: selfAddressed,
      message:
        `${METHOD_LABELS[selfAddressed]} — as imagens voltam para quem pediu, o que elimina toda a classe de falha de destino errado.`,
    };
  }
  return {
    preferred: 'c-move',
    message:
      'Só C-MOVE disponível: o destino precisa ser verificado antes, porque um envio bem-sucedido para o nó errado não deixa erro nenhum.',
  };
}

/** One line for the query/retrieve panel. */
export function describeRetrieve(outcome: RetrieveOutcome): string {
  return `${RETRIEVE_LABELS[outcome.state]}: ${outcome.message}`;
}
