/**
 * Painel de fala para estrutura (RTV-225).
 *
 * O nucleo `../voiceStructure` extrai entidades, decide o que pode ser comitado, separa ditado
 * de comando e registra o destino da transcricao. A UI tem quatro maneiras de desfazer isso, e
 * cada uma tem uma regra aqui.
 *
 * ## O chip que se auto-confirma
 *
 * Um chip que aparece e "some" para dentro do campo estruturado depois de um instante parece
 * fluido, e e a coisa mais perigosa que este painel poderia fazer. Texto livre e lido por um
 * humano antes da assinatura; dado estruturado nao e lido por ninguem -- vai para o registro
 * de cancer, para a categoria RADS e para a fila de seguimento, e o unico contato do
 * radiologista com ele foi um chip que apareceu enquanto ele olhava a imagem.
 *
 * Entao nenhum chip se comita sozinho: cada um tem um ato explicito, nao existe temporizador e
 * nao existe "confirmar todos". Ha teste varrendo os controles para garantir que continue
 * assim.
 *
 * ## Confianca baixa desenhada igual a confianca alta
 *
 * O nucleo marca a lateralidade vinda de uma letra como confianca baixa, com a ressalva de que
 * o reconhecedor troca "D" e "E" e que uma troca de lado manda o cirurgiao ao pulmao errado. Se
 * o painel desenhasse os dois chips iguais, a ressalva estaria no objeto e nao na tela -- e a
 * ressalva do nucleo fica visivel NO chip, nao num tooltip.
 *
 * E o campo de correcao aparece exatamente onde `voiceCommitChip` recusaria sem correcao. A
 * condicao nao e reescrita aqui: o painel pergunta ao nucleo, chamando-o com o chip. Um teste
 * varre todos os chips e exige que "ofereceu correcao" e "o nucleo recusa" sejam o mesmo
 * conjunto, para que a regra nao possa divergir depois.
 *
 * ## Rotulo de valor inventado pela UI
 *
 * `chip.value` de polaridade e `present`, e de lateralidade e `right`: valores de maquina. O
 * nucleo publica `VOICE_POLARITY_LABELS` e `VOICE_LATERALITY_LABELS` justamente para que a
 * traducao nao seja reescrita em cada tela -- duas telas traduzindo `unknown` por conta propria
 * viram "desconhecido" numa e "ausente" na outra, e a segunda e uma afirmacao clinica.
 *
 * ## A confirmacao de comando destrutivo que sobrevive a fala seguinte
 *
 * Confirmar "apagar achado" e nao executar, e em seguida dizer "assinar laudo", nao pode
 * encontrar a confirmacao ainda de pe. Aqui a confirmacao guarda a fala que foi confirmada e
 * so vale para ela; qualquer outra fala volta a exigir confirmacao. Prender a confirmacao ao
 * texto e mais estrito que prende-la ao comando, porque falas diferentes podem cair no mesmo
 * comando mas a mesma fala nunca cai em comandos diferentes.
 *
 * Em modo de ditado o painel nunca executa: passa o texto. Quando a fala ditada parece um
 * comando ele oferece uma dica, via `voiceLooksLikeCommand`, que existe para a UI sugerir sem
 * agir.
 *
 * Sem import de outra extensao (RTV-114). O reconhecedor de fala fica no hospedeiro: este
 * painel recebe transcricao e devolve intencoes.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  VOICE_LATERALITY_LABELS,
  VOICE_MODE_COMMAND,
  VOICE_MODE_DICTATION,
  VOICE_MODE_LABELS,
  VOICE_POLARITY_LABELS,
  VOICE_RETENTION_LABELS,
  voiceCommitChip,
  voiceDecideRetention,
  voiceExtract,
  voiceInterpret,
  voiceLooksLikeCommand,
  type VoiceChip,
  type VoiceChipKind,
  type VoiceMode,
  type VoiceRetentionAction,
} from '../voiceStructure';

/* ------------------------------------------------------------------ */
/* Props                                                              */
/* ------------------------------------------------------------------ */

export interface VoiceStructurePanelProps {
  /** Transcricao da ultima fala, vinda do reconhecedor do hospedeiro. */
  utterance: string;
  /** Modo corrente. Decidido pelo hospedeiro, para que o pedal e o atalho concordem. */
  mode: VoiceMode;
  /** Campo em foco quando a fala comecou e campo em foco agora. */
  fieldIdAtStart?: string;
  fieldIdNow?: string;
  /** Ligacoes CDE por tipo de entidade, quando a instituicao as define. */
  cdeBindings?: Partial<Record<VoiceChipKind, string>>;
  /** Quem confirma e quem decide a retencao. */
  actorId: string;
  /** Instante, injetado. */
  nowMs: number;
  onModeChange?: (mode: VoiceMode) => void;
  onInsertText?: (text: string, fieldId?: string) => void;
  onRunCommand?: (commandId: string) => void;
  onCommitChip?: (outcome: ReturnType<typeof voiceCommitChip>) => void;
  onDecideRetention?: (outcome: ReturnType<typeof voiceDecideRetention>) => void;
  servicesManager?: { services: Record<string, unknown> };
}

