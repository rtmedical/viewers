# Plano — stack de desenvolvimento e microserviço Python interoperável

Data: 2026-08-17. Alvos: **subir o React contra o PACS** e **criar o microserviço Python**
que roda tanto como API (contêiner) quanto como binário local (chamado pelo Tauri no RTVW).

Tickets relacionados: RTV-3 (compose inicial), RTV-231 (subir o stack no DEV1), RTV-8 (build
dual web + Tauri), RTV-196 (primeiro consumidor real do microserviço).

---

## 0. O que já existe — não refazer

Levantado no repo em 2026-08-17:

| Arquivo | O que faz |
|---|---|
| `docker-compose.yml` | Perfil **Orthanc** (RTV-3): sobe Orthanc vazio + viewer buildado, `3000:80` |
| `docker-compose.dcm4chee.yml` | Perfil **dcm4chee** (RTV-231): só o viewer, `3010:80`, aponta para o dcm4chee do host via `host-gateway` |
| `docker-compose.override.yml.example` | Desvio de portas por máquina, com o mapa de portas ocupadas do DEV1 |
| `docker/nginx-dcm4chee.conf.template` | Proxy `/dicom-web` e `/wado-uri` -> dcm4chee, mantendo same-origin |
| `docker/nginx-default.conf.template` | Idem para o Orthanc |
| `docker/seed-orthanc-from-dcm4chee.py` | Popular o Orthanc do RTV-3 a partir do dcm4chee |
| `docker/README.md` | Documenta os dois perfis e o custo de memória do build |
| `platform/app/public/config/docker_compose_dcm4chee.js` | Config de app apontando para `/dicom-web` |
| `Dockerfile` | Build multi-stage: `pnpm install` + `rspack build` + nginx |

**O que falta, e é o que este plano resolve:** um caminho que de fato sobe no DEV1, o modo
**dev server com HMR** (hoje só existe build de produção), e o microserviço Python.

---

## 1. Diagnóstico — por que o build derruba o DEV1, exatamente

O `docker/README.md` registra a medição de 2026-08-14: RAM livre ~190 MiB, swap 13/15 GiB, load
average **74** em 10 cores, e o `sshd` parou de aceitar conexão.

A leitura fácil é "5,6 GiB é pouco". Está incompleta, e a parte que falta é a que dá a solução:

> **O build não tinha limite de memória.** Sem `mem_limit`, o cgroup do contêiner é o cgroup da
> máquina: quando o kernel precisou matar algo, ele escolheu entre **todos** os processos do host
> — e escolheu o `sshd`. Um build com limite falha como *build falhado*; sem limite, ele falha
> como *máquina inacessível*.

São dois problemas separados e cada um tem sua correção:

**(a) Blast radius.** Todo serviço que compila recebe `mem_limit`, `memswap_limit` (igual ao
`mem_limit`, para proibir swap-thrash) e `cpus`. Isso não faz o build passar — faz o fracasso
ser local. É a correção mais barata e a que deveria existir de qualquer forma.

**(b) Demanda de pico.** Medido hoje no DEV1: **5 GiB totais, ~1 GiB disponível, 22 contêineres
já rodando** (dcm4chee, keycloak, hapi-fhir, ehrbase, 4 postgres, qdrant, whisper-api, workspace
PHP...). Um `rspack build` de produção do OHIF quer 4-6 GiB. Com ou sem limite, **não cabe**.

Conclusão honesta: **build de produção do viewer não roda no DEV1 e não vai rodar.** Não é
questão de ajustar flag. O plano abaixo assume isso em vez de tentar contornar.

Um dev server é outra coisa: rspack em modo watch, sem minificação, com `--max-old-space-size`
controlado, fica na casa de 1,5-2,5 GiB. Isso é o limite do viável no DEV1 — cabe se o limite
existir e se aceitarmos que ele compete com o resto.

### Bloqueio secundário, e é imediato

