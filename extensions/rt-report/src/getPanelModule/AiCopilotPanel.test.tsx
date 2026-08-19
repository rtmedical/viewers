import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import AiCopilotPanel from './AiCopilotPanel';
import type { AiPolicy, AiSegment, AiSuggestion } from '../aiCopilot';

const T0 = 1_760_000_000_000;

function policy(over: Partial<AiPolicy> = {}): AiPolicy {
  return {
    tenantId: 'HOSP1',
    enabled: true,
    enabledForRoles: ['radiologist'],
    modelId: 'rt-laudo',
    modelVersion: '2026.07.1',
    ...over,
  };
}

const CONTEXT = { role: 'radiologist', modality: 'CT' };

function suggestion(over: Partial<AiSuggestion> = {}): AiSuggestion {
  return {
    suggestionId: 'S1',
    kind: 'impression',
    section: 'findings',
    proposedText: 'Nodulo de 1,5 cm no lobo superior direito.',
    modelId: 'rt-laudo',
    modelVersion: '2026.07.1',
    contextRef: 'ctx-1',
    producedAt: T0 - 1000,
    reportVersion: 1,
    ...over,
  };
}

function segment(over: Partial<AiSegment> = {}): AiSegment {
  return {
    segmentId: 'SEG-1',
    section: 'findings',
    text: 'texto',
    provenance: 'human',
    ...over,
  };
}

function renderPanel(over: Record<string, unknown> = {}) {
  return render(
    <AiCopilotPanel
      policy={policy()}
      context={CONTEXT}
      suggestions={[suggestion()]}
      segments={[segment()]}
      currentReportVersion={1}
      actorId="CRM-SP-123456"
      nowMs={T0}
      {...(over as never)}
    />
  );
}

/* ------------------------------------------------------------------ */

describe('AiCopilotPanel: nao existe aceite em lote', () => {
  it('cada botao decide exatamente uma sugestao', () => {
    renderPanel({
      suggestions: [
        suggestion({ suggestionId: 'A' }),
        suggestion({ suggestionId: 'B' }),
        suggestion({ suggestionId: 'C' }),
      ],
    });
    const buttons = Array.from(document.querySelectorAll('button'));
    // Todo botao de decisao carrega a marca de que age sobre uma sugestao so.
    const decision = buttons.filter(b => (b.getAttribute('data-testid') ?? '').match(/^ai-(accept|edit|reject)-/));
    expect(decision.length).toBe(9);
    expect(decision.every(b => b.getAttribute('data-single-suggestion') === 'true')).toBe(true);
  });

  it('nao oferece nenhum controle de aceitar todas', () => {
    renderPanel({
      suggestions: [suggestion({ suggestionId: 'A' }), suggestion({ suggestionId: 'B' })],
    });
    const ids = Array.from(document.querySelectorAll('button, input[type="checkbox"]')).map(
      el => el.getAttribute('data-testid') ?? ''
    );
    // "todas"/"all"/"lote" em qualquer testid de controle seria o atalho que o nucleo recusa.
    expect(ids.some(id => /all|todas|todos|bulk|lote/i.test(id))).toBe(false);
  });

  it('decidir uma sugestao nao decide as outras', () => {
    renderPanel({
      suggestions: [suggestion({ suggestionId: 'A' }), suggestion({ suggestionId: 'B' })],
    });
    fireEvent.click(screen.getByTestId('ai-accept-A'));
    expect(screen.getByTestId('ai-settled-A')).toBeTruthy();
    expect(screen.queryByTestId('ai-settled-B')).toBeNull();
    expect(screen.getByTestId('ai-accept-B')).toBeTruthy();
  });
});

describe('AiCopilotPanel: rejeitar tem o mesmo peso que aceitar', () => {
  it('os tres botoes existem no mesmo grupo', () => {
    renderPanel();
    const group = screen.getByTestId('ai-actions-S1');
    const ids = Array.from(group.querySelectorAll('button')).map(b => b.getAttribute('data-testid'));
    expect(ids).toEqual(['ai-accept-S1', 'ai-edit-S1', 'ai-reject-S1']);
  });

  it('rejeitar nao exige motivo', () => {
    let applied: unknown = null;
    renderPanel({ onDecision: (o: unknown) => { applied = o; } });
    fireEvent.click(screen.getByTestId('ai-reject-S1'));
    expect(screen.getByTestId('ai-settled-S1').textContent).toContain('rejeitar');
    expect(applied).not.toBe(null);
  });

  it('rejeitar nao produz segmento para o documento', () => {
    let segmentOut: unknown = 'nao-chamado';
    renderPanel({
      onDecision: (o: { ok: boolean; value?: { segment: unknown } }) => {
        segmentOut = o.ok ? o.value.segment : 'recusado';
      },
    });
    fireEvent.click(screen.getByTestId('ai-reject-S1'));
    expect(segmentOut).toBe(null);
  });
});

