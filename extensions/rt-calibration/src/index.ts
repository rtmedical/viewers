/**
 * @ohif/extension-rt-calibration
 *
 * - **RTV-138 — calibração por phantom.** Deriva mm/pixel de uma referência de catálogo,
 *   escopada por imagem, série ou estudo, com a ressalva de ampliação que a projeção
 *   impõe e a invalidação por mudança de geometria.
 *
 * - **RTV-129 — QA de acelerador (TG-142).** Interpretação dos resultados que o pylinac
 *   produz: três estados em vez de passa/falha, tendência separada de dispersão, linha de
 *   base que não engole a deriva, e a decomposição do Winston-Lutz em o que de fato se
 *   corrige ajustando a máquina.
 *
 * A calibração de monitor (GSDF) é outra coisa e vive em
 * `@ohif/extension-rt-display-cal`: aquela ajusta como o pixel é exibido, esta define
 * quanto ele mede.
 *
 * Zero-fork per RTV-114.
 */
export * from './calibration';
export * from './linacQa';
