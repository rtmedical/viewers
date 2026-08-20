/**
 * Painel de achados criticos (RTV-202).
 *
 * O nucleo `../criticalFindings` e o registro e o relogio. Este painel e onde as duas coisas
 * podem ser desfeitas, e cada regra abaixo fecha uma rota.
 *
 * ## O relogio nao pode ser capturado
 *
 * `escalationState` e derivado de `now` a cada chamada, e o cabecalho do nucleo diz por que:
 * uma flag guardada vale o que vale o temporizador que a escreve -- uma aba fechada, um worker
 * morto, um laptop que dormiu -- e a falha e um achado critico que silenciosamente para de
 * cobrar. Se este painel capturasse `now` na montagem, reproduziria exatamente essa falha na
 * camada de cima: o cracha ficaria em "aguardando" para sempre.
 *
 * Isto e o OPOSTO da regra do painel da fila de laudos, que congela `now` de proposito. La o
 * risco e reordenar linhas sob o cursor; aqui o risco e um cronometro parado. Ha teste que
 * avanca `nowMs` e exige que o nivel mude.
 *
 * ## O radiologista nao confirma o recebimento
 *
 * `acknowledge` e o ato do DESTINATARIO. Um botao aqui, no painel de quem enviou, produziria a
 * prova de que alguem foi avisado a partir de um clique de quem avisou -- e o caso em que esse
 * registro importa e justamente o caso em que alguem esta estabelecendo o que se sabia, quando,
 * e quem foi informado. Este painel nao tem esse controle, e ha teste varrendo os botoes.
 *
 * O telefonema tem seu proprio caminho, e nao e esse: `verballyConfirmed` no envio e o
 * radiologista declarando que falou. Isso e uma atestacao de quem envia, nao uma confirmacao de
 * quem recebe, e os dois nao se substituem.
 *
 * ## A descricao nao se edita, se complementa
 *
 * O registro e append-only porque e prova. O painel nao oferece campo ligado a `description`:
 * oferece complemento, e os dois textos ficam na tela. Ha teste exigindo que a descricao
 * original continue visivel depois do complemento.
 *
 * ## O achado nao enviado nao pode ser dispensado
 *
 * `pendingDispatch` existe, nas palavras do nucleo, "so the UI can refuse to let go of it". O
 * bloqueio aqui nao tem "depois", "dispensar" nem "ok, entendi": some quando o envio acontece,
 * e nao quando alguem clica. Teste varre os controles por afordancia de dispensa.
 *
 * ## O painel nao grava `sent` por um envio que ainda nao aconteceu
 *
 * Esta e a distincao que estruturou o componente, e a primeira versao dele errava. Chamar
 * `dispatch` no clique escreve `sentAt` e inicia o relogio; para telefone isso esta certo, porque
 * a ligacao ja aconteceu e o que se faz e registra-la. Para WhatsApp e e-mail, nao: no clique o
 * transporte ainda nao rodou, e gravar `sent` ali produz exatamente a falha que o nucleo descreve
 * -- o radiologista acreditando que comunicou.
 *
 * Entao ha dois caminhos. Telefone: o painel chama `dispatch`, que exige a atestacao. Canal de
 * maquina: o painel entrega a intencao e a mensagem ao hospedeiro por `onRequestSend` e **nao**
 * escreve nada; o achado continua em `pendingDispatch`, sob o bloqueio, ate o hospedeiro registrar
 * o resultado real. Uma falha volta como evento `sendFailed` sem `sentAt`, e o achado segue
 * pendente -- a falha fica tao visivel quanto o sucesso.
 *
 * ## O nome do paciente nao vai por padrao
 *
 * `buildMessage` recebe `includePatientName` explicito porque o modelo do ticket poe nome e
 * prontuario num canal de terceiros. Aqui o padrao e NAO incluir, a decisao e por mensagem, e a
 * previa do texto aparece antes do envio -- quem envia le exatamente o que sai da instituicao.
 * Quando a instituicao nao permite, o controle nao e nem oferecido.
 *
 * ## O limite de 200 caracteres nao truca em silencio
 *
 * Sem `maxLength` no campo: o atributo faria a digitacao simplesmente parar no 201o caractere, e
 * um resumo clinico cortado no meio de uma palavra pode nao ser notado por quem digitou. O
 * contador mostra o excesso e o nucleo recusa com a razao dele.
 *
 * Sem import de outra extensao (RTV-114). O transporte (WhatsApp, e-mail, telefonia) fica no
 * hospedeiro: este painel produz a mensagem e o registro, e devolve intencoes.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  CRITICAL_FINDING_LABELS,
  CRITICAL_FINDING_TYPES,
  DESCRIPTION_MAX,
  amend,
  buildMessage,
  createFinding,
  dispatch,
  escalationState,
  pendingAcknowledgement,
  pendingDispatch,
  type CriticalFinding,
  type CriticalFindingType,
  type NotificationChannel,
  type Recipient,
} from '../criticalFindings';

/* ------------------------------------------------------------------ */
/* Props                                                              */
/* ------------------------------------------------------------------ */