describe('AiCopilotPanel: editar marca procedencia diferente de aceitar', () => {
  it('aceitar sem alteracao marca ai-accepted', () => {
    let provenance: unknown = null;
    renderPanel({
      onDecision: (o: { ok: boolean; value?: { provenance: unknown } }) => {
        provenance = o.ok ? o.value.provenance : null;
      },
    });
    fireEvent.click(screen.getByTestId('ai-accept-S1'));
    expect(provenance).toBe('ai-accepted');
  });

  it('editar marca ai-edited e leva o texto reescrito', () => {
    let applied: { provenance: unknown; appliedText: string } | null = null;
    renderPanel({
      onDecision: (o: { ok: boolean; value?: { provenance: unknown; appliedText: string } }) => {
        applied = o.ok ? o.value : null;
      },
    });
    fireEvent.change(screen.getByTestId('ai-editor-S1'), {
      target: { value: 'Nodulo indeterminado, medindo 1,5 cm.' },
    });
    fireEvent.click(screen.getByTestId('ai-edit-S1'));
    expect(applied).not.toBe(null);
    expect(applied.provenance).toBe('ai-edited');
    expect(applied.appliedText).toContain('indeterminado');
  });
});

describe('AiCopilotPanel: a impressao vem primeiro e sinalizada', () => {
  it('poe impressao e recomendacao acima de achados', () => {
    renderPanel({
      suggestions: [
        suggestion({ suggestionId: 'ACH', section: 'findings' }),
        suggestion({ suggestionId: 'REC', section: 'recommendation' }),
        suggestion({ suggestionId: 'IMP', section: 'impression' }),
      ],
    });
    const cards = Array.from(
      screen.getByTestId('ai-suggestions').querySelectorAll('li')
    ).map(li => li.getAttribute('data-testid'));
    expect(cards).toEqual(['ai-card-IMP', 'ai-card-REC', 'ai-card-ACH']);
  });

  it('marca o cartao de alto risco', () => {
    renderPanel({ suggestions: [suggestion({ suggestionId: 'IMP', section: 'impression' })] });
    expect(screen.getByTestId('ai-card-IMP').getAttribute('data-high-stakes')).toBe('true');
  });

  it('nao marca achados como alto risco', () => {
    renderPanel();
    expect(screen.getByTestId('ai-card-S1').getAttribute('data-high-stakes')).toBe('false');
  });
});

describe('AiCopilotPanel: o portao mostra a mensagem, nao a contagem sozinha', () => {
  it('bloqueia com a frase do nucleo quando ha trecho nao decidido', () => {
    renderPanel({ segments: [segment({ provenance: 'ai-suggested' })] });
    expect(screen.getByTestId('ai-gate-blocked').textContent).toContain('afirmacao assinada');
  });

  it('destaca quando o pendente esta na impressao', () => {
    renderPanel({
      segments: [segment({ section: 'impression', provenance: 'ai-suggested' })],
    });
    expect(screen.getByTestId('ai-gate-high-stakes').textContent).toContain('impressao');
  });

  it('declara livre quando tudo foi decidido', () => {
    renderPanel({ segments: [segment({ provenance: 'ai-edited' })] });
    expect(screen.getByTestId('ai-gate-clear')).toBeTruthy();
    expect(screen.queryByTestId('ai-gate-blocked')).toBeNull();
  });

  it('mostra a contagem por procedencia', () => {
    renderPanel({
      segments: [
        segment({ segmentId: 'A', provenance: 'human' }),
        segment({ segmentId: 'B', provenance: 'ai-accepted' }),
      ],
    });
    expect(screen.getByTestId('ai-count-human').textContent).toContain('1');
    expect(screen.getByTestId('ai-count-ai-accepted').textContent).toContain('1');
  });
});

describe('AiCopilotPanel: desligado nao e sem sugestoes', () => {
  it('diz indisponivel com o motivo quando o perfil nao esta habilitado', () => {
    renderPanel({ context: { role: 'resident', modality: 'CT' } });
    expect(screen.getByTestId('ai-unavailable')).toBeTruthy();
    expect(screen.getByTestId('ai-unavailable-reason').textContent).toContain('perfil');
    expect(screen.queryByTestId('ai-no-suggestions')).toBeNull();
  });

  it('diz indisponivel quando a instituicao desligou', () => {
    renderPanel({ policy: policy({ enabled: false }) });
    expect(screen.getByTestId('ai-unavailable-reason').textContent).toContain('desativado');
  });

  it('diz indisponivel quando falta identidade do modelo', () => {
    renderPanel({ policy: policy({ modelVersion: '' }) });
    expect(screen.getByTestId('ai-unavailable-reason').textContent).toContain('auditada');
  });

  it('habilitado e sem sugestoes afirma que o copiloto nao propos nada', () => {
    renderPanel({ suggestions: [] });
    const text = screen.getByTestId('ai-no-suggestions').textContent;
    expect(text).toContain('habilitado');
    expect(text).toContain('nao propos nada');
  });
});

describe('AiCopilotPanel: recusas do nucleo aparecem no cartao', () => {
  it('recusa sugestao produzida contra outra versao do laudo', () => {
    renderPanel({ currentReportVersion: 2 });
    fireEvent.click(screen.getByTestId('ai-accept-S1'));
    expect(screen.getByTestId('ai-refusal-S1').textContent).toContain('reintroduziria');
    expect(screen.queryByTestId('ai-settled-S1')).toBeNull();
  });

  it('recusa uma segunda decisao sobre a mesma sugestao', () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('ai-accept-S1'));
    // Depois de decidida, os botoes saem; nao ha caminho para decidir de novo.
    expect(screen.queryByTestId('ai-actions-S1')).toBeNull();
  });

  it('recusa quando o texto editado fica vazio', () => {
    renderPanel();
    fireEvent.change(screen.getByTestId('ai-editor-S1'), { target: { value: '   ' } });
    fireEvent.click(screen.getByTestId('ai-edit-S1'));
    expect(screen.getByTestId('ai-refusal-S1').textContent).toContain('texto');
  });
});
