/**
 * Painel de comparacao entre versoes do laudo (RTV-227).
 *
 * O nucleo `../versionDiff` faz o diff e classifica cada mudanca por RISCO CLINICO. Este
 * painel existe para nao enterrar o resultado — e um painel de diff feito do jeito obvio
 * enterra exatamente a mudanca que importa.
 *
 * ## Uma mudanca de tres letras nao pode ficar abaixo de sessenta linhas de reescrita
 *
 * O nucleo ordena por classe de risco: negacao, lateralidade, categoria, medida. Se este
 * painel renderizasse as secoes na ordem do documento, o `nao` apagado no nono paragrafo
 * ficaria embaixo de uma reescrita inteira que nao mudou sentido nenhum — e o revisor rola,
 * cansa e aprova. As secoes com risco alto vem primeiro, e dentro de cada secao os spans de
 * risco alto vem primeiro.
 *
 * A ordem do documento **nao** e preservada de proposito. Isso e uma escolha, nao um
 * descuido: o revisor nao esta lendo o laudo aqui, esta procurando o que mudou de sentido.
 *
 * ## Um selo que grita em toda versao deixa de ser lido
 *
 * `wording-only` renderiza calmo. Se toda comparacao aparecesse com alerta vermelho, a
 * decima quinta seria ignorada junto com as catorze anteriores — e a decima sexta seria a
 * que tinha o `nao` apagado. O nivel de risco do nucleo vira o tom, sem inflacao.
 *
 * ## `identical` e um veredicto, nao um painel vazio
 *
 * O nucleo garante uma frase nao vazia mesmo quando nada mudou. O painel renderiza essa
 * frase, porque um painel em branco e indistinguivel de uma falha de carregamento — e o
 * revisor conclui que o diff nao rodou.
 *
 * ## Comparacao nao adjacente diz o que ficou escondido
 *
 * Comparar v1 com v3 nao mostra o adendo que entrou na v2 e saiu na v3: ele nao existe em
 * nenhum dos dois lados. Sem o aviso do nucleo, o revisor conclui que ele nunca existiu. O
 * aviso e as secoes escondidas aparecem no topo, nao no fim.
 *
 * ## Aprovar a comparacao nao e aprovar o laudo
 *
 * A frase de escopo do nucleo fica **no ponto da decisao**, colada aos botoes — nao num
 * tooltip nem no rodape. E a rejeicao tem o campo de motivo adjacente, com a explicacao de
 * por que ele e obrigatorio, em vez de um botao que falha depois de clicado.
 *
 * Sem import de outra extensao (RTV-114). Nao modifica pacote core.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  DIFF_DECISION_APPROVED,
  DIFF_DECISION_REJECTED,
  diffApproveComparison,
  diffCompareVersions,
  type DiffChangeSpan,
  type DiffComparison,
  type DiffDecision,
  type DiffReportVersion,
  type DiffRiskLevel,
  type DiffSectionComparison,
} from '../versionDiff';

/* ------------------------------------------------------------------ */
/* Props                                                              */
/* ------------------------------------------------------------------ */

export interface VersionDiffPanelProps {
  /** Historico completo. O nucleo precisa dele para detectar versoes saltadas. */
  history: readonly DiffReportVersion[];
  baseVersionId: string;
  targetVersionId: string;
  /** Cabeca do laudo agora, para recusar aprovacao obsoleta. */
  currentVersionId: string;
  /** Quem esta revisando. */
  reviewerId: string;
  /** Instante, injetado. */
  nowMs: number;
  /** Recebe o registro de aprovacao aceito pelo nucleo. */
  onDecision?: (record: ReturnType<typeof diffApproveComparison>) => void;
  servicesManager?: { services: Record<string, unknown> };
}

/* ------------------------------------------------------------------ */
/* Ordenacao por risco                                                */
/* ------------------------------------------------------------------ */

const RISK_WEIGHT: Readonly<Record<DiffRiskLevel, number>> = { high: 0, low: 1, none: 2 };

const RISK_TONE: Readonly<Record<DiffRiskLevel, string>> = {
  high: 'rt-diff-risk-high',
  low: 'rt-diff-risk-low',
  none: 'rt-diff-risk-none',
};

function bySpanRisk(a: DiffChangeSpan, b: DiffChangeSpan): number {
  const byRisk = RISK_WEIGHT[a.riskLevel] - RISK_WEIGHT[b.riskLevel];
  if (byRisk !== 0) {
    return byRisk;
  }
  // Empate: mantem a ordem do texto dentro da mesma faixa de risco, para o revisor poder
  // seguir a secao de cima para baixo depois de ver o que importa.
  return a.beforeTokenIndex - b.beforeTokenIndex;
}

