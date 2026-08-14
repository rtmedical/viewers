/**
 * RTV-231 — app config embutido no serviço `viewer` do docker-compose.dcm4chee.yml.
 *
 * Aponta para um dcm4chee-arc que já roda no host, em vez do Orthanc novo (e vazio)
 * que o docker-compose.yml do RTV-3 sobe. Os roots são RELATIVOS: o nginx do viewer
 * (docker/nginx-dcm4chee.conf.template) proxia /dicom-web e /wado-uri para o
 * dcm4chee, então o browser fica same-origin e não é preciso CORS no dcm4chee.
 *
 * Para trocar de AET, edite `RTPACS` aqui e nos dois proxy_pass do template nginx.
 *
 * @type {AppTypes.Config}
 */
window.config = {
  routerBasename: null,
  extensions: [],
  modes: [],
  showStudyList: true,
  maxNumberOfWebWorkers: 3,
  showLoadingIndicator: true,
  showWarningMessageForCrossOrigin: false,
  showCPUFallbackMessage: true,
  strictZSpacingForVolumeViewport: true,
  defaultDataSourceName: 'dcm4chee',
  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'dcm4chee',
      configuration: {
        friendlyName: 'dcm4chee-arc RTPACS (proxied)',
        name: 'Dcm4chee',
        // Proxiados pelo nginx do viewer — ver docker/nginx-dcm4chee.conf.template.
        wadoUriRoot: '/wado-uri',
        qidoRoot: '/dicom-web',
        wadoRoot: '/dicom-web',
        // Mantido `false` para acompanhar o config dcm4chee que já existe no repo
        // (docker-nginx-dcm4chee.js): com `true` o OHIF passa a pedir
        // includefield=all, e um root que não suporte isso degrada o worklist em
        // silêncio. O RTPACS do DEV1 respondeu bem a includefield com tags
        // explícitas (verificado em 2026-08-14), então pode ser promovido a `true`
        // depois de testar o worklist completo.
        qidoSupportsIncludeField: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        dicomUploadEnabled: true,
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: true,
        supportsWildcard: true,
        omitQuotationForMultipartRequest: true,
        bulkDataURI: {
          enabled: true,
          relativeResolution: 'studies',
        },
      },
    },
  ],
};
