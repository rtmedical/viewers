/**
 * Painel de planos em cache externo e limpeza do cache (RTV-179).
 *
 * O nucleo `../cachedPlans` monta o inventario, classifica a vigencia de cada copia e
 * decide se a limpeza pode acontecer. A camada de UI tem uma responsabilidade que o nucleo
 * nao pode assumir sozinho, e ela e o motivo pelo qual a impressao digital existe.
 *
 * ## A confirmacao e um passo separado, e e o que da sentido a impressao digital
 *
 * O nucleo compara a impressao digital que o operador confirmou com a da selecao no momento
 * da execucao, e recusa quando divergem. Isso protege contra o caso real: o dialogo lista
 * tres planos, um quarto entra no cache enquanto o fisico le, ele confirma e a limpeza pega
 * quatro.
 *
 * A primeira versao deste painel calculava a impressao digital por `useMemo` sobre a selecao
 * corrente e a enviava no mesmo clique. Isso **anula a protecao**: os dois lados da
 * comparacao saem da mesma leitura, a checagem passa sempre, e nao existe janela em que a
 * divergencia possa aparecer. O comentario que dizia haver teste para isso estava
 * descrevendo algo que nao podia acontecer.
 *
 * A correcao e a estrutura de um dialogo de confirmacao de verdade, em **dois passos**:
 *
 * 1. `Remover do cache` **apresenta** o que sera removido e congela a impressao digital
 *    daquele instante em estado;
 * 2. `Confirmar` envia a impressao digital **congelada**.
 *
 * Entre os dois existe a janela real, e um item que entra ou sai do cache nesse intervalo faz
 * o nucleo recusar com `fingerprint-mismatch`. Ha teste que troca as entradas entre os dois
 * passos e exige a recusa.
 *
 * ## Instantaneo nao verificado nao pode parecer vigente
 *
 * Cada linha mostra o veredicto de vigencia do nucleo. Uma copia em cache que ninguem
 * confrontou com a origem e desenhada como nao verificada, e nao com o mesmo tom de uma
 * confirmada — porque entregar contra o instantaneo velho entrega a distribuicao de dose
 * errada e nada no resultado denunciaria.
 *
 * ## Linha bloqueada nao e selecionavel
 *
 * Plano em uso, uso desconhecido, curso em andamento ou item que nao e copia externa vem do
 * nucleo com bloqueio. A caixa de selecao segue o `clearable` da linha, e o motivo fica
 * visivel ao lado — nao num tooltip. Uma linha que o operador consegue marcar e que depois
 * falha silenciosamente ensina a ignorar a lista.
 *
 * ## "Cache limpo" nunca aparece para uma limpeza parcial
 *
 * O nucleo devolve `partial` quando qualquer plano ficou sem confirmacao de remocao. O
 * painel renderiza o veredicto do nucleo e o aviso de que podem restar planos velhos — que
 * pende de `stalePlansMayRemain` e nao de `verdict !== success`, para que plano nao
 * contabilizado avise tao alto quanto plano que falhou.
 *
 * ## Data ausente nao pode ler como "nunca tratado"
 *
 * O nucleo separa tratado, nunca tratado e desconhecido. O painel usa os tres rotulos, e
 * nunca preenche o desconhecido com um traco: um leitor que conclui que o curso nao comecou
 * pode recomeca-lo da primeira fracao e dobrar a dose entregue.
 *
 * Sem import de outra extensao (RTV-114). Nao modifica pacote core.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  PLAN_CACHE_CURRENCY_VERDICTS,
  planCacheApplyClearResults,
  planCacheBuildInventory,
  planCacheEntryKey,
  planCacheEvaluateClearRequest,
  planCacheFingerprintSelection,
  type PlanCacheClearAttempt,
  type PlanCacheClearReport,
  type PlanCacheEntry,
  type PlanCacheInventoryRow,
  type PlanCacheUsageProbe,
} from '../cachedPlans';

/* ------------------------------------------------------------------ */
/* Props                                                              */
/* ------------------------------------------------------------------ */

export interface CachedPlansPanelProps {
  /** Itens de cache conhecidos. */
  entries: readonly PlanCacheEntry[];
  /** Instante, injetado. */
  nowMs: number;
  /** Quem esta operando. */
  actorId: string;
  /** Sonda de uso, quando o hospedeiro sabe consultar o daemon. */
  usageProbe?: PlanCacheUsageProbe;
  /**
   * Executa a remocao e devolve o resultado POR PLANO. Ausente: o painel autoriza e
   * relata a autorizacao, sem afirmar que algo foi removido.
   */
  onClear?: (entryKeys: string[]) => PlanCacheClearAttempt[] | void;
  servicesManager?: { services: Record<string, unknown> };
}

/* ------------------------------------------------------------------ */
/* Componente                                                         */
/* ------------------------------------------------------------------ */

const CURRENCY_TONE: Record<string, string> = {
  'verifiable-current': 'rt-plan-currency-current',
  'snapshot-unverified': 'rt-plan-currency-unverified',
  'known-stale': 'rt-plan-currency-stale',
};

