/**
 * Painel do copiloto de IA (RTV-224).
 *
 * O nucleo `../aiCopilot` carrega a regra: toda sugestao exige aceitar, rejeitar ou editar,
 * e trecho de maquina nao decidido bloqueia a assinatura. Este painel existe para nao
 * oferecer o atalho que dissolve essa regra — e o atalho e uma unica caixa de selecao.
 *
 * ## Nao ha aceite em lote, e a ausencia e o desenho
 *
 * O nucleo nao expoe funcao de aceite em lote de proposito. Se este painel oferecesse
 * "aceitar todas", teria construido a funcao que o nucleo se recusou a ter: um unico
 * "revisei as sugestoes da IA" nao e uma decisao sobre as catorze frases que ele cobre, e
 * sim uma decisao sobre a caixa de selecao. E e exatamente a affordance que transforma o
 * copiloto em autor.
 *
 * Entao cada cartao tem seus tres botoes e nao existe controle acima da lista que os
 * dispense. Ha teste que varre o painel exigindo que nenhum botao aceite mais de uma
 * sugestao.
 *
 * ## Rejeitar tem de ser tao facil quanto aceitar
 *
 * Se aceitar e um clique e rejeitar exige abrir um menu, escolher um motivo e confirmar, a
 * assimetria empurra para o aceite — e o aceite e o unico dos tres que poe texto de maquina
 * no laudo sem ninguem ter reescrito nada. Os tres botoes tem o mesmo peso e a mesma
 * distancia. O motivo da rejeicao e opcional, porque exigi-lo e o que faz o radiologista
 * aceitar para nao ter de justificar.
 *
 * ## A impressao e sinalizada antes de ser lida
 *
 * O nucleo relata trecho de maquina nao decidido na impressao ou na recomendacao
 * separadamente e mais alto, porque e a parte em que o solicitante age sem ler o resto. O
 * painel poe esses cartoes primeiro e marca-os, em vez de deixa-los na ordem em que o modelo
 * os produziu.
 *
 * ## O contador de pendencias nao e um numero solto
 *
 * "3 sugestoes pendentes" ao lado de um botao de assinar e lido como progresso. A mensagem
 * do nucleo diz o que a pendencia significa — que assinar agora tornaria texto de maquina
 * uma afirmacao assinada do radiologista — e e ela que aparece, nao a contagem sozinha.
 *
 * ## Copiloto desligado nao e copiloto sem sugestoes
 *
 * Quando a politica da instituicao nao habilita a IA para este perfil ou modalidade, o
 * painel diz isso com o motivo do nucleo. Um painel vazio seria lido como "a IA nao teve
 * nada a sugerir", que e uma afirmacao sobre o exame e nao sobre a configuracao.
 *
 * Sem import de outra extensao (RTV-114). Nao modifica pacote core.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  AI_ACTION_LABELS,
  AI_PROVENANCE_LABELS,
  AI_SECTION_LABELS,
  aiApplySuggestion,
  aiAvailability,
  aiEvaluateSignability,
  type AiAction,
  type AiPolicy,
  type AiSegment,
  type AiSignabilityReport,
  type AiSuggestion,
} from '../aiCopilot';

/* ------------------------------------------------------------------ */
/* Props                                                              */
/* ------------------------------------------------------------------ */

export interface AiCopilotPanelProps {
  /** Politica da instituicao. Decide se o copiloto roda. */
  policy: AiPolicy;
  /** Perfil e modalidade do contexto atual, para a checagem de disponibilidade. */
  context: { role: string; modality: string };
  /** Sugestoes pendentes de decisao. */
  suggestions: readonly AiSuggestion[];
  /** Trechos do laudo, para o portao de assinatura. */
  segments: readonly AiSegment[];
  /** Versao corrente do laudo, para recusar sugestao obsoleta. */
  currentReportVersion: number;
  /** Quem esta decidindo. */
  actorId: string;
  /** Instante da decisao, injetado. */
  nowMs: number;
  /** Recebe a decisao aplicada, para o hospedeiro gravar. */
  onDecision?: (application: ReturnType<typeof aiApplySuggestion>) => void;
  servicesManager?: { services: Record<string, unknown> };
}

/* ------------------------------------------------------------------ */
/* Componente                                                         */
/* ------------------------------------------------------------------ */

const ACTIONS: AiAction[] = ['accept', 'edit', 'reject'];