function bySectionRisk(a: DiffSectionComparison, b: DiffSectionComparison): number {
  const byRisk = RISK_WEIGHT[a.riskLevel] - RISK_WEIGHT[b.riskLevel];
  if (byRisk !== 0) {
    return byRisk;
  }
  // Dentro da mesma faixa, secao acionavel primeiro: e onde o solicitante age.
  if (a.actionable !== b.actionable) {
    return a.actionable ? -1 : 1;
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/* Componente                                                         */
/* ------------------------------------------------------------------ */

export default function VersionDiffPanel({
  history,
  baseVersionId,
  targetVersionId,
  currentVersionId,
  reviewerId,
  nowMs,
  onDecision,
}: VersionDiffPanelProps): JSX.Element {
  const [note, setNote] = useState('');
  const [refusal, setRefusal] = useState<string | null>(null);
  const [record, setRecord] = useState<string | null>(null);

  const outcome = useMemo(
    () =>
      diffCompareVersions({
        history: history as DiffReportVersion[],
        baseVersionId,
        targetVersionId,
        comparedAt: nowMs,
      }),
    [history, baseVersionId, targetVersionId, nowMs]
  );

  const decide = useCallback(
    (decision: DiffDecision) => {
      const result = diffApproveComparison({
        history: history as DiffReportVersion[],
        reviewerId,
        decision,
        reviewedBaseVersionId: baseVersionId,
        reviewedTargetVersionId: targetVersionId,
        currentVersionId,
        decidedAt: nowMs,
        note,
      });
      if (!result.ok) {
        setRefusal(result.reason);
        setRecord(null);
        return;
      }
      setRefusal(null);
      setRecord(result.value.message);
      if (onDecision) {
        onDecision(result);
      }
    },
    [history, reviewerId, baseVersionId, targetVersionId, currentVersionId, nowMs, note, onDecision]
  );

  if (!outcome.ok) {
    // Recusa do nucleo. Nunca um painel vazio: um painel em branco e indistinguivel de uma
    // falha de carregamento, e o revisor conclui que o diff nao rodou.
    return (
      <div className="rt-diff" data-testid="rt-diff">
        <p data-testid="diff-refused">Nao foi possivel comparar as versoes.</p>
        <p data-testid="diff-refused-reason">{outcome.reason}</p>
      </div>
    );
  }

  const comparison: DiffComparison = outcome.value;
  const sections = [...comparison.sections].filter(s => s.changed).sort(bySectionRisk);

  return (
    <div className="rt-diff" data-testid="rt-diff">
      <header>
        <p data-testid="diff-verdict" data-kind={comparison.verdict}>
          {comparison.verdictMessage}
        </p>
        <p data-testid="diff-impression">{comparison.impressionMessage}</p>
        <p data-testid="diff-span-counts">
          {`${comparison.highRiskSpanCount} de ${comparison.totalSpanCount} mudanca(s) de risco alto`}
        </p>
      </header>

      {/* Adjacencia no TOPO. Ver o cabecalho: sem isso o revisor conclui que o adendo
          nunca existiu. */}
      {!comparison.adjacency.adjacent ? (
        <section data-testid="diff-adjacency">
          <p data-testid="diff-adjacency-message">{comparison.adjacency.message}</p>
          {comparison.adjacency.hiddenSectionKinds.length > 0 ? (
            <p data-testid="diff-hidden-sections">
              {`Secoes que existiram apenas nas versoes saltadas: ${comparison.adjacency.hiddenSectionKinds.join(', ')}`}
            </p>
          ) : null}
        </section>
      ) : null}

      {comparison.warnings.length > 0 ? (
        <ul data-testid="diff-warnings">
          {comparison.warnings.map(w => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}

      {sections.length === 0 ? (
        <p data-testid="diff-no-changes">{comparison.verdictMessage}</p>
      ) : (
        <ul data-testid="diff-sections">
          {sections.map(section => (
            <li
              key={section.kind}
              data-testid={`diff-section-${section.kind}`}
              className={RISK_TONE[section.riskLevel]}
              data-risk={section.riskLevel}
              data-actionable={section.actionable ? 'true' : 'false'}
            >
              <h4 data-testid={`diff-section-label-${section.kind}`}>{section.label}</h4>
              <p data-testid={`diff-section-message-${section.kind}`}>{section.message}</p>
              <ul data-testid={`diff-spans-${section.kind}`}>
                {[...section.spans].sort(bySpanRisk).map((span, index) => (
                  <li
                    key={`${section.kind}-${span.beforeTokenIndex}-${index}`}
                    data-testid={`diff-span-${section.kind}-${index}`}
                    className={RISK_TONE[span.riskLevel]}
                    data-risk={span.riskLevel}
                    data-class={span.riskClass}
                  >
                    <span data-testid={`diff-span-message-${section.kind}-${index}`}>
                      {span.message}
                    </span>
                    {/* O contexto permite localizar um span de tres letras. */}
                    <span data-testid={`diff-span-context-${section.kind}-${index}`}>
                      {`${span.contextBefore} [${span.removed} -> ${span.added}] ${span.contextAfter}`}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <footer data-testid="diff-decision">
        {/* A frase de escopo fica NO PONTO DA DECISAO. */}
        <p data-testid="diff-scope">
          Aprovar aqui cobre somente as diferencas entre estas duas versoes. Nao e aprovacao
          do laudo inteiro.
        </p>
        <label htmlFor="diff-note" data-testid="diff-note-label">
          Motivo (obrigatorio para rejeitar: sem ele o autor nao sabe o que corrigir e a
          discrepancia volta igual)
        </label>
        <textarea
          id="diff-note"
          data-testid="diff-note"
          value={note}
          onChange={event => setNote(event.target.value)}
        />
        <button
          type="button"
          onClick={() => decide(DIFF_DECISION_APPROVED)}
          data-testid="diff-approve"
        >
          Aprovar as diferencas
        </button>
        <button
          type="button"
          onClick={() => decide(DIFF_DECISION_REJECTED)}
          data-testid="diff-reject"
        >
          Rejeitar
        </button>
        {refusal ? <p data-testid="diff-decision-refusal">{refusal}</p> : null}
        {record ? <p data-testid="diff-decision-record">{record}</p> : null}
      </footer>
    </div>
  );
}