| Ferramenta | No DEV1 | Exigido pelo repo |
|---|---|---|
| node (PATH) | v18.19.1 | `engines.node >= 24` |
| node (nvm default) | v24.13.0 | ok |
| pnpm | **9.15.9** | `packageManager: pnpm@11.5.2`, `engines.pnpm >= 11` |

`pnpm` do host está duas majors atrás. Qualquer `pnpm install` no host falha ou, pior, resolve
diferente do lockfile. **Correção: `corepack enable && corepack prepare pnpm@11.5.2 --activate`**
com o node 24 do nvm ativo — e o contêiner de dev faz o mesmo no Dockerfile, para host e
contêiner não divergirem.

---

## 2. Três perfis, e qual usar em cada máquina

| Perfil | Compila? | RAM de pico | HMR | Onde usar |
|---|---|---|---|---|
| **A. dev** (`docker-compose.dev.yml`) | sim, em watch | ~2-3 GiB | **sim** | máquina de desenvolvimento com >= 8 GiB livres |
| **B. static** (`docker-compose.static.yml`) | **não** | ~30 MiB | não | **DEV1 hoje**, e qualquer máquina apertada |
| **C. build** (`docker-compose.yml` / `.dcm4chee.yml`, já existem) | sim, produção | 4-6 GiB | não | CI, ou máquina com >= 12 GiB |

O perfil **B** é o que responde "subir o React e começar a usar o PACS" no DEV1 **hoje**: o
`dist/` é produzido fora (CI ou máquina do desenvolvedor) e o contêiner é um nginx puro, sem
node. Custa quase nada de RAM e já dá acesso ao dcm4chee com dados reais.

O perfil **A** é o que se quer para desenvolver de verdade, e é onde o HMR vive. No DEV1 ele
só é viável se derrubarmos parte dos 22 contêineres — o que é uma decisão de quem administra a
máquina, não deste plano.

---

## 3. Perfil A — dev server com HMR

### 3.1 `Dockerfile.dev`

```dockerfile
# Contêiner de DESENVOLVIMENTO: nao produz bundle de producao.
# Roda o rspack dev server em watch, com HMR, contra o codigo montado do host.
FROM node:24.13.0-bookworm-slim

ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH \
    # O default do node (~2 GiB em containers) e apertado para o grafo do OHIF.
    # Fica abaixo do mem_limit do compose, de proposito: o node falha antes de o
    # cgroup matar o processo, e ai o erro e legivel.
    NODE_OPTIONS=--max-old-space-size=2560

RUN corepack enable && corepack prepare pnpm@11.5.2 --activate

# git: alguns pacotes do grafo resolvem por git. curl: healthcheck.
RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
# Nao copiamos codigo: o compose monta o repo. Nao rodamos install no build:
# o install acontece no primeiro `up`, contra o volume nomeado de node_modules.
EXPOSE 3000
CMD ["pnpm", "dev"]
```

### 3.2 `docker-compose.dev.yml`

```yaml
services:
  viewer-dev:
    build:
      context: .
      dockerfile: Dockerfile.dev
    container_name: rtv-viewer-dev
    # (a) do diagnostico: o fracasso tem que ser local.
    mem_limit: 3g
    memswap_limit: 3g          # igual ao mem_limit => proibe swap-thrash
    cpus: 4.0
    ports:
      - '${RTV_DEV_PORT:-3010}:3000'
    extra_hosts:
      - 'dcm4chee-host:host-gateway'
    environment:
      APP_CONFIG: config/docker_compose_dcm4chee.js
      # Lido pelo proxy do dev server (secao 3.4).
      RTV_DICOMWEB_UPSTREAM: 'http://dcm4chee-host:8080/dcm4chee-arc/aets/RTPACS/rs'
      RTV_WADOURI_UPSTREAM: 'http://dcm4chee-host:8080/dcm4chee-arc/aets/RTPACS/wado'
    volumes:
      - .:/workspace:cached
      # node_modules e store em volume NOMEADO, nunca no bind mount:
      # o pnpm deste repo usa nodeLinker=hoisted, e resolver esse grafo sobre
      # um bind mount no overlayfs custa minutos por install e quebra symlink
      # em alguns kernels. Ver secao 8, risco R3.
      - rtv-node-modules:/workspace/node_modules
      - rtv-pnpm-store:/pnpm
    healthcheck:
      test: ['CMD', 'curl', '-fsS', 'http://localhost:3000/']
      interval: 30s
      timeout: 5s
      retries: 20
      start_period: 300s        # o primeiro install+compile e longo

volumes:
  rtv-node-modules:
  rtv-pnpm-store:
```

