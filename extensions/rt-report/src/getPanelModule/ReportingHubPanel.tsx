/**
 * Reporting Hub right-panel (RTV-222) — a fila de laudos do plantao.
 *
 * O nucleo puro `../hubQueue` decide tudo que e decisao: validacao das linhas, SLA,
 * ordenacao, contagens e escalacao. Este componente **nao recalcula nada** — ele renderiza
 * o que o nucleo devolve. As decisoes que sobram para a camada de UI sao as de
 * apresentacao, e cada uma abaixo existe por um modo de falha que a implementacao obvia
 * produz.
 *
 * ## Fila vazia e fila nao carregada nao podem compartilhar um ramo
 *
 * E o modo de falha central do ticket. Uma lista vazia porque nao ha nada pendente e uma
 * lista vazia porque a consulta falhou aparecem **identicas na tela**, e a segunda faz o
 * radiologista concluir que nao ha trabalho critico esperando, fechar o viewer, e os
 * estudos ficarem sem laudo.
 *
 * Por isso a prop `queue` e um estado de carregamento **explicito** ({@link HubPanelQueue})
 * em vez de um array com um booleano ao lado: `loading`, `failed` com motivo, e `loaded`
 * com as linhas. Nao existe caminho em que um array vazio chegue aqui sem dizer se foi
 * carregado. Um `rows: []` com `status: 'failed'` e impossivel de construir.
 *
 * ## O relogio nao pode andar durante o render
 *
 * O SLA depende de `nowMs`. Se este componente chamasse o relogio dentro do render, cada
 * re-render recalcularia atrasos e **reordenaria as linhas debaixo do cursor** — o
 * radiologista clica numa linha e abre outra, porque a lista se mexeu entre o mousedown e
 * o mouseup. O instante entra por prop, e quando nao entra e capturado **uma vez** na
 * montagem e so avanca por um ato explicito (o botao "Atualizar"). A hora do calculo fica
 * visivel no cabecalho, porque uma fila com SLA de dez minutos atras nao pode parecer
 * atual.
 *
 * ## Toda contagem viaja com o seu recorte
 *
 * O nucleo **recusa** resumir sem contexto de filtro, e a razao vale repetir aqui: o cracha
 * "12 atrasados" sai da tela numa passagem de plantao verbal como numero do departamento, e
 * o dimensionamento de equipe segue a figura errada. O escopo e renderizado colado ao
 * numero, nunca abaixo dele nem num tooltip.
 *
 * ## O que a UI e obrigada a mostrar mesmo sendo feio
 *
 * - **`orderingNote`**: sem ela, um STAT de quatro minutos acima de uma rotina de tres dias
 *   parece ordenacao quebrada, e alguem "conserta" ordenando por atraso.
 * - **`countsSumNote`**: as contagens por marcador quase nunca somam o total de linhas,
 *   porque uma linha carrega varios marcadores. Sem a nota, alguem reconcilia e abre um bug.
 * - **`unknownFlags`**: um servidor mais novo manda um marcador que este build nao conhece.
 *   Descartar esconde trabalho; a fila mostra que existe algo que ela nao sabe classificar.
 * - **`unmeasurableKeys`**: linha cujo SLA nao pode ser medido com o relogio escolhido nao
 *   pode ser desenhada como "em dia" — ela e listada como nao mensuravel.
 *
 * ## Strings
 *
 * O texto vem do nucleo, que ja e pt-BR, e os rotulos estruturais estao em pt-BR literal em
 * vez de `react-i18next`. Deliberado: inventar chaves de traducao que nao existem nos
 * bundles renderizaria a propria chave na tela, que e pior que uma string fixa num produto
 * que hoje e monolingue. Trocar por i18n depois e mecanico.
 *
 * Sem import de outra extensao (RTV-114). Nao modifica `@ohif/core`, `@ohif/ui` nem
 * `@ohif/ui-next`.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  HUB_PRIORITY_LABELS,
  HUB_FLAG_LABELS,
  HUB_SLA_LABELS,
  HUB_CRITICAL_FLAG,
  hubComputeSla,
  hubSortQueue,
  hubSummarizeQueue,
  type HubFilterContext,
  type HubNormalizedRow,
  type HubPriority,
  type HubQueueRow,
  type HubQueueSummary,
  type HubReportFlag,
  type HubSlaReference,
  type HubSortedQueue,
} from '../hubQueue';

/* ------------------------------------------------------------------ */
/* Props                                                              */
/* ------------------------------------------------------------------ */

/**
 * Estado de carregamento da fila, explicito por construcao.
 *
 * Nao e `{ rows, loading, error }`: essa forma permite `rows: []` com `error` preenchido, e
 * e exatamente a combinacao que faz um painel desenhar "nenhum estudo" sobre uma falha.
 */
