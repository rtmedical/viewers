import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import CriticalFindingsPanel from './CriticalFindingsPanel';
import {
  ACK_TIMEOUT_MS,
  DESCRIPTION_MAX,
  SUPERVISOR_TIMEOUT_MS,
  type CriticalFinding,
} from '../criticalFindings';

const T0 = 1_760_000_000_000;
const RADIOLOGIST = { id: 'CRM-SP-1', name: 'Dra. Ana Lima' };
const REQUESTER = { id: 'req-1', name: 'Dr. Bruno Alves', phone: '+5511999990000' };
const LINK = 'https://viewer.local/estudo/abc';

function makeFinding(over: Partial<CriticalFinding> = {}): CriticalFinding {
  return {
    id: 'cf-1',
    studyInstanceUid: '1.2.840.1',
    patientId: 'MRN-77',
    patientName: 'Maria Souza',
    findingType: 'pulmonaryEmbolism',
    description: 'TEP central bilateral com sobrecarga de VD.',
    radiologist: RADIOLOGIST,
    recipients: [REQUESTER],
    createdAt: T0,
    events: [{ type: 'created', at: T0, actorId: RADIOLOGIST.id }],
    ...over,
  };
}

function element(over: Record<string, unknown> = {}) {
  const props = {
    findings: [makeFinding()],
    studyInstanceUid: '1.2.840.1',
    patientId: 'MRN-77',
    patientName: 'Maria Souza',
    radiologist: RADIOLOGIST,
    recipients: [REQUESTER],
    studyLink: LINK,
    newFindingId: 'cf-2',
    nowMs: T0,
    ...over,
  };
  return <CriticalFindingsPanel {...(props as never)} />;
}

function renderPanel(over: Record<string, unknown> = {}) {
  return render(element(over));
}

function buttonTexts(): string[] {
  return Array.from(document.querySelectorAll('button')).map(b => b.textContent ?? '');
}

/* ------------------------------------------------------------------ */
/* O relogio nao pode ser capturado                                   */
/* ------------------------------------------------------------------ */

describe('CriticalFindingsPanel: a escalacao e derivada do relogio a cada render', () => {
  const sent = makeFinding({ sentAt: T0, sentVia: 'phone' });

  it('dentro da janela mostra aguardando', () => {
    renderPanel({ findings: [sent], nowMs: T0 + 60_000 });
    expect(screen.getByTestId('cf-item-cf-1').getAttribute('data-level')).toBe('awaiting');
  });

  it('avancar o relogio passa para callNow SEM remontar o painel', () => {
    const view = render(element({ findings: [sent], nowMs: T0 + 60_000 }));
    expect(screen.getByTestId('cf-item-cf-1').getAttribute('data-level')).toBe('awaiting');
    view.rerender(element({ findings: [sent], nowMs: T0 + ACK_TIMEOUT_MS + 1000 }));
    expect(screen.getByTestId('cf-item-cf-1').getAttribute('data-level')).toBe('callNow');
    expect(screen.getByTestId('cf-state-cf-1').textContent).toContain('ligue para o solicitante');
  });

  it('avancar mais passa para supervisor', () => {
    const view = render(element({ findings: [sent], nowMs: T0 + ACK_TIMEOUT_MS + 1000 }));
    view.rerender(element({ findings: [sent], nowMs: T0 + SUPERVISOR_TIMEOUT_MS + 1000 }));
    expect(screen.getByTestId('cf-item-cf-1').getAttribute('data-level')).toBe('supervisor');
    expect(screen.getByTestId('cf-state-cf-1').textContent).toContain('coordenação');
  });

  it('os minutos decorridos acompanham o relogio', () => {
    const view = render(element({ findings: [sent], nowMs: T0 + 5 * 60_000 }));
    expect(screen.getByTestId('cf-elapsed-cf-1').textContent).toBe('5 min desde o envio');
    view.rerender(element({ findings: [sent], nowMs: T0 + 12 * 60_000 }));
    expect(screen.getByTestId('cf-elapsed-cf-1').textContent).toBe('12 min desde o envio');
  });

  it('confirmado nao escala mais, e nao mostra cronometro', () => {
    const ack = makeFinding({
      sentAt: T0,
      sentVia: 'phone',
      acknowledgedAt: T0 + 60_000,
      acknowledgedBy: REQUESTER.id,
    });
    renderPanel({ findings: [ack], nowMs: T0 + SUPERVISOR_TIMEOUT_MS + 1000 });
    expect(screen.getByTestId('cf-item-cf-1').getAttribute('data-level')).toBe('none');
    expect(screen.queryByTestId('cf-elapsed-cf-1')).toBeNull();
  });

  it('a mensagem de estado vem do nucleo, nao da tela', () => {
    renderPanel({ findings: [makeFinding()], nowMs: T0 });
    expect(screen.getByTestId('cf-state-cf-1').textContent).toBe(
      'Achado crítico NÃO comunicado — envie antes de finalizar o laudo.'
    );
  });

  it('ordena o nao enviado antes do que ja espera confirmacao', () => {
    const unsent = makeFinding({ id: 'cf-a', createdAt: T0 + 5000 });
    const waiting = makeFinding({ id: 'cf-b', sentAt: T0, sentVia: 'phone' });
    renderPanel({ findings: [waiting, unsent], nowMs: T0 + 60_000 });
    const ids = Array.from(screen.getByTestId('cf-list').querySelectorAll('li[data-level]')).map(
      li => li.getAttribute('data-testid')
    );
    expect(ids[0]).toBe('cf-item-cf-a');
  });
});