### 3.3 Primeiro `up` — a sequência importa

```bash
cp docker-compose.override.yml.example docker-compose.override.yml   # ajuste a porta
docker compose -f docker-compose.dev.yml build
# install PRIMEIRO, num comando separado e com o mesmo limite:
docker compose -f docker-compose.dev.yml run --rm viewer-dev pnpm install --frozen-lockfile
docker compose -f docker-compose.dev.yml up -d
docker compose -f docker-compose.dev.yml logs -f viewer-dev
```

Rodar o `install` separado do `up` é deliberado: se ele estourar o limite, o erro aparece no
terminal em vez de virar um contêiner em restart loop. E `--frozen-lockfile` é obrigatório —
o `pnpm-workspace.yaml` já pede, e um install que "resolve sozinho" numa máquina de
desenvolvimento produz um `dist/` que ninguém mais consegue reproduzir.

### 3.4 O proxy do dev server — a única mudança de código necessária

Hoje `platform/app/.webpack/webpack.pwa.js` tem:

```js
proxy: [
  { context: ['/dicomweb'], target: 'http://localhost:5000' },
],
```

Isso aponta para um servidor de teste que não existe no contêiner. **No perfil B o nginx faz o
proxy; no perfil A quem faz é o dev server**, então a entrada precisa existir aqui. Proposta:

```js
proxy: [
  {
    context: ['/dicom-web'],
    target: process.env.RTV_DICOMWEB_UPSTREAM || 'http://localhost:8042/dicom-web',
    changeOrigin: true,
    pathRewrite: { '^/dicom-web': '' },
  },
  {
    context: ['/wado-uri'],
    target: process.env.RTV_WADOURI_UPSTREAM || 'http://localhost:8042/wado',
    changeOrigin: true,
    pathRewrite: { '^/wado-uri': '' },
  },
  // mantida para nao quebrar quem usa o dicomweb-server local
  { context: ['/dicomweb'], target: 'http://localhost:5000' },
],
```

**Ponto de atenção:** o repo usa `/dicomweb` (dev server) e `/dicom-web` (templates nginx) para
coisas diferentes. Antes de mexer, conferir qual prefixo o
`platform/app/public/config/docker_compose_dcm4chee.js` usa e **alinhar os três** — dev server,
nginx e config de app. Um prefixo diferente entre eles produz 404 só no perfil que ninguém
testou, e o sintoma (lista de estudos vazia) parece "o PACS não tem nada".

### 3.5 Autenticação do dcm4chee

O `rt-arc-1` do DEV1 responde em `http://localhost:8080/dcm4chee-arc/aets/RTPACS/rs` e, pelo que
o `docker-compose.dcm4chee.yml` já assume, sem exigir token nessa rota. Se exigir, o token
**não** vai no config de app (ele é servido ao browser): vai como header injetado pelo proxy —
no perfil B, no nginx; no perfil A, num `onProxyReq`. Manter os dois iguais.

---

## 4. Perfil B — o que sobe no DEV1 hoje

Nenhum node no contêiner. O `dist/` entra como bind mount ou como camada copiada.

### 4.1 `Dockerfile.static`