export type HubPanelQueue =
  | { status: 'loading' }
  | { status: 'failed'; reason: string }
  | { status: 'loaded'; rows: readonly HubQueueRow[] };

export interface ReportingHubPanelProps {
  /** Fila e seu estado de carregamento. */
  queue: HubPanelQueue;
  /** Recorte ativo. Obrigatorio: o nucleo recusa resumir sem ele. */
  filter: HubFilterContext;
  /** Relogio de referencia do SLA. */
  slaReference?: HubSlaReference;
  /** Instante do calculo. Ausente: capturado uma vez na montagem. */
  nowMs?: number;
  /** Chamado quando o usuario pede uma atualizacao explicita. */
  onRefresh?: () => void;
  /** Chamado ao escolher um estudo da fila. */
  onOpenStudy?: (row: HubNormalizedRow) => void;
  servicesManager?: { services: Record<string, unknown> };
}

/* ------------------------------------------------------------------ */
/* Apresentacao                                                       */
/* ------------------------------------------------------------------ */

const PRIORITY_TONE: Readonly<Record<HubPriority, string>> = {
  stat: 'rt-hub-priority-stat',
  urgent: 'rt-hub-priority-urgent',
  unspecified: 'rt-hub-priority-unspecified',
  routine: 'rt-hub-priority-routine',
};

function flagLabel(flag: HubReportFlag | string): string {
  return HUB_FLAG_LABELS[flag as HubReportFlag] ?? flag;
}

/* ------------------------------------------------------------------ */
/* Componente                                                         */
/* ------------------------------------------------------------------ */