export default function CachedPlansPanel({
  entries,
  nowMs,
  actorId,
  usageProbe,
  onClear,
}: CachedPlansPanelProps): JSX.Element {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [report, setReport] = useState<PlanCacheClearReport | null>(null);
  /**
   * O que foi APRESENTADO no passo 1: a impressao digital e a lista, congeladas. E dela que
   * a confirmacao sai, e nao de uma releitura da selecao -- ver o cabecalho.
   */
  const [presented, setPresented] = useState<{
    digest: string;
    planCount: number;
    planIds: string[];
    entries: PlanCacheEntry[];
  } | null>(null);

  const inventory = useMemo(
    () => planCacheBuildInventory(entries as PlanCacheEntry[], nowMs, usageProbe),
    [entries, nowMs, usageProbe]
  );

  const rows: PlanCacheInventoryRow[] = inventory.ok ? inventory.value.rows : [];

  /**
   * Entradas correspondentes as linhas marcadas, na ordem em que a lista foi desenhada.
   *
   * O casamento e por CHAVE DE ITEM e nao por Plan ID: dois instantaneos do mesmo plano no
   * cache e um estado real -- e a linha o sinaliza -- entao casar por Plan ID pegaria o
   * primeiro dos dois e removeria o instantaneo errado.
   */
  const selectedEntries = useMemo(() => {
    const byKey = new Map<string, PlanCacheEntry>();
    for (const entry of entries as PlanCacheEntry[]) {
      byKey.set(planCacheEntryKey(entry), entry);
    }
    return rows
      .filter(row => selected[row.entryKey] === true && row.clearable)
      .map(row => byKey.get(row.entryKey))
      .filter(Boolean) as PlanCacheEntry[];
  }, [rows, selected, entries]);

  const toggle = useCallback((key: string) => {
    setSelected(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  /** Passo 1: apresenta o que sera removido e congela a impressao digital daquele instante. */
  const present = useCallback(() => {
    if (selectedEntries.length === 0) {
      setRefusal('Nenhum plano selecionado.');
      setPresented(null);
      return;
    }
    const fingerprint = planCacheFingerprintSelection(selectedEntries);
    if (!fingerprint.ok) {
      setRefusal(fingerprint.reason);
      setPresented(null);
      return;
    }
    setRefusal(null);
    setReport(null);
    setPresented({
      digest: fingerprint.value.digest,
      planCount: fingerprint.value.planCount,
      planIds: fingerprint.value.planIds,
      entries: selectedEntries,
    });
  }, [selectedEntries]);

  /** Passo 2: confirma com a impressao digital CONGELADA. */
  const confirmClear = useCallback(() => {
    if (!presented) {
      return;
    }
    const decision = planCacheEvaluateClearRequest({
      // A selecao corrente, que pode ter mudado desde a apresentacao.
      selection: selectedEntries,
      confirmation: {
        // Congelada no passo 1. Se a selecao mudou, o nucleo recusa aqui.
        digest: presented.digest,
        confirmedByUserId: actorId,
        confirmedAt: nowMs,
        reason,
        acknowledgedIrreversible: acknowledged,
        presentedPlanCount: presented.planCount,
      },
      usageProbe,
      now: nowMs,
    });

    if (!decision.authorized) {
      setRefusal(decision.refusalReason);
      setReport(null);
      return;
    }
    setRefusal(null);

    const attempts = onClear ? onClear(decision.plan.authorizedEntryKeys) : undefined;
    if (!attempts) {
      // Sem executor nao ha o que consolidar, e o painel NAO afirma que removeu.
      setReport(null);
      setPresented(null);
      return;
    }
    const applied = planCacheApplyClearResults(decision.plan, attempts, nowMs);
    if (!applied.ok) {
      setRefusal(applied.reason);
      setReport(null);
      return;
    }
    setReport(applied.value);
    setPresented(null);
  }, [
    presented,
    selectedEntries,
    actorId,
    nowMs,
    reason,
    acknowledged,
    usageProbe,
    onClear,
  ]);

  if (!inventory.ok) {
    return (
      <div className="rt-plan-cache" data-testid="rt-plan-cache">
        <p data-testid="plan-inventory-refused">Nao foi possivel montar o inventario do cache.</p>
        <p data-testid="plan-inventory-reason">{inventory.reason}</p>
      </div>
    );
  }

  const counts = inventory.value.counts;

  return (
    <div className="rt-plan-cache" data-testid="rt-plan-cache">
      <header>
        <p data-testid="plan-counts">
          {`${counts.total} item(ns) em cache: ${counts.verifiableCurrent} vigente(s), ` +
            `${counts.snapshotUnverified} nao verificado(s), ${counts.knownStale} desatualizado(s).`}
        </p>
        <p data-testid="plan-clearable-counts">
          {`${counts.clearable} podem ser removidos, ${counts.blocked} bloqueados.`}
        </p>
        {inventory.value.invalidEntries.length > 0 ? (
          // Item malformado e relatado, nao descartado: omiti-lo deixaria um plano velho no
          // disco que o operador nunca viu e portanto nunca limpou.
          <p data-testid="plan-invalid">
            {`${inventory.value.invalidEntries.length} item(ns) de cache malformado(s) e nao exibivel(is).`}
          </p>
        ) : null}
      </header>

      <ul data-testid="plan-rows">
        {rows.map(row => (
          <li
            key={row.entryKey}
            data-testid={`plan-row-${row.planId}`}
            className={CURRENCY_TONE[row.currency.verdict]}
            data-currency={row.currency.verdict}
            data-clearable={row.clearable ? 'true' : 'false'}
          >
            <input
              type="checkbox"
              data-testid={`plan-select-${row.planId}`}
              aria-label={`Selecionar ${row.planId} para remocao`}
              checked={selected[row.entryKey] === true}
              disabled={!row.clearable}
              onChange={() => toggle(row.entryKey)}
            />
            <span data-testid={`plan-id-${row.planId}`}>{row.locked.planIdLabel}</span>
            {/* Vigencia com o veredicto do nucleo: nao verificado nao pode parecer vigente. */}
            <span data-testid={`plan-currency-${row.planId}`}>{row.currency.stamp}</span>
            {row.currency.verdict !== PLAN_CACHE_CURRENCY_VERDICTS.VERIFIABLE_CURRENT ? (
              <span data-testid={`plan-currency-reason-${row.planId}`}>
                {row.currency.reason}
              </span>
            ) : null}
            {/* Os tres estados de ultimo tratamento, sem traco para o desconhecido. */}
            <span data-testid={`plan-last-treatment-${row.planId}`}>
              {row.locked.lastTreatmentLabel}
            </span>
            {row.blockers.length > 0 ? (
              <ul data-testid={`plan-blockers-${row.planId}`}>
                {row.blockers.map(b => (
                  <li key={`${b.entryKey}-${b.code}`} data-code={b.code}>
                    {b.reason}
                  </li>
                ))}
              </ul>
            ) : null}
            {row.hasSiblingSnapshot ? (
              <span data-testid={`plan-sibling-${row.planId}`}>
                Existe outro instantaneo do mesmo Plan ID no cache.
              </span>
            ) : null}
            {row.locked.warnings.length > 0 ? (
              <ul data-testid={`plan-warnings-${row.planId}`}>
                {row.locked.warnings.map(w => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>

      <footer data-testid="plan-clear">
        <p data-testid="plan-selected-count">
          {`${selectedEntries.length} plano(s) selecionado(s) para remocao.`}
        </p>
        <label htmlFor="plan-reason" data-testid="plan-reason-label">
          Justificativa (obrigatoria: a remocao e irreversivel e fica na auditoria)
        </label>
        <textarea
          id="plan-reason"
          data-testid="plan-reason"
          value={reason}
          onChange={event => setReason(event.target.value)}
        />
        <label data-testid="plan-ack-label">
          <input
            type="checkbox"
            data-testid="plan-ack"
            checked={acknowledged}
            onChange={() => setAcknowledged(prev => !prev)}
          />
          Entendo que a remocao nao pode ser desfeita
        </label>
        <button type="button" onClick={present} data-testid="plan-clear-button">
          Remover do cache
        </button>

        {presented ? (
          <section data-testid="plan-confirmation">
            <p data-testid="plan-confirmation-list">
              {`Sera removido: ${presented.planIds.join(', ')} (${presented.planCount} item(ns)).`}
            </p>
            <p data-testid="plan-confirmation-digest" data-digest={presented.digest}>
              Confirme exatamente esta lista. Se algo entrar ou sair do cache antes da
              confirmacao, a operacao sera recusada.
            </p>
            <button type="button" onClick={confirmClear} data-testid="plan-confirm-button">
              Confirmar remocao
            </button>
            <button
              type="button"
              onClick={() => setPresented(null)}
              data-testid="plan-cancel-button"
            >
              Cancelar
            </button>
          </section>
        ) : null}

        {refusal ? <p data-testid="plan-refusal">{refusal}</p> : null}

        {report ? (
          <section data-testid="plan-report" data-verdict={report.verdict}>
            <p data-testid="plan-report-reason">{report.reason}</p>
            {/* Pende de stalePlansMayRemain, nao de verdict !== success. */}
            {report.stalePlansMayRemain ? (
              <p data-testid="plan-may-remain">
                Podem restar planos antigos no cache. Reimportar agora traria uma mistura de
                planos frescos e instantaneos sobreviventes, sem nada distinguindo os dois.
              </p>
            ) : null}
            {report.cacheClean ? (
              <p data-testid="plan-clean">Todos os planos autorizados foram removidos.</p>
            ) : null}
            <ul data-testid="plan-outcomes">
              {report.outcomes.map(o => (
                <li key={o.entryKey} data-testid={`plan-outcome-${o.planId}`} data-outcome={o.outcome}>
                  {`${o.planId}: ${o.outcome}${o.failureReason ? ' -- ' + o.failureReason : ''}`}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </footer>
    </div>
  );
}