```dockerfile
# Serve um dist/ JA BUILDADO. Nenhum pnpm, nenhum node, nenhuma compilacao.
# Existe porque build de producao do viewer nao cabe em maquina de 5 GiB.
FROM nginx:1.27-alpine
RUN apk add --no-cache gettext curl
COPY docker/nginx-dcm4chee.conf.template /usr/src/default.conf.template
COPY docker/entrypoint-static.sh /usr/local/bin/entrypoint-static.sh
RUN chmod +x /usr/local/bin/entrypoint-static.sh
ENTRYPOINT ["/usr/local/bin/entrypoint-static.sh"]
CMD ["nginx", "-g", "daemon off;"]
```

`docker/entrypoint-static.sh` faz o `envsubst` do template e valida que o `dist/` não está
vazio — porque um nginx servindo um diretório vazio devolve 403 e o sintoma parece problema de
permissão, não "esqueci de buildar":

```sh
#!/bin/sh
set -eu
: "${DCM4CHEE_UPSTREAM:=http://dcm4chee-host:8080}"
: "${DCM4CHEE_AET:=RTPACS}"
if [ ! -f /usr/share/nginx/html/index.html ]; then
  echo "ERRO: /usr/share/nginx/html/index.html nao existe." >&2
  echo "O perfil static NAO builda. Rode 'pnpm build' fora e monte o dist/ aqui." >&2
  exit 1
fi
envsubst '${DCM4CHEE_UPSTREAM} ${DCM4CHEE_AET}' \
  < /usr/src/default.conf.template > /etc/nginx/conf.d/default.conf
exec "$@"
```

### 4.2 `docker-compose.static.yml`

```yaml
services:
  viewer-static:
    build:
      context: .
      dockerfile: Dockerfile.static
    container_name: rtv-viewer-static
    restart: unless-stopped
    mem_limit: 256m
    ports:
      - '${RTV_STATIC_PORT:-3010}:80'
    extra_hosts:
      - 'dcm4chee-host:host-gateway'
    environment:
      DCM4CHEE_UPSTREAM: 'http://dcm4chee-host:8080'
      DCM4CHEE_AET: 'RTPACS'
    volumes:
      - ./platform/app/dist:/usr/share/nginx/html:ro
```

### 4.3 Onde o `dist/` é produzido

Três opções, em ordem de preferência:

1. **CI** (`build:ci` já existe no `package.json`) publica o `dist/` como artefato. Melhor: é
   reprodutível e ninguém precisa de máquina grande.
2. **Máquina do desenvolvedor**, com o `dist/` enviado por `rsync`. Serve para desbloquear hoje.
3. **Outra máquina do parque** com folga, buildando a mesma tag de git.

O que **não** deve acontecer: cada um buildar local com install não-congelado. O `dist/` que
está servindo tem de corresponder a um commit conhecido — vale gravar o SHA num
`dist/BUILD_INFO` e expor em `/BUILD_INFO`, para dar para responder "que versão está no ar" sem
adivinhar.

---

## 5. Microserviço Python — um core, dois adaptadores, um contrato

### 5.1 O requisito, e por que ele é a parte difícil

O mesmo código tem de rodar:

- como **API HTTP** num contêiner (viewer web chama pela rede);
- como **binário local** invocado pelo Tauri no RTVW (sidecar, sem rede).

Se isso não for desenhado desde o começo, o resultado previsível é **duas implementações que
divergem devagar**: uma correção entra na API e não no binário, e o desktop passa a responder
diferente da web para o mesmo estudo. O sintoma é o pior possível — o número muda de máquina para
máquina e ninguém sabe qual está certo.

A forma que evita isso é a mesma que os ~100 módulos de TS desta leva usam: **núcleo puro, com
os efeitos injetados nas bordas.** Aqui isso vira quatro camadas:

