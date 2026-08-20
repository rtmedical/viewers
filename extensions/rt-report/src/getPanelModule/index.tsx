/**
 * getPanelModule da rt-report (RTV-222) — primeiro painel desta extensao.
 *
 * O painel e opt-in pelo modo, via
 * '@ohif/extension-rt-report.panelModule.reportingHub'.
 *
 * As props de dados (`queue`, `filter`) sao injetadas pelo modo ou por um wrapper: este
 * modulo NAO busca a fila. Manter o fetch fora daqui e o que deixa o painel testavel sem
 * rede e o que permite ao chamador dizer explicitamente se a fila esta carregando, falhou
 * ou carregou vazia -- a distincao que o nucleo existe para proteger.
 */
import React from 'react';
import ReportingHubPanel, { type HubPanelQueue } from './ReportingHubPanel';
import SignOffPanel from './SignOffPanel';
import AiCopilotPanel from './AiCopilotPanel';
import VersionDiffPanel from './VersionDiffPanel';
import DictationRecorderPanel from './DictationRecorderPanel';
import VoiceStructurePanel from './VoiceStructurePanel';
import type { HubFilterContext } from '../hubQueue';
import type { SignReportDraft, SignSignature } from '../signOff';
import type { AiPolicy, AiSegment, AiSuggestion } from '../aiCopilot';
import type { DiffReportVersion } from '../versionDiff';
import type { AudioBinding, AudioCapture, AudioEnvironment, AudioSignalSummary } from '../audioCapture';
import { VOICE_MODE_DICTATION, type VoiceChipKind, type VoiceMode } from '../voiceStructure';

interface PanelModuleParams {
  servicesManager: { services: Record<string, any> };
  commandsManager?: { runCommand: (name: string, options?: Record<string, unknown>) => unknown };
  extensionManager?: unknown;
}

/**
 * Estado inicial quando nenhum provedor injetou a fila.
 *
 * `loading` e nao uma lista vazia, de proposito: um painel montado sem provedor nao sabe se
 * ha estudos, e "nenhum estudo pendente" seria uma afirmacao que ninguem verificou.
 */
const UNPROVIDED_QUEUE: HubPanelQueue = { status: 'loading' };

const DEPARTMENT_FILTER: HubFilterContext = {
  label: 'todos os estudos do departamento',
};

