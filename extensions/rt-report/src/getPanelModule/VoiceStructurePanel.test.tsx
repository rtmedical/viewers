import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import VoiceStructurePanel from './VoiceStructurePanel';
import {
  VOICE_LATERALITY_LABELS,
  VOICE_MODE_COMMAND,
  VOICE_MODE_DICTATION,
  VOICE_POLARITY_LABELS,
  voiceCommitChip,
  voiceExtract,
} from '../voiceStructure';

const T0 = 1_760_000_000_000;
const ACTOR = 'CRM-SP-1';
const FULL = 'Ha nodulo de 1,5 centimetros no lobo superior direito, BI-RADS 3.';

function element(over: Record<string, unknown> = {}) {
  const props = {
    utterance: FULL,
    mode: VOICE_MODE_DICTATION,
    fieldIdAtStart: 'achados',
    fieldIdNow: 'achados',
    actorId: ACTOR,
    nowMs: T0,
    ...over,
  };
  return <VoiceStructurePanel {...(props as never)} />;
}

function renderPanel(over: Record<string, unknown> = {}) {
  return render(element(over));
}

/* ------------------------------------------------------------------ */
/* Nenhum chip se comita sozinho                                      */
/* ------------------------------------------------------------------ */

describe('VoiceStructurePanel: nenhum chip se comita sozinho', () => {
  it('todos os chips nascem nao confirmados', () => {
    renderPanel();
    const chips = Array.from(screen.getByTestId('voice-chips').querySelectorAll('li'));
    expect(chips.length > 0).toBe(true);
    expect(chips.every(li => li.getAttribute('data-confirmed') === 'false')).toBe(true);
  });

  it('diz quantas exigem confirmacao e que nada entra sem ato explicito', () => {
    renderPanel();
    const text = screen.getByTestId('voice-pending').textContent;
    expect(text).toContain('exigindo confirmacao');
    expect(text).toContain('ato explicito');
  });

  it('nao existe controle de confirmar todos', () => {
    renderPanel();
    const ids = Array.from(document.querySelectorAll('button, input[type="checkbox"]')).map(
      el => el.getAttribute('data-testid') ?? ''
    );
    expect(ids.length > 0).toBe(true);
    expect(ids.some(id => /all|todas|todos|bulk|lote/i.test(id))).toBe(false);
  });

  it('cada botao de confirmar age sobre um chip so', () => {
    renderPanel();
    const buttons = Array.from(document.querySelectorAll('button')).filter(b =>
      (b.getAttribute('data-testid') ?? '').indexOf('voice-chip-confirm-') === 0
    );
    expect(buttons.length > 0).toBe(true);
    expect(buttons.every(b => b.getAttribute('data-single-chip') === 'true')).toBe(true);
  });

  it('confirmar um chip nao confirma os outros', () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('voice-chip-confirm-measurement'));
    expect(screen.getByTestId('voice-chip-settled-measurement')).toBeTruthy();
    expect(screen.queryByTestId('voice-chip-settled-category')).toBeNull();
    expect(screen.getByTestId('voice-chip-category').getAttribute('data-confirmed')).toBe('false');
  });

  it('comita a medida com o valor numerico do nucleo', () => {
    let value: unknown = null;
    renderPanel({
      onCommitChip: (o: { ok: boolean; value?: { value: unknown } }) => {
        value = o.ok ? o.value.value : null;
      },
    });
    fireEvent.click(screen.getByTestId('voice-chip-confirm-measurement'));
    expect(value).toBe(1.5);
  });

  it('marca o chip confirmado e retira o botao de confirmar dele', () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('voice-chip-confirm-category'));
    expect(screen.getByTestId('voice-chip-category').getAttribute('data-confirmed')).toBe('true');
    expect(screen.queryByTestId('voice-chip-confirm-category')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* A condicao de correcao nao pode divergir do nucleo                 */
/* ------------------------------------------------------------------ */

describe('VoiceStructurePanel: correcao exatamente onde o nucleo recusa', () => {
  const CASES = [
    FULL,
    'Nodulo no lobo superior D.',
    'Nodulo no lobo superior E.',
    'Nao ha nodulo pulmonar.',
    'Nodulo bilateral de 2 cm.',
    'Ha nodulo no lobo direito e no lobo esquerdo.',
    'Ha nodulo de 1,5 cm.',
  ];

  it('oferecer correcao e o nucleo recusar sem correcao sao o mesmo conjunto', () => {
    for (const utterance of CASES) {
      const extraction = voiceExtract({ utterance });
      expect(extraction.ok).toBe(true);
      const view = renderPanel({ utterance });
      for (const chip of extraction.value.chips) {
        const core = voiceCommitChip({ chip, confirmedBy: ACTOR, confirmedAt: T0 });
        const offered = screen.queryByTestId('voice-chip-correct-' + chip.kind) !== null;
        expect(offered).toBe(core.ok === false);
      }
      view.unmount();
    }
  });

  it('a ressalva do nucleo aparece no chip, e nao so no objeto', () => {
    for (const utterance of CASES) {
      const extraction = voiceExtract({ utterance });
      const view = renderPanel({ utterance });
      for (const chip of extraction.value.chips) {
        const node = screen.queryByTestId('voice-chip-caution-' + chip.kind);
        if (chip.caution) {
          expect(node.textContent).toBe(chip.caution);
        } else {
          expect(node).toBeNull();
        }
      }
      view.unmount();
    }
  });

  it('confianca baixa e visivel, nao apenas um atributo', () => {
    renderPanel({ utterance: 'Nodulo no lobo superior D.' });
    expect(screen.getByTestId('voice-chip-laterality').getAttribute('data-confidence')).toBe('low');
    expect(screen.getByTestId('voice-chip-low-laterality')).toBeTruthy();
  });

  it('confianca alta nao ganha o aviso de confianca baixa', () => {
    renderPanel({ utterance: 'Ha nodulo no lobo superior direito.' });
    expect(screen.getByTestId('voice-chip-laterality').getAttribute('data-confidence')).toBe('high');
    expect(screen.queryByTestId('voice-chip-low-laterality')).toBeNull();
  });

  it('a letra "D" sem corrigir e recusada, com o motivo do nucleo', () => {
    renderPanel({ utterance: 'Nodulo no lobo superior D.' });
    fireEvent.click(screen.getByTestId('voice-chip-confirm-laterality'));
    expect(screen.getByTestId('voice-chip-refusal-laterality').textContent).toContain(
      'confirmar o palpite'
    );
    expect(screen.queryByTestId('voice-chip-settled-laterality')).toBeNull();
  });

  it('aceita a lateralidade uma vez corrigida', () => {
    let value: unknown = null;
    renderPanel({
      utterance: 'Nodulo no lobo superior D.',
      onCommitChip: (o: { ok: boolean; value?: { value: unknown } }) => {
        value = o.ok ? o.value.value : null;
      },
    });
    fireEvent.change(screen.getByTestId('voice-chip-correct-laterality'), {
      target: { value: 'left' },
    });
    fireEvent.click(screen.getByTestId('voice-chip-confirm-laterality'));
    expect(value).toBe('left');
  });

  it('polaridade nao dita e recusada, nomeando a afirmacao que ninguem fez', () => {
    renderPanel({ utterance: 'Nodulo de 1,5 centimetros no lobo direito.' });
    fireEvent.click(screen.getByTestId('voice-chip-confirm-polarity'));
    expect(screen.getByTestId('voice-chip-refusal-polarity').textContent).toContain('ninguem fez');
  });

  it('negacao explicita comita sem correcao', () => {
    renderPanel({ utterance: 'Nao ha nodulo pulmonar.' });
    fireEvent.click(screen.getByTestId('voice-chip-confirm-polarity'));
    expect(screen.getByTestId('voice-chip-settled-polarity')).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/* Rotulo de valor: do nucleo                                         */
/* ------------------------------------------------------------------ */

describe('VoiceStructurePanel: o rotulo do valor vem do nucleo', () => {
  it('polaridade e lateralidade usam os mapas do nucleo em todos os casos', () => {
    const CASES = [
      FULL,
      'Nao ha nodulo pulmonar.',
      'Nodulo bilateral de 2 cm.',
      'Nodulo no lobo superior E.',
      'Ha nodulo no lobo direito e no lobo esquerdo.',
    ];
    for (const utterance of CASES) {
      const extraction = voiceExtract({ utterance });
      const view = renderPanel({ utterance });
      for (const chip of extraction.value.chips) {
        if (chip.kind === 'polarity') {
          expect(screen.getByTestId('voice-chip-value-polarity').textContent).toBe(
            VOICE_POLARITY_LABELS[chip.polarity]
          );
        }
        if (chip.kind === 'laterality') {
          expect(screen.getByTestId('voice-chip-value-laterality').textContent).toBe(
            VOICE_LATERALITY_LABELS[chip.laterality]
          );
        }
      }
      view.unmount();
    }
  });

  it('nao imprime o valor de maquina no lugar do rotulo', () => {
    // Comparacao exata de proposito: "presente" contem "present", entao uma busca por
    // substring na pagina inteira acusaria o rotulo correto.
    renderPanel();
    expect(screen.getByTestId('voice-chip-value-polarity').textContent).toBe('presente');
    expect(screen.getByTestId('voice-chip-value-laterality').textContent).toBe('direito');
  });

  it('a medida sai com valor e unidade juntos', () => {
    renderPanel();
    expect(screen.getByTestId('voice-chip-value-measurement').textContent).toBe('1.5 cm');
  });

  it('a segunda dimensao aparece quando foi dita', () => {
    renderPanel({ utterance: 'Ha nodulo de 2 por 3 centimetros.' });
    expect(screen.getByTestId('voice-chip-value-measurement').textContent).toBe('2 x 3 cm');
  });

  it('a categoria sai com familia e valor', () => {
    renderPanel();
    expect(screen.getByTestId('voice-chip-value-category').textContent).toBe('BI-RADS 3');
  });

  it('mostra o elemento CDE que o chip preencheria, quando ha ligacao', () => {
    renderPanel({ cdeBindings: { category: 'RDES195' } });
    expect(screen.getByTestId('voice-chip-cde-category').textContent).toBe('RDES195');
    expect(screen.queryByTestId('voice-chip-cde-polarity')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Em ditado nada executa                                             */
/* ------------------------------------------------------------------ */

describe('VoiceStructurePanel: em ditado nada executa', () => {
  it('a frase exata de um comando e inserida como TEXTO', () => {
    let inserted: string | null = null;
    let ran: string | null = null;
    renderPanel({
      utterance: 'assinar laudo',
      onInsertText: (t: string) => {
        inserted = t;
      },
      onRunCommand: (c: string) => {
        ran = c;
      },
    });
    fireEvent.click(screen.getByTestId('voice-act'));
    expect(inserted).toBe('assinar laudo');
    expect(ran).toBe(null);
  });

  it('oferece a dica de modo sem agir', () => {
    renderPanel({ utterance: 'assinar laudo' });
    const hint = screen.getByTestId('voice-command-hint').textContent;
    expect(hint).toContain('soa como um comando');
    expect(hint).toContain('nada e executado');
    expect(screen.queryByTestId('voice-confirm-destructive')).toBeNull();
  });

  it('nao da dica para conteudo que apenas contem a palavra', () => {
    renderPanel({ utterance: 'O paciente assinou o termo de consentimento.' });
    expect(screen.queryByTestId('voice-command-hint')).toBeNull();
  });

  it('recusa inserir quando o foco mudou durante a fala', () => {
    let inserted: string | null = null;
    renderPanel({
      fieldIdNow: 'impressao',
      onInsertText: (t: string) => {
        inserted = t;
      },
    });
    expect(screen.getByTestId('voice-interpret-refusal').getAttribute('data-code')).toBe(
      'focus-changed'
    );
    fireEvent.click(screen.getByTestId('voice-act'));
    expect(inserted).toBe(null);
    expect(screen.getByTestId('voice-act-refusal').textContent).toContain('conclusao');
  });

  it('diz em qual campo o texto sera inserido', () => {
    renderPanel();
    expect(screen.getByTestId('voice-will-insert').textContent).toContain('achados');
  });

  it('insere no campo onde a fala comecou, nao no atual', () => {
    let field: string | undefined = undefined;
    renderPanel({
      fieldIdAtStart: 'achados',
      fieldIdNow: 'achados',
      onInsertText: (_t: string, f?: string) => {
        field = f;
      },
    });
    fireEvent.click(screen.getByTestId('voice-act'));
    expect(field).toBe('achados');
  });
});

/* ------------------------------------------------------------------ */
/* Modo de comando                                                    */
/* ------------------------------------------------------------------ */

describe('VoiceStructurePanel: modo de comando', () => {
  it('executa comando nao destrutivo', () => {
    let ran: string | null = null;
    renderPanel({
      utterance: 'proximo campo',
      mode: VOICE_MODE_COMMAND,
      onRunCommand: (c: string) => {
        ran = c;
      },
    });
    fireEvent.click(screen.getByTestId('voice-act'));
    expect(ran).toBe('next-field');
  });

  it('comando destrutivo nao executa antes da confirmacao', () => {
    let ran: string | null = null;
    renderPanel({
      utterance: 'assinar laudo',
      mode: VOICE_MODE_COMMAND,
      onRunCommand: (c: string) => {
        ran = c;
      },
    });
    expect(screen.getByTestId('voice-interpret-refusal').getAttribute('data-code')).toBe(
      'destructive-unconfirmed'
    );
    fireEvent.click(screen.getByTestId('voice-act'));
    expect(ran).toBe(null);
  });

  it('executa o destrutivo depois de confirmado', () => {
    let ran: string | null = null;
    renderPanel({
      utterance: 'assinar laudo',
      mode: VOICE_MODE_COMMAND,
      onRunCommand: (c: string) => {
        ran = c;
      },
    });
    fireEvent.click(screen.getByTestId('voice-confirm-destructive'));
    fireEvent.click(screen.getByTestId('voice-act'));
    expect(ran).toBe('sign-report');
  });

  it('a confirmacao de um destrutivo NAO vale para outra fala destrutiva', () => {
    const ran: string[] = [];
    const props = {
      mode: VOICE_MODE_COMMAND,
      onRunCommand: (c: string) => {
        ran.push(c);
      },
    };
    const view = render(element({ ...props, utterance: 'apagar achado' }));
    fireEvent.click(screen.getByTestId('voice-confirm-destructive'));
    // Chega outra fala antes de o operador executar a que ele confirmou.
    view.rerender(element({ ...props, utterance: 'assinar laudo' }));
    expect(screen.getByTestId('voice-interpret-refusal').getAttribute('data-code')).toBe(
      'destructive-unconfirmed'
    );
    fireEvent.click(screen.getByTestId('voice-act'));
    expect(ran).toEqual([]);
  });

  it('a confirmacao vale uma vez, nao para a repeticao do comando', () => {
    const ran: string[] = [];
    renderPanel({
      utterance: 'apagar achado',
      mode: VOICE_MODE_COMMAND,
      onRunCommand: (c: string) => {
        ran.push(c);
      },
    });
    fireEvent.click(screen.getByTestId('voice-confirm-destructive'));
    fireEvent.click(screen.getByTestId('voice-act'));
    fireEvent.click(screen.getByTestId('voice-act'));
    expect(ran).toEqual(['delete-finding']);
  });

  it('nao oferece confirmacao de destrutivo para comando comum', () => {
    renderPanel({ utterance: 'proximo campo', mode: VOICE_MODE_COMMAND });
    expect(screen.queryByTestId('voice-confirm-destructive')).toBeNull();
  });

  it('recusa comando nao reconhecido em vez de inserir como texto', () => {
    let inserted: string | null = null;
    renderPanel({
      utterance: 'faz o laudo pra mim',
      mode: VOICE_MODE_COMMAND,
      onInsertText: (t: string) => {
        inserted = t;
      },
    });
    expect(screen.getByTestId('voice-interpret-refusal').getAttribute('data-code')).toBe(
      'unknown-command'
    );
    fireEvent.click(screen.getByTestId('voice-act'));
    expect(inserted).toBe(null);
  });

  it('nao mostra dica de comando quando ja esta em modo de comando', () => {
    renderPanel({ utterance: 'assinar laudo', mode: VOICE_MODE_COMMAND });
    expect(screen.queryByTestId('voice-command-hint')).toBeNull();
  });

  it('alterna o modo pelo controle', () => {
    let next: string | null = null;
    renderPanel({
      onModeChange: (m: string) => {
        next = m;
      },
    });
    fireEvent.click(screen.getByTestId('voice-toggle-mode'));
    expect(next).toBe(VOICE_MODE_COMMAND);
  });

  it('mostra o modo corrente em atributo e em texto do nucleo', () => {
    renderPanel({ mode: VOICE_MODE_COMMAND });
    const node = screen.getByTestId('voice-mode');
    expect(node.getAttribute('data-mode')).toBe(VOICE_MODE_COMMAND);
    expect(node.textContent).toContain('comando');
  });
});

/* ------------------------------------------------------------------ */
/* Retencao da transcricao                                            */
/* ------------------------------------------------------------------ */

describe('VoiceStructurePanel: retencao da transcricao', () => {
  it('nasce sem destino escolhido', () => {
    renderPanel();
    expect((screen.getByTestId('voice-retention-action') as HTMLSelectElement).value).toBe('');
    expect(screen.queryByTestId('voice-retention-settled')).toBeNull();
  });

  it('salvar sem escolher destino e recusado', () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('voice-retention-save'));
    expect(screen.getByTestId('voice-retention-refusal').textContent).toContain(
      'Acao de retencao desconhecida'
    );
  });

  it('manter sem prazo e recusado, dizendo que manter sem prazo e para sempre', () => {
    renderPanel();
    fireEvent.change(screen.getByTestId('voice-retention-action'), { target: { value: 'keep' } });
    fireEvent.change(screen.getByTestId('voice-retention-justification'), {
      target: { value: 'ensino' },
    });
    fireEvent.click(screen.getByTestId('voice-retention-save'));
    expect(screen.getByTestId('voice-retention-refusal').textContent).toContain('para sempre');
  });

  it('o prazo so aparece quando manter foi escolhido', () => {
    renderPanel();
    expect(screen.queryByTestId('voice-retention-days')).toBeNull();
    fireEvent.change(screen.getByTestId('voice-retention-action'), { target: { value: 'keep' } });
    expect(screen.getByTestId('voice-retention-days')).toBeTruthy();
  });

  it('manter com prazo e justificativa e registrado', () => {
    let outcome: { ok: boolean; value?: { retainDays?: number } } | null = null;
    renderPanel({
      onDecideRetention: (o: { ok: boolean; value?: { retainDays?: number } }) => {
        outcome = o;
      },
    });
    fireEvent.change(screen.getByTestId('voice-retention-action'), { target: { value: 'keep' } });
    fireEvent.change(screen.getByTestId('voice-retention-days'), { target: { value: '30' } });
    fireEvent.change(screen.getByTestId('voice-retention-justification'), {
      target: { value: 'auditoria interna' },
    });
    fireEvent.click(screen.getByTestId('voice-retention-save'));
    expect(outcome.ok).toBe(true);
    expect(outcome.value.retainDays).toBe(30);
    expect(screen.queryByTestId('voice-retention-refusal')).toBeNull();
  });

  it('sem justificativa e recusado', () => {
    renderPanel();
    fireEvent.change(screen.getByTestId('voice-retention-action'), {
      target: { value: 'discard-on-signature' },
    });
    fireEvent.click(screen.getByTestId('voice-retention-save'));
    expect(screen.getByTestId('voice-retention-refusal').textContent).toContain('justificativa');
  });

  it('transcricao que sai da instituicao exige o provedor nomeado', () => {
    renderPanel();
    fireEvent.change(screen.getByTestId('voice-retention-action'), {
      target: { value: 'discard-on-signature' },
    });
    fireEvent.change(screen.getByTestId('voice-retention-justification'), {
      target: { value: 'reconhecimento em nuvem' },
    });
    fireEvent.click(screen.getByTestId('voice-retention-leaves'));
    fireEvent.click(screen.getByTestId('voice-retention-save'));
    expect(screen.getByTestId('voice-retention-refusal').textContent).toContain(
      'onde isso foi processado'
    );
  });

  it('o campo de provedor so aparece quando a transcricao sai', () => {
    renderPanel();
    expect(screen.queryByTestId('voice-retention-provider')).toBeNull();
    fireEvent.click(screen.getByTestId('voice-retention-leaves'));
    expect(screen.getByTestId('voice-retention-provider')).toBeTruthy();
  });

  it('registra a decisao com o provedor nomeado', () => {
    let outcome: { ok: boolean; value?: { providerId?: string } } | null = null;
    renderPanel({
      onDecideRetention: (o: { ok: boolean; value?: { providerId?: string } }) => {
        outcome = o;
      },
    });
    fireEvent.change(screen.getByTestId('voice-retention-action'), {
      target: { value: 'discard-after-confirmation' },
    });
    fireEvent.change(screen.getByTestId('voice-retention-justification'), {
      target: { value: 'ASR em nuvem contratada' },
    });
    fireEvent.click(screen.getByTestId('voice-retention-leaves'));
    fireEvent.change(screen.getByTestId('voice-retention-provider'), {
      target: { value: 'asr-vendor-1' },
    });
    fireEvent.click(screen.getByTestId('voice-retention-save'));
    expect(outcome.ok).toBe(true);
    expect(outcome.value.providerId).toBe('asr-vendor-1');
    expect(screen.getByTestId('voice-retention-settled')).toBeTruthy();
  });

  it('a recusa desaparece quando a decisao passa a ser valida', () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('voice-retention-save'));
    expect(screen.getByTestId('voice-retention-refusal')).toBeTruthy();
    fireEvent.change(screen.getByTestId('voice-retention-action'), {
      target: { value: 'discard-on-signature' },
    });
    fireEvent.change(screen.getByTestId('voice-retention-justification'), {
      target: { value: 'politica local' },
    });
    fireEvent.click(screen.getByTestId('voice-retention-save'));
    expect(screen.queryByTestId('voice-retention-refusal')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Fala vazia e entidades ausentes                                    */
/* ------------------------------------------------------------------ */

describe('VoiceStructurePanel: nada dito e entidade ausente', () => {
  it('mostra a recusa do nucleo para fala vazia, sem lista de chips', () => {
    renderPanel({ utterance: '   ' });
    expect(screen.getByTestId('voice-extract-refusal').getAttribute('data-code')).toBe(
      'empty-utterance'
    );
    expect(screen.queryByTestId('voice-chips')).toBeNull();
    expect(screen.queryByTestId('voice-pending')).toBeNull();
  });

  it('omite o chip de medida quando a unidade nao foi dita', () => {
    renderPanel({ utterance: 'Ha nodulo de 1,5 no lobo direito.' });
    expect(screen.queryByTestId('voice-chip-measurement')).toBeNull();
  });

  it('omite o chip de categoria quando nenhuma foi dita', () => {
    renderPanel({ utterance: 'Ha nodulo de 1,5 cm no lobo direito.' });
    expect(screen.queryByTestId('voice-chip-category')).toBeNull();
  });

  it('polaridade e lateralidade existem sempre, porque a ausencia delas e o aviso', () => {
    renderPanel({ utterance: 'Nodulo.' });
    expect(screen.getByTestId('voice-chip-polarity')).toBeTruthy();
    expect(screen.getByTestId('voice-chip-laterality')).toBeTruthy();
  });
});