/* ------------------------------------------------------------------ */
/* O radiologista nao confirma o recebimento                          */
/* ------------------------------------------------------------------ */

describe('CriticalFindingsPanel: quem envia nao confirma o recebimento', () => {
  it('nao existe controle de confirmar recebimento', () => {
    renderPanel({ findings: [makeFinding({ sentAt: T0, sentVia: 'whatsapp' })], nowMs: T0 + 60_000 });
    const ids = Array.from(document.querySelectorAll('button, input')).map(
      el => el.getAttribute('data-testid') ?? ''
    );
    expect(ids.length > 0).toBe(true);
    expect(ids.some(id => /ack|acknowledge|receb|confirmar-receb/i.test(id))).toBe(false);
    expect(buttonTexts().some(t => /recebimento/i.test(t))).toBe(false);
  });

  it('mostra a espera do nucleo sem oferecer um jeito de satisfaze-la aqui', () => {
    renderPanel({ findings: [makeFinding({ sentAt: T0, sentVia: 'whatsapp' })], nowMs: T0 + 60_000 });
    expect(screen.getByTestId('cf-state-cf-1').textContent).toBe(
      'Aguardando confirmação de recebimento.'
    );
    expect(screen.queryByTestId('cf-send-cf-1')).toBeNull();
  });

  it('a atestacao de telefone nao e um recebimento: ela e do remetente', () => {
    renderPanel();
    fireEvent.change(screen.getByTestId('cf-channel-cf-1'), { target: { value: 'phone' } });
    const label = screen.getByTestId('cf-verbal-cf-1').parentElement.textContent;
    expect(label).toContain('Declaro que falei');
  });
});

/* ------------------------------------------------------------------ */
/* O bloqueio do achado nao comunicado                                */
/* ------------------------------------------------------------------ */

