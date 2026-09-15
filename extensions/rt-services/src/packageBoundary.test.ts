/**
 * Import relativo nao pode atravessar a fronteira do pacote em runtime (RTV-237).
 *
 * `import X from '../../default/src/ViewerLayout/ViewerHeader'` compila, empacota e funciona --
 * e amarra o nosso codigo a um arquivo INTERNO de outro pacote, sem passar por barrel nenhum.
 * Quando o alvo e um pacote do upstream, isso e uma dependencia de algo que eles podem mover ou
 * renomear a qualquer sync, sem aviso e sem nada quebrar antes do build.
 *
 * ## Por que nenhuma guarda existente ve isso
 *
 * - O gate do RTV-114 (`check-no-core-fork.sh`) reprova MODIFICAR pacote core. Aqui nada foi
 *   modificado -- so importado. Da verde.
 * - `workspaceImports.test.ts` (RTV-234) confere se o nome importado existe no que o pacote
 *   EXPORTA. Um caminho relativo nao passa por barrel, entao nao ha export a conferir.
 * - `extensionLoads.test.ts` (RTV-236) carrega o ponto de entrada. O import resolve, entao a
 *   carga passaria -- e no caso do rt-tps ela nem chega a acontecer, justamente porque a cadeia
 *   puxa a aplicacao inteira.
 *
 * O buraco e exatamente o mesmo formato das duas correcoes de 19 e 20/08 no gate do RTV-114: a
 * politica proibia o acoplamento e a verificacao nao o detectava.
 *
 * ## A distincao que esta guarda faz, e por que ela importa
 *
 * Nem todo import relativo que escapa e igual:
 *
 *   - RUNTIME (`import { collectIsocenters } from '...'`) cria acoplamento de verdade: o modulo
 *     e carregado, o codigo executa, e a assinatura importa.
 *   - TYPE-ONLY (`import type { RtPlan } from '...'`) e apagado na compilacao. Nao ha modulo
 *     carregado, nao ha nada no bundle, e o acoplamento e so de forma.
 *
 * Type-only e TOLERADO de proposito, e nao por preguica. `usePlanData.ts` faz isso e explica no
 * proprio arquivo: "Type-only import of the parser model -- no runtime coupling (zero fork,
 * RTV-114)". A alternativa seria copiar `RtPlan` e seus tipos aninhados para dentro do rt-tps, e
 * um tipo duplicado diverge em silencio -- o que e pior que a dependencia que ele evita. O repo
 * ja usa duck-typing onde o tipo e pequeno (ver o cabecalho de `rt-timeline/src/courseTimeline.ts`);
 * aqui o tipo nao e.
 *
 * ## A lista e exata nos dois sentidos
 *
 * Mesmo motivo da lista de paineis orfaos (RTV-233) e da de pacotes que nao carregam (RTV-236):
 * um import novo que escape falha por nao estar declarado, e um declarado que deixou de existir
 * TAMBEM falha. A lista encolhe junto com a divida em vez de virar cemiterio.
 */
import fs from 'fs';
import path from 'path';

// __dirname e <repo>/extensions/rt-services/src.
const EXTENSIONS_DIR = path.resolve(__dirname, '../..');
const REPO_DIR = path.resolve(EXTENSIONS_DIR, '..');

/** Especificador relativo num `import ... from '...'` ou `require('...')`. */
const RELATIVE_SPEC = String.raw`(?:^|\n)\s*import\s+([^;]*?)\s*from\s*'(\.[^']*)'|require\(\s*'(\.[^']*)'\s*\)`;