```
connectpy/rtpy/
  rtpy/
    core/          # funcoes puras. sem FastAPI, sem argparse, sem I/O de rede.
      register.py
      dvh.py
    contract/      # modelos pydantic + JSON Schema versionado. UM por operacao.
      v1/register.py
    api/           # adaptador FastAPI:  HTTP  -> contract -> core -> contract -> HTTP
      main.py
    cli/           # adaptador stdio:   argv  -> contract -> core -> contract -> stdout
      main.py
    io/            # leitura de DICOM, escrita de arquivo. injetado no core.
  tests/
    test_core_*.py
    test_parity.py # <- o teste que de fato garante "interoperavel"
  pyproject.toml
  Dockerfile
  rtpy.spec        # PyInstaller, para o sidecar do Tauri
```

### 5.2 As cinco decisões que fazem os dois transportes serem o mesmo

**(1) Recusa de domínio viaja no corpo, erro de transporte viaja no transporte.**

Uma recusa como "as duas séries têm frames of reference diferentes" **não** é HTTP 400. Ela é
`200 OK` com `{"ok": false, "error": {...}}`. Motivo: o binário não tem código HTTP. Se a API
sinalizar recusa por status, o cliente TS precisa de dois caminhos de erro — um para web, um
para desktop — e é exatamente aí que os dois comportamentos divergem.

Status HTTP fica para o que é transporte de verdade: 404 rota inexistente, 413 payload grande,
500 exceção não tratada. No binário, o equivalente é o **exit code**: `0` = respondeu (com `ok`
true ou false no JSON), `2` = entrada inválida, `70` = falha interna. E `stdout` **só** carrega
JSON — qualquer log vai para `stderr`, senão a primeira linha de log corrompe a resposta.

**(2) Pixel nunca passa por JSON. Os dois transportes trocam caminhos de arquivo.**

Uma série de CT tem centenas de MB. Base64 num corpo JSON é inviável nos dois lados. Então o
contrato carrega **caminhos**, e cada transporte diz de onde eles são:

| Transporte | Caminhos são | Como o arquivo chega |
|---|---|---|
| binário (Tauri) | do filesystem local | o Tauri já baixou/tem em cache local |
| API (contêiner) | de um volume montado | volume compartilhado, ou o serviço baixa do PACS por conta própria |

O contrato ganha um campo `source` (`local-path` ou `pacs-query`) e o core recebe um
`FileResolver` injetado. **Isto é a maior restrição prática de interop** e precisa estar no
contrato v1, não ser acrescentada depois.

**(3) Progresso é o mesmo evento nos dois lados.**

Registro rígido leva 5-30 s; deformável, minutos. A API quer polling ou SSE; o binário é
síncrono. Em vez de dois mecanismos, o core recebe um `progress: Callable[[Progress], None]`:

- no binário, o sink escreve **JSONL em stderr** — uma linha por evento;
- na API, o sink alimenta um SSE ou uma tabela de jobs.

O mesmo evento, serializado igual. O cliente TS aprende um formato.

**(4) Versão no caminho e no artefato, nas duas pontas.**

A rota é `POST /v1/register`; o comando é `rtpy register --contract v1`. E existe
`rtpy version --json` devolvendo versão do pacote **e das bibliotecas que mudam resultado**
(SimpleITK, numpy, pydicom). Sem isso não há como responder "por que o desktop deu 1,2 mm e a
web deu 1,4 mm" — e essa pergunta vai aparecer.

**(5) Um teste de paridade, e ele é o entregável.**

`tests/test_parity.py` roda os mesmos fixtures pelos dois adaptadores e exige JSON **idêntico**:

