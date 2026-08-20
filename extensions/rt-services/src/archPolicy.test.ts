/**
 * A política do ARCH.md e o gate que a aplica têm de continuar dizendo a mesma coisa.
 *
 * Este teste existe porque os dois já divergiram **duas vezes**, com o mesmo resultado nas
 * duas: a política proibia um mecanismo de fork e a verificação dava verde.
 *
 * - 19/08/2026: o texto enumerava três mecanismos e o gate espelhava o texto. O quarto --
 *   editar `platform/core` diretamente, que é onde `@ohif/core` mora neste monorepo -- não
 *   estava em nenhum dos dois. As três regras existentes casavam o literal `@ohif/<core>` no
 *   caminho, e `platform/core/src/foo.ts` não contém essa string em lugar nenhum.
 * - 20/08/2026: o quinto -- editar um mode do upstream -- apareceu ao fiar um painel num mode.
 *   O ARCH.md manda estender `modes/basic`, e editá-lo passava com verde.
 *
 * Nos dois casos ninguém tinha explorado o buraco. O problema não é o buraco: é que a
 * documentação e o script são editados em commits diferentes, por pessoas diferentes, e nada
 * compara os dois. Este arquivo compara.
 *
 * A checagem é textual de propósito. Executar o gate daqui exigiria commits sintéticos numa
 * branch descartável -- o que é o teste certo para o comportamento dele, mas é um script de
 * shell, não uma suite. O que se verifica aqui é a consistência que costuma quebrar: a
 * contagem de mecanismos, a lista que o CI diz aplicar, e a tabela de pacotes contra os
 * diretórios que o script realmente varre.
 */
import fs from 'fs';
import path from 'path';

// __dirname e <repo>/extensions/rt-services/src.
const REPO_DIR = path.resolve(__dirname, '../../..');
const ARCH_PATH = path.join(REPO_DIR, 'ARCH.md');
const GUARD_PATH = path.join(REPO_DIR, '.github/scripts/check-no-core-fork.sh');

const ARCH = fs.readFileSync(ARCH_PATH, 'utf8');
const GUARD = fs.readFileSync(GUARD_PATH, 'utf8');

/** Trecho entre um cabecalho e o proximo do mesmo nivel ou maior. */
function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(heading);
  if (start < 0) {
    return '';
  }
  const rest = markdown.slice(start + heading.length);
  const next = rest.search(/\n## /);
  return next < 0 ? rest : rest.slice(0, next);
}

const FORBIDDEN = section(ARCH, '## NÃO fazer');
const ENFORCEMENT = section(ARCH, '## Como o CI faz cumprir');

const NUMBER_WORDS: { [word: string]: number } = {
  uma: 1,
  duas: 2,
  tres: 3,
  três: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
};

describe('ARCH.md: a politica descreve a si mesma sem erro', () => {
  it('as duas secoes existem', () => {
    expect(FORBIDDEN.length > 0).toBe(true);
    expect(ENFORCEMENT.length > 0).toBe(true);
  });

  it('a quantidade escrita em palavra bate com a quantidade de itens numerados', () => {
    const claimed = FORBIDDEN.match(/São \*\*([a-zçà-ü]+)\*\* as formas/);
    expect(claimed).toBeTruthy();
    const expected = NUMBER_WORDS[claimed[1].toLowerCase()];
    expect(typeof expected).toBe('number');

    const items = FORBIDDEN.match(/^\d+\. /gm) ?? [];
    expect(items.length).toBe(expected);
  });

  it('os itens numerados estao em sequencia, sem numero repetido nem pulado', () => {
    const numbers = (FORBIDDEN.match(/^(\d+)\. /gm) ?? []).map(m => Number(m.trim().replace('.', '')));
    expect(numbers).toEqual(numbers.map((_value, index) => index + 1));
  });
});

describe('ARCH.md: o que o CI diz aplicar cobre todos os mecanismos', () => {
  it('a lista do CI tem um item por mecanismo proibido', () => {
    const mechanisms = (FORBIDDEN.match(/^\d+\. /gm) ?? []).length;
    // Sub-itens da lista do que o script faz falhar.
    const enforced = (ENFORCEMENT.match(/^ {2}- /gm) ?? []).length;
    expect(enforced).toBe(mechanisms);
  });

  it('a secao do CI manda editar os tres lugares no mesmo commit', () => {
    expect(ENFORCEMENT).toContain('no mesmo commit');
  });
});

