import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import CachedPlansPanel from './CachedPlansPanel';
import {
  PLAN_CACHE_CURRENCY_VERDICTS,
  planCacheEntryKey,
  type PlanCacheClearAttempt,
  type PlanCacheEntry,
} from '../cachedPlans';

const NOW = 1_760_000_000_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Item verificavelmente vigente e removivel. */
function entry(over: Partial<PlanCacheEntry> = {}): PlanCacheEntry {
  return {
    planId: 'PLANO-A',
    patientRef: 'PAC-1',
    courseRef: 'CURSO-1',
    cachedAt: NOW - 2 * HOUR,
    sourceSystem: 'ARIA-HOSP1',
    sourceRevision: {
      revisionId: 'rev-7',
      planInstanceUid: '1.2.840.1.7',
      approvalStatus: 'APPROVED',
    },
    revisionVerification: {
      verifiedAt: NOW - HOUR,
      currentRevisionId: 'rev-7',
      verifiedAgainstSystem: 'ARIA-HOSP1',
    },
    lastTreatment: { kind: 'treated', at: NOW - 5 * DAY, attestedBy: 'RTRECORD' },
    lockState: 'locked',
    usage: { kind: 'free' },
    courseStatus: 'completed',
    externallyCached: true,
    sizeBytes: 1_048_576,
    ...over,
  };
}

function renderPanel(over: Record<string, unknown> = {}) {
  return render(
    <CachedPlansPanel
      entries={[entry()]}
      nowMs={NOW}
      actorId="FIS-9"
      {...(over as never)}
    />
  );
}

/** Preenche justificativa e reconhecimento, e apresenta (passo 1). */
function fillAndPresent() {
  fireEvent.change(screen.getByTestId('plan-reason'), {
    target: { value: 'Reimportacao apos replanejamento.' },
  });
  fireEvent.click(screen.getByTestId('plan-ack'));
  fireEvent.click(screen.getByTestId('plan-clear-button'));
}

/** Os dois passos seguidos, sem nada mudando no meio. */
function fillAndClear() {
  fillAndPresent();
  fireEvent.click(screen.getByTestId('plan-confirm-button'));
}

/* ------------------------------------------------------------------ */