export interface CriticalFindingsPanelProps {
  /** Achados deste estudo, do mais antigo ao mais novo. */
  findings: readonly CriticalFinding[];
  studyInstanceUid: string;
  patientId?: string;
  patientName?: string;
  /** Quem esta laudando. */
  radiologist: Recipient;
  /** Destinatarios possiveis, resolvidos pelo hospedeiro. */
  recipients: readonly Recipient[];
  /** Link autenticado do estudo, que e o que carrega a identidade. */
  studyLink: string;
  /**
   * Identificador do proximo achado, gerado pelo hospedeiro.
   *
   * O painel nao sorteia: sem ele o formulario de abertura nao e oferecido, porque um achado
   * critico sem identificador nao pode ser rastreado depois.
   */
  newFindingId?: string;
  /** Politica da instituicao sobre nome do paciente em canal de terceiros. */
  allowPatientNameInMessage?: boolean;
  /** Instante. Re-derivado a cada render, de proposito. Ver o cabecalho. */
  nowMs: number;
  onCreate?: (result: ReturnType<typeof createFinding>) => void;
  /** So para telefone: a comunicacao ja aconteceu e o painel a registra. */
  onDispatch?: (result: ReturnType<typeof dispatch>) => void;
  /**
   * Canal de maquina: o hospedeiro transporta e depois registra o resultado real.
   *
   * O painel entrega a mensagem exata que previu na tela, para que o que o radiologista leu e o
   * que sai sejam o mesmo texto.
   */
  onRequestSend?: (finding: CriticalFinding, channel: NotificationChannel, message: string) => void;
  onAmend?: (result: ReturnType<typeof amend>) => void;
  servicesManager?: { services: Record<string, unknown> };
}

const ESCALATION_ORDER: string[] = ['unsent', 'supervisor', 'callNow', 'awaiting', 'none'];

/* ------------------------------------------------------------------ */
/* Componente                                                         */
/* ------------------------------------------------------------------ */

