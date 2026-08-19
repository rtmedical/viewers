import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ReportingHubPanel, { type HubPanelQueue } from './ReportingHubPanel';
import type { HubFilterContext, HubQueueRow } from '../hubQueue';

const NOW = 1_760_000_000_000;
const MIN = 60_000;

const DEPARTMENT: HubFilterContext = { label: 'todos os estudos do departamento' };
const FILTERED: HubFilterContext = { label: 'somente TC do plantao noturno', modality: 'CT' };

function row(over: Partial<HubQueueRow> = {}): HubQueueRow {
  return {
    studyKey: 'EST-1',
    queueKey: 'FILA-A',
    modality: 'CT',
    priority: 'routine',
    flags: [],
    clocks: { orderPlacedAt: NOW - 60 * MIN, imagesArrivedAt: NOW - 30 * MIN, assignedAt: NOW - 20 * MIN },
    slaTargetMinutes: 60,
    assignedTo: 'CRM-1',
    patientLabel: 'Paciente Um',
    ...over,
  };
}

function loaded(rows: HubQueueRow[]): HubPanelQueue {
  return { status: 'loaded', rows };
}

function renderPanel(queue: HubPanelQueue, over: Record<string, unknown> = {}) {
  return render(
    <ReportingHubPanel queue={queue} filter={DEPARTMENT} nowMs={NOW} {...(over as never)} />
  );
}

/* ------------------------------------------------------------------ */

describe('ReportingHubPanel: vazio e nao carregado nunca compartilham um ramo', () => {
  it('mostra carregando, e nao uma lista vazia', () => {
    renderPanel({ status: 'loading' });
    expect(screen.getByTestId('rt-hub-loading')).toBeTruthy();
    expect(screen.queryByTestId('rt-hub-empty')).toBeNull();
    expect(screen.queryByTestId('rt-hub-rows')).toBeNull();
  });

  it('numa falha, diz que isso NAO significa ausencia de estudos', () => {
    renderPanel({ status: 'failed', reason: 'A consulta ao PACS expirou.' });
    expect(screen.getByTestId('rt-hub-failed').textContent).toContain(
      'nao significa que nao ha estudos pendentes'
    );
  });

  it('numa falha, mostra o motivo em vez de engolir', () => {
    renderPanel({ status: 'failed', reason: 'A consulta ao PACS expirou.' });
    expect(screen.getByTestId('rt-hub-failed-reason').textContent).toBe(
      'A consulta ao PACS expirou.'
    );
  });

  it('numa falha, nunca renderiza a lista nem o texto de vazio', () => {
    renderPanel({ status: 'failed', reason: 'erro' });
    expect(screen.queryByTestId('rt-hub-empty')).toBeNull();
    expect(screen.queryByTestId('rt-hub-rows')).toBeNull();
  });

  it('numa fila carregada e vazia, afirma que a consulta foi concluida', () => {
    renderPanel(loaded([]));
    const empty = screen.getByTestId('rt-hub-empty');
    expect(empty.textContent).toContain('Nenhum estudo pendente');
    expect(empty.textContent).toContain('concluida com sucesso');
  });

  it('oferece tentar de novo apenas na falha', () => {
    const { unmount } = renderPanel({ status: 'failed', reason: 'x' });
    expect(screen.getByTestId('rt-hub-retry')).toBeTruthy();
    unmount();
    renderPanel(loaded([]));
    expect(screen.queryByTestId('rt-hub-retry')).toBeNull();
  });

  it('chama onRefresh ao tentar de novo', () => {
    let called = 0;
    renderPanel({ status: 'failed', reason: 'x' }, { onRefresh: () => { called += 1; } });
    fireEvent.click(screen.getByTestId('rt-hub-retry'));
    expect(called).toBe(1);
  });
});

describe('ReportingHubPanel: recusa do nucleo tambem nao e fila vazia', () => {
  it('mostra a recusa quando o filtro ativo nao tem rotulo', () => {
    render(
      <ReportingHubPanel
        queue={loaded([row()])}
        filter={{ label: '', modality: 'CT' }}
        nowMs={NOW}
      />
    );
    expect(screen.getByTestId('rt-hub-refused')).toBeTruthy();
    expect(screen.getByTestId('rt-hub-refused-reason').textContent).toContain(
      'número do departamento'
    );
    expect(screen.queryByTestId('rt-hub-empty')).toBeNull();
  });

  it('mostra a recusa quando uma linha e invalida', () => {
    renderPanel(loaded([row({ studyKey: '' })]));
    expect(screen.getByTestId('rt-hub-refused')).toBeTruthy();
    expect(screen.queryByTestId('rt-hub-rows')).toBeNull();
  });
});

