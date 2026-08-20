/**
 * O registro de paineis de cada extensao tem de ser consistente com o que os modos pedem.
 *
 * Este arquivo mora aqui, e nao em cada pacote, pela mesma razao que `barrelExports.test.ts`:
 * e uma regra sobre o repositorio inteiro, e as duas falhas que ele pega sao invisiveis para
 * uma suite comum.
 *
 * ## Nome de painel repetido
 *
 * Um `getPanelModule` que devolve duas entradas com o mesmo `name` registra o mesmo id duas
 * vezes. Nenhum teste de componente ve isso: cada painel e testado montando o componente
 * diretamente, e o array de registro nunca e inspecionado. Foi assim que uma duplicata literal
 * de `cachedPlans` entrou na rt-record -- um script de fiacao aplicado duas vezes -- e passou
 * por 33 suites verdes.
 *
 * ## Id de painel que nenhuma extensao registra
 *
 * Um modo que pede `X.panelModule.Y` inexistente nao quebra: o painel simplesmente nao aparece.
 * O radiologista abre o modo e o painel que o ticket prometeu nao esta la, sem erro no console
 * e sem teste vermelho. Um erro de digitacao no id, ou um painel renomeado na extensao sem
 * atualizar o modo, produz exatamente isso.
 *
 * A checagem de citacao cobre os modos DESTE projeto (`modes/rtmedical-*`). `modes/tmtv`, que e
 * upstream, cita `@ohif/extension-cornerstone.panelModule.measurements`, e a cornerstone
 * registra `panelMeasurement` -- id defasado que nao e nosso e que nao podemos corrigir sem
 * forkar pacote core (RTV-114). Fica registrado aqui para nao se perder, em vez de virar uma
 * excecao muda ou um teste que alguem apaga porque "sempre falhou".
 *
 * A checagem e estatica de proposito: importar quarenta `getPanelModule` traria componentes
 * React, codigo de viewport e parsers DICOM, e o resultado passaria a depender da ordem de
 * carga.
 */
import fs from 'fs';
import path from 'path';

// __dirname e <repo>/extensions/rt-services/src.
const EXTENSIONS_DIR = path.resolve(__dirname, '../..');
const REPO_DIR = path.resolve(EXTENSIONS_DIR, '..');
const MODES_DIR = path.join(REPO_DIR, 'modes');

/** `name: 'algo'` dentro de um getPanelModule. */
const PANEL_NAME = /name:\s*'([A-Za-z0-9_-]+)'/g;
/** `id: 'algo'` de um ponto de entrada, ou `const id = 'algo'` de um barrel. */
const ENTRY_ID = /(?:^|\n)\s*id:\s*'([@A-Za-z0-9_./-]+)'/;
const CONST_ID = /(?:^|\n)(?:export\s+)?const id\s*=\s*'([@A-Za-z0-9_./-]+)'/;
/** Citacao de painel num modo. */
const CITATION = /'([@A-Za-z0-9_./-]+)\.panelModule\.([A-Za-z0-9_-]+)'/g;

interface PanelRegistration {
  dir: string;
  /** Todos os ids sob os quais um modo pode pedir esta extensao. */
  ids: string[];
  names: string[];
}

function readIfPresent(file: string): string {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function panelModuleSource(dir: string): string {
  const candidates = [
    path.join(dir, 'src', 'getPanelModule', 'index.tsx'),
    path.join(dir, 'src', 'getPanelModule', 'index.ts'),
    path.join(dir, 'src', 'getPanelModule.tsx'),
    path.join(dir, 'src', 'getPanelModule.ts'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, 'utf8');
    }
  }
  return '';
}

/**
 * Os ids de uma extensao.
 *
 * Pode ser mais de um porque os dois existem no repo: a maioria declara
 * `const id = '@ohif/extension-x'` no barrel, e a rtmedical-theme declara `id: 'rtmedical-theme'`
 * no ponto de entrada -- diferente do nome do pacote. Aceitar os dois evita que a checagem
 * acuse uma fiacao que funciona.
 */