describe('ARCH.md: a tabela de pacotes bate com o que o gate varre', () => {
  /** Diretorios da coluna "Onde vive neste repo". */
  const tableDirs = (FORBIDDEN.match(/\|\s*`([a-z]+\/[a-z-]+)`\s*\|/g) ?? []).map(cell =>
    cell.replace(/[|`\s]/g, '')
  );

  /** Entradas de CORE_PATHS no script. */
  const guardDirs = (() => {
    const block = GUARD.match(/CORE_PATHS=\(([^)]*)\)/);
    if (!block) {
      return [];
    }
    return (block[1].match(/"([^"]+)"/g) ?? []).map(entry => entry.replace(/"/g, ''));
  })();

  it('encontrou as duas listas', () => {
    expect(tableDirs.length > 0).toBe(true);
    expect(guardDirs.length > 0).toBe(true);
  });

  it('todo diretorio da tabela e varrido pelo gate', () => {
    const missing = tableDirs.filter(dir => guardDirs.indexOf(dir) < 0);
    expect(missing).toEqual([]);
  });

  it('todo diretorio varrido pelo gate esta na tabela', () => {
    const extra = guardDirs.filter(dir => tableDirs.indexOf(dir) < 0);
    expect(extra).toEqual([]);
  });

  it('os diretorios da tabela existem de verdade neste repo', () => {
    const absent = tableDirs.filter(dir => !fs.existsSync(path.join(REPO_DIR, dir)));
    expect(absent).toEqual([]);
  });
});

describe('gate: os pontos de integracao sancionados sao os mesmos nos dois lugares', () => {
  const guardAllow = (() => {
    const block = GUARD.match(/CORE_PATH_ALLOW=\(([^)]*)\)/);
    if (!block) {
      return [];
    }
    return (block[1].match(/"([^"]+)"/g) ?? []).map(entry => entry.replace(/"/g, ''));
  })();

  it('encontrou a lista do gate', () => {
    expect(guardAllow.length > 0).toBe(true);
  });

  it('cada excecao do gate aparece no ARCH.md', () => {
    const missing = guardAllow.filter(allow => {
      // A doc escreve `public/config/**`; o gate casa por prefixo `public/config/`.
      const documented = allow.replace(/\/$/, '');
      return ARCH.indexOf(documented) < 0;
    });
    expect(missing).toEqual([]);
  });
});

describe('gate: os modes do upstream sao derivados, nao fixados', () => {
  it('o script deriva a lista dos package.json em vez de listar diretorios', () => {
    expect(GUARD).toContain('UPSTREAM_MODE_DIRS');
    expect(GUARD).toContain('modes/*/');
    // Uma lista fixa de nome de mode e justamente o que envelhece quando o upstream
    // acrescenta um mode.
    expect(GUARD).not.toContain('"modes/basic"');
    expect(GUARD).not.toContain('"modes/tmtv"');
  });

  it('o ARCH.md explica que a lista e derivada', () => {
    expect(FORBIDDEN).toContain('derivada');
    expect(FORBIDDEN).toContain('@rt/mode-');
    expect(FORBIDDEN).toContain('@ohif/mode-');
  });

  it('os nossos modes seguem o prefixo que o gate usa para nos distinguir', () => {
    const modesDir = path.join(REPO_DIR, 'modes');
    const ours: string[] = [];
    for (const entry of fs.readdirSync(modesDir)) {
      const pkgPath = path.join(modesDir, entry, 'package.json');
      if (!fs.existsSync(pkgPath)) {
        continue;
      }
      const name = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).name ?? '';
      if (String(name).indexOf('@rt/') === 0) {
        ours.push(entry);
      }
    }
    expect(ours.length > 0).toBe(true);
    // O gate tem um fallback por prefixo de diretorio para o caso de package.json
    // ilegivel; se um mode nosso nao seguir o prefixo, esse fallback o trataria como
    // upstream e bloquearia trabalho legitimo.
    const offPrefix = ours.filter(dir => dir.indexOf('rtmedical-') !== 0);
    expect(offPrefix).toEqual([]);
  });
});