describe('ReportingHubPanel: toda contagem viaja com o seu recorte', () => {
  it('renderiza o escopo do departamento junto ao cracha', () => {
    renderPanel(loaded([row()]));
    expect(screen.getByTestId('rt-hub-scope').textContent.length > 0).toBe(true);
    expect(screen.getByTestId('rt-hub-breached')).toBeTruthy();
  });

  it('renderiza o rotulo do recorte quando ha filtro', () => {
    render(<ReportingHubPanel queue={loaded([row()])} filter={FILTERED} nowMs={NOW} />);
    expect(screen.getByTestId('rt-hub-scope').textContent).toContain('plantao noturno');
  });

  it('diz de qual relogio o SLA foi medido', () => {
    renderPanel(loaded([row()]));
    expect(screen.getByTestId('rt-hub-reference').textContent).toContain('SLA medido de');
  });

  it('mostra a hora do calculo, para a fila nao parecer atual sem ser', () => {
    renderPanel(loaded([row()]));
    expect(screen.getByTestId('rt-hub-clock').textContent).toContain('UTC');
  });
});

describe('ReportingHubPanel: ordem clinica e as notas obrigatorias', () => {
  const statFresh = row({
    studyKey: 'STAT-NOVO',
    priority: 'stat',
    patientLabel: 'Stat Recente',
    clocks: { orderPlacedAt: NOW - 4 * MIN, imagesArrivedAt: NOW - 4 * MIN, assignedAt: NOW - 4 * MIN },
    slaTargetMinutes: 30,
  });
  const routineOld = row({
    studyKey: 'ROTINA-VELHA',
    priority: 'routine',
    patientLabel: 'Rotina Antiga',
    clocks: {
      orderPlacedAt: NOW - 4320 * MIN,
      imagesArrivedAt: NOW - 4320 * MIN,
      assignedAt: NOW - 4320 * MIN,
    },
    slaTargetMinutes: 60,
  });

  it('poe o STAT de quatro minutos acima da rotina de tres dias', () => {
    renderPanel(loaded([routineOld, statFresh]));
    const list = screen.getByTestId('rt-hub-rows');
    const keys = Array.from(list.querySelectorAll('li')).map(li =>
      li.getAttribute('data-testid')
    );
    expect(keys[0]).toBe('rt-hub-row-STAT-NOVO');
    expect(keys[1]).toBe('rt-hub-row-ROTINA-VELHA');
  });

  it('explica a ordenacao, senao alguem a "conserta"', () => {
    renderPanel(loaded([routineOld, statFresh]));
    expect(screen.getByTestId('rt-hub-ordering-note').textContent).toContain('urgência clínica');
  });

  it('mostra a nota de que as contagens por marcador nao somam o total', () => {
    renderPanel(
      loaded([
        row({ studyKey: 'A', flags: ['criticalFindingUnacknowledged'] }),
        row({ studyKey: 'B', flags: ['criticalFindingUnacknowledged'] }),
      ])
    );
    expect(screen.getByTestId('rt-hub-counts-note')).toBeTruthy();
  });

  it('nao esconde marcador que este build nao conhece', () => {
    renderPanel(loaded([row({ studyKey: 'A', flags: ['inventadoPeloServidorNovo'] })]));
    expect(screen.getByTestId('rt-hub-unknown-A').textContent).toContain(
      'inventadoPeloServidorNovo'
    );
    expect(screen.getByTestId('rt-hub-unknown-note')).toBeTruthy();
  });
});

describe('ReportingHubPanel: SLA nao mensuravel nao e desenhado como em dia', () => {
  it('lista a nota quando falta o relogio de referencia', () => {
    renderPanel(
      loaded([row({ studyKey: 'SEM-RELOGIO', clocks: { orderPlacedAt: NOW - 10 * MIN } })]),
      { slaReference: 'assigned' }
    );
    expect(screen.getByTestId('rt-hub-unmeasurable')).toBeTruthy();
  });

  it('marca a propria linha como nao mensuravel', () => {
    renderPanel(
      loaded([row({ studyKey: 'SEM-RELOGIO', clocks: { orderPlacedAt: NOW - 10 * MIN } })]),
      { slaReference: 'assigned' }
    );
    expect(screen.getByTestId('rt-hub-sla-SEM-RELOGIO').textContent).toContain(
      'nao mensuravel'
    );
  });
});

