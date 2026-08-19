/**
 * Painel de assinatura do laudo (RTV-228).
 *
 * O nucleo puro `../signOff` decide se o laudo pode ser assinado. Este painel existe para
 * nao desfazer essa decisao — e a camada de UI tem varias maneiras de desfaze-la sem
 * mudar uma linha do nucleo. Cada regra abaixo fecha uma delas.
 *
 * ## Uma faixa nao substitui um bloqueio por campo
 *
 * O nucleo classifica campo de normalidade pre-preenchido e nao tocado como pendencia
 * **bloqueante**, nunca como aviso, porque faixas sao lidas **depois** que a assinatura
 * irreversivel ja existe. Se este painel renderizasse as pendencias como uma faixa
 * descartavel no topo, teria reintroduzido exatamente o que o nucleo recusa: o radiologista
 * fecha a faixa, assina, e o laudo afirma "sem alteracoes" num pulmao que ninguem olhou.
 *
 * Por isso a lista de bloqueios **nao e descartavel, nao e recolhivel e nao tem estado**.
 * Nao existe prop para esconde-la. Cada item mostra o campo ofensor e oferece navegar ate
 * ele, porque uma pendencia que o usuario nao consegue localizar e uma pendencia que ele
 * contorna.
 *
 * ## Um botao desabilitado sem motivo ensina que o sistema esta quebrado
 *
 * O padrao comum — desabilitar "Assinar" e parar ai — produz um usuario que conclui que o
 * botao nao funciona, e a proxima acao dele e recarregar a pagina ou pedir suporte. O
 * motivo fica **adjacente ao botao**, sempre visivel, com a contagem no proprio rotulo
 * acessivel.
 *
 * ## `aria-disabled`, nao `disabled` — e o motivo nao e cosmetico
 *
 * Um botao com o atributo `disabled` sai da ordem de tabulacao e e ignorado por leitor de
 * tela. O radiologista que navega por teclado **nao consegue nem alcanca-lo** para
 * descobrir por que assinar esta indisponivel — ele encontra um botao que nao existe.
 *
 * E `disabled` tambem nao despacha clique, o que torna qualquer verificacao no handler
 * codigo morto. Com `aria-disabled` o botao continua focavel e anunciado como
 * indisponivel, o clique chega ao handler, e o handler **reavalia o nucleo** e mostra a
 * recusa. A defesa passa a existir de verdade, pela mesma razao que o nucleo reavalia
 * dentro de `signCreateSignature`: o estado visual e apresentacao, e apresentacao nao
 * pode ser o que impede uma assinatura.
 *
 * ## Bloqueante e informativo em listas separadas
 *
 * Misturados, o radiologista tem de ler doze itens para descobrir quais dois o impedem.
 * Separados, ele resolve dois. A lista informativa diz explicitamente que nao impede a
 * assinatura, porque um item que parece bloquear e ignorado junto com os que bloqueiam.
 *
 * ## "Assinado" nunca renderiza como "entregue"
 *
 * Sao fatos distintos e o nucleo os mantem separados. Depois da assinatura o painel diz
 * que o laudo esta assinado e, na mesma vista, que a distribuicao e um passo seguinte —
 * senao alguem conclui que o solicitante ja recebeu.
 *
 * Sem import de outra extensao (RTV-114). Nao modifica pacote core.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  signEvaluateReadiness,
  type SignChecklistItem,
  type SignReadiness,
  type SignReportDraft,
  type SignSignature,
} from '../signOff';

/* ------------------------------------------------------------------ */
/* Props                                                              */
/* ------------------------------------------------------------------ */

export interface SignOffPanelProps {
  /** Rascunho na tela. A prontidao e derivada dele pelo nucleo. */
  draft: SignReportDraft;
  /** Presente quando o laudo ja foi assinado. */
  signature?: SignSignature | null;
  /**
   * Executa a assinatura. Chamado somente depois de o painel reavaliar o portao.
   * Devolve uma recusa legivel quando o hospedeiro tambem recusar.
   */
  onSign?: (draft: SignReportDraft) => { ok: boolean; reason?: string } | void;
  /** Navega ate o campo de uma pendencia. */
  onFocusSubject?: (subject: string) => void;
  /** Abre o fluxo de distribuicao, que e um passo separado da assinatura. */
  onOpenDistribution?: () => void;
  servicesManager?: { services: Record<string, unknown> };
}

