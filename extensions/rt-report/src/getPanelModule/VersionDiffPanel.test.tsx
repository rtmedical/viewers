import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import VersionDiffPanel from './VersionDiffPanel';
import { diffCompareVersions, type DiffReportVersion } from '../versionDiff';

const T0 = 1_760_000_000_000;

function version(
  id: string,
  ordinal: number,
  sections: Array<{ kind: string; text: string }>,
  authorId = 'CRM-AUTOR'
): DiffReportVersion {
  return {
    id,
    ordinal,
    savedAt: T0 - (10 - ordinal) * 60_000,
    authorId,
    sections: sections.map(s => ({ kind: s.kind, text: s.text })) as never,
  };
}

/**
 * v1 -> v2: a impressao perde o "nao" (risco alto, tres letras) e os achados sao
 * inteiramente reescritos sem mudar sentido (risco baixo, muitos tokens).
 */
function historyRiskVsSize(): DiffReportVersion[] {
  const longBefore =
    'Opacidades reticulares difusas nos campos pulmonares inferiores, com distribuicao ' +
    'predominantemente subpleural e sem consolidacao associada, aspecto compativel com ' +
    'processo intersticial cronico de longa evolucao conforme descrito anteriormente.';
  const longAfter =
    'Ha opacidades reticulares de distribuicao difusa nos terços inferiores dos pulmoes, ' +
    'predominando na regiao subpleural, sem consolidacao acompanhante, achado compativel ' +
    'com processo intersticial cronico de evolucao prolongada conforme antes descrito.';
  return [
    version('v1', 1, [
      { kind: 'findings', text: longBefore },
      { kind: 'impression', text: 'Nao ha sinais de pneumotorax.' },
    ]),
    version('v2', 2, [
      { kind: 'findings', text: longAfter },
      { kind: 'impression', text: 'Ha sinais de pneumotorax.' },
    ]),
  ];
}

function historyIdentical(): DiffReportVersion[] {
  const same = [
    { kind: 'findings', text: 'Nodulo de 1,5 cm no lobo superior direito.' },
    { kind: 'impression', text: 'Nodulo indeterminado.' },
  ];
  return [version('v1', 1, same), version('v2', 2, same)];
}

/** v2 tem um adendo que v3 remove: comparar v1 com v3 nao o mostra. */
function historyWithHiddenAddendum(): DiffReportVersion[] {
  return [
    version('v1', 1, [{ kind: 'findings', text: 'Achado inicial.' }]),
    version('v2', 2, [
      { kind: 'findings', text: 'Achado inicial.' },
      { kind: 'addendum', text: 'Comunicado ao solicitante por telefone.' },
    ]),
    version('v3', 3, [{ kind: 'findings', text: 'Achado inicial revisto.' }]),
  ];
}

function renderPanel(over: Record<string, unknown> = {}) {
  const history = (over.history as DiffReportVersion[]) ?? historyRiskVsSize();
  return render(
    <VersionDiffPanel
      history={history}
      baseVersionId="v1"
      targetVersionId="v2"
      currentVersionId="v2"
      reviewerId="CRM-REVISOR"
      nowMs={T0}
      {...(over as never)}
    />
  );
}

/* ------------------------------------------------------------------ */

describe('VersionDiffPanel: a fixture reflete o nucleo', () => {
  it('o nucleo classifica a perda do "nao" como risco alto', () => {
    const out = diffCompareVersions({
      history: historyRiskVsSize(),
      baseVersionId: 'v1',
      targetVersionId: 'v2',
      comparedAt: T0,
    });
    expect(out.ok).toBe(true);
    const impression = out.value.sections.filter(s => s.kind === 'impression')[0];
    expect(impression.riskLevel).toBe('high');
  });

  it('e classifica a reescrita equivalente como risco baixo', () => {
    const out = diffCompareVersions({
      history: historyRiskVsSize(),
      baseVersionId: 'v1',
      targetVersionId: 'v2',
      comparedAt: T0,
    });
    const findings = out.value.sections.filter(s => s.kind === 'findings')[0];
    expect(findings.riskLevel).toBe('low');
  });
});

describe('VersionDiffPanel: risco antes de tamanho', () => {
  it('poe a impressao de tres letras acima da reescrita de sessenta palavras', () => {
    renderPanel();
    const order = Array.from(
      screen.getByTestId('diff-sections').querySelectorAll(':scope > li')
    ).map(li => li.getAttribute('data-testid'));
    expect(order[0]).toBe('diff-section-impression');
  });

  it('marca o nivel de risco em cada secao', () => {
    renderPanel();
    expect(screen.getByTestId('diff-section-impression').getAttribute('data-risk')).toBe('high');
    expect(screen.getByTestId('diff-section-findings').getAttribute('data-risk')).toBe('low');
  });

  it('da tom calmo a mudanca de redacao, para o selo nao inflacionar', () => {
    renderPanel();
    const findings = screen.getByTestId('diff-section-findings');
    expect(findings.className).toContain('risk-low');
    expect(findings.className).not.toContain('risk-high');
  });

  it('conta as mudancas de risco alto separadamente do total', () => {
    renderPanel();
    expect(screen.getByTestId('diff-span-counts').textContent).toMatch(/de \d+ mudanca/);
  });

  it('mostra o contexto para localizar um span de tres letras', () => {
    renderPanel();
    const context = screen.getByTestId('diff-span-context-impression-0').textContent;
    expect(context).toContain('->');
  });
});