describe('CachedPlansPanel: a impressao digital vem do que foi mostrado', () => {
  it('autoriza quando a selecao nao mudou', () => {
    let cleared: string[] | null = null;
    renderPanel({
      onClear: (keys: string[]) => {
        cleared = keys;
        return keys.map(k => ({ entryKey: k, succeeded: true })) as PlanCacheClearAttempt[];
      },
    });
    fireEvent.click(screen.getByTestId('plan-select-PLANO-A'));
    fillAndClear();
    expect(cleared).not.toBe(null);
    expect(cleared.length).toBe(1);
    expect(screen.queryByTestId('plan-refusal')).toBeNull();
  });

  it('a confirmacao e um passo separado, e lista o que sera removido', () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('plan-select-PLANO-A'));
    fillAndPresent();
    expect(screen.getByTestId('plan-confirmation')).toBeTruthy();
    expect(screen.getByTestId('plan-confirmation-list').textContent).toContain('PLANO-A');
    expect(screen.getByTestId('plan-confirmation-list').textContent).toContain('1 item');
  });

  it('nada e removido antes da confirmacao', () => {
    let called = 0;
    renderPanel({
      onClear: () => {
        called += 1;
        return [];
      },
    });
    fireEvent.click(screen.getByTestId('plan-select-PLANO-A'));
    fillAndPresent();
    expect(called).toBe(0);
  });

  it('cancelar fecha a confirmacao sem remover', () => {
    let called = 0;
    renderPanel({ onClear: () => { called += 1; return []; } });
    fireEvent.click(screen.getByTestId('plan-select-PLANO-A'));
    fillAndPresent();
    fireEvent.click(screen.getByTestId('plan-cancel-button'));
    expect(screen.queryByTestId('plan-confirmation')).toBeNull();
    expect(called).toBe(0);
  });

  // O caso que a impressao digital existe para pegar: o dialogo listou dois planos, um
  // terceiro entra no cache enquanto o fisico le, e ele confirma.
  it('RECUSA quando um plano entra no cache entre apresentar e confirmar', () => {
    const a = entry({ planId: 'PLANO-A' });
    const b = entry({ planId: 'PLANO-B' });
    const c = entry({ planId: 'PLANO-C' });
    let cleared = 0;
    const { rerender } = render(
      <CachedPlansPanel
        entries={[a, b]}
        nowMs={NOW}
        actorId="FIS-9"
        onClear={() => {
          cleared += 1;
          return [];
        }}
      />
    );
    fireEvent.click(screen.getByTestId('plan-select-PLANO-A'));
    fireEvent.click(screen.getByTestId('plan-select-PLANO-B'));
    fillAndPresent();
    expect(screen.getByTestId('plan-confirmation-list').textContent).toContain('2 item');

    // Um terceiro item aparece e e marcado antes da confirmacao.
    rerender(
      <CachedPlansPanel
        entries={[a, b, c]}
        nowMs={NOW}
        actorId="FIS-9"
        onClear={() => {
          cleared += 1;
          return [];
        }}
      />
    );
    fireEvent.click(screen.getByTestId('plan-select-PLANO-C'));
    fireEvent.click(screen.getByTestId('plan-confirm-button'));

    expect(cleared).toBe(0);
    expect(screen.getByTestId('plan-refusal').textContent).toContain('mudou');
  });

  it('RECUSA quando um plano sai da selecao entre apresentar e confirmar', () => {
    const a = entry({ planId: 'PLANO-A' });
    const b = entry({ planId: 'PLANO-B' });
    let cleared = 0;
    renderPanel({
      entries: [a, b],
      onClear: () => {
        cleared += 1;
        return [];
      },
    });
    fireEvent.click(screen.getByTestId('plan-select-PLANO-A'));
    fireEvent.click(screen.getByTestId('plan-select-PLANO-B'));
    fillAndPresent();
    // Desmarca um antes de confirmar.
    fireEvent.click(screen.getByTestId('plan-select-PLANO-B'));
    fireEvent.click(screen.getByTestId('plan-confirm-button'));
    expect(cleared).toBe(0);
    expect(screen.getByTestId('plan-refusal').textContent.length > 0).toBe(true);
  });

  it('a confirmacao carrega o digesto congelado no atributo', () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('plan-select-PLANO-A'));
    fillAndPresent();
    const digest = screen.getByTestId('plan-confirmation-digest').getAttribute('data-digest');
    expect(digest.startsWith('pc1-')).toBe(true);
  });

  it('recusa na confirmacao quando falta justificativa', () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('plan-select-PLANO-A'));
    fireEvent.click(screen.getByTestId('plan-ack'));
    fireEvent.click(screen.getByTestId('plan-clear-button'));
    fireEvent.click(screen.getByTestId('plan-confirm-button'));
    expect(screen.getByTestId('plan-refusal').textContent.length > 0).toBe(true);
  });

  it('recusa na confirmacao sem reconhecer a irreversibilidade', () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('plan-select-PLANO-A'));
    fireEvent.change(screen.getByTestId('plan-reason'), { target: { value: 'motivo' } });
    fireEvent.click(screen.getByTestId('plan-clear-button'));
    fireEvent.click(screen.getByTestId('plan-confirm-button'));
    expect(screen.getByTestId('plan-refusal')).toBeTruthy();
  });

  it('nao apresenta nada sem plano selecionado', () => {
    renderPanel();
    fillAndPresent();
    expect(screen.getByTestId('plan-refusal').textContent).toContain('Nenhum plano');
    expect(screen.queryByTestId('plan-confirmation')).toBeNull();
  });
});

