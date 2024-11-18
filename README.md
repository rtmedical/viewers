# ConnectViewer

ConnectViewer é um aplicativo web que fornece um visualizador de imagens médicas DICOM. Este aplicativo é baseado na plataforma OHIF e oferece uma interface poderosa, robusta e flexível para visualização de imagens.

## Pré-requisitos

Antes de começar, certifique-se de que o seguinte software está instalado no seu sistema:

- [Docker](https://www.docker.com/)
- [Docker Compose](https://docs.docker.com/compose/)

## Instalação

Para instalar o ConnectViewer, siga os passos abaixo:

```bash
# Clonar o repositório
git clone https://github.com/rtmedical/viewers.git
cd connectviewer
```

## Execução

Para iniciar o servidor de desenvolvimento, execute:

```bash
docker-compose up
```

O aplicativo agora deve estar rodando no http://localhost:3000. Para acessar o aplicativo, você pode mapear a porta 3000 para o seu navegador usando o VS Code

## Git Upstream
"Upstream" é um termo comumente usado no Git para se referir ao repositório original a partir do qual um fork foi criado. Quando você cria um fork de um repositório, você essencialmente faz uma cópia desse repositório em seu próprio espaço no GitHub (ou outra plataforma de hospedagem do Git). Esse repositório copiado é chamado de "fork", enquanto o repositório original é chamado de "upstream".

Manter o "upstream" configurado em seu fork tem muitas vantagens, principalmente quando você deseja manter seu fork sincronizado com as últimas alterações no repositório original.

Para adicionar um repositório "upstream" à sua configuração Git, você pode usar o comando git remote add. Aqui está um exemplo:
```bash
git remote add upstream https://github.com/OHIF/Viewers.git
```

Instalar Dependências:


Habilitar workspaces do Yarn:
```bash
yarn config set workspaces-experimental true
```

Instalar dependências:
```bash
yarn install
```

## Desenvolver e Sincronizar com o Repositório Original

Para iniciar o desenvolvimento, use o comando:
```bash

yarn dev
```

Para rodar testes unitários:
```bash

yarn test:unit
```

Para criar uma versão de produção:
```bash
yarn build
```

## Manter seu Fork Atualizado:
Periodicamente, você deve buscar atualizações do repositório original e mesclar essas atualizações no seu fork. Aqui estão os comandos para fazer isso:


```bash

# Buscar atualizações do repositório original
git fetch upstream

# Mesclar as atualizações da branch master do upstream no seu fork
git checkout master
git merge upstream/master

# Se houver conflitos, resolva-os e depois faça o commit das alterações

```

Note que, ao fazer o merge, você pode encontrar conflitos se o mesmo arquivo foi modificado tanto no seu fork quanto no repositório original. Esses conflitos devem ser resolvidos manualmente antes de você poder continuar.

É importante notar que a configuração do "upstream" é particularmente útil quando você deseja contribuir para o repositório original. Você pode fazer suas alterações em seu fork, manter o fork sincronizado com o repositório original e, em seguida, emitir um Pull Request do seu fork para o repositório original.


## Conflitos

Os conflitos de mesclagem ocorrem quando o Git não consegue decidir como combinar alterações de diferentes commits que alteram a mesma linha de código. Normalmente, esses conflitos surgem quando você tenta mesclar duas branches que têm commits conflitantes.

Quando um conflito de mesclagem ocorre, o Git pausa o processo de mesclagem e aguarda que você resolva o conflito. Aqui estão os passos que você pode seguir para resolver conflitos de mesclagem:

Identifique os arquivos conflitantes: Primeiro, você precisa identificar quais arquivos têm conflitos de mesclagem. Você pode fazer isso executando o comando git status. Os arquivos com conflitos serão listados na seção "unmerged paths".

Abra os arquivos conflitantes: Abra os arquivos com conflitos em um editor de texto. Você verá blocos de conflito que parecem com isso:

```bash
# As alterações no seu branch aparecerão aqui
# As alterações no branch que está sendo mesclado (normalmente o upstream) aparecerão aqui
```

Resolva os conflitos: Para resolver os conflitos, você precisa decidir quais alterações manter. Você pode escolher manter as alterações no seu branch, as alterações no branch que está sendo mesclado, ou você pode combinar as alterações de ambos. Uma vez que você tomou sua decisão, você pode editar o arquivo para refletir essa decisão. Remova as linhas <<<<<<<, =======, e >>>>>>>, e faça as alterações necessárias para resolver o conflito.

Marque o arquivo como resolvido: Depois de resolver o conflito, você precisa informar ao Git que o conflito foi resolvido. Você pode fazer isso adicionando o arquivo ao staging area usando o comando git add. Por exemplo:
```bash
git add myfile.txt
```

Faça um commit: Uma vez que todos os conflitos foram resolvidos e os arquivos conflitantes foram adicionados ao staging area, você pode fazer um commit para finalizar a mesclagem. Por exemplo:
```bash
git commit -m "Resolved merge conflicts"
```


## Construindo o Aplicativo
Acesse o conteiner

```bash
docker exec -it ID_CONTEINER bash
```
Execute o comando para constuir o aplicativo:

```bash
yarn run build

```
Após a conclusão da construção, os arquivos estarão na pasta concluir

## Executando PWA no Laravel.
Você poderá criar um arquivo deploy.sh

```bash

#!/bin/bash

## DELETANDO EXISTENTES no LARAVEL
rm -rf /var/www/public/assets/viewer/
mkdir  /var/www/public/assets/viewer/

#Copiando pasta dist gerada depois do build para o laravel
cp -R /app/platform/app/dist/* /var/www/public/assets/viewer/

#Movendo os Arquivos para a pasta Viewer
#/connect/resources/views/viewer/index.blade.php
mv /var/www/public/assets/viewer/index.blade.php  /var/www/resources/views/viewer/
mv /var/www/public/assets/viewer/silent-refresh.blade.php  /var/www/resources/views/viewer/

```
Para o mapeamento acima funcionar, deverá estar configurado da seguinte maneira.
```yml

    volumes:
      - /app/node_modules
      - .:/app
      - ../connect:/var/www

```