describe('VersionDiffPanel: identical e um veredicto, nao um painel vazio', () => {
  it('renderiza a frase do nucleo quando nada mudou', () => {
    renderPanel({ history: historyIdentical() });
    const text = screen.getByTestId('diff-no-changes').textContent;
    expect(text.length > 10).toBe(true);
  });

  it('carrega o veredicto identical no atributo', () => {
    renderPanel({ history: historyIdentical() });
    expect(screen.getByTestId('diff-verdict').getAttribute('data-kind')).toBe('identical');
  });

  it('nao renderiza lista de secoes vazia', () => {
    renderPanel({ history: historyIdentical() });
    expect(screen.queryByTestId('diff-sections')).toBeNull();
  });
});

describe('VersionDiffPanel: comparacao nao adjacente diz o que ficou escondido', () => {
  it('mostra o aviso de adjacencia', () => {
    renderPanel({
      history: historyWithHiddenAddendum(),
      baseVersionId: 'v1',
      targetVersionId: 'v3',
      currentVersionId: 'v3',
    });
    expect(screen.getByTestId('diff-adjacency-message').textContent.length > 0).toBe(true);
  });

  it('lista o adendo que nao aparece em nenhum dos dois lados', () => {
    renderPanel({
      history: historyWithHiddenAddendum(),
      baseVersionId: 'v1',
      targetVersionId: 'v3',
      currentVersionId: 'v3',
    });
    expect(screen.getByTestId('diff-hidden-sections').textContent).toContain('addendum');
  });

  it('nao mostra a secao de adjacencia numa comparacao adjacente', () => {
    renderPanel();
    expect(screen.queryByTestId('diff-adjacency')).toBeNull();
  });
});

describe('VersionDiffPanel: recusa do nucleo nunca e painel vazio', () => {
  it('mostra o motivo quando a versao base nao existe', () => {
    renderPanel({ baseVersionId: 'v9' });
    expect(screen.getByTestId('diff-refused')).toBeTruthy();
    expect(screen.getByTestId('diff-refused-reason').textContent.length > 0).toBe(true);
    expect(screen.queryByTestId('diff-sections')).toBeNull();
  });

  it('mostra o motivo quando as duas versoes sao a mesma', () => {
    renderPanel({ targetVersionId: 'v1' });
    expect(screen.getByTestId('diff-refused')).toBeTruthy();
  });
});

describe('VersionDiffPanel: aprovar a comparacao nao e aprovar o laudo', () => {
  it('poe a frase de escopo no ponto da decisao', () => {
    renderPanel();
    const scope = screen.getByTestId('diff-scope').textContent;
    expect(scope).toContain('somente as diferencas');
    expect(scope).toContain('Nao e aprovacao do laudo inteiro');
  });

  it('registra a aprovacao com o escopo do nucleo', () => {
    let record: unknown = null;
    renderPanel({
      onDecision: (r: { ok: boolean; value?: { scope: string } }) => {
        record = r.ok ? r.value.scope : null;
      },
    });
    fireEvent.click(screen.getByTestId('diff-approve'));
    expect(record).toBe('comparison-only');
    expect(screen.getByTestId('diff-decision-record').textContent).toContain('Aprovadas');
  });

  it('recusa rejeitar sem motivo, explicando por que', () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('diff-reject'));
    expect(screen.getByTestId('diff-decision-refusal').textContent).toContain('volta igual');
    expect(screen.queryByTestId('diff-decision-record')).toBeNull();
  });

  it('aceita a rejeicao com motivo', () => {
    renderPanel();
    fireEvent.change(screen.getByTestId('diff-note'), {
      target: { value: 'A impressao contradiz os achados.' },
    });
    fireEvent.click(screen.getByTestId('diff-reject'));
    expect(screen.getByTestId('diff-decision-record').textContent).toContain('Rejeitadas');
  });

  it('o campo de motivo explica que e obrigatorio para rejeitar', () => {
    renderPanel();
    expect(screen.getByTestId('diff-note-label').textContent).toContain('obrigatorio para rejeitar');
  });

  it('recusa quando a versao revisada nao e mais a atual', () => {
    renderPanel({
      history: historyWithHiddenAddendum(),
      baseVersionId: 'v1',
      targetVersionId: 'v2',
      currentVersionId: 'v3',
    });
    fireEvent.click(screen.getByTestId('diff-approve'));
    // Acentuado: a string vem do nucleo, nao do painel.
    expect(screen.getByTestId('diff-decision-refusal').textContent).toContain(
      'não é mais a versão atual'
    );
  });

  it('recusa autorrevisao', () => {
    renderPanel({ reviewerId: 'CRM-AUTOR' });
    fireEvent.click(screen.getByTestId('diff-approve'));
    expect(screen.getByTestId('diff-decision-refusal').textContent).toContain('outro profissional');
  });

  it('limpa a recusa quando a decisao seguinte e aceita', () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('diff-reject'));
    expect(screen.getByTestId('diff-decision-refusal')).toBeTruthy();
    fireEvent.click(screen.getByTestId('diff-approve'));
    expect(screen.queryByTestId('diff-decision-refusal')).toBeNull();
  });
});