function extensionIds(dir: string): string[] {
  const ids: string[] = [];
  let pkgName = '';
  try {
    pkgName = JSON.parse(readIfPresent(path.join(dir, 'package.json')) || '{}').name ?? '';
  } catch (error) {
    pkgName = '';
  }
  if (pkgName) {
    ids.push(pkgName);
  }
  const sources = [
    readIfPresent(path.join(dir, 'src', 'index.ts')),
    readIfPresent(path.join(dir, 'src', 'index.tsx')),
    readIfPresent(path.join(dir, 'index.js')),
    readIfPresent(path.join(dir, 'index.ts')),
  ];
  for (const source of sources) {
    if (!source) {
      continue;
    }
    const fromConst = source.match(CONST_ID);
    if (fromConst && ids.indexOf(fromConst[1]) < 0) {
      ids.push(fromConst[1]);
    }
    const fromEntry = source.match(ENTRY_ID);
    if (fromEntry && ids.indexOf(fromEntry[1]) < 0) {
      ids.push(fromEntry[1]);
    }
  }
  return ids;
}

function collectRegistrations(): PanelRegistration[] {
  return fs
    .readdirSync(EXTENSIONS_DIR)
    .filter(entry => fs.statSync(path.join(EXTENSIONS_DIR, entry)).isDirectory())
    .map(entry => {
      const dir = path.join(EXTENSIONS_DIR, entry);
      const source = panelModuleSource(dir);
      const names: string[] = [];
      PANEL_NAME.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = PANEL_NAME.exec(source)) !== null) {
        names.push(match[1]);
      }
      return { dir: entry, ids: extensionIds(dir), names };
    })
    .filter(registration => registration.names.length > 0);
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
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry) && !/\.test\./.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const REGISTRATIONS = collectRegistrations();

/* ------------------------------------------------------------------ */

describe('registro de paineis: um nome, um painel', () => {
  it('encontra os getPanelModule do repo (se este numero cair a zero, a checagem morreu)', () => {
    expect(REGISTRATIONS.length > 10).toBe(true);
  });

  it.each(REGISTRATIONS.map(r => [r.dir, r] as [string, PanelRegistration]))(
    '%s nao registra o mesmo nome de painel duas vezes',
    (_dir, registration) => {
      const seen = new Map<string, number>();
      for (const name of registration.names) {
        seen.set(name, (seen.get(name) ?? 0) + 1);
      }
      const repeated = Array.from(seen.entries())
        .filter(([, count]) => count > 1)
        .map(([name, count]) => name + ' x' + String(count));
      expect(repeated).toEqual([]);
    }
  );

  it('toda extensao com painel tem ao menos um id sob o qual um modo pode pedi-la', () => {
    const without = REGISTRATIONS.filter(r => r.ids.length === 0).map(r => r.dir);
    expect(without).toEqual([]);
  });
});

describe('registro de paineis: o que os nossos modos pedem existe', () => {
  const KNOWN = new Set<string>();
  for (const registration of REGISTRATIONS) {
    for (const id of registration.ids) {
      for (const name of registration.names) {
        KNOWN.add(id + '.panelModule.' + name);
      }
    }
  }

  const ourModeFiles = walk(MODES_DIR, []).filter(file =>
    path.relative(MODES_DIR, file).startsWith('rtmedical-')
  );

  it('encontra os modos deste projeto', () => {
    expect(ourModeFiles.length > 0).toBe(true);
  });

  it('nenhum modo rtmedical-* pede um painel que nenhuma extensao registra', () => {
    const missing: string[] = [];
    for (const file of ourModeFiles) {
      const source = fs.readFileSync(file, 'utf8');
      CITATION.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = CITATION.exec(source)) !== null) {
        const token = match[1] + '.panelModule.' + match[2];
        if (!KNOWN.has(token)) {
          missing.push(path.relative(REPO_DIR, file) + ': ' + token);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
