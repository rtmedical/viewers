/*
 * Stub para os codecs WASM do @cornerstonejs (RTV-236).
 *
 * Quatro pacotes -- codec-charls, codec-libjpeg-turbo-8bit, codec-openjpeg, codec-openjph --
 * publicam por `exports` com subpaths que NAO seguem `dist/esm` (`/decodewasmjs` aponta para
 * `dist/libjpegturbowasm_decode.js`, por exemplo). O mapeador generico de jest.config.base.js
 * manda tudo para `dist/esm/<subpath>` e nao acha nada.
 *
 * Aqui interessa por que isto e SEGURO, e nao so conveniente: a guarda de carga pergunta se o
 * ponto de entrada de uma extensao NOSSA avalia. Esses pacotes sao decodificadores WASM de
 * terceiros, arrastados transitivamente pelo dicom-image-loader, e no momento do import o
 * consumidor apenas liga a factory -- nao decodifica nada. Trocar a factory por uma funcao
 * vazia nao muda o que a guarda mede, e evita que ela reprove a rt-tps por um detalhe de
 * empacotamento de dependencia.
 *
 * O que isto NAO cobre, e nem tenta: se algum dia um codec quebrar de verdade, esta guarda nao
 * vai perceber. Quem cobre decodificacao e teste de imagem, nao teste de carga.
 */
const factory = () => ({});
module.exports = factory;
module.exports.default = factory;
