/*
 * Stub para asset importado por componente (png/svg/woff2/...), exigido pelo moduleNameMapper
 * de jest.config.base.js. Existe porque a guarda de carga de extensao (RTV-236) monta os
 * pontos de entrada de verdade, e varios deles arrastam imagem -- o rt-plan importa
 * assets/images/CT-AAA.png, por exemplo. Sem isto a guarda falharia por nao achar o mock, que
 * e ruido sobre a propria guarda e nao defeito do codigo medido.
 */
module.exports = 'test-file-stub';
