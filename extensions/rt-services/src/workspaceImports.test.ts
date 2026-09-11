/**
 * Nome importado de um pacote do workspace tem de ser exportado por ele (RTV-234).
 *
 * Este arquivo mora aqui, e nao em cada pacote, pela mesma razao que `barrelExports.test.ts` e
 * `panelRegistry.test.ts`: e uma regra sobre o repositorio inteiro, e a falha que ele pega e
 * invisivel para uma suite comum.
 *
 * ## A falha
 *
 * `import { toolbarButtons } from '@ohif/mode-basic'` compila, empacota e roda -- e vale
 * `undefined`, porque o mode-basic nunca exportou esse nome. Se o valor for usado dentro de uma
 * funcao, o erro aparece quando alguem clica. Se for espalhado num array em escopo de modulo,
 * como estava nos dois modos deste projeto, `[...undefined]` lanca na CARGA e o modulo inteiro
 * morre antes de registrar rota, painel ou toolbar.
 *
 * Foi exatamente isso, e ficou assim por meses. O que torna esta classe traicoeira e que o
 * TypeScript SO reclama se o pacote tiver tipos resolviveis pelo caminho do import -- num
 * monorepo com alias, `main` apontando para `dist/` inexistente e `module` para a fonte, isso
 * varia por pacote e por ferramenta. E o bundler trata "export not found" como AVISO, no meio
 * de milhares de linhas de log.
 *
 * ## Por que isto importa mais que um bug
 *
 * O contrato deste repo com o OHIF e estreito de proposito (RTV-114: extension-first, zero
 * fork). Medido em 11/09/2026, as nossas fontes importam 45 nomes de pacotes do workspace --
 * essa e toda a superficie que um sync de upstream pode quebrar. Uma verificacao que cobre
 * esses 45 nomes cobre a superficie inteira, e e a diferenca entre atualizar o OHIF com
 * evidencia e atualizar torcendo.
 *
 * ## Tres decisoes que valem registro
 *
 * 1. COMENTARIO E APAGADO ANTES DE PARSEAR. A primeira versao desta checagem acusou `defaults`
 *    do @ohif/core, que E exportado. O barrel do core escreve o bloco com separadores:
 *    `ViewportRefsProvider,` / `//` / `defaults,`. Separando por virgula, o nome vinha como
 *    "//\n  defaults" e nunca casava. Uma guarda que acusa o inocente e desligada na segunda
 *    semana, entao isto e parte do contrato dela, nao detalhe de implementacao.
 *
 * 2. PACOTE QUE NAO RESOLVE E PULADO, NAO REPROVADO. Se o `@ohif/x` nao tem diretorio de fonte
 *    neste monorepo, nao sabemos o que ele exporta -- e isso e diferente de saber que ele nao
 *    exporta. Reprovar aqui transformaria a guarda num alarme sobre dependencia externa.
 *
 * 3. HA UM PISO DE NOMES VERIFICADOS. Toda a mecanica depende de regex sobre barrel; uma
 *    mudanca de estilo no upstream pode fazer a leitura devolver zero, e zero problema em zero
 *    nome verificado se le como verde. O piso faz esse caso ficar vermelho.
 */
import fs from 'fs';
import path from 'path';

// __dirname e <repo>/extensions/rt-services/src.
const EXTENSIONS_DIR = path.resolve(__dirname, '../..');
const REPO_DIR = path.resolve(EXTENSIONS_DIR, '..');

/*
 * Os padroes ficam como TEXTO e cada laco constroi o seu RegExp.
 *
 * Um RegExp global guarda `lastIndex` no proprio objeto, e `exportedNames` e recursiva: com um
 * objeto compartilhado, a chamada de dentro zerava o `lastIndex` que o laco de fora estava
 * percorrendo, e o laco de fora recomecava do inicio -- para sempre. O sintoma nao foi teste
 * vermelho, foi a suite do pacote parar de terminar, que e bem pior de diagnosticar. Instancia
 * por laco custa nada e elimina a classe inteira.
 */

