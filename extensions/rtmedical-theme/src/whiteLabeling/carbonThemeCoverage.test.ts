/**
 * O tema Carbon tem de cobrir TODO token que o ui-next declara (RTV-235).
 *
 * Este e o contrato de aparencia com o upstream, e existe para uma exigencia especifica do
 * produto: atualizar o OHIF quando quisermos e a nossa UI continuar sendo a nossa UI.
 *
 * ## Por que uma contagem nao bastaria
 *
 * O tema pinta os design tokens do ui-next gravando custom properties INLINE no <html>, o que
 * vence `:root` e `.dark` da folha do upstream. Isso protege o que o tema pinta -- e nao diz
 * nada sobre o que ele NAO pinta. Um token que o upstream acrescente nasce sem par no nosso
 * lado, e a aparencia padrao do OHIF vaza por ali, em silencio, ate alguem abrir o viewer e
 * reparar.
 *
 * Medido em 11/09/2026, antes desta guarda: o ui-next declarava 41 tokens e o tema pintava 22.
 * Os 19 de fora eram `--destructive(+foreground)`, os cinco `--chart-*` e as doze semanticas
 * (error/info/success/warning x bg/border/text).
 *
 * VALE SER PRECISO SOBRE O QUE ERA DIVIDA E O QUE ERA RISCO, porque a diferenca muda a
 * prioridade: so `--destructive` tinha consumidor de verdade (cinco lugares com
 * `bg-destructive`/`text-destructive`). As doze semanticas e os cinco `--chart-*` estao
 * declarados no tailwind.css e nao sao usados por componente nenhum -- nem por `var()`, nem por
 * classe Tailwind. Ou seja, nao havia tela branca no viewer escuro; havia a garantia de que
 * haveria no dia em que o upstream comecasse a usa-los. As semanticas so existem no bloco
 * claro do tailwind.css e NUNCA sao redefinidas no `.dark`: `--warning-bg` e
 * `hsl(49, 100%, 97%)`, quase branco.
 *
 * ## Os dois formatos, que e a falha que nao da erro
 *
 * O tailwind.css do upstream NAO e uniforme:
 *   - `--background`, `--primary`, `--destructive`, `--chart-*` sao TRIPLETES (`H S% L%`),
 *     consumidos como `hsl(var(--token))`;
 *   - as familias semanticas sao COR COMPLETA (`hsl(49, 100%, 97%)`).
 *
 * Gravar um triplete onde se espera cor completa (ou o contrario) produz um valor invalido, que
 * o CSS descarta calado: a regra inteira morre e o elemento fica com a cor herdada. Nao ha erro
 * no console, nao ha teste vermelho -- so uma cor errada que ninguem consegue explicar. Por isso
 * a guarda compara FORMATO, e nao so presenca.
 */
import { CARBON_G100_TOKENS, CARBON_G80_TOKENS, resolveCarbonTheme } from './carbonTheme';
import fs from 'fs';
import path from 'path';

// __dirname e <repo>/extensions/rtmedical-theme/src/whiteLabeling.
const REPO_DIR = path.resolve(__dirname, '../../../..');
const TAILWIND_CSS = path.join(REPO_DIR, 'platform/ui-next/src/tailwind.css');

/**
 * Tokens que o tema pinta DE PROPOSITO sem o ui-next declarar.
 *
 * Vazia hoje, e a intencao e que continue. Uma entrada aqui e um token que so o nosso lado
 * conhece -- legitimo se alguma extensao nossa o consumir, e lixo se ninguem consumir. Como a
 * lista e exata, entrar nela e uma decisao registrada e nao um acidente.
 */
const NOSSOS_SOMENTE: string[] = [];

/** `--token:` no inicio de uma linha de declaracao. */
const DECLARED = /^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gm;

/**
 * Como o valor esta escrito. `triplete` = `H S% L%` para `hsl(var(--x))`;
 * `cor` = qualquer coisa que ja seja uma cor CSS pronta. `outro` cobre `--radius`, que e
 * comprimento e nao entra na comparacao de cor.
 */
function formato(valor: string): string {
  const v = valor.trim();
  if (/^-?[\d.]+(rem|px|em)$/.test(v)) {
    return 'outro';
  }
  if (/^[\d.]+\s+[\d.]+%\s+[\d.]+%$/.test(v)) {
    return 'triplete';
  }
  if (/^(hsl|rgb|#)/i.test(v)) {
    return 'cor';
  }
  return 'outro';
}

function tokensDeclarados(): Map<string, string> {
  const css = fs.readFileSync(TAILWIND_CSS, 'utf8');
  const out = new Map<string, string>();
  DECLARED.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DECLARED.exec(css)) !== null) {
    const nome = match[1];
    const valor = match[2].trim();
    // Um token vazio (`--chart-1: ;`) existe no arquivo e nao diz nada sobre formato;
    // o primeiro valor real vence.
    if (!valor) {
      continue;
    }
    if (!out.has(nome)) {
      out.set(nome, valor);
    }
  }
  return out;
}

const DECLARADOS = tokensDeclarados();