describe('CachedPlansPanel: instantaneo nao verificado nao parece vigente', () => {
  it('marca o veredicto de vigencia na linha', () => {
    renderPanel();
    expect(screen.getByTestId('plan-row-PLANO-A').getAttribute('data-currency')).toBe(
      PLAN_CACHE_CURRENCY_VERDICTS.VERIFIABLE_CURRENT
    );
  });

  it('nao verificado recebe tom e motivo proprios', () => {
    renderPanel({ entries: [entry({ revisionVerification: {} })] });
    const row = screen.getByTestId('plan-row-PLANO-A');
    expect(row.getAttribute('data-currency')).toBe(
      PLAN_CACHE_CURRENCY_VERDICTS.SNAPSHOT_UNVERIFIED
    );
    expect(row.className).toContain('unverified');
    expect(screen.getByTestId('plan-currency-reason-PLANO-A').textContent).toContain(
      'nunca foi confrontada'
    );
  });

  it('vigente nao mostra motivo de ressalva', () => {
    renderPanel();
    expect(screen.queryByTestId('plan-currency-reason-PLANO-A')).toBeNull();
  });

  it('mostra o selo com a origem e o instante de captura', () => {
    renderPanel();
    expect(screen.getByTestId('plan-currency-PLANO-A').textContent).toContain('ARIA-HOSP1');
  });
});

describe('CachedPlansPanel: linha bloqueada nao e selecionavel', () => {
  it('desabilita a caixa de um plano em uso e mostra o motivo', () => {
    renderPanel({
      entries: [entry({ usage: { kind: 'in-use', holder: 'DICOM Daemon' } })],
    });
    const box = screen.getByTestId('plan-select-PLANO-A') as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(screen.getByTestId('plan-blockers-PLANO-A').textContent).toContain('DICOM Daemon');
  });

  it('desabilita quando o uso e desconhecido', () => {
    renderPanel({ entries: [entry({ usage: undefined })] });
    expect((screen.getByTestId('plan-select-PLANO-A') as HTMLInputElement).disabled).toBe(true);
  });

  it('desabilita quando o curso esta em andamento', () => {
    renderPanel({ entries: [entry({ courseStatus: 'in-progress' })] });
    expect((screen.getByTestId('plan-select-PLANO-A') as HTMLInputElement).disabled).toBe(true);
  });

  it('desabilita item que nao e copia externa', () => {
    renderPanel({ entries: [entry({ externallyCached: false })] });
    expect((screen.getByTestId('plan-select-PLANO-A') as HTMLInputElement).disabled).toBe(true);
  });

  it('marca clearable no atributo da linha', () => {
    renderPanel();
    expect(screen.getByTestId('plan-row-PLANO-A').getAttribute('data-clearable')).toBe('true');
  });
});

describe('CachedPlansPanel: data ausente nao le como nunca tratado', () => {
  it('usa o rotulo de indisponivel e avisa', () => {
    renderPanel({ entries: [entry({ lastTreatment: undefined })] });
    const label = screen.getByTestId('plan-last-treatment-PLANO-A').textContent;
    expect(label).toContain('indisponível');
    expect(label).not.toContain('Nunca tratado');
    expect(screen.getByTestId('plan-warnings-PLANO-A').textContent).toContain(
      'nunca foi tratado'
    );
  });

  it('nunca tratado atestado aparece como tal', () => {
    renderPanel({
      entries: [entry({ lastTreatment: { kind: 'never-treated', attestedBy: 'RTRECORD' } })],
    });
    expect(screen.getByTestId('plan-last-treatment-PLANO-A').textContent).toContain(
      'Nunca tratado'
    );
  });

  it('tratado mostra a data', () => {
    renderPanel();
    expect(screen.getByTestId('plan-last-treatment-PLANO-A').textContent).toContain(
      'Último tratamento em'
    );
  });
});