export default function AiCopilotPanel({
  policy,
  context,
  suggestions,
  segments,
  currentReportVersion,
  actorId,
  nowMs,
  onDecision,
}: AiCopilotPanelProps): JSX.Element {
  const [refusals, setRefusals] = useState<Record<string, string>>({});
  const [decided, setDecided] = useState<Record<string, AiAction>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const availability = useMemo(() => aiAvailability(policy, context), [policy, context]);

  const signability: AiSignabilityReport = useMemo(
    () => aiEvaluateSignability(segments as AiSegment[]),
    [segments]
  );

  /**
   * A impressao e a recomendacao primeiro. O modelo produz na ordem que quiser, e a ordem
   * dele nao reflete o custo de um erro.
   */
  const ordered = useMemo(() => {
    const weight = (s: AiSuggestion) =>
      s.section === 'impression' ? 0 : s.section === 'recommendation' ? 1 : 2;
    return [...suggestions].sort((a, b) => weight(a) - weight(b));
  }, [suggestions]);

  const decide = useCallback(
    (suggestion: AiSuggestion, action: AiAction) => {
      const outcome = aiApplySuggestion({
        suggestion,
        decision: {
          suggestionId: suggestion.suggestionId,
          action,
          decidedBy: actorId,
          decidedAt: nowMs,
          editedText: action === 'edit' ? drafts[suggestion.suggestionId] : undefined,
        },
        currentReportVersion,
        policy,
        alreadyDecided: decided[suggestion.suggestionId] !== undefined,
      });

      if (!outcome.ok) {
        setRefusals(prev => ({ ...prev, [suggestion.suggestionId]: outcome.reason }));
        return;
      }
      setRefusals(prev => {
        const next = { ...prev };
        delete next[suggestion.suggestionId];
        return next;
      });
      setDecided(prev => ({ ...prev, [suggestion.suggestionId]: action }));
      if (onDecision) {
        onDecision(outcome);
      }
    },
    [actorId, nowMs, drafts, currentReportVersion, policy, decided, onDecision]
  );

  if (!availability.available) {
    // Desligado NAO e "sem sugestoes". Ver o cabecalho.
    return (
      <div className="rt-ai" data-testid="rt-ai">
        <p data-testid="ai-unavailable">Copiloto de IA indisponivel neste contexto.</p>
        <p data-testid="ai-unavailable-reason">{availability.reason}</p>
      </div>
    );
  }

  return (
    <div className="rt-ai" data-testid="rt-ai">
      {/* O portao de assinatura, com a mensagem do nucleo e nao so a contagem. */}
      <section data-testid="ai-gate">
        {signability.signable ? (
          <p data-testid="ai-gate-clear">{signability.message}</p>
        ) : (
          <>
            <p data-testid="ai-gate-blocked">{signability.message}</p>
            {signability.undecidedHighStakes.length > 0 ? (
              <p data-testid="ai-gate-high-stakes">
                {`${signability.undecidedHighStakes.length} em impressao ou recomendacao.`}
              </p>
            ) : null}
          </>
        )}
        <ul data-testid="ai-provenance-counts">
          {(Object.keys(signability.counts) as Array<keyof typeof signability.counts>).map(key => (
            <li key={key} data-testid={`ai-count-${key}`}>
              {`${AI_PROVENANCE_LABELS[key]}: ${signability.counts[key]}`}
            </li>
          ))}
        </ul>
      </section>

      {ordered.length === 0 ? (
        <p data-testid="ai-no-suggestions">
          Nenhuma sugestao pendente. O copiloto esta habilitado e nao propos nada agora.
        </p>
      ) : (
        <ul data-testid="ai-suggestions">
          {ordered.map(suggestion => {
            const id = suggestion.suggestionId;
            const settled = decided[id];
            const highStakes =
              suggestion.section === 'impression' || suggestion.section === 'recommendation';
            return (
              <li key={id} data-testid={`ai-card-${id}`} data-high-stakes={highStakes ? 'true' : 'false'}>
                <span data-testid={`ai-section-${id}`}>{AI_SECTION_LABELS[suggestion.section]}</span>
                <span data-testid={`ai-model-${id}`}>
                  {`${suggestion.modelId}@${suggestion.modelVersion}`}
                </span>
                {suggestion.currentText ? (
                  <p data-testid={`ai-current-${id}`}>{suggestion.currentText}</p>
                ) : null}
                <p data-testid={`ai-proposed-${id}`}>{suggestion.proposedText}</p>

                {settled ? (
                  <p data-testid={`ai-settled-${id}`}>{`Decidido: ${AI_ACTION_LABELS[settled]}`}</p>
                ) : (
                  <>
                    <textarea
                      data-testid={`ai-editor-${id}`}
                      aria-label={`Editar a sugestao de ${AI_SECTION_LABELS[suggestion.section]}`}
                      value={drafts[id] ?? suggestion.proposedText}
                      onChange={event =>
                        setDrafts(prev => ({ ...prev, [id]: event.target.value }))
                      }
                    />
                    {/* Os tres botoes com o mesmo peso: a assimetria empurraria para o
                        aceite, que e o unico que poe texto de maquina no laudo sem
                        ninguem reescrever nada. */}
                    <div data-testid={`ai-actions-${id}`}>
                      {ACTIONS.map(action => (
                        <button
                          key={action}
                          type="button"
                          onClick={() => decide(suggestion, action)}
                          data-testid={`ai-${action}-${id}`}
                          data-single-suggestion="true"
                        >
                          {AI_ACTION_LABELS[action]}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {refusals[id] ? (
                  <p data-testid={`ai-refusal-${id}`}>{refusals[id]}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