describe('tema Carbon: cobertura dos tokens do ui-next (RTV-235)', () => {
  it('consegue ler os tokens do ui-next (se isto zerar, a guarda morreu)', () => {
    expect(DECLARADOS.size).toBeGreaterThan(30);
  });

  it('todo token declarado pelo ui-next e pintado pelo tema', () => {
    const semPar = Array.from(DECLARADOS.keys())
      .filter(token => !(token in CARBON_G100_TOKENS))
      .sort();
    expect(semPar).toEqual([]);
  });

  it('o tema nao pinta token que o ui-next nao declara', () => {
    const sobrando = Object.keys(CARBON_G100_TOKENS)
      .filter(token => !DECLARADOS.has(token) && NOSSOS_SOMENTE.indexOf(token) < 0)
      .sort();
    expect(sobrando).toEqual([]);
  });

  /**
   * Ver o cabecalho: formato trocado nao da erro, da cor herdada. Compara-se a FORMA do valor,
   * nunca a cor em si -- a cor e justamente o que temos o direito de trocar.
   */
  it('cada token e escrito no mesmo formato que o ui-next espera', () => {
    const divergentes: string[] = [];
    for (const [token, valorUpstream] of DECLARADOS) {
      const nosso = CARBON_G100_TOKENS[token];
      if (nosso === undefined) {
        continue;
      }
      const esperado = formato(valorUpstream);
      const obtido = formato(nosso);
      if (esperado !== obtido) {
        divergentes.push(token + ': ui-next usa ' + esperado + ', o tema grava ' + obtido);
      }
    }
    expect(divergentes.sort()).toEqual([]);
  });

  it('o g80 cobre exatamente os mesmos tokens que o g100', () => {
    const g100 = Object.keys(CARBON_G100_TOKENS).sort();
    const g80 = Object.keys(CARBON_G80_TOKENS).sort();
    expect(g80).toEqual(g100);
  });

  it('o g80 so muda superficie neutra, mantendo acento, texto e cantos do g100', () => {
    // O que define a identidade Carbon e compartilhado; o g80 e um degrau de cinza, nao outro
    // tema. Se um destes divergir, os dois temas viraram dois produtos.
    for (const token of ['--primary', '--ring', '--foreground', '--radius', '--destructive']) {
      expect(CARBON_G80_TOKENS[token]).toBe(CARBON_G100_TOKENS[token]);
    }
  });
});

/**
 * O tema e SEMPRE escuro, e o `g80` guarda a rampa do g90 do Carbon apesar do nome.
 *
 * Duas decisoes de produto que ate agora viviam so em comentario. Comentario nao impede
 * ninguem de mudar o valor; teste impede.
 */
describe('tema Carbon: as duas decisoes de produto (RTV-235)', () => {
  /** Luminosidade de um triplete `H S% L%`. */
  function luz(triplete: string): number {
    const partes = triplete.trim().split(/\s+/);
    return parseFloat(partes[partes.length - 1]);
  }

  /**
   * O viewer nunca abre claro.
   *
   * `resolveCarbonTheme` cai no g100 para qualquer coisa que nao seja 'g80' -- inclusive nomes
   * de tema CLARO do proprio Carbon, que e o caso que interessa: 'white' e 'g10' existem, sao
   * plausiveis numa URL, e nao podem acender a tela de quem esta lendo imagem no escuro.
   */
  it('nenhuma entrada, nem os temas claros do Carbon, produz um tema claro', () => {
    const entradas = ['white', 'g10', 'light', 'G100', 'g90', '', '   ', 'lixo', null, undefined];
    for (const entrada of entradas) {
      const tokens = resolveCarbonTheme(entrada as string);
      // Fundo escuro e texto claro — a definicao operacional de "tema preto".
      expect(luz(tokens['--background'])).toBeLessThan(25);
      expect(luz(tokens['--foreground'])).toBeGreaterThan(75);
    }
  });

  /**
   * Ver o cabecalho de CARBON_G80_TOKENS: o nome diverge do Carbon DE PROPOSITO, porque ja esta
   * persistido no localStorage das estacoes. O perigo e alguem "corrigir" os valores para casar
   * com o nome e escurecer a rampa para Gray 80/70/60. Estes numeros sao o tema g90 do Carbon.
   */
  it('o g80 mantem a rampa do g90 do Carbon: Gray 90 / 80 / 70', () => {
    expect(CARBON_G80_TOKENS['--background']).toBe('0 0% 14.9%'); // Gray 90 #262626
    expect(CARBON_G80_TOKENS['--card']).toBe('0 0% 22.4%'); // Gray 80 #393939
    expect(CARBON_G80_TOKENS['--secondary']).toBe('0 0% 32.2%'); // Gray 70 #525252
  });

  /** E o g100 continua sendo o default do produto: base Gray 100. */
  it('o g100 e a base Gray 100 do Carbon', () => {
    expect(CARBON_G100_TOKENS['--background']).toBe('0 0% 8.6%'); // Gray 100 #161616
    expect(CARBON_G100_TOKENS['--card']).toBe('0 0% 14.9%'); // Gray 90 #262626
    expect(CARBON_G100_TOKENS['--secondary']).toBe('0 0% 22.4%'); // Gray 80 #393939
  });
});