export default function ReportingHubPanel({
  queue,
  filter,
  slaReference = 'imagesArrived',
  nowMs,
  onRefresh,
  onOpenStudy,
}: ReportingHubPanelProps): JSX.Element {
  // Capturado UMA VEZ. Ver o cabecalho: relogio lido no render reordena a fila debaixo do
  // cursor entre o mousedown e o mouseup.
  const [capturedNow] = useState<number>(() => (typeof nowMs === 'number' ? nowMs : Date.now()));
  const effectiveNow = typeof nowMs === 'number' ? nowMs : capturedNow;

  const rows: readonly HubQueueRow[] = queue.status === 'loaded' ? queue.rows : [];

  // Uma chamada por nucleo, e dela saem o valor e a recusa. Chamar duas vezes para
  // extrair cada metade dobraria o trabalho de ordenacao numa fila de plantao.
  const computed = useMemo(() => {
    if (queue.status !== 'loaded') {
      return { sorted: null, sortFailure: null, summary: null, summaryFailure: null };
    }
    const options = { nowMs: effectiveNow, reference: slaReference };
    const sortOutcome = hubSortQueue(rows, options);
    const summaryOutcome = hubSummarizeQueue(rows, { ...options, filter });
    return {
      sorted: sortOutcome.ok ? sortOutcome.value : null,
      sortFailure: sortOutcome.ok ? null : sortOutcome.reason,
      summary: summaryOutcome.ok ? summaryOutcome.value : null,
      summaryFailure: summaryOutcome.ok ? null : summaryOutcome.reason,
    };
  }, [queue.status, rows, effectiveNow, slaReference, filter]);

  const sorted: HubSortedQueue | null = computed.sorted;
  const summary: HubQueueSummary | null = computed.summary;
  const sortFailure: string | null = computed.sortFailure;
  const summaryFailure: string | null = computed.summaryFailure;

  const handleRefresh = useCallback(() => {
    if (onRefresh) {
      onRefresh();
    }
  }, [onRefresh]);

  /* ---- estados que nao sao "fila com linhas" ---- */

  if (queue.status === 'loading') {
    return (
      <div className="rt-hub" data-testid="rt-hub">
        <p data-testid="rt-hub-loading">Carregando a fila...</p>
      </div>
    );
  }

  if (queue.status === 'failed') {
    // Nunca uma lista vazia. O motivo e mostrado porque "nenhum estudo" sobre uma falha e
    // o modo de falha que este painel existe para impedir.
    return (
      <div className="rt-hub" data-testid="rt-hub">
        <p data-testid="rt-hub-failed">
          Nao foi possivel carregar a fila. Isto nao significa que nao ha estudos pendentes.
        </p>
        <p data-testid="rt-hub-failed-reason">{queue.reason}</p>
        <button type="button" onClick={handleRefresh} data-testid="rt-hub-retry">
          Tentar de novo
        </button>
      </div>
    );
  }

  // Carregada, mas o nucleo recusou ordenar ou resumir: tambem nao e "fila vazia".
  const coreRefusal = sortFailure ?? summaryFailure;
  if (coreRefusal) {
    return (
      <div className="rt-hub" data-testid="rt-hub">
        <p data-testid="rt-hub-refused">
          A fila foi carregada, mas nao pode ser exibida com seguranca.
        </p>
        <p data-testid="rt-hub-refused-reason">{coreRefusal}</p>
      </div>
    );
  }

  const queueRows = sorted ? sorted.rows : [];

  return (
    <div className="rt-hub" data-testid="rt-hub">
      <header className="rt-hub-header">
        {/* O escopo cola no numero: um cracha sem recorte sai da tela como numero do
            departamento numa passagem de plantao verbal. */}
        <div data-testid="rt-hub-scope">{summary ? summary.scopeMessage : ''}</div>
        <div data-testid="rt-hub-breached">{summary ? summary.breachedBadge : ''}</div>
        <div data-testid="rt-hub-reference">
          {`SLA medido de: ${HUB_SLA_LABELS[slaReference]}`}
        </div>
        {/* A hora do calculo, porque uma fila de dez minutos atras nao pode parecer atual. */}
        <div data-testid="rt-hub-clock">
          {`Calculado as ${new Date(effectiveNow).toISOString().slice(11, 16)} UTC`}
        </div>
        <button type="button" onClick={handleRefresh} data-testid="rt-hub-refresh">
          Atualizar
        </button>
      </header>

      {summary && summary.unassignedUrgentCount > 0 ? (
        <section data-testid="rt-hub-escalation">
          <strong>{`${summary.unassignedUrgentCount} urgente(s) sem radiologista atribuido`}</strong>
          <p>{summary.unassignedUrgentNote}</p>
        </section>
      ) : null}

      {queueRows.length === 0 ? (
        // Vazia E CARREGADA. A frase diz isso, para nao ser confundida com falha.
        <p data-testid="rt-hub-empty">
          Nenhum estudo pendente neste recorte. A consulta foi concluida com sucesso.
        </p>
      ) : (
        <ul data-testid="rt-hub-rows">
          {queueRows.map(row => {
            const sla = hubComputeSla(row, { nowMs: effectiveNow, reference: slaReference });
            const critical = row.flags.indexOf(HUB_CRITICAL_FLAG) >= 0;
            return (
              <li
                key={row.studyKey}
                data-testid={`rt-hub-row-${row.studyKey}`}
                className={PRIORITY_TONE[row.priority]}
                data-critical={critical ? 'true' : 'false'}
              >
                <button
                  type="button"
                  onClick={() => onOpenStudy && onOpenStudy(row)}
                  data-testid={`rt-hub-open-${row.studyKey}`}
                >
                  {row.patientLabel ?? row.studyKey}
                </button>
                <span data-testid={`rt-hub-priority-${row.studyKey}`}>
                  {HUB_PRIORITY_LABELS[row.priority]}
                </span>
                <span data-testid={`rt-hub-modality-${row.studyKey}`}>{row.modality}</span>
                <span data-testid={`rt-hub-sla-${row.studyKey}`}>
                  {sla.ok ? sla.value.label : 'SLA nao mensuravel'}
                </span>
                {row.flags.length > 0 ? (
                  <ul data-testid={`rt-hub-flags-${row.studyKey}`}>
                    {row.flags.map(flag => (
                      <li key={flag}>{flagLabel(flag)}</li>
                    ))}
                  </ul>
                ) : null}
                {row.unknownFlags.length > 0 ? (
                  <span data-testid={`rt-hub-unknown-${row.studyKey}`}>
                    {`Marcadores nao reconhecidos: ${row.unknownFlags.join(', ')}`}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <footer className="rt-hub-footer">
        {/* Notas que a UI e obrigada a mostrar. Ver o cabecalho do modulo. */}
        {sorted && sorted.orderingNote ? (
          <p data-testid="rt-hub-ordering-note">{sorted.orderingNote}</p>
        ) : null}
        {sorted && sorted.unmeasurableKeys.length > 0 ? (
          <p data-testid="rt-hub-unmeasurable">{sorted.unmeasurableNote}</p>
        ) : null}
        {summary && summary.buckets.flagTotal > 0 ? (
          <p data-testid="rt-hub-counts-note">{summary.buckets.countsSumNote}</p>
        ) : null}
        {summary && summary.buckets.unknownFlags.length > 0 ? (
          <p data-testid="rt-hub-unknown-note">{summary.buckets.unknownFlagsNote}</p>
        ) : null}
      </footer>
    </div>
  );
}