describe('CriticalFindingsPanel: o nao comunicado nao se dispensa', () => {
  it('bloqueia enquanto ha achado nao enviado', () => {
    renderPanel();
    expect(screen.getByTestId('cf-blocker').getAttribute('data-count')).toBe('1');
    expect(screen.getByTestId('cf-blocker-text').textContent).toContain('NAO comunicado');
  });

  it('nao ha controle para dispensar, adiar ou reconhecer o bloqueio', () => {
    renderPanel();
    const ids = Array.from(document.querySelectorAll('button, input')).map(
      el => el.getAttribute('data-testid') ?? ''
    );
    expect(ids.some(id => /dismiss|dispensar|adiar|depois|ignorar|entendi|snooze/i.test(id))).toBe(
      false
    );
    expect(
      buttonTexts().some(t => /dispensar|mais tarde|depois|ignorar|entendi/i.test(t))
    ).toBe(false);
  });

  it('o bloqueio some quando o envio aconteceu, e nao por clique', () => {
    const view = render(element());
    expect(screen.getByTestId('cf-blocker')).toBeTruthy();
    view.rerender(element({ findings: [makeFinding({ sentAt: T0, sentVia: 'phone' })] }));
    expect(screen.queryByTestId('cf-blocker')).toBeNull();
  });

  it('um envio que FALHOU mantem o bloqueio e deixa a falha na lista', () => {
    const failed = makeFinding({
      events: [
        { type: 'created', at: T0, actorId: RADIOLOGIST.id },
        { type: 'sendFailed', at: T0 + 1000, actorId: RADIOLOGIST.id, channel: 'whatsapp' },
      ],
    });
    renderPanel({ findings: [failed], nowMs: T0 + 2000 });
    expect(screen.getByTestId('cf-blocker').getAttribute('data-count')).toBe('1');
    expect(screen.getByTestId('cf-item-cf-1').getAttribute('data-level')).toBe('unsent');
    expect(screen.getByTestId('cf-event-cf-1-1').getAttribute('data-type')).toBe('sendFailed');
  });

  it('conta separadamente o nao enviado e o que aguarda confirmacao', () => {
    renderPanel({
      findings: [makeFinding({ id: 'cf-a' }), makeFinding({ id: 'cf-b', sentAt: T0, sentVia: 'phone' })],
      nowMs: T0 + 60_000,
    });
    expect(screen.getByTestId('cf-count-unsent').textContent).toBe('1');
    expect(screen.getByTestId('cf-count-awaiting').textContent).toBe('1');
  });
});

/* ------------------------------------------------------------------ */
/* Telefone: atestacao                                                */
/* ------------------------------------------------------------------ */

describe('CriticalFindingsPanel: telefone exige a atestacao', () => {
  it('a caixa nasce desmarcada', () => {
    renderPanel();
    fireEvent.change(screen.getByTestId('cf-channel-cf-1'), { target: { value: 'phone' } });
    expect((screen.getByTestId('cf-verbal-cf-1') as HTMLInputElement).checked).toBe(false);
  });

  it('registrar sem atestacao e recusado com a razao do nucleo', () => {
    let result: { ok: boolean; error?: string; finding?: CriticalFinding } | null = null;
    renderPanel({
      onDispatch: (r: { ok: boolean; error?: string; finding?: CriticalFinding }) => {
        result = r;
      },
    });
    fireEvent.change(screen.getByTestId('cf-channel-cf-1'), { target: { value: 'phone' } });
    fireEvent.click(screen.getByTestId('cf-send-cf-1'));
    expect(screen.getByTestId('cf-send-error-cf-1').textContent).toBe(
      'Marque a confirmação de que a comunicação verbal foi feita.'
    );
    expect(result.ok).toBe(false);
    // Nada foi anexado ao registro append-only.
    expect(result.finding.events.length).toBe(1);
    expect(result.finding.sentAt).toBe(undefined);
  });

  it('com a atestacao o registro e feito', () => {
    let result: { ok: boolean; finding?: CriticalFinding } | null = null;
    renderPanel({
      onDispatch: (r: { ok: boolean; finding?: CriticalFinding }) => {
        result = r;
      },
    });
    fireEvent.change(screen.getByTestId('cf-channel-cf-1'), { target: { value: 'phone' } });
    fireEvent.click(screen.getByTestId('cf-verbal-cf-1'));
    fireEvent.click(screen.getByTestId('cf-send-cf-1'));
    expect(result.ok).toBe(true);
    expect(result.finding.sentAt).toBe(T0);
    expect(result.finding.sentVia).toBe('phone');
  });

  it('a caixa de atestacao existe so no telefone', () => {
    renderPanel();
    fireEvent.change(screen.getByTestId('cf-channel-cf-1'), { target: { value: 'whatsapp' } });
    expect(screen.queryByTestId('cf-verbal-cf-1')).toBeNull();
    fireEvent.change(screen.getByTestId('cf-channel-cf-1'), { target: { value: 'phone' } });
    expect(screen.getByTestId('cf-verbal-cf-1')).toBeTruthy();
  });

  it('o rotulo do botao diz que se esta registrando algo que aconteceu', () => {
    renderPanel();
    fireEvent.change(screen.getByTestId('cf-channel-cf-1'), { target: { value: 'phone' } });
    expect(screen.getByTestId('cf-send-cf-1').textContent).toContain('Registrar');
  });
});