describe('ReportingHubPanel: escalacao de urgente sem atribuicao', () => {
  it('destaca urgente sem radiologista', () => {
    renderPanel(loaded([row({ studyKey: 'U1', priority: 'urgent', assignedTo: null })]));
    const box = screen.getByTestId('rt-hub-escalation');
    expect(box.textContent).toContain('sem radiologista atribuido');
  });

  it('nao mostra o destaque quando tudo esta atribuido', () => {
    renderPanel(loaded([row({ priority: 'urgent', assignedTo: 'CRM-1' })]));
    expect(screen.queryByTestId('rt-hub-escalation')).toBeNull();
  });
});

describe('ReportingHubPanel: linha e interacao', () => {
  it('mostra rotulo do paciente, prioridade e modalidade', () => {
    renderPanel(loaded([row({ studyKey: 'X', priority: 'stat', modality: 'MR' })]));
    expect(screen.getByTestId('rt-hub-open-X').textContent).toBe('Paciente Um');
    expect(screen.getByTestId('rt-hub-priority-X').textContent.length > 0).toBe(true);
    expect(screen.getByTestId('rt-hub-modality-X').textContent).toBe('MR');
  });

  it('cai para a chave do estudo quando nao ha rotulo de paciente', () => {
    renderPanel(loaded([row({ studyKey: 'SEM-NOME', patientLabel: null })]));
    expect(screen.getByTestId('rt-hub-open-SEM-NOME').textContent).toBe('SEM-NOME');
  });

  it('marca a linha com achado critico nao reconhecido', () => {
    renderPanel(loaded([row({ studyKey: 'C1', flags: ['criticalFindingUnacknowledged'] })]));
    expect(screen.getByTestId('rt-hub-row-C1').getAttribute('data-critical')).toBe('true');
  });

  it('chama onOpenStudy com a linha normalizada', () => {
    let opened: string | null = null;
    renderPanel(loaded([row({ studyKey: 'ABRIR' })]), {
      onOpenStudy: (r: { studyKey: string }) => {
        opened = r.studyKey;
      },
    });
    fireEvent.click(screen.getByTestId('rt-hub-open-ABRIR'));
    expect(opened).toBe('ABRIR');
  });

  it('chama onRefresh no botao de atualizar', () => {
    let called = 0;
    renderPanel(loaded([row()]), { onRefresh: () => { called += 1; } });
    fireEvent.click(screen.getByTestId('rt-hub-refresh'));
    expect(called).toBe(1);
  });
});

describe('ReportingHubPanel: o relogio nao anda durante o render', () => {
  it('nao reordena quando o componente re-renderiza sem nowMs novo', () => {
    const rows = [
      row({
        studyKey: 'A',
        priority: 'urgent',
        clocks: { orderPlacedAt: NOW - 10 * MIN, imagesArrivedAt: NOW - 10 * MIN, assignedAt: NOW - 10 * MIN },
      }),
      row({
        studyKey: 'B',
        priority: 'urgent',
        clocks: { orderPlacedAt: NOW - 50 * MIN, imagesArrivedAt: NOW - 50 * MIN, assignedAt: NOW - 50 * MIN },
      }),
    ];
    const { rerender } = render(
      <ReportingHubPanel queue={loaded(rows)} filter={DEPARTMENT} nowMs={NOW} />
    );
    const before = Array.from(
      screen.getByTestId('rt-hub-rows').querySelectorAll('li')
    ).map(li => li.getAttribute('data-testid'));

    rerender(<ReportingHubPanel queue={loaded(rows)} filter={DEPARTMENT} nowMs={NOW} />);
    const after = Array.from(
      screen.getByTestId('rt-hub-rows').querySelectorAll('li')
    ).map(li => li.getAttribute('data-testid'));

    expect(after).toEqual(before);
  });

  it('usa o nowMs recebido em vez de um relogio interno', () => {
    const r = row({
      studyKey: 'PRAZO',
      clocks: { orderPlacedAt: NOW - 90 * MIN, imagesArrivedAt: NOW - 90 * MIN, assignedAt: NOW - 90 * MIN },
      slaTargetMinutes: 60,
    });
    renderPanel(loaded([r]));
    const late = screen.getByTestId('rt-hub-sla-PRAZO').textContent;
    // Com nowMs 80 minutos antes, a mesma linha nao esta atrasada.
    render(
      <ReportingHubPanel queue={loaded([r])} filter={DEPARTMENT} nowMs={NOW - 80 * MIN} />
    );
    const onTime = screen.getAllByTestId('rt-hub-sla-PRAZO')[1].textContent;
    expect(late).not.toBe(onTime);
  });
});