```python
import json, subprocess, sys
from fastapi.testclient import TestClient
from rtpy.api.main import app

CASES = ["register_rigid_ok", "register_mismatched_for", "register_missing_series"]

def _via_api(payload):
    r = TestClient(app).post("/v1/register", json=payload)
    assert r.status_code == 200, r.text      # recusa de dominio NAO e 4xx
    return r.json()

def _via_cli(payload):
    p = subprocess.run(
        [sys.executable, "-m", "rtpy.cli", "register", "--stdin", "--stdout"],
        input=json.dumps(payload), capture_output=True, text=True,
    )
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)                # stdout so tem JSON

def test_api_and_cli_agree(case, payload, expected):
    assert _via_api(payload) == _via_cli(payload) == expected
```

Um caso de recusa entre os fixtures é obrigatório. Paridade só no caminho felizes é a paridade
que não pega nada: é justamente no erro que os dois adaptadores costumam divergir.

### 5.3 Empacotamento — o mesmo código, dois artefatos

`pyproject.toml`:

```toml
[project]
name = "rtpy"
version = "0.1.0"
requires-python = ">=3.11,<3.13"

# Pinado, nao com >=. A versao do SimpleITK MUDA O RESULTADO NUMERICO do
# registro: se o container e o binario tiverem versoes diferentes, o desktop e a
# web respondem numeros diferentes para o mesmo estudo e a paridade vira ficcao.
dependencies = [
  "pydantic==2.9.2",
  "SimpleITK==2.4.0",
  "pydicom==3.0.1",
  "numpy==2.1.2",
]

[project.optional-dependencies]
api = ["fastapi==0.115.5", "uvicorn[standard]==0.32.1"]
dev = ["pytest==8.3.4", "pyinstaller==6.11.1", "httpx==0.28.1"]

[project.scripts]
rtpy = "rtpy.cli.main:main"
```

Reparar em duas coisas: **FastAPI é dependência opcional** (o binário do Tauri não deve carregar
um framework web), e as versões são **exatas**. `SimpleITK>=2.4` num lado e `2.5` no outro produz
diferença numérica no registro, e o teste de paridade — que roda num só ambiente — não pega.
Contra isso, `rtpy version --json` e um **golden file** conferido nos dois artefatos no CI.

`Dockerfile` (segue o padrão do `connectpy/drr`, que já existe no repo):

```dockerfile
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pyproject.toml /app/
COPY rtpy /app/rtpy
RUN pip install '.[api]'
ENV RTPY_DATA_ROOT=/data
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD curl -fsS http://localhost:8000/v1/health || exit 1
CMD ["uvicorn", "rtpy.api.main:app", "--host", "0.0.0.0", "--port", "8000"]

# Estagio separado que produz o binario do sidecar. Nao entra na imagem da API.
FROM base AS sidecar
RUN pip install pyinstaller==6.11.1
COPY rtpy.spec /app/
RUN pyinstaller --clean --distpath /out rtpy.spec
```

`docker-compose.rtpy.yml`:

```yaml
services:
  rtpy:
    build:
      context: ./connectpy/rtpy
      target: base
    container_name: rt-rtpy
    restart: unless-stopped
    mem_limit: 2g
    memswap_limit: 2g
    cpus: 2.0
    ports:
      # 8000 esta ocupada no DEV1 (whisper-api). 8200 e 8201 estao livres.
      - '${RTPY_PORT:-8200}:8000'
    environment:
      RTPY_DATA_ROOT: /data
      PACS_DICOMWEB: 'http://dcm4chee-host:8080/dcm4chee-arc/aets/RTPACS/rs'
    extra_hosts:
      - 'dcm4chee-host:host-gateway'
    volumes:
      # O MESMO caminho dentro e fora, para o campo `path` do contrato ter o
      # mesmo significado nos dois transportes. Ver 5.2 (2).
      - rtpy-data:/data
volumes:
  rtpy-data:
```

### 5.4 O sidecar do Tauri

O Tauri espera o binário nomeado com o *target triple* e declarado no `tauri.conf.json`:

```
src-tauri/binaries/rtpy-x86_64-unknown-linux-gnu
src-tauri/binaries/rtpy-x86_64-pc-windows-msvc.exe
```