/* ------------------------------------------------------------------ */
/* Canal de maquina: nada de `sent` antes do transporte               */
/* ------------------------------------------------------------------ */

describe('CriticalFindingsPanel: canal de maquina nao grava envio no clique', () => {
  it('WhatsApp entrega a intencao ao hospedeiro e NAO registra nada', () => {
    const requested: unknown[] = [];
    let dispatched = 0;
    renderPanel({
      onRequestSend: (f: CriticalFinding, c: string, m: string) => {
        requested.push([f.id, c, m]);
      },
      onDispatch: () => {
        dispatched += 1;
      },
    });
    fireEvent.change(screen.getByTestId('cf-channel-cf-1'), { target: { value: 'whatsapp' } });
    fireEvent.click(screen.getByTestId('cf-send-cf-1'));
    expect(requested.length).toBe(1);
    expect(dispatched).toBe(0);
  });

  it('e-mail segue o mesmo caminho', () => {
    let channelSeen: string | null = null;
    let dispatched = 0;
    renderPanel({
      onRequestSend: (_f: CriticalFinding, c: string) => {
        channelSeen = c;
      },
      onDispatch: () => {
        dispatched += 1;
      },
    });
    fireEvent.change(screen.getByTestId('cf-channel-cf-1'), { target: { value: 'email' } });
    fireEvent.click(screen.getByTestId('cf-send-cf-1'));
    expect(channelSeen).toBe('email');
    expect(dispatched).toBe(0);
  });

  it('o achado continua bloqueado depois do pedido, porque nada foi enviado ainda', () => {
    renderPanel({ onRequestSend: () => undefined });
    fireEvent.change(screen.getByTestId('cf-channel-cf-1'), { target: { value: 'whatsapp' } });
    fireEvent.click(screen.getByTestId('cf-send-cf-1'));
    expect(screen.getByTestId('cf-blocker').getAttribute('data-count')).toBe('1');
    expect(screen.getByTestId('cf-item-cf-1').getAttribute('data-level')).toBe('unsent');
  });

  it('o rotulo do botao diz que e um pedido, nao um registro', () => {
    renderPanel();
    fireEvent.change(screen.getByTestId('cf-channel-cf-1'), { target: { value: 'whatsapp' } });
    expect(screen.getByTestId('cf-send-cf-1').textContent).toContain('Solicitar');
  });

  it('o texto entregue ao hospedeiro e exatamente o da previa', () => {
    let message: string | null = null;
    renderPanel({
      onRequestSend: (_f: CriticalFinding, _c: string, m: string) => {
        message = m;
      },
    });
    fireEvent.change(screen.getByTestId('cf-channel-cf-1'), { target: { value: 'whatsapp' } });
    const shown = screen.getByTestId('cf-preview-cf-1').textContent;
    fireEvent.click(screen.getByTestId('cf-send-cf-1'));
    expect(message).toBe(shown);
  });

  it('sem canal escolhido nada sai, e a recusa aparece', () => {
    let requested = 0;
    let dispatched = 0;
    renderPanel({
      onRequestSend: () => {
        requested += 1;
      },
      onDispatch: () => {
        dispatched += 1;
      },
    });
    fireEvent.click(screen.getByTestId('cf-send-cf-1'));
    expect(screen.getByTestId('cf-send-error-cf-1').textContent).toBe(
      'Canal de notificação inválido.'
    );
    expect(requested).toBe(0);
    expect(dispatched).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* O nome do paciente                                                 */
/* ------------------------------------------------------------------ */

describe('CriticalFindingsPanel: o nome do paciente nao vai por padrao', () => {
  it('a previa nao traz o nome, e traz o identificador', () => {
    renderPanel({ allowPatientNameInMessage: true });
    const preview = screen.getByTestId('cf-preview-cf-1').textContent;
    expect(preview).not.toContain('Maria Souza');
    expect(preview).toContain('MRN-77');
  });

  it('quando a instituicao nao permite, o controle nao e oferecido', () => {
    renderPanel({ allowPatientNameInMessage: false });
    expect(screen.queryByTestId('cf-with-name-cf-1')).toBeNull();
  });

  it('quando permite, a caixa existe e nasce desmarcada', () => {
    renderPanel({ allowPatientNameInMessage: true });
    expect((screen.getByTestId('cf-with-name-cf-1') as HTMLInputElement).checked).toBe(false);
  });

  it('marcar poe o nome na previa, e o ato e visivel antes do envio', () => {
    renderPanel({ allowPatientNameInMessage: true });
    fireEvent.click(screen.getByTestId('cf-with-name-cf-1'));
    expect(screen.getByTestId('cf-preview-cf-1').textContent).toContain('Maria Souza');
  });

  it('a previa carrega o link, que e o que leva a identidade autenticada', () => {
    renderPanel();
    expect(screen.getByTestId('cf-preview-cf-1').textContent).toContain(LINK);
  });
});

/* ------------------------------------------------------------------ */
/* Append-only: complemento, nao edicao                               */
/* ------------------------------------------------------------------ */

describe('CriticalFindingsPanel: a descricao nao se edita', () => {
  it('nenhum campo esta ligado a descricao original', () => {
    const f = makeFinding();
    renderPanel({ findings: [f] });
    const values = Array.from(document.querySelectorAll('input, textarea')).map(
      el => (el as HTMLInputElement).value
    );
    expect(values.some(v => v === f.description)).toBe(false);
  });

  it('complemento vazio e recusado', () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('cf-amend-save-cf-1'));
    expect(screen.getByTestId('cf-amend-error-cf-1').textContent).toBe('Complemento vazio.');
  });

  it('o complemento vira evento e a descricao original permanece', () => {
    let result: { ok: boolean; finding?: CriticalFinding } | null = null;
    const f = makeFinding();
    const view = render(
      element({
        findings: [f],
        onAmend: (r: { ok: boolean; finding?: CriticalFinding }) => {
          result = r;
        },
      })
    );
    fireEvent.change(screen.getByTestId('cf-amend-input-cf-1'), {
      target: { value: 'Falado com o plantonista; TEP segmentar, nao central.' },
    });
    fireEvent.click(screen.getByTestId('cf-amend-save-cf-1'));
    expect(result.ok).toBe(true);
    expect(result.finding.description).toBe(f.description);
    expect(result.finding.events[result.finding.events.length - 1].type).toBe('amended');

    view.rerender(element({ findings: [result.finding] }));
    expect(screen.getByTestId('cf-description-cf-1').textContent).toBe(f.description);
    expect(screen.getByTestId('cf-event-note-cf-1-1').textContent).toContain('segmentar');
  });

  it('o registro de eventos aparece inteiro, na ordem em que cresceu', () => {
    const f = makeFinding({
      sentAt: T0 + 1000,
      sentVia: 'phone',
      events: [
        { type: 'created', at: T0, actorId: RADIOLOGIST.id },
        { type: 'sendFailed', at: T0 + 500, actorId: RADIOLOGIST.id, channel: 'whatsapp' },
        { type: 'sent', at: T0 + 1000, actorId: RADIOLOGIST.id, channel: 'phone' },
      ],
    });
    renderPanel({ findings: [f], nowMs: T0 + 2000 });
    const types = Array.from(
      screen.getByTestId('cf-events-cf-1').querySelectorAll('li')
    ).map(li => li.getAttribute('data-type'));
    expect(types).toEqual(['created', 'sendFailed', 'sent']);
  });
});

/* ------------------------------------------------------------------ */
/* Abertura de um achado                                              */
/* ------------------------------------------------------------------ */

describe('CriticalFindingsPanel: abertura', () => {
  it('sem identificador do hospedeiro o formulario nao e oferecido', () => {
    renderPanel({ newFindingId: undefined });
    expect(screen.queryByTestId('cf-new')).toBeNull();
    expect(screen.getByTestId('cf-new-unavailable').textContent).toContain('irrastreavel');
  });

  it('sem tipo, a recusa e a do nucleo', () => {
    renderPanel({ findings: [] });
    fireEvent.change(screen.getByTestId('cf-new-description'), { target: { value: 'TEP.' } });
    fireEvent.click(screen.getByTestId('cf-recipient-req-1'));
    fireEvent.click(screen.getByTestId('cf-new-save'));
    expect(screen.getByTestId('cf-new-error').textContent).toBe(
      'Selecione o tipo do achado crítico.'
    );
  });

  it('sem destinatario, a recusa nomeia o que falta', () => {
    renderPanel({ findings: [] });
    fireEvent.change(screen.getByTestId('cf-new-type'), { target: { value: 'acuteStroke' } });
    fireEvent.change(screen.getByTestId('cf-new-description'), { target: { value: 'AVC.' } });
    fireEvent.click(screen.getByTestId('cf-new-save'));
    expect(screen.getByTestId('cf-new-error').textContent).toBe(
      'Informe ao menos um destinatário.'
    );
  });

  it('o campo de descricao NAO tem maxLength, para nao cortar em silencio', () => {
    renderPanel({ findings: [] });
    const box = screen.getByTestId('cf-new-description') as HTMLTextAreaElement;
    expect(box.getAttribute('maxlength')).toBe(null);
  });

  it('passar de 200 caracteres e mostrado e recusado, nao truncado', () => {
    renderPanel({ findings: [] });
    const long = 'a'.repeat(DESCRIPTION_MAX + 1);
    fireEvent.change(screen.getByTestId('cf-new-type'), { target: { value: 'acuteStroke' } });
    fireEvent.change(screen.getByTestId('cf-new-description'), { target: { value: long } });
    fireEvent.click(screen.getByTestId('cf-recipient-req-1'));
    expect(screen.getByTestId('cf-new-counter').getAttribute('data-over')).toBe('true');
    expect((screen.getByTestId('cf-new-description') as HTMLTextAreaElement).value.length).toBe(
      DESCRIPTION_MAX + 1
    );
    fireEvent.click(screen.getByTestId('cf-new-save'));
    expect(screen.getByTestId('cf-new-error').textContent).toContain('no máximo 200');
  });

  it('abre o achado quando tudo esta informado', () => {
    let created: CriticalFinding | null = null;
    renderPanel({
      findings: [],
      onCreate: (r: { finding: CriticalFinding | null }) => {
        created = r.finding;
      },
    });
    fireEvent.change(screen.getByTestId('cf-new-type'), { target: { value: 'aorticDissection' } });
    fireEvent.change(screen.getByTestId('cf-new-description'), {
      target: { value: 'Diseccao tipo A com hemopericardio.' },
    });
    fireEvent.click(screen.getByTestId('cf-recipient-req-1'));
    fireEvent.click(screen.getByTestId('cf-new-save'));
    expect(created.id).toBe('cf-2');
    expect(created.findingType).toBe('aorticDissection');
    expect(created.recipients.length).toBe(1);
    expect(created.sentAt).toBe(undefined);
  });

  it('o rotulo de cada tipo vem do nucleo', () => {
    renderPanel({ findings: [] });
    const options = Array.from(
      (screen.getByTestId('cf-new-type') as HTMLSelectElement).querySelectorAll('option')
    ).map(o => o.textContent);
    expect(options).toContain('Tromboembolismo pulmonar');
    expect(options).toContain('Dissecção aórtica');
  });

  it('sem achado nenhum nao ha bloqueio', () => {
    renderPanel({ findings: [] });
    expect(screen.queryByTestId('cf-blocker')).toBeNull();
    expect(screen.getByTestId('cf-count-unsent').textContent).toBe('0');
  });
});