function getPanelModule({ servicesManager }: PanelModuleParams) {
  return [
    {
      name: 'reportingHub',
      iconName: 'tab-studies',
      iconLabel: 'Laudos',
      label: 'Fila de laudos',
      component: (props: Record<string, unknown>) => (
        <ReportingHubPanel
          queue={(props.queue as HubPanelQueue) ?? UNPROVIDED_QUEUE}
          filter={(props.filter as HubFilterContext) ?? DEPARTMENT_FILTER}
          slaReference={props.slaReference as never}
          nowMs={props.nowMs as number | undefined}
          onRefresh={props.onRefresh as (() => void) | undefined}
          onOpenStudy={props.onOpenStudy as never}
          servicesManager={servicesManager}
        />
      ),
    },
    {
      name: 'signOff',
      iconName: 'tab-linear',
      iconLabel: 'Assinatura',
      label: 'Assinatura do laudo',
      /**
       * O painel NAO cria a assinatura: ele avalia a prontidao pelo nucleo e delega o ato
       * a `onSign`. Criar a assinatura exige digesto, signatario e delegacoes, que sao do
       * hospedeiro -- e manter isso fora daqui e o que deixa o portao testavel sem
       * infraestrutura de certificado.
       */
      component: (props: Record<string, unknown>) => {
        const draft = props.draft as SignReportDraft | undefined;
        if (!draft) {
          // Sem rascunho nao ha o que avaliar, e renderizar "pode assinar" seria uma
          // afirmacao sobre um laudo que nao chegou.
          return <p data-testid="sign-no-draft">Nenhum laudo em edicao.</p>;
        }
        return (
          <SignOffPanel
            draft={draft}
            signature={props.signature as SignSignature | null | undefined}
            onSign={props.onSign as never}
            onFocusSubject={props.onFocusSubject as never}
            onOpenDistribution={props.onOpenDistribution as never}
            servicesManager={servicesManager}
          />
        );
      },
    },
    {
      name: 'aiCopilot',
      iconName: 'tab-linear',
      iconLabel: 'IA',
      label: 'Copiloto de IA',
      /**
       * A politica e obrigatoria e vem do hospedeiro. Sem ela o painel nao decide se a IA
       * roda -- e "assumir habilitado" poria sugestoes de maquina na frente de um
       * radiologista de uma instituicao que decidiu contra (ver RTV-230).
       */
      component: (props: Record<string, unknown>) => {
        const policy = props.policy as AiPolicy | undefined;
        if (!policy) {
          return (
            <p data-testid="ai-no-policy">
              Politica de IA nao informada. O copiloto nao roda sem ela.
            </p>
          );
        }
        return (
          <AiCopilotPanel
            policy={policy}
            context={(props.context as { role: string; modality: string }) ?? { role: '', modality: '' }}
            suggestions={(props.suggestions as readonly AiSuggestion[]) ?? []}
            segments={(props.segments as readonly AiSegment[]) ?? []}
            currentReportVersion={(props.currentReportVersion as number) ?? 1}
            actorId={(props.actorId as string) ?? ''}
            nowMs={props.nowMs as number}
            onDecision={props.onDecision as never}
            servicesManager={servicesManager}
          />
        );
      },
    },
    {
      name: 'versionDiff',
      iconName: 'tab-linear',
      iconLabel: 'Versoes',
      label: 'Comparar versoes',
      /**
       * Exige o historico COMPLETO, e nao as duas versoes: o nucleo precisa dele para
       * detectar versoes saltadas e dizer quais secoes existiram apenas nelas -- que e o
       * aviso sem o qual o revisor conclui que um adendo nunca existiu.
       */
      component: (props: Record<string, unknown>) => {
        const history = props.history as readonly DiffReportVersion[] | undefined;
        if (!history || history.length === 0) {
          return (
            <p data-testid="diff-no-history">
              Historico de versoes nao informado. Sem ele nao e possivel comparar nem dizer o
              que ficou de fora.
            </p>
          );
        }
        return (
          <VersionDiffPanel
            history={history}
            baseVersionId={(props.baseVersionId as string) ?? ''}
            targetVersionId={(props.targetVersionId as string) ?? ''}
            currentVersionId={(props.currentVersionId as string) ?? ''}
            reviewerId={(props.reviewerId as string) ?? ''}
            nowMs={props.nowMs as number}
            onDecision={props.onDecision as never}
            servicesManager={servicesManager}
          />
        );
      },
    },
    {
      name: 'dictationRecorder',
      iconName: 'tab-linear',
      iconLabel: 'Ditado',
      label: 'Gravador de ditado',
      /**
       * O MediaRecorder e o AudioContext ficam no hospedeiro. O painel recebe o ambiente
       * observado e o resumo de sinal AO VIVO, e devolve intencoes -- o que o mantem
       * testavel sem microfone e o que permite ao indicador mostrar o nivel real em vez do
       * estado do gravador.
       *
       * Sem ambiente o painel nao roda: assumir "pronto para gravar" poria um ponto
       * vermelho na tela sem nada atras dele, que e a falha exata que este painel existe
       * para impedir.
       */
      component: (props: Record<string, unknown>) => {
        const environment = props.environment as AudioEnvironment | undefined;
        const binding = props.binding as AudioBinding | undefined;
        if (!environment || !binding) {
          return (
            <p data-testid="rec-no-context">
              Ambiente de captura ou laudo em foco nao informados. O gravador nao roda sem
              os dois.
            </p>
          );
        }
        return (
          <DictationRecorderPanel
            environment={environment}
            binding={binding}
            recording={props.recording === true}
            liveSignal={props.liveSignal as AudioSignalSummary | undefined}
            capture={props.capture as AudioCapture | null | undefined}
            nowMs={props.nowMs as number}
            reportSigned={props.reportSigned === true}
            onStart={props.onStart as never}
            onStop={props.onStop as never}
            onAttach={props.onAttach as never}
            servicesManager={servicesManager}
          />
        );
      },
    },
    {
      name: 'voiceStructure',
      iconName: 'tab-linear',
      iconLabel: 'Voz',
      label: 'Fala para estrutura',
      /**
       * O reconhecedor de fala fica no hospedeiro. O painel recebe a transcricao e o modo, e
       * devolve intencoes -- o que o mantem testavel sem microfone.
       *
       * Sem `actorId` o painel nao monta: toda acao daqui grava quem confirmou uma entidade
       * estruturada ou decidiu o destino de uma transcricao, e um formulario completo cujo
       * unico desfecho possivel e recusa por falta de responsavel e pior que dizer isso.
       *
       * Fala vazia NAO impede a montagem: e o estado normal antes de alguem falar, e o nucleo
       * a recusa com a razao na tela.
       */
      component: (props: Record<string, unknown>) => {
        const actorId = props.actorId as string | undefined;
        if (!actorId) {
          return (
            <p data-testid="voice-no-actor">
              Responsavel nao identificado. Confirmar uma entidade estruturada ou decidir o
              destino da transcricao exige quem responde por isso.
            </p>
          );
        }
        return (
          <VoiceStructurePanel
            utterance={(props.utterance as string) ?? ''}
            /*
             * Ditado como padrao, e nao comando: em ditado nada executa, entao um hospedeiro
             * que esqueceu de informar o modo perde uma conveniencia. O padrao inverso
             * assinaria um laudo porque alguem descreveu um termo de consentimento.
             */
            mode={(props.mode as VoiceMode) ?? VOICE_MODE_DICTATION}
            fieldIdAtStart={props.fieldIdAtStart as string | undefined}
            fieldIdNow={props.fieldIdNow as string | undefined}
            cdeBindings={props.cdeBindings as Partial<Record<VoiceChipKind, string>> | undefined}
            actorId={actorId}
            nowMs={props.nowMs as number}
            onModeChange={props.onModeChange as never}
            onInsertText={props.onInsertText as never}
            onRunCommand={props.onRunCommand as never}
            onCommitChip={props.onCommitChip as never}
            onDecideRetention={props.onDecideRetention as never}
            servicesManager={servicesManager}
          />
        );
      },
    },
  ];
}

export default getPanelModule;
