# Stack Docker de desenvolvimento — RTV

Dois perfis, para duas situações diferentes.

| Perfil | Arquivo | Sobe PACS? | Quando usar |
|---|---|---|---|
| **Orthanc** (RTV-3) | `docker-compose.yml` | Sim, Orthanc novo (nasce **vazio**) | Ambiente isolado, do zero. Você popula com seus próprios estudos. |
| **dcm4chee** (RTV-231) | `docker-compose.dcm4chee.yml` | Não — usa um dcm4chee-arc que já roda no host | Quando já existe PACS com dados na máquina. É o caso do DEV1. |

Em ambos, o nginx do viewer proxia `/dicom-web`, então o browser fica same-origin e **não** é preciso configurar CORS no PACS.

---

## ⚠️ Leia isto antes de rodar no DEV1

O build dos dois perfis roda `pnpm install` + `rspack build` **dentro do container**. Isso não cabe no DEV1.

Medido em 2026-08-14, durante o build:

| Métrica | Valor |
|---|---|
| RAM total da máquina | 5.6 GiB |
| RAM livre no pico do build | ~190 MiB |
| Swap em uso | 13 GiB de 15 GiB |
| Load average | **74** (em 10 cores) |
| Efeito colateral | `sshd` parou de aceitar conexão por vários minutos |

O build teve de ser abortado. **Não rode o build in-container no DEV1**, e nunca junto com `pnpm test:unit` — os dois competem pela mesma RAM e a máquina para.

### Caminho recomendado em máquina apertada: buildar fora, servir só o `dist/`

Builde numa máquina com folga (ou no CI) e sirva o resultado com um nginx puro — sem `pnpm` no container:

```bash
# 1) Numa máquina com RAM sobrando (ou no CI), com Node >= 24:
export NVM_DIR=$HOME/.nvm && . $NVM_DIR/nvm.sh && nvm use default
corepack pnpm@11.5.2 install --no-frozen-lockfile
APP_CONFIG=config/docker_compose_dcm4chee.js corepack pnpm@11.5.2 run build

# 2) Leve platform/app/dist para a máquina alvo e sirva:
docker run -d --name rtv-viewer-static -p 3010:8080 \
  --add-host dcm4chee-host:host-gateway \
  -v "$PWD/platform/app/dist:/usr/share/nginx/html:ro" \
  -v "$PWD/docker/nginx-dcm4chee.conf.template:/etc/nginx/templates/default.conf.template:ro" \
  -e PORT=8080 -e PUBLIC_PATH=/ -e PUBLIC_PATH_REDIRECT= \
  nginxinc/nginx-unprivileged:1.27-alpine
```

Sem build, sem `pnpm install`, footprint de um nginx.

---

## Perfil Orthanc (RTV-3)

```bash
docker compose up -d              # Orthanc + viewer buildado
docker compose up -d orthanc      # só o PACS — então `pnpm dev` local contra http://localhost:8042
```

- Viewer: `http://localhost:3000` (mas veja **Portas** abaixo)
- Orthanc UI/API: `http://localhost:8042` (autenticação **desligada** — só desenvolvimento, não exponha)
- Estudos persistem no volume `orthanc-data`
- Config embutido: `platform/app/public/config/docker_compose_orthanc.js`

## Perfil dcm4chee (RTV-231)

```bash
docker compose -f docker-compose.dcm4chee.yml up -d --build
```

- Viewer: `http://localhost:3010`
- Config embutido: `platform/app/public/config/docker_compose_dcm4chee.js`
- Upstream: `dcm4chee-host:8080` (alias para o gateway do host, via `extra_hosts: host-gateway`)

### O dcm4chee do DEV1

O container `rt-arc-1` (`dcm4che/dcm4chee-arc-psql:5.22.3`) já está no ar:

- DICOMweb: `http://localhost:8080/dcm4chee-arc/aets/RTPACS/rs`
- DIMSE: porta `11112`
- AETs: `RTPACS` (principal), `AUTOSEG`, `QA`, `AS_RECEIVED`, `RTPACS_ANCHIETA`, `RTPACS_HELIOPOLIS`, `RTPACS_HEMC`, `RTPACS_ICAVC`, `RTPACS_IRABC`, `RTPACS_SANTANA`, e os `IOCM_*`

Acervo em 2026-08-14 — **11 estudos**:

| Modalidade | Estudos |
|---|---|
| CT | 10 |
| RTIMAGE (DRR) | 3 |
| RTPLAN | 1 |
| RTSTRUCT | 1 |

Majoritariamente sintético (`Test study for AUTOSEG-PAT001`, `QA-PAT00x`), com um `TC PELVE OU BACIA` e um `PET/CT whole-body PSMA`.

**Não há RTDOSE nem RTRECORD.** Consequência prática: os tickets de dose (RTV-137, isodose) e toda a epic de treatment history (RTV-162 — RTV-167/169/171/172/177…) **não têm dado para validar** neste PACS. Vão precisar de dado sintético ou de um export do ARIA.

Para usar outro AET, troque `RTPACS` em **dois** lugares: os `proxy_pass` de `docker/nginx-dcm4chee.conf.template` e o `friendlyName`/comentário de `docker_compose_dcm4chee.js`.

---

## Portas

`docker-compose.yml` mapeia `3000:80`, que é o default certo na maioria das máquinas — mas no DEV1 a 3000 é do `rt-workspace-1`. Em vez de mudar o default do repo, declare o desvio da sua máquina num override local:

```bash
cp docker-compose.override.yml.example docker-compose.override.yml
docker compose up -d
```

`docker-compose.override.yml` é ignorado pelo git. O arquivo `.example` lista as portas que estavam ocupadas no DEV1.

---

## Popular o Orthanc a partir do dcm4chee

Para usar o perfil isolado do RTV-3 **com dados de verdade**, copie os estudos do dcm4chee para o Orthanc:

```bash
python3 docker/seed-orthanc-from-dcm4chee.py                  # tudo
python3 docker/seed-orthanc-from-dcm4chee.py --limit 3        # só 3 estudos
python3 docker/seed-orthanc-from-dcm4chee.py --dry-run        # só lista
```

Só stdlib do Python 3 — sem dependências. Ver `--help` para trocar hosts e AET.

---

## Node

Depois do sync com o upstream (PR #113) o `engines` exige **Node >= 24** e **pnpm >= 11** (`packageManager: pnpm@11.5.2`).

No DEV1 o `node` do PATH é v18.19.1 — abaixo do mínimo. O Node 24 está no nvm:

```bash
export NVM_DIR=$HOME/.nvm && . $NVM_DIR/nvm.sh && nvm use default   # -> v24.13.0
corepack pnpm@11.5.2 install --no-frozen-lockfile
```

Build em container não é afetado: o `Dockerfile` usa `node:24.15.0-slim`.
