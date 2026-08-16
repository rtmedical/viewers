/**
 * @ohif/extension-rt-calibration
 *
 * - **RTV-138 — calibração por phantom.** Deriva mm/pixel de uma referência de catálogo,
 *   escopada por imagem, série ou estudo, com a ressalva de ampliação que a projeção
 *   impõe e a invalidação por mudança de geometria.
 *
 * A calibração de monitor (GSDF) é outra coisa e vive em
 * `@ohif/extension-rt-display-cal`: aquela ajusta como o pixel é exibido, esta define
 * quanto ele mede.
 *
 * Zero-fork per RTV-114.
 */
export * from './calibration';