export default function CriticalFindingsPanel({
  findings,
  studyInstanceUid,
  patientId,
  patientName,
  radiologist,
  recipients,
  studyLink,
  newFindingId,
  allowPatientNameInMessage,
  nowMs,
  onCreate,
  onDispatch,
  onRequestSend,
  onAmend,
}: CriticalFindingsPanelProps): JSX.Element {
  const [findingType, setFindingType] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [createError, setCreateError] = useState<string | null>(null);

  const [channel, setChannel] = useState<Record<string, string>>({});
  const [verbal, setVerbal] = useState<Record<string, boolean>>({});
  const [withName, setWithName] = useState<Record<string, boolean>>({});
  const [dispatchError, setDispatchError] = useState<Record<string, string>>({});

  const [amendment, setAmendment] = useState<Record<string, string>>({});
  const [amendError, setAmendError] = useState<Record<string, string>>({});

  const list = useMemo(() => (findings ?? []) as CriticalFinding[], [findings]);

  /*
    Derivado de `nowMs`, nunca de um relogio proprio nem de uma leitura na montagem. Ver o
    cabecalho: um cronometro parado aqui e o mesmo defeito que o nucleo evitou nao guardando
    flag.
  */
  const unsent = useMemo(() => pendingDispatch(list), [list]);
  const awaiting = useMemo(() => pendingAcknowledgement(list, nowMs), [list, nowMs]);

  const ordered = useMemo(() => {
    const withLevel = list.map(f => ({ finding: f, state: escalationState(f, nowMs) }));
    return withLevel.sort(
      (a, b) =>
        ESCALATION_ORDER.indexOf(a.state.level) - ESCALATION_ORDER.indexOf(b.state.level) ||
        a.finding.createdAt - b.finding.createdAt
    );
  }, [list, nowMs]);

  const submitNew = useCallback(() => {
    const picked = (recipients ?? []).filter(r => chosen[r.id]);
    const result = createFinding({
      id: newFindingId ?? '',
      studyInstanceUid,
      findingType: findingType as CriticalFindingType,
      description,
      radiologist,
      recipients: picked as Recipient[],
      now: nowMs,
      patientId,
      patientName,
    });
    setCreateError(result.finding ? null : result.error ?? null);
    if (onCreate) {
      onCreate(result);
    }
  }, [
    recipients,
    chosen,
    newFindingId,
    studyInstanceUid,
    findingType,
    description,
    radiologist,
    nowMs,
    patientId,
    patientName,
    onCreate,
  ]);

  /**
   * Dois caminhos, e a diferenca esta no cabecalho.
   *
   * `message` chega de fora em vez de ser recalculada aqui: e literalmente o no que foi
   * renderizado na previa, entao o texto que o radiologista leu e o texto que sai.
   */
  const send = useCallback(
    (finding: CriticalFinding, message: string) => {
      const chan = channel[finding.id] as NotificationChannel;

      if (chan !== 'phone') {
        // O transporte ainda nao rodou. Nada e escrito, e o achado segue pendente.
        setDispatchError(prev => {
          const next = { ...prev };
          delete next[finding.id];
          return next;
        });
        if (!chan) {
          /*
            A razao vem do nucleo em vez de ser redigitada aqui. `dispatch` e puro e devolve o
            achado inalterado numa recusa, entao chama-lo para obter a mensagem nao escreve nada.
          */
          const refusal = dispatch(finding, { channel: chan, now: nowMs });
          setDispatchError(prev => ({
            ...prev,
            [finding.id]: refusal.error ?? '',
          }));
          return;
        }
        if (onRequestSend) {
          onRequestSend(finding, chan, message);
        }
        return;
      }

      const result = dispatch(finding, {
        channel: chan,
        now: nowMs,
        verballyConfirmed: verbal[finding.id] === true,
      });
      setDispatchError(prev => {
        const next = { ...prev };
        if (result.ok) {
          delete next[finding.id];
        } else {
          next[finding.id] = result.error ?? 'Falha no envio.';
        }
        return next;
      });
      if (onDispatch) {
        onDispatch(result);
      }
    },
    [channel, verbal, nowMs, onDispatch, onRequestSend]
  );

  const submitAmend = useCallback(
    (finding: CriticalFinding) => {
      const result = amend(finding, amendment[finding.id] ?? '', radiologist?.id ?? '', nowMs);
      setAmendError(prev => {
        const next = { ...prev };
        if (result.ok) {
          delete next[finding.id];
        } else {
          next[finding.id] = result.error ?? '';
        }
        return next;
      });
      if (onAmend) {
        onAmend(result);
      }
    },
    [amendment, radiologist, nowMs, onAmend]
  );

  const over = description.trim().length > DESCRIPTION_MAX;

  return (
    <div className="rt-critical" data-testid="rt-critical">
      {/*
        Bloqueio sem saida por clique. Some quando o envio acontece, e nao quando alguem
        concorda em ignorar.
      */}
      {unsent.length > 0 ? (
        <section data-testid="cf-blocker" data-count={unsent.length}>
          <p data-testid="cf-blocker-text">
            {unsent.length +
              ' achado(s) critico(s) aberto(s) e NAO comunicado(s). O laudo nao deve ser ' +
              'finalizado antes do envio.'}
          </p>
        </section>
      ) : null}

      <section data-testid="cf-summary">
        <p data-testid="cf-count-unsent">{unsent.length}</p>
        <p data-testid="cf-count-awaiting">{awaiting.length}</p>
      </section>

      <ul data-testid="cf-list">
        {ordered.map(({ finding, state }) => {
          const chan = channel[finding.id] ?? '';
          const nameAllowed = allowPatientNameInMessage === true;
          const includeName = nameAllowed && withName[finding.id] === true;
          const preview =
            finding.recipients.length > 0
              ? buildMessage(finding, finding.recipients[0], {
                  studyLink,
                  includePatientName: includeName,
                })
              : '';
          return (
            <li
              key={finding.id}
              data-testid={'cf-item-' + finding.id}
              data-level={state.level}
              data-sent={finding.sentAt ? 'true' : 'false'}
              data-acknowledged={finding.acknowledgedAt ? 'true' : 'false'}
            >
              <h3 data-testid={'cf-label-' + finding.id}>
                {CRITICAL_FINDING_LABELS[finding.findingType]}
              </h3>
              {/* A mensagem de estado vem do nucleo, que e quem tem o relogio. */}
              <p data-testid={'cf-state-' + finding.id}>{state.message}</p>
              {state.elapsedMs !== null ? (
                <p data-testid={'cf-elapsed-' + finding.id}>
                  {Math.floor(state.elapsedMs / 60000) + ' min desde o envio'}
                </p>
              ) : null}

              {/* Descricao original: sem campo de edicao. Ver o cabecalho. */}
              <p data-testid={'cf-description-' + finding.id}>{finding.description}</p>

              <ol data-testid={'cf-events-' + finding.id}>
                {finding.events.map((event, index) => (
                  <li
                    key={String(index) + '-' + event.type + '-' + String(event.at)}
                    data-testid={'cf-event-' + finding.id + '-' + String(index)}
                    data-type={event.type}
                  >
                    {event.type + (event.channel ? ' (' + event.channel + ')' : '')}
                    {event.note ? <span data-testid={'cf-event-note-' + finding.id + '-' + String(index)}>{event.note}</span> : null}
                  </li>
                ))}
              </ol>

              {!finding.sentAt ? (
                <div data-testid={'cf-dispatch-' + finding.id}>
                  <select
                    data-testid={'cf-channel-' + finding.id}
                    aria-label="Canal"
                    value={chan}
                    onChange={e =>
                      setChannel(prev => ({ ...prev, [finding.id]: e.target.value }))
                    }
                  >
                    <option value="">Selecione o canal</option>
                    <option value="phone">Telefone</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="email">E-mail</option>
                  </select>

                  {/*
                    Atestacao de quem envia, nunca marcada por padrao: marca-la por conveniencia
                    poria no registro que houve conversa verbal sem ninguem ter afirmado isso.
                  */}
                  {chan === 'phone' ? (
                    <label>
                      <input
                        type="checkbox"
                        data-testid={'cf-verbal-' + finding.id}
                        checked={verbal[finding.id] === true}
                        onChange={e =>
                          setVerbal(prev => ({ ...prev, [finding.id]: e.target.checked }))
                        }
                      />
                      Declaro que falei diretamente com o destinatario.
                    </label>
                  ) : null}

                  {nameAllowed ? (
                    <label>
                      <input
                        type="checkbox"
                        data-testid={'cf-with-name-' + finding.id}
                        checked={withName[finding.id] === true}
                        onChange={e =>
                          setWithName(prev => ({ ...prev, [finding.id]: e.target.checked }))
                        }
                      />
                      Incluir o nome do paciente na mensagem.
                    </label>
                  ) : null}

                  {/* Previa antes do envio: quem envia le o que sai. */}
                  <p data-testid={'cf-preview-' + finding.id}>{preview}</p>

                  {/*
                    O rotulo diz qual dos dois caminhos e. "Registrar" e um ato sobre algo que
                    aconteceu; "Solicitar" e um pedido cujo resultado ainda vem.
                  */}
                  <button
                    type="button"
                    onClick={() => send(finding, preview)}
                    data-testid={'cf-send-' + finding.id}
                  >
                    {chan === 'phone'
                      ? 'Registrar a ligacao feita'
                      : 'Solicitar envio ao sistema'}
                  </button>
                  {dispatchError[finding.id] ? (
                    <p data-testid={'cf-send-error-' + finding.id}>
                      {dispatchError[finding.id]}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p data-testid={'cf-sent-via-' + finding.id}>{String(finding.sentVia)}</p>
              )}

              <div data-testid={'cf-amend-' + finding.id}>
                <input
                  data-testid={'cf-amend-input-' + finding.id}
                  aria-label="Complemento"
                  value={amendment[finding.id] ?? ''}
                  onChange={e =>
                    setAmendment(prev => ({ ...prev, [finding.id]: e.target.value }))
                  }
                />
                <button
                  type="button"
                  onClick={() => submitAmend(finding)}
                  data-testid={'cf-amend-save-' + finding.id}
                >
                  Anexar complemento
                </button>
                {amendError[finding.id] ? (
                  <p data-testid={'cf-amend-error-' + finding.id}>{amendError[finding.id]}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {/* Abertura: sem identificador do hospedeiro o formulario nao e oferecido. */}
      {newFindingId ? (
        <section data-testid="cf-new">
          <select
            data-testid="cf-new-type"
            aria-label="Tipo do achado"
            value={findingType}
            onChange={e => setFindingType(e.target.value)}
          >
            <option value="">Selecione o tipo</option>
            {CRITICAL_FINDING_TYPES.map(type => (
              <option key={type} value={type}>
                {CRITICAL_FINDING_LABELS[type]}
              </option>
            ))}
          </select>

          {/* Sem maxLength: o corte silencioso e pior que a recusa. Ver o cabecalho. */}
          <textarea
            data-testid="cf-new-description"
            aria-label="Descricao do achado"
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
          <p data-testid="cf-new-counter" data-over={over ? 'true' : 'false'}>
            {description.trim().length + '/' + DESCRIPTION_MAX}
          </p>

          <fieldset data-testid="cf-new-recipients">
            {(recipients ?? []).map(recipient => (
              <label key={recipient.id}>
                <input
                  type="checkbox"
                  data-testid={'cf-recipient-' + recipient.id}
                  checked={chosen[recipient.id] === true}
                  onChange={e =>
                    setChosen(prev => ({ ...prev, [recipient.id]: e.target.checked }))
                  }
                />
                {recipient.name}
              </label>
            ))}
          </fieldset>

          <button type="button" onClick={submitNew} data-testid="cf-new-save">
            Abrir achado critico
          </button>
          {createError ? <p data-testid="cf-new-error">{createError}</p> : null}
        </section>
      ) : (
        <p data-testid="cf-new-unavailable">
          Identificador do achado nao fornecido pelo hospedeiro. Abrir um achado critico sem
          identificador o tornaria irrastreavel.
        </p>
      )}
    </div>
  );
}