/* ------------------------------------------------------------------ */
/* Rotulo de valor: sempre do nucleo                                  */
/* ------------------------------------------------------------------ */

function chipValueLabel(chip: VoiceChip): string {
  if (chip.kind === 'polarity' && chip.polarity) {
    return VOICE_POLARITY_LABELS[chip.polarity];
  }
  if (chip.kind === 'laterality' && chip.laterality) {
    return VOICE_LATERALITY_LABELS[chip.laterality];
  }
  if (chip.kind === 'measurement') {
    // A unidade existe por construcao: `voiceParseMeasurement` recusa medida sem unidade, e
    // `voiceExtract` so cria o chip quando ela foi dita. Nao ha aqui o caso "numero sem
    // unidade" para o painel ter que representar.
    const dims =
      chip.secondValue !== undefined
        ? String(chip.value) + ' x ' + String(chip.secondValue)
        : String(chip.value);
    return dims + ' ' + (chip.unit ?? '');
  }
  return String(chip.value);
}

/* ------------------------------------------------------------------ */
/* Componente                                                         */
/* ------------------------------------------------------------------ */

export default function VoiceStructurePanel({
  utterance,
  mode,
  fieldIdAtStart,
  fieldIdNow,
  cdeBindings,
  actorId,
  nowMs,
  onModeChange,
  onInsertText,
  onRunCommand,
  onCommitChip,
  onDecideRetention,
}: VoiceStructurePanelProps): JSX.Element {
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [committed, setCommitted] = useState<Record<string, string>>({});
  const [refusals, setRefusals] = useState<Record<string, string>>({});
  const [actRefusal, setActRefusal] = useState<string | null>(null);
  /** A fala que foi confirmada, nao um booleano. Ver o cabecalho. */
  const [confirmedUtterance, setConfirmedUtterance] = useState<string | null>(null);

  const [retentionAction, setRetentionAction] = useState<string>('');
  const [retainDays, setRetainDays] = useState<string>('');
  const [leavesInstitution, setLeavesInstitution] = useState<boolean>(false);
  const [providerId, setProviderId] = useState<string>('');
  const [justification, setJustification] = useState<string>('');
  const [retentionRefusal, setRetentionRefusal] = useState<string | null>(null);
  const [retentionSettled, setRetentionSettled] = useState<string | null>(null);

  const extraction = useMemo(
    () => voiceExtract({ utterance, cdeBindings }),
    [utterance, cdeBindings]
  );

  const interpretation = useMemo(
    () =>
      voiceInterpret({
        utterance,
        mode,
        fieldIdAtStart,
        fieldIdNow,
        destructiveConfirmed: confirmedUtterance !== null && confirmedUtterance === utterance,
      }),
    [utterance, mode, fieldIdAtStart, fieldIdNow, confirmedUtterance]
  );

  /** Dica sem acao: existe para sugerir o modo, nunca para executar em ditado. */
  const looksLikeCommand = useMemo(
    () => (mode === VOICE_MODE_DICTATION ? voiceLooksLikeCommand(utterance) : null),
    [mode, utterance]
  );

  /**
   * Pergunta ao nucleo, com este chip, se ele seria recusado sem correcao.
   *
   * A alternativa era repetir a condicao ("polaridade unknown ou lateralidade low"), que e a
   * forma de a UI passar a discordar do nucleo depois de uma mudanca de regra.
   */
  const needsCorrection = useCallback(
    (chip: VoiceChip): boolean =>
      voiceCommitChip({ chip, confirmedBy: actorId, confirmedAt: nowMs }).ok === false,
    [actorId, nowMs]
  );

  const commit = useCallback(
    (chip: VoiceChip) => {
      const corrected = corrections[chip.chipId];
      const outcome = voiceCommitChip({
        chip,
        confirmedBy: actorId,
        confirmedAt: nowMs,
        correctedValue: corrected !== undefined && corrected !== '' ? corrected : undefined,
      });
      if (!outcome.ok) {
        setRefusals(prev => ({ ...prev, [chip.chipId]: outcome.reason }));
        return;
      }
      setRefusals(prev => {
        const next = { ...prev };
        delete next[chip.chipId];
        return next;
      });
      setCommitted(prev => ({ ...prev, [chip.chipId]: chipValueLabel(outcome.value) }));
      if (onCommitChip) {
        onCommitChip(outcome);
      }
    },
    [corrections, actorId, nowMs, onCommitChip]
  );

  const act = useCallback(() => {
    if (!interpretation.ok) {
      setActRefusal(interpretation.reason);
      return;
    }
    setActRefusal(null);
    const value = interpretation.value;
    if (value.mode === VOICE_MODE_DICTATION) {
      if (onInsertText) {
        onInsertText(value.text ?? '', value.targetFieldId);
      }
      return;
    }
    if (value.command && onRunCommand) {
      onRunCommand(value.command.commandId);
    }
    // A confirmacao vale uma vez.
    setConfirmedUtterance(null);
  }, [interpretation, onInsertText, onRunCommand]);

  const decideRetention = useCallback(() => {
    const outcome = voiceDecideRetention({
      action: retentionAction as VoiceRetentionAction,
      retainDays: retainDays === '' ? undefined : Number(retainDays),
      transcriptLeavesInstitution: leavesInstitution,
      providerId,
      decidedBy: actorId,
      decidedAt: nowMs,
      justification,
    });
    if (!outcome.ok) {
      setRetentionRefusal(outcome.reason);
      setRetentionSettled(null);
    } else {
      setRetentionRefusal(null);
      setRetentionSettled(VOICE_RETENTION_LABELS[outcome.value.action]);
    }
    if (onDecideRetention) {
      onDecideRetention(outcome);
    }
  }, [
    retentionAction,
    retainDays,
    leavesInstitution,
    providerId,
    justification,
    actorId,
    nowMs,
    onDecideRetention,
  ]);

  return (
    <div className="rt-voice" data-testid="rt-voice">
      <header>
        <p data-testid="voice-mode" data-mode={mode}>
          {VOICE_MODE_LABELS[mode]}
        </p>
        <button
          type="button"
          onClick={() =>
            onModeChange &&
            onModeChange(mode === VOICE_MODE_COMMAND ? VOICE_MODE_DICTATION : VOICE_MODE_COMMAND)
          }
          data-testid="voice-toggle-mode"
        >
          {mode === VOICE_MODE_COMMAND ? 'Voltar ao ditado' : 'Entrar em modo de comando'}
        </button>
      </header>

      <p data-testid="voice-utterance">{utterance}</p>

      {/* Dica, nao acao. Em ditado nada executa. */}
      {looksLikeCommand ? (
        <p data-testid="voice-command-hint">
          {'"' +
            looksLikeCommand.label +
            '" soa como um comando. Em ditado nada e executado -- entre em modo de comando ' +
            'para usa-lo.'}
        </p>
      ) : null}

      <section data-testid="voice-action">
        {interpretation.ok ? (
          interpretation.value.mode === VOICE_MODE_DICTATION ? (
            /*
              Frase propria, e nao `interpretation.value.message`: a do nucleo esta no passado
              ("Texto ditado inserido em achados") porque descreve um resultado, e aqui nada foi
              inserido ainda. O campo vem do nucleo; a conjugacao e da tela.
            */
            <p data-testid="voice-will-insert">
              {'Sera inserido em ' + (interpretation.value.targetFieldId ?? 'campo em foco') + '.'}
            </p>
          ) : (
            <p data-testid="voice-will-run">{interpretation.value.message}</p>
          )
        ) : (
          <p data-testid="voice-interpret-refusal" data-code={interpretation.code}>
            {interpretation.reason}
          </p>
        )}

        {/* Destrutivo pede confirmacao, e a confirmacao fica presa a esta fala. */}
        {!interpretation.ok && interpretation.code === 'destructive-unconfirmed' ? (
          <button
            type="button"
            onClick={() => setConfirmedUtterance(utterance)}
            data-testid="voice-confirm-destructive"
          >
            Confirmar acao irreversivel
          </button>
        ) : null}

        <button type="button" onClick={act} data-testid="voice-act">
          {mode === VOICE_MODE_COMMAND ? 'Executar' : 'Inserir texto'}
        </button>
        {actRefusal ? <p data-testid="voice-act-refusal">{actRefusal}</p> : null}
      </section>

      {extraction.ok ? (
        <ul data-testid="voice-chips">
          {extraction.value.chips.map(chip => {
            const settled = committed[chip.chipId];
            const correctable = needsCorrection(chip);
            return (
              <li
                key={chip.chipId}
                data-testid={'voice-chip-' + chip.kind}
                data-confidence={chip.confidence}
                data-confirmed={settled !== undefined ? 'true' : 'false'}
                /*
                  Sem `aria-label` proprio. `voiceDescribeChip` existe no nucleo mas devolve
                  `laterality - right - confianca baixa`: valor de maquina e nome em ingles, uma
                  linha de log. Usa-la aqui daria ao leitor de tela "right" enquanto a tela
                  mostra "direito" -- o texto visivel e o texto acessivel, e sao o mesmo.
                */
              >
                {/* Rotulo do nucleo, nunca traduzido aqui. */}
                <span data-testid={'voice-chip-value-' + chip.kind}>{chipValueLabel(chip)}</span>
                {chip.cdeElementId ? (
                  <span data-testid={'voice-chip-cde-' + chip.kind}>{chip.cdeElementId}</span>
                ) : null}
                {chip.confidence === 'low' ? (
                  <span data-testid={'voice-chip-low-' + chip.kind}>confianca baixa</span>
                ) : null}
                {/* A ressalva do nucleo fica NO chip. */}
                {chip.caution ? (
                  <span data-testid={'voice-chip-caution-' + chip.kind}>{chip.caution}</span>
                ) : null}

                {settled !== undefined ? (
                  <span data-testid={'voice-chip-settled-' + chip.kind}>
                    {'Confirmado: ' + settled}
                  </span>
                ) : (
                  <>
                    {correctable ? (
                      <input
                        data-testid={'voice-chip-correct-' + chip.kind}
                        aria-label={'Corrigir ' + chip.kind}
                        value={corrections[chip.chipId] ?? ''}
                        onChange={e =>
                          setCorrections(prev => ({ ...prev, [chip.chipId]: e.target.value }))
                        }
                      />
                    ) : null}
                    <button
                      type="button"
                      onClick={() => commit(chip)}
                      data-testid={'voice-chip-confirm-' + chip.kind}
                      /* Um chip por botao. Ver o cabecalho. */
                      data-single-chip="true"
                    >
                      Confirmar
                    </button>
                  </>
                )}

                {refusals[chip.chipId] ? (
                  <p data-testid={'voice-chip-refusal-' + chip.kind}>{refusals[chip.chipId]}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p data-testid="voice-extract-refusal" data-code={extraction.code}>
          {extraction.reason}
        </p>
      )}

      {extraction.ok && extraction.value.needsConfirmation.length > 0 ? (
        <p data-testid="voice-pending">
          {extraction.value.message +
            ' Nenhuma entra em campo estruturado sem um ato explicito.'}
        </p>
      ) : null}

      <section data-testid="voice-retention">
        {/*
          Sem opcao pre-selecionada. "manter" como padrao seria a instalacao decidindo guardar
          a gravacao de um medico discutindo um paciente nomeado porque ninguem mexeu no campo.
        */}
        <label htmlFor="voice-retention-action">Destino da transcricao</label>
        <select
          id="voice-retention-action"
          data-testid="voice-retention-action"
          value={retentionAction}
          onChange={e => setRetentionAction(e.target.value)}
        >
          <option value="">Nao decidido</option>
          <option value="keep">{VOICE_RETENTION_LABELS.keep}</option>
          <option value="discard-after-confirmation">
            {VOICE_RETENTION_LABELS['discard-after-confirmation']}
          </option>
          <option value="discard-on-signature">
            {VOICE_RETENTION_LABELS['discard-on-signature']}
          </option>
        </select>

        {/* O prazo aparece so onde ele significa algo, e o nucleo o exige. */}
        {retentionAction === 'keep' ? (
          <input
            data-testid="voice-retention-days"
            aria-label="Prazo em dias"
            value={retainDays}
            onChange={e => setRetainDays(e.target.value)}
          />
        ) : null}

        <label htmlFor="voice-retention-leaves">A transcricao sai da instituicao</label>
        <input
          id="voice-retention-leaves"
          type="checkbox"
          data-testid="voice-retention-leaves"
          checked={leavesInstitution}
          onChange={e => setLeavesInstitution(e.target.checked)}
        />
        {leavesInstitution ? (
          <input
            data-testid="voice-retention-provider"
            aria-label="Provedor de reconhecimento"
            value={providerId}
            onChange={e => setProviderId(e.target.value)}
          />
        ) : null}

        <input
          data-testid="voice-retention-justification"
          aria-label="Justificativa"
          value={justification}
          onChange={e => setJustification(e.target.value)}
        />

        <button type="button" onClick={decideRetention} data-testid="voice-retention-save">
          Registrar decisao
        </button>
        {retentionRefusal ? (
          <p data-testid="voice-retention-refusal">{retentionRefusal}</p>
        ) : null}
        {retentionSettled ? (
          <p data-testid="voice-retention-settled">{retentionSettled}</p>
        ) : null}
      </section>
    </div>
  );
}