/** Import nomeado de um pacote @ohif (o `import x from` default nao entra: nao ha nome a checar). */
const NAMED_IMPORT = String.raw`import\s*(?:type\s*)?\{([^}]+)\}\s*from\s*'(@ohif\/[^']+)'`;
/** Declaracao exportada direto: `export const x`, `export function y`, `export interface Z`. */
const EXPORT_DECL = String.raw`^export\s+(?:declare\s+)?(?:async\s+)?(?:function|const|let|var|class|type|interface|enum)\s+([A-Za-z0-9_$]+)`;
/** Bloco `export { a, b as c }` — com ou sem `from`. */
const EXPORT_NAMED = String.raw`export\s*\{([^}]*)\}`;
/** `export * from './x'` e `export * as ns from './x'`. */
const EXPORT_STAR = String.raw`export\s*\*\s*(?:as\s+([A-Za-z0-9_$]+)\s*)?from\s*'([^']+)'`;

/** Cada chamada devolve um objeto novo — ver o comentario acima. */
function rx(pattern: string, flags: string): RegExp {
  return new RegExp(pattern, flags);
}

function readIfPresent(file: string): string {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

/** Ver a decisao 1 no cabecalho: comentario dentro de `export { }` corrompe a leitura. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Pacotes deste projeto, pelo campo `repository` — mesmo criterio do panelRegistry. */
function isOurs(dir: string): boolean {
  let pkg: { name?: string; repository?: string | { url?: string } } = {};
  try {
    pkg = JSON.parse(readIfPresent(path.join(dir, 'package.json')) || '{}');
  } catch (error) {
    return false;
  }
  const repository = pkg.repository;
  const url = typeof repository === 'string' ? repository : (repository || {}).url || '';
  const name = pkg.name || '';
  return url.indexOf('rtmedical/viewers') >= 0 || name.indexOf('@rt/') === 0;
}

function ourSourceDirs(): string[] {
  const out: string[] = [];
  for (const base of ['extensions', 'modes']) {
    const baseDir = path.join(REPO_DIR, base);
    if (!fs.existsSync(baseDir)) {
      continue;
    }
    for (const entry of fs.readdirSync(baseDir)) {
      const dir = path.join(baseDir, entry);
      if (fs.statSync(dir).isDirectory() && isOurs(dir) && fs.existsSync(path.join(dir, 'src'))) {
        out.push(path.join(dir, 'src'));
      }
    }
  }
  return out;
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

/**
 * Onde `@ohif/<x>` mora NESTE monorepo.
 *
 * As tres formas existem e a ordem importa, porque a ultima casaria todas:
 * `@ohif/mode-basic` -> modes/basic/src, `@ohif/extension-rt-plan` -> extensions/rt-plan/src,
 * `@ohif/core` -> platform/core/src. Devolve null quando nada resolve (decisao 2).
 */
function resolveWorkspaceSource(spec: string): string {
  const match = spec.match(/^@ohif\/(.+)$/);
  if (!match) {
    return null;
  }
  const name = match[1];
  const candidates: string[] = [];
  if (name.indexOf('mode-') === 0) {
    candidates.push(path.join('modes', name.slice('mode-'.length)));
  }
  if (name.indexOf('extension-') === 0) {
    candidates.push(path.join('extensions', name.slice('extension-'.length)));
  }
  candidates.push(path.join('platform', name));
  for (const candidate of candidates) {
    const src = path.join(REPO_DIR, candidate, 'src');
    if (fs.existsSync(src)) {
      return src;
    }
  }
  return null;
}

/** Nomes que o barrel de `srcDir` exporta, seguindo `export *` ate `depth` niveis. */
function exportedNames(srcDir: string, depth: number): Set<string> {
  const names = new Set<string>();
  if (depth > 3) {
    return names;
  }
  let barrel = '';
  for (const candidate of ['index.ts', 'index.tsx']) {
    const file = path.join(srcDir, candidate);
    if (fs.existsSync(file)) {
      barrel = readIfPresent(file);
      break;
    }
  }
  if (!barrel) {
    return names;
  }
  barrel = stripComments(barrel);

  const collect = (source: string) => {
    const decl = rx(EXPORT_DECL, 'gm');
    let match: RegExpExecArray | null;
    while ((match = decl.exec(source)) !== null) {
      names.add(match[1]);
    }
    const named = rx(EXPORT_NAMED, 'g');
    while ((match = named.exec(source)) !== null) {
      for (const raw of match[1].split(',')) {
        const parts = raw.trim().split(/\s+as\s+/);
        const name = parts[parts.length - 1].trim();
        if (name) {
          names.add(name);
        }
      }
    }
    if (/^export\s+default/m.test(source)) {
      names.add('default');
    }
  };

  collect(barrel);

  const starRx = rx(EXPORT_STAR, 'g');
  let star: RegExpExecArray | null;
  while ((star = starRx.exec(barrel)) !== null) {
    if (star[1]) {
      // `export * as ns` publica um nome so, o do namespace.
      names.add(star[1]);
      continue;
    }
    const resolved = path.resolve(srcDir, star[2]);
    if (fs.existsSync(resolved + '.ts')) {
      collect(stripComments(readIfPresent(resolved + '.ts')));
    } else if (fs.existsSync(resolved + '.tsx')) {
      collect(stripComments(readIfPresent(resolved + '.tsx')));
    } else if (
      fs.existsSync(path.join(resolved, 'index.ts')) ||
      fs.existsSync(path.join(resolved, 'index.tsx'))
    ) {
      for (const name of exportedNames(resolved, depth + 1)) {
        names.add(name);
      }
    }
  }
  return names;
}

interface Checked {
  problems: string[];
  count: number;
}

function check(): Checked {
  const files: string[] = [];
  for (const dir of ourSourceDirs()) {
    walk(dir, files);
  }
  const problems: string[] = [];
  let count = 0;
  const cache = new Map<string, Set<string>>();

  for (const file of files) {
    const source = readIfPresent(file);
    const imports = rx(NAMED_IMPORT, 'g');
    let match: RegExpExecArray | null;
    while ((match = imports.exec(source)) !== null) {
      const spec = match[2];
      if (!cache.has(spec)) {
        const dir = resolveWorkspaceSource(spec);
        cache.set(spec, dir ? exportedNames(dir, 0) : new Set<string>());
      }
      const exported = cache.get(spec);
      // Barrel ilegivel ou pacote externo: nao sabemos, e nao saber nao e reprovar.
      if (exported.size === 0) {
        continue;
      }
      for (const raw of match[1].split(',')) {
        const name = raw
          .trim()
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/)[0]
          .trim();
        if (!name) {
          continue;
        }
        count += 1;
        if (!exported.has(name)) {
          problems.push(
            path.relative(REPO_DIR, file) + ": '" + name + "' nao e exportado por " + spec
          );
        }
      }
    }
  }
  return { problems, count };
}

const RESULT = check();

describe('imports do workspace: o nome importado existe do outro lado (RTV-234)', () => {
  it('verifica uma quantidade de nomes compativel com o tamanho do repo', () => {
    // Ver a decisao 3 no cabecalho. Eram 45 em 11/09/2026; o piso e folgado de proposito,
    // para pegar a leitura quebrada e nao para travar a evolucao do codigo.
    expect(RESULT.count).toBeGreaterThan(20);
  });

  it('nenhum pacote nosso importa um nome que o pacote de origem nao exporta', () => {
    expect(Array.from(new Set(RESULT.problems)).sort()).toEqual([]);
  });
});