/* ------------------------------------------------------------------ */
/* Componente                                                         */
/* ------------------------------------------------------------------ */

export default function SignOffPanel({
  draft,
  signature,
  onSign,
  onFocusSubject,
  onOpenDistribution,
}: SignOffPanelProps): JSX.Element {
  const [refusal, setRefusal] = useState<string | null>(null);

  const readiness: SignReadiness = useMemo(() => signEvaluateReadiness(draft), [draft]);

  const blocked = readiness.blocking.length > 0;

  const handleSign = useCallback(() => {
    // O portao roda aqui tambem. Ver o cabecalho: `disabled` e apresentacao, e um bug que
    // torne o botao clicavel nao pode virar uma assinatura.
    const fresh = signEvaluateReadiness(draft);
    if (fresh.blocking.length > 0) {
      setRefusal(
        `Assinatura recusada por ${fresh.blocking.length} pendencia(s) obrigatoria(s): ` +
          fresh.blocking.map(item => item.message).join(' | ')
      );
      return;
    }
    setRefusal(null);
    if (!onSign) {
      return;
    }
    const outcome = onSign(draft);
    if (outcome && outcome.ok === false) {
      setRefusal(outcome.reason ?? 'Assinatura recusada.');
    }
  }, [draft, onSign]);

  const renderItem = (item: SignChecklistItem, kind: 'blocking' | 'advisory') => (
    <li
      key={`${kind}-${item.code}-${item.subject}`}
      data-testid={`sign-${kind}-${item.subject}`}
      data-code={item.code}
    >
      <span data-testid={`sign-${kind}-message-${item.subject}`}>{item.message}</span>
      {onFocusSubject ? (
        <button
          type="button"
          onClick={() => onFocusSubject(item.subject)}
          data-testid={`sign-focus-${item.subject}`}
        >
          Ir para o campo
        </button>
      ) : null}
    </li>
  );

  if (signature) {
    return (
      <div className="rt-signoff" data-testid="rt-signoff">
        <p data-testid="sign-signed">
          {`Laudo assinado na versao ${signature.version} por ${signature.signerId}.`}
        </p>
        {/* Assinado nao e entregue. Ver o cabecalho. */}
        <p data-testid="sign-not-delivered">
          Assinar nao envia. A distribuicao ao solicitante e um passo seguinte e ainda nao
          aconteceu.
        </p>
        <button type="button" onClick={onOpenDistribution} data-testid="sign-open-distribution">
          Abrir distribuicao
        </button>
      </div>
    );
  }

  return (
    <div className="rt-signoff" data-testid="rt-signoff">
      {/* Lista de bloqueios: sem estado, sem recolher, sem descartar. */}
      {blocked ? (
        <section data-testid="sign-blocking-section">
          <h3 data-testid="sign-blocking-title">
            {`${readiness.blocking.length} pendencia(s) impedem a assinatura`}
          </h3>
          <ul data-testid="sign-blocking-list">
            {readiness.blocking.map(item => renderItem(item, 'blocking'))}
          </ul>
        </section>
      ) : (
        <p data-testid="sign-ready">Nenhuma pendencia obrigatoria. O laudo pode ser assinado.</p>
      )}

      {readiness.advisory.length > 0 ? (
        <section data-testid="sign-advisory-section">
          <h3 data-testid="sign-advisory-title">
            {`${readiness.advisory.length} observacao(oes) que NAO impedem a assinatura`}
          </h3>
          <ul data-testid="sign-advisory-list">
            {readiness.advisory.map(item => renderItem(item, 'advisory'))}
          </ul>
        </section>
      ) : null}

      <div className="rt-signoff-action">
        <button
          type="button"
          onClick={handleSign}
          aria-disabled={blocked}
          data-blocked={blocked ? 'true' : 'false'}
          aria-label={
            blocked
              ? `Assinar laudo, indisponivel por ${readiness.blocking.length} pendencia(s) obrigatoria(s)`
              : 'Assinar laudo'
          }
          data-testid="sign-button"
        >
          Assinar laudo
        </button>
        {/* O motivo fica ADJACENTE ao botao. Um botao desabilitado sem motivo ensina que o
            sistema esta quebrado. */}
        {blocked ? (
          <p data-testid="sign-button-reason">
            {`Indisponivel: ${readiness.blocking.map(i => i.message).join(' | ')}`}
          </p>
        ) : null}
      </div>

      {refusal ? <p data-testid="sign-refusal">{refusal}</p> : null}
    </div>
  );
}
