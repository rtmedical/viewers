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

/* ------------------------------------------------------------------ */

/**
 * ## Painel registrado que nenhum modo pede (RTV-233)
 *
 * O inverso da checagem acima, e o caso que de fato aconteceu. Um painel pode estar escrito,
 * testado, mesclado e registrado no `getPanelModule` da extensao -- e nao aparecer em
 * `rightPanels`/`leftPanels` de modo nenhum. Nada falha: a extensao carrega, o registro
 * acontece, e simplesmente nao existe caminho de UI para chegar ao painel.
 *
 * Isso nao e teoria. Em 20/08/2026 uma auditoria mediu doze paineis nessa situacao, entre eles
 * os sete da rt-report e os dois da rt-timeline. Cada um tinha ticket fechado e suite verde. O
 * criterio de aceite do RTV-202 pedia "disponivel em modo de laudo", e o painel entregue nao
 * satisfazia isso -- sem nenhum sinal vermelho em lugar nenhum.
 *
 * ## Por que uma lista de excecoes, e nao um teste que so falha
 *
 * O orfao E o estado atual de parte do repo: os sete paineis da rt-report dependem de fila,
 * rascunho, politica, historico e registro de achados, e nada disso existe client-side hoje.
 * Um teste sem lista nasceria vermelho e seria desligado na primeira semana.
 *
 * A lista e EXATA nos dois sentidos, e e isso que a torna util em vez de decorativa:
 *   - um painel novo que nasce inalcancavel falha, porque nao esta na lista;
 *   - um painel que finalmente foi fiado e continua na lista TAMBEM falha, o que forca a
 *     lista a encolher junto com a divida em vez de virar um cemiterio.
 *
 * ## O recorte: extensoes deste projeto
 *
 * A checagem cobre so as nossas extensoes, derivadas do campo `repository` do package.json
 * (`rtmedical/viewers` contra `OHIF/Viewers`) -- a mesma tecnica que o gate do RTV-114 usa para
 * separar mode nosso de mode upstream, em vez de uma lista fixa que alguem tem de lembrar de
 * editar. A cornerstone registra `panelSegmentation`, a tmtv registra `petSUV`, e nenhum modo
 * nosso os cita: sao paineis do upstream, pedidos por modos do upstream, e cobra-los aqui
 * geraria ruido sobre codigo que o ARCH.md nos proibe de mudar.
 */