```json
{ "bundle": { "externalBin": ["binaries/rtpy"] } }
```

Do lado Rust, `Command::new_sidecar("rtpy")` com `--stdin --stdout`, lendo JSONL de `stderr` para
progresso. Três consequências que precisam estar no plano de build (RTV-8):

1. **Um binário por plataforma.** PyInstaller não cruza-compila: Windows tem de ser buildado no
   Windows. Isso vira uma matriz no CI, não um passo local.
2. **Tamanho.** SimpleITK + numpy num `--onefile` passa de 150 MB, e o `--onefile` extrai para
   temp a cada execução, o que custa segundos por chamada. Preferir `--onedir` num diretório de
   recursos do bundle, e medir o tempo de partida.
3. **Antivírus.** Binário PyInstaller assinado é tratado bem melhor no Windows. Entra no mesmo
   passo de assinatura do instalador.

---

## 6. Primeira operação a entregar: `register` (RTV-196)

Porque o consumidor já existe e já diz o que precisa: `rigidRegistrationQa.ts` (mergeado hoje)
recusa uma matriz com determinante negativo, precisa de landmarks para liberar transferência de
contorno, e o `deformableQa.ts` (RTV-199) exige **campo direto e inverso**.

Contrato v1:

```jsonc
// POST /v1/register    |    rtpy register --stdin --stdout
{
  "contract": "v1",
  "fixed":  { "source": "local-path", "path": "/data/ct/",  "series_uid": "1.2.3" },
  "moving": { "source": "local-path", "path": "/data/mr/",  "series_uid": "1.2.4" },
  "transform": "rigid",                      // rigid | affine | deformable
  "metric": "mattes-mi",
  "landmarks": [ { "fixed": [1,2,3], "moving": [1,2,4] } ]   // opcional
}
```

```jsonc
// resposta — mesma nos dois transportes
{
  "ok": true,
  "contract": "v1",
  "transform_matrix": [ /* 16, row-major, mm, DICOM patient */ ],
  "determinant": 1.0000,                     // exigido pelo QA do RTV-196
  "metrics": { "mattes_mi": -0.83, "landmark_rms_mm": 1.2 },
  "deformable": {                            // so quando transform=deformable
    "forward_field_path": "/data/out/fwd.nii.gz",
    "inverse_field_path": "/data/out/inv.nii.gz"   // exigido pelo QA do RTV-199
  },
  "versions": { "rtpy": "0.1.0", "SimpleITK": "2.4.0" },
  "elapsed_ms": 4210
}
```

Recusa, com `200 OK` e exit code `0`:

```jsonc
{
  "ok": false,
  "contract": "v1",
  "error": {
    "code": "frame-of-reference-mismatch",
    "message": "As duas series tem Frame of Reference UID diferentes e nenhuma transformacao inicial foi fornecida."
  },
  "versions": { "rtpy": "0.1.0", "SimpleITK": "2.4.0" }
}
```

O campo `determinant` não é decoração: o QA do RTV-196 recusa determinante negativo porque é
espelhamento (confusão LPS/RAS), e as imagens ainda se sobrepõem de forma convincente num corte
axial de cabeça quase simétrica, com esquerda e direita trocadas. Melhor o serviço já devolver o
número do que o cliente recalculá-lo.

---

## 7. Sequência — o que desbloqueia o que

