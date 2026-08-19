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
import type { HubFilterContext } from '../hubQueue';
import type { SignReportDraft, SignSignature } from '../signOff';
import type { AiPolicy, AiSegment, AiSuggestion } from '../aiCopilot';

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
  ];
}

export default getPanelModule;