describe('CachedPlansPanel: "cache limpo" nunca aparece para limpeza parcial', () => {
  function twoPlans() {
    return [entry({ planId: 'P1' }), entry({ planId: 'P2' })];
  }

  it('limpeza completa afirma que tudo foi removido', () => {
    renderPanel({
      entries: twoPlans(),
      onClear: (keys: string[]) =>
        keys.map(k => ({ entryKey: k, succeeded: true })) as PlanCacheClearAttempt[],
    });
    fireEvent.click(screen.getByTestId('plan-select-P1'));
    fireEvent.click(screen.getByTestId('plan-select-P2'));
    fillAndClear();
    expect(screen.getByTestId('plan-report').getAttribute('data-verdict')).toBe('success');
    expect(screen.getByTestId('plan-clean')).toBeTruthy();
    expect(screen.queryByTestId('plan-may-remain')).toBeNull();
  });

  it('um plano que falhou nao produz "cache limpo"', () => {
    renderPanel({
      entries: twoPlans(),
      onClear: (keys: string[]) =>
        keys.map((k, i) => ({ entryKey: k, succeeded: i === 0 })) as PlanCacheClearAttempt[],
    });
    fireEvent.click(screen.getByTestId('plan-select-P1'));
    fireEvent.click(screen.getByTestId('plan-select-P2'));
    fillAndClear();
    expect(screen.getByTestId('plan-report').getAttribute('data-verdict')).toBe('partial');
    expect(screen.queryByTestId('plan-clean')).toBeNull();
    expect(screen.getByTestId('plan-may-remain').textContent).toContain('mistura');
  });

  it('plano nao contabilizado avisa tao alto quanto plano que falhou', () => {
    renderPanel({
      entries: twoPlans(),
      // Devolve resultado para apenas um dos dois autorizados.
      onClear: (keys: string[]) =>
        [{ entryKey: keys[0], succeeded: true }] as PlanCacheClearAttempt[],
    });
    fireEvent.click(screen.getByTestId('plan-select-P1'));
    fireEvent.click(screen.getByTestId('plan-select-P2'));
    fillAndClear();
    expect(screen.getByTestId('plan-may-remain')).toBeTruthy();
  });

  it('lista o resultado por plano', () => {
    renderPanel({
      entries: twoPlans(),
      onClear: (keys: string[]) =>
        keys.map((k, i) => ({ entryKey: k, succeeded: i === 0 })) as PlanCacheClearAttempt[],
    });
    fireEvent.click(screen.getByTestId('plan-select-P1'));
    fireEvent.click(screen.getByTestId('plan-select-P2'));
    fillAndClear();
    expect(screen.getByTestId('plan-outcomes').querySelectorAll('li').length).toBe(2);
  });

  it('sem executor NAO afirma que removeu', () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('plan-select-PLANO-A'));
    fillAndClear();
    expect(screen.queryByTestId('plan-report')).toBeNull();
    expect(screen.queryByTestId('plan-clean')).toBeNull();
    expect(screen.queryByTestId('plan-refusal')).toBeNull();
  });
});

describe('CachedPlansPanel: dois instantaneos do mesmo plano', () => {
  it('sinaliza o irmao em cada linha', () => {
    renderPanel({
      entries: [entry({ cachedAt: NOW - 2 * HOUR }), entry({ cachedAt: NOW - 6 * HOUR })],
    });
    expect(screen.getAllByTestId('plan-sibling-PLANO-A').length).toBe(2);
  });

  it('as duas linhas tem chaves de item distintas', () => {
    const a = entry({ cachedAt: NOW - 2 * HOUR });
    const b = entry({ cachedAt: NOW - 6 * HOUR });
    expect(planCacheEntryKey(a)).not.toBe(planCacheEntryKey(b));
  });
});

describe('CachedPlansPanel: inventario', () => {
  it('conta vigentes, nao verificados e desatualizados', () => {
    const stale = entry({ planId: 'P-STALE' });
    stale.sourceRevision.supersededByRevisionId = 'rev-8';
    renderPanel({ entries: [entry({ planId: 'P-OK' }), stale] });
    const text = screen.getByTestId('plan-counts').textContent;
    expect(text).toContain('1 vigente');
    expect(text).toContain('1 desatualizado');
  });

  it('relata item malformado em vez de descartar', () => {
    renderPanel({
      entries: [entry(), { planId: '', patientRef: '', cachedAt: 0, sourceSystem: '' } as PlanCacheEntry],
    });
    expect(screen.getByTestId('plan-invalid').textContent).toContain('malformado');
    expect(screen.getByTestId('plan-rows').querySelectorAll(':scope > li').length).toBe(1);
  });

  it('recusa o inventario inteiro com instante invalido', () => {
    renderPanel({ nowMs: Number.NaN });
    expect(screen.getByTestId('plan-inventory-refused')).toBeTruthy();
    expect(screen.queryByTestId('plan-rows')).toBeNull();
  });
});