| # | Passo | Desbloqueia | Custo | Rodável no DEV1? |
|---|---|---|---|---|
| 1 | `corepack prepare pnpm@11.5.2` no host + documentar | qualquer coisa com pnpm | minutos | **sim** |
| 2 | `mem_limit` nos serviços que compilam (compose já existentes) | build deixa de derrubar o host | minutos | **sim** |
| 3 | Perfil **static** + `dist/` vindo do CI | **React contra o PACS com dados reais** | horas | **sim** |
| 4 | Alinhar prefixo `/dicom-web` entre dev server, nginx e config | perfil dev não dar 404 | horas | sim (só leitura) |
| 5 | Perfil **dev** com HMR | desenvolvimento de verdade | 1 dia | só liberando RAM |
| 6 | `rtpy` esqueleto: core+contract+api+cli+paridade, operação `health` e `version` | prova o padrão de interop **antes** de ter algoritmo | 1 dia | **sim** (imagem pequena) |
| 7 | `register` rígido no `rtpy` | RTV-196, e fusão CT+MR de verdade | dias | sim |
| 8 | Sidecar PyInstaller + matriz de CI | RTV-8, RTVW | dias | build Linux sim, Windows não |
| 9 | `register` deformável com campo inverso | RTV-199 | dias | sim, mas lento |

O passo 6 antes do 7 é de propósito: **provar o transporte com uma operação trivial** custa um dia
e evita descobrir o problema de paridade quando já existe algoritmo para reescrever.

---

## 8. Riscos, e como cada um é detectado

| # | Risco | Como aparece | Detecção |
|---|---|---|---|
| R1 | Build de produção tentado no DEV1 | host inacessível, sshd cai | `mem_limit` no compose; aviso no `docker/README.md` (já existe) |
| R2 | pnpm 9 no host resolvendo diferente do lockfile | `dist/` que só funciona na máquina de quem buildou | `--frozen-lockfile` + `corepack` fixando 11.5.2 |
| R3 | `node_modules` em bind mount | install de minutos, symlink quebrado, HMR que não recarrega | volume nomeado (seção 3.2) |
| R4 | Prefixo DICOMweb divergente entre os três lugares | lista de estudos **vazia**, que parece PACS sem dados | conferir os três antes de mexer; teste de fumaça que faz um QIDO e exige >= 1 estudo |
| R5 | API e binário divergindo | mesmo estudo, número diferente no desktop e na web | `test_parity.py` com caso de recusa; golden file nos dois artefatos |
| R6 | SimpleITK em versão diferente nos dois artefatos | diferença numérica sem erro nenhum | versões exatas no `pyproject`; `rtpy version --json` no cabeçalho de toda resposta |
| R7 | Pixel via JSON | 413, ou OOM no serviço | contrato só aceita caminho; sem campo de payload binário |
| R8 | Log em `stdout` no binário | JSON corrompido na primeira linha de log | `stdout` só JSON, por contrato; teste que roda o CLI e faz `json.loads` do stdout inteiro |
| R9 | `--onefile` no sidecar | segundos de partida por chamada, no caminho interativo | medir tempo de partida; preferir `--onedir` |
| R10 | Porta ocupada | `up` falha, ou pior, sobe em porta que outro serviço usava | `.env` com as portas; 3010/8200/8201 conferidas livres em 2026-08-17 |

---

## 9. O que dá para verificar hoje, e o que não dá

**Dá, no DEV1:** perfil static contra o `rt-arc-1` (11 estudos: 10 CT, 3 RTIMAGE/DRR, 1 RTPLAN,
1 RTSTRUCT); a imagem do `rtpy` e o teste de paridade; o `corepack`; os limites de memória.

**Não dá, no DEV1:** build de produção do viewer (seção 1); o perfil dev sem liberar RAM; o
sidecar Windows (precisa de máquina Windows); qualquer validação que precise de **RTDOSE ou
RTRECORD**, que não existem no acervo — o que mantém cinco tickets do epic RTV-162 sem dado,
conforme já registrado no RTV-231.

**Consequência para a validação:** o passo 3 deste plano é o que finalmente permite exercitar em
browser os módulos que dependem de CT, RTPLAN e RTSTRUCT — notadamente RTV-11 (linhas de feixe) e
RTV-141 (volume de estrutura, onde comparar contra o volume do TPS é a conferência de maior
valor). Os demais continuam esperando dado, não código.