describe('registro de paineis: painel nosso que nenhum modo nosso alcanca (RTV-233)', () => {
  /**
   * Painel registrado que ainda nao tem modo, com a razao. A chave e `<diretorio>:<painel>`
   * porque uma extensao pode ser pedida por mais de um id (nome do pacote e id do ponto de
   * entrada), e o diretorio identifica uma so.
   */
  const PENDING: { [key: string]: string } = {
    // Falta a camada de dados, nao a linha de fiacao (RTV-233). Estes paineis recebem o estado
    // por prop de proposito; fia-los hoje daria sete abas renderizando "nao informado", que
    // afirma menos que aba nenhuma.
    'rt-report:reportingHub': 'RTV-222 — precisa da fila do Reporting Hub (backend)',
    'rt-report:signOff': 'RTV-228 — precisa de credencial de assinatura e do rascunho',
    'rt-report:aiCopilot': 'RTV-224 — precisa da politica de IA do servico',
    'rt-report:versionDiff': 'RTV-227 — precisa do historico de versoes do laudo',
    'rt-report:dictationRecorder': 'RTV-111 — precisa do ambiente de captura de audio',
    'rt-report:voiceStructure': 'RTV-225 — precisa do ambiente de captura de audio',
    'rt-report:criticalFindings': 'RTV-202 — precisa do registro de achados criticos',
    'rt-record:cachedPlans': 'RTV-179 — precisa do inventario do cache local/daemon',

    // Estes resolvem os proprios dados; o que falta e a decisao de qual modo os hospeda, que
    // pertence ao ticket da feature. Ficam aqui medidos, e nao esquecidos.
    'deid:deid': 'RTV-113 — de-identificacao ainda sem modo que a exponha',
    'dose-tracking:doseReport': 'RTV-201 — dose tracking ainda sem modo',
    'mammography:birads': 'RTV-78 — BI-RADS depende de um modo de mamografia (RTV-75/76)',
    'measurements:measurements': 'RTV-27/28/29/30/46 — calculadoras avancadas sem modo',
    'rt-4d:rt4d': 'RTV-93/51 — 4D/gating ainda sem modo',
    'rt-fusion:fusion': 'RTV-197 — fusao sem modo (o modal completo e RTV-134)',
    'rt-mr-quant:parametricMap': 'RTV-82 — mapas parametricos sem modo',
    'rt-struct:rtStruct': 'RTV-31/213 — tabela de estruturas; os modos usam o roiWorkspace',
    'rtmedical-theme:rtMeasurements': 'RTV-151 — tabela de medidas propria sem modo',
    'rtmedical-theme:srTree': 'arvore de SR sem modo',
  };

  /** Nossas extensoes, derivadas do package.json (ver o cabecalho deste bloco). */
  function isOurs(dir: string): boolean {
    let pkg: { repository?: string | { url?: string } } = {};
    try {
      pkg = JSON.parse(readIfPresent(path.join(EXTENSIONS_DIR, dir, 'package.json')) || '{}');
    } catch (error) {
      return false;
    }
    const repository = pkg.repository;
    const url = typeof repository === 'string' ? repository : (repository || {}).url || '';
    return url.indexOf('rtmedical/viewers') >= 0;
  }

  const OURS = REGISTRATIONS.filter(registration => isOurs(registration.dir));

  const cited = new Set<string>();
  for (const file of walk(MODES_DIR, []).filter(f =>
    path.relative(MODES_DIR, f).startsWith('rtmedical-')
  )) {
    const source = fs.readFileSync(file, 'utf8');
    CITATION.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CITATION.exec(source)) !== null) {
      cited.add(match[1] + '.panelModule.' + match[2]);
    }
  }

  const orphans: string[] = [];
  for (const registration of OURS) {
    for (const name of registration.names) {
      const reachable = registration.ids.some(id => cited.has(id + '.panelModule.' + name));
      if (!reachable) {
        orphans.push(registration.dir + ':' + name);
      }
    }
  }

  it('separa as nossas extensoes das do upstream (se isto zerar, a checagem morreu)', () => {
    expect(OURS.length > 5).toBe(true);
    expect(OURS.length < REGISTRATIONS.length).toBe(true);
    // A cornerstone e do upstream e registra painel: tem de ficar de fora.
    expect(OURS.map(r => r.dir)).not.toContain('cornerstone');
  });

  it('nenhum painel nosso nasce inalcancavel sem estar declarado como pendente', () => {
    const undeclared = orphans.filter(key => !(key in PENDING)).sort();
    expect(undeclared).toEqual([]);
  });

  it('painel ja fiado nao continua na lista de pendentes', () => {
    const stale = Object.keys(PENDING)
      .filter(key => orphans.indexOf(key) < 0)
      .sort();
    expect(stale).toEqual([]);
  });

  /**
   * O mapa de ids do modo nao prova que o painel foi colocado.
   *
   * Os modos deste repo declaram os ids num objeto (`const rtmedical = { dvh: '...panelModule.dvh' }`)
   * e so depois referenciam `rtmedical.dvh` dentro de `rightPanels`/`leftPanels`. A checagem de
   * citacao acima e textual: ela ve a string no mapa e ja da o painel por alcancavel. Quem
   * acrescenta a entrada no mapa e esquece de coloca-la no layout -- que e metade do defeito
   * que o RTV-233 mediu -- passa pelas duas checagens anteriores.
   *
   * Esta exige que a chave seja usada em algum outro lugar do arquivo. Nao verifica em QUAL
   * array ela entrou: o layout do rt-tps tambem hospeda painel (a Info Window do fundo, onde
   * vivem Ficha/DVH/Isodoses), e exigir `rightPanels` reprovaria fiacao que funciona.
   *
   * As proprias citacoes sao apagadas do texto antes da contagem. Sem isso a checagem nao
   * detecta nada no caso comum: a chave do mapa costuma ter o nome do painel, e entao
   * `.cachedPlans` casa DENTRO de `'....panelModule.cachedPlans'`, a entrada parece usada por
   * si mesma e o teste passa sempre. Foi assim que esta versao nasceu, e so apareceu ao
   * verificar que a guarda sabia ficar vermelha.
   */
  it('id declarado no mapa de um modo e usado em algum lugar do modo', () => {
    const declaredUnused: string[] = [];
    for (const file of walk(MODES_DIR, []).filter(f =>
      path.relative(MODES_DIR, f).startsWith('rtmedical-')
    )) {
      const source = fs.readFileSync(file, 'utf8');
      // Ver o cabecalho: a citacao nao pode contar como uso dela mesma.
      const withoutCitations = source.replace(CITATION, '');
      CITATION.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = CITATION.exec(source)) !== null) {
        const lineStart = source.lastIndexOf('\n', match.index) + 1;
        const key = source.slice(lineStart, match.index).match(/^\s*([A-Za-z0-9_]+):\s*$/);
        if (!key) {
          // Literal direto dentro do array de paineis: ja esta colocado.
          continue;
        }
        const uses = withoutCitations.match(new RegExp('\\.' + key[1] + '\\b', 'g'));
        if (!uses || uses.length === 0) {
          declaredUnused.push(path.relative(REPO_DIR, file) + ': ' + key[1]);
        }
      }
    }
    expect(declaredUnused).toEqual([]);
  });

  it('toda pendencia tem razao escrita', () => {
    const empty = Object.keys(PENDING).filter(key => !PENDING[key] || PENDING[key].length < 10);
    expect(empty).toEqual([]);
  });
});
