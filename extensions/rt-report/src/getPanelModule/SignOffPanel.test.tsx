import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import SignOffPanel from './SignOffPanel';
import { signEvaluateReadiness, type SignReportDraft, type SignSignature } from '../signOff';

const T0 = 1_760_000_000_000;

/** Rascunho limpo: assinavel, sem pendencia obrigatoria. */
function cleanDraft(over: Partial<SignReportDraft> = {}): SignReportDraft {
  return {
    reportId: 'LAU-1',
    studyInstanceUID: '1.2.840.113619.2.55.3',
    stage: 'final',
    paragraphs: [
      { id: 'tecnica', kind: 'authored', text: 'TC de torax sem contraste.', editedAt: T0 },
      {
        id: 'pulmoes',
        kind: 'assertive-default',
        text: 'Pulmoes sem alteracoes.',
        confirmedAt: T0,
      },
    ],
    structuredFindings: [
      {
        code: 'RDE1',
        label: 'Nodulo',
        assertion: 'absent',
        severity: 'routine',
        proseAssertion: 'absent',
      },
    ],
    criticalCommunications: [],
    peerReview: { required: false, state: 'waived' },
    contentDigest: 'a'.repeat(64),
    priorStudyAvailable: false,
    clinicalIndicationPresent: true,
    ...over,
  };
}

/** Rascunho com o campo de normalidade pre-preenchido e NAO confirmado. */
function unconfirmedDraft(): SignReportDraft {
  return cleanDraft({
    paragraphs: [
      { id: 'tecnica', kind: 'authored', text: 'TC de torax.', editedAt: T0 },
      { id: 'pulmoes', kind: 'assertive-default', text: 'Pulmoes sem alteracoes.' },
      { id: 'mediastino', kind: 'assertive-default', text: 'Mediastino sem alteracoes.' },
    ],
  });
}

function signature(): SignSignature {
  return {
    reportId: 'LAU-1',
    version: 1,
    contentDigest: 'a'.repeat(64),
    signerId: 'CRM-SP-123456',
    signerRole: 'attending',
    authorityKind: 'author',
    stage: 'final',
    signedAt: T0,
    signatureFormat: 'PAdES',
    councilId: 'CRM-SP',
  };
}

/* ------------------------------------------------------------------ */

describe('SignOffPanel: a fixture reflete o nucleo', () => {
  it('o rascunho limpo e realmente assinavel pelo nucleo', () => {
    expect(signEvaluateReadiness(cleanDraft()).signAllowed).toBe(true);
  });

  it('o rascunho nao confirmado e realmente bloqueado pelo nucleo', () => {
    const readiness = signEvaluateReadiness(unconfirmedDraft());
    expect(readiness.signAllowed).toBe(false);
    expect(readiness.blocking.length >= 2).toBe(true);
  });
});

describe('SignOffPanel: bloqueio nao e faixa descartavel', () => {
  it('lista as pendencias obrigatorias', () => {
    render(<SignOffPanel draft={unconfirmedDraft()} />);
    expect(screen.getByTestId('sign-blocking-section')).toBeTruthy();
    expect(screen.getByTestId('sign-blocking-list').querySelectorAll('li').length >= 2).toBe(true);
  });

  it('nao oferece nenhum meio de fechar ou recolher a lista', () => {
    render(<SignOffPanel draft={unconfirmedDraft()} />);
    const section = screen.getByTestId('sign-blocking-section');
    const buttons = Array.from(section.querySelectorAll('button')).map(b =>
      (b.getAttribute('data-testid') ?? '').replace(/-.*/, '')
    );
    // Os unicos botoes na secao sao os de navegar ate o campo.
    expect(buttons.every(id => id === 'sign')).toBe(true);
    expect(section.querySelector('[data-testid*="dismiss"]')).toBeNull();
    expect(section.querySelector('[data-testid*="collapse"]')).toBeNull();
  });

  it('nomeia o campo ofensor em cada pendencia', () => {
    render(<SignOffPanel draft={unconfirmedDraft()} />);
    expect(screen.getByTestId('sign-blocking-pulmoes')).toBeTruthy();
    expect(screen.getByTestId('sign-blocking-mediastino')).toBeTruthy();
  });

  it('oferece navegar ate o campo, para a pendencia nao ser contornada', () => {
    let focused: string | null = null;
    render(
      <SignOffPanel
        draft={unconfirmedDraft()}
        onFocusSubject={s => {
          focused = s;
        }}
      />
    );
    fireEvent.click(screen.getByTestId('sign-focus-pulmoes'));
    expect(focused).toBe('pulmoes');
  });

  it('diz explicitamente quando nao ha pendencia', () => {
    render(<SignOffPanel draft={cleanDraft()} />);
    expect(screen.getByTestId('sign-ready')).toBeTruthy();
    expect(screen.queryByTestId('sign-blocking-section')).toBeNull();
  });
});