function readIfPresent(file: string): string {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function isOurs(base: string, dir: string): boolean {
  let pkg: { name?: string; repository?: string | { url?: string } } = {};
  try {
    pkg = JSON.parse(readIfPresent(path.join(REPO_DIR, base, dir, 'package.json')) || '{}');
  } catch (error) {
    return false;
  }
  const repository = pkg.repository;
  const url = typeof repository === 'string' ? repository : (repository || {}).url || '';
  return String(url).indexOf('rtmedical/viewers') >= 0 || String(pkg.name || '').indexOf('@rt/') === 0;
}

function walk(dir: string, out: string[]): string[] {
  if (!fs.existsSync(dir)) {
    return out;
  }
  for (const entry of fs.readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') {
      continue;
    }
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

interface Escape {
  /** `<arquivo relativo ao repo> -> <especificador>`, a chave da lista abaixo. */
  chave: string;
  /** `false` quando o import e `import type`, apagado na compilacao. */
  runtime: boolean;
}

function coletar(): Escape[] {
  const out: Escape[] = [];
  for (const base of ['extensions', 'modes']) {
    const baseDir = path.join(REPO_DIR, base);
    if (!fs.existsSync(baseDir)) {
      continue;
    }
    for (const dir of fs.readdirSync(baseDir)) {
      const pkgRoot = path.join(baseDir, dir);
      if (!fs.statSync(pkgRoot).isDirectory() || !isOurs(base, dir)) {
        continue;
      }
      for (const file of walk(path.join(pkgRoot, 'src'), [])) {
        const source = readIfPresent(file);
        const rx = new RegExp(RELATIVE_SPEC, 'g');
        let match: RegExpExecArray | null;
        while ((match = rx.exec(source)) !== null) {
          const clausula = match[1] || '';
          const spec = match[2] || match[3];
          if (!spec) {
            continue;
          }
          const alvo = path.resolve(path.dirname(file), spec);
          if (alvo.startsWith(pkgRoot + path.sep)) {
            continue;
          }
          out.push({
            chave: path.relative(REPO_DIR, file) + " -> '" + spec + "'",
            runtime: !/^\s*type\b/.test(clausula),
          });
        }
      }
    }
  }
  return out;
}

const ESCAPES = coletar();
const RUNTIME = ESCAPES.filter(e => e.runtime).map(e => e.chave).sort();

/**
 * Acoplamentos de runtime que existem hoje, com a razao. Todos no rt-tps; ver RTV-237.
 *
 * Todos apontam para dentro da extensao `default`, que e do UPSTREAM, e nenhuma saida e barata
 * nem verificavel sem risco: copiar as 607 linhas para dentro do rt-tps seria um fork com
 * passos extras, e refazer o layout por CustomizationService e trabalho de feature, nao de
 * guarda. Ficam medidos.
 *
 * ERA QUATRO ATE 15/09/2026. O quarto -- `PlanFieldsTable.tsx` importando
 * `'../../../rt-plan/src/isocenters'` -- saiu, e a razao de ele ter ficado aqui na primeira
 * versao estava ERRADA. Eu registrei que trocar pelo barril "puxa o getSopClassHandlerModule
 * junto e isso muda o bundle". Medido com o build de producao, nao muda: o tree-shaking do
 * rspack descarta o que nao e usado, e o bundle com barril ficou 783 BYTES MENOR no total
 * (133.759.159 contra 133.759.942), com 10 bytes a mais no app.bundle -- ruido de tamanho de
 * string de caminho. A troca foi feita.
 */
const CONHECIDOS: { [chave: string]: string } = {
  "extensions/rt-tps/src/TpsViewerLayout.tsx -> '../../default/src/ViewerLayout/ViewerHeader'":
    'RTV-237 — entranha da extensao default (upstream); a default nao exporta isto pelo barrel',
  "extensions/rt-tps/src/TpsViewerLayout.tsx -> '../../default/src/Components/SidePanelWithServices'":
    'RTV-237 — entranha da extensao default (upstream)',
  "extensions/rt-tps/src/TpsViewerLayout.tsx -> '../../default/src/ViewerLayout/ResizablePanelsHook'":
    'RTV-237 — entranha da extensao default (upstream)',
};

describe('fronteira de pacote: import relativo nao atravessa em runtime (RTV-237)', () => {
  it('varre os pacotes do projeto (se isto zerar, a guarda morreu)', () => {
    // Ha pelo menos um escape conhecido; se a varredura devolver zero, ela parou de ler.
    expect(ESCAPES.length).toBeGreaterThan(0);
  });

  it('nenhum import de runtime novo atravessa a fronteira do pacote', () => {
    const naoDeclarados = RUNTIME.filter(chave => !(chave in CONHECIDOS));
    expect(naoDeclarados).toEqual([]);
  });

  it('acoplamento declarado que deixou de existir sai da lista', () => {
    const obsoletos = Object.keys(CONHECIDOS)
      .filter(chave => RUNTIME.indexOf(chave) < 0)
      .sort();
    expect(obsoletos).toEqual([]);
  });

  it('toda entrada da lista tem razao escrita', () => {
    const semRazao = Object.keys(CONHECIDOS).filter(
      chave => !CONHECIDOS[chave] || CONHECIDOS[chave].length < 20
    );
    expect(semRazao).toEqual([]);
  });

  /**
   * Type-only e tolerado (ver o cabecalho), mas nao invisivel: se um dia virar dezenas, e sinal
   * de que dois pacotes viraram um so e o limite esta no lugar errado.
   */
  it('os imports type-only que atravessam continuam sendo poucos', () => {
    const typeOnly = ESCAPES.filter(e => !e.runtime);
    expect(typeOnly.length).toBeLessThan(5);
  });
});