describe('SignOffPanel: o botao nunca fica desabilitado sem motivo', () => {
  // aria-disabled e nao o atributo disabled: um botao com `disabled` sai da ordem de
  // tabulacao, entao o radiologista que navega por teclado nao consegue alcanca-lo para
  // descobrir por que assinar esta indisponivel.
  it('anuncia indisponivel sem sair da ordem de tabulacao', () => {
    render(<SignOffPanel draft={unconfirmedDraft()} />);
    const button = screen.getByTestId('sign-button') as HTMLButtonElement;
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.disabled).toBe(false);
  });

  it('mostra o motivo adjacente ao botao', () => {
    render(<SignOffPanel draft={unconfirmedDraft()} />);
    expect(screen.getByTestId('sign-button-reason').textContent).toContain('Indisponivel');
  });

  it('poe a contagem no rotulo acessivel', () => {
    render(<SignOffPanel draft={unconfirmedDraft()} />);
    expect(screen.getByTestId('sign-button').getAttribute('aria-label')).toContain('pendencia');
  });

  it('nao anuncia indisponivel nem mostra motivo quando esta limpo', () => {
    render(<SignOffPanel draft={cleanDraft()} />);
    expect(screen.getByTestId('sign-button').getAttribute('aria-disabled')).toBe('false');
    expect(screen.queryByTestId('sign-button-reason')).toBeNull();
  });
});

describe('SignOffPanel: o portao roda no clique tambem', () => {
  it('assina quando o rascunho esta limpo', () => {
    let signed = 0;
    render(<SignOffPanel draft={cleanDraft()} onSign={() => { signed += 1; }} />);
    fireEvent.click(screen.getByTestId('sign-button'));
    expect(signed).toBe(1);
    expect(screen.queryByTestId('sign-refusal')).toBeNull();
  });

  it('o clique num botao bloqueado recusa e NAO chama onSign', () => {
    let signed = 0;
    render(<SignOffPanel draft={unconfirmedDraft()} onSign={() => { signed += 1; }} />);
    fireEvent.click(screen.getByTestId('sign-button'));
    expect(signed).toBe(0);
    expect(screen.getByTestId('sign-refusal').textContent).toContain('recusada');
  });

  it('a recusa do clique nomeia as pendencias, em vez de so nao fazer nada', () => {
    render(<SignOffPanel draft={unconfirmedDraft()} onSign={() => undefined} />);
    fireEvent.click(screen.getByTestId('sign-button'));
    expect(screen.getByTestId('sign-refusal').textContent).toContain('pendencia');
  });

  it('mostra a recusa do hospedeiro quando ele tambem recusa', () => {
    render(
      <SignOffPanel
        draft={cleanDraft()}
        onSign={() => ({ ok: false, reason: 'Certificado do CRM expirado.' })}
      />
    );
    fireEvent.click(screen.getByTestId('sign-button'));
    expect(screen.getByTestId('sign-refusal').textContent).toBe('Certificado do CRM expirado.');
  });

  it('nao explode sem onSign', () => {
    render(<SignOffPanel draft={cleanDraft()} />);
    fireEvent.click(screen.getByTestId('sign-button'));
    expect(screen.queryByTestId('sign-refusal')).toBeNull();
  });
});

describe('SignOffPanel: bloqueante e informativo em listas separadas', () => {
  it('separa as duas listas', () => {
    // priorStudyAvailable sem comparacao gera uma observacao informativa.
    const draft = unconfirmedDraft();
    draft.priorStudyAvailable = true;
    draft.priorStudyCompared = false;
    render(<SignOffPanel draft={draft} />);
    expect(screen.getByTestId('sign-blocking-section')).toBeTruthy();
    expect(screen.getByTestId('sign-advisory-section')).toBeTruthy();
  });

  it('diz que a lista informativa NAO impede a assinatura', () => {
    const draft = cleanDraft({ priorStudyAvailable: true, priorStudyCompared: false });
    render(<SignOffPanel draft={draft} />);
    expect(screen.getByTestId('sign-advisory-title').textContent).toContain('NAO impedem');
  });

  it('um rascunho com so informativo continua assinavel', () => {
    const draft = cleanDraft({ priorStudyAvailable: true, priorStudyCompared: false });
    render(<SignOffPanel draft={draft} />);
    expect(screen.getByTestId('sign-button').getAttribute('aria-disabled')).toBe('false');
  });

  it('omite a secao informativa quando nao ha observacao', () => {
    render(<SignOffPanel draft={cleanDraft()} />);
    expect(screen.queryByTestId('sign-advisory-section')).toBeNull();
  });
});

describe('SignOffPanel: assinado nunca renderiza como entregue', () => {
  it('mostra a assinatura com versao e signatario', () => {
    render(<SignOffPanel draft={cleanDraft()} signature={signature()} />);
    const text = screen.getByTestId('sign-signed').textContent;
    expect(text).toContain('versao 1');
    expect(text).toContain('CRM-SP-123456');
  });

  it('afirma na mesma vista que assinar nao envia', () => {
    render(<SignOffPanel draft={cleanDraft()} signature={signature()} />);
    expect(screen.getByTestId('sign-not-delivered').textContent).toContain('nao envia');
  });

  it('nao mostra mais o botao de assinar', () => {
    render(<SignOffPanel draft={cleanDraft()} signature={signature()} />);
    expect(screen.queryByTestId('sign-button')).toBeNull();
  });

  it('oferece abrir a distribuicao como passo separado', () => {
    let opened = 0;
    render(
      <SignOffPanel
        draft={cleanDraft()}
        signature={signature()}
        onOpenDistribution={() => { opened += 1; }}
      />
    );
    fireEvent.click(screen.getByTestId('sign-open-distribution'));
    expect(opened).toBe(1);
  });

  it('a vista assinada nao mostra pendencias, mesmo se o rascunho as tivesse', () => {
    render(<SignOffPanel draft={unconfirmedDraft()} signature={signature()} />);
    expect(screen.queryByTestId('sign-blocking-section')).toBeNull();
  });
});
