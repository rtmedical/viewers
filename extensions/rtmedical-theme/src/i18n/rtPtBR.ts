/**
 * RT Medical PT-BR string bundle (RTV-9).
 *
 * OHIF v3 already ships a `pt-BR` locale (platform/i18n) plus a language selector
 * and i18next localStorage persistence, so the base UI translates and the toggle
 * works natively. This adds the RT-specific strings (modes, RT panels, workflow
 * actions) under an `RTMedical` namespace so RT components/customizations can
 * translate via t('RTMedical:<key>'). Registered through addResourceBundle in
 * the extension's preRegistration — no fork of @ohif/i18n (RTV-114).
 */
export const RT_NAMESPACE = 'RTMedical';
export const RT_LOCALE = 'pt-BR';

export const rtPtBR: Record<string, string> = {
  // Modes
  Radiology: 'Radiologia',
  Radiotherapy: 'Radioterapia',
  // Panels
  KeyImages: 'Imagens-Chave',
  Laudo: 'Laudo',
  Measurements: 'Medidas',
  StudyBrowser: 'Estudos',
  Segmentation: 'Segmentação',
  // Worklist navigation (RTV-120)
  NextStudy: 'Próximo estudo',
  PreviousStudy: 'Estudo anterior',
  // Key Images panel (RTV-148)
  NoKeyImagesSelected: 'Nenhuma imagem-chave selecionada.',
  ExportKOS: 'Exportar KOS',
  Clear: 'Limpar',
  // Measurements panel (RTV-151)
  NoMeasurements: 'Nenhuma medida.',
  ExportCSV: 'Exportar CSV',
  // Laudo placeholder (RTV-118/121)
  LaudoComingSoon: 'O editor de laudo inline será disponibilizado em RTV-121.',
};

/** A minimal English mirror so missing-key fallbacks read sensibly in en-US. */
export const rtEn: Record<string, string> = {
  Radiology: 'Radiology',
  Radiotherapy: 'Radiotherapy',
  KeyImages: 'Key Images',
  Laudo: 'Report',
  Measurements: 'Measurements',
  StudyBrowser: 'Studies',
  Segmentation: 'Segmentation',
  NextStudy: 'Next study',
  PreviousStudy: 'Previous study',
  NoKeyImagesSelected: 'No key images selected.',
  ExportKOS: 'Export KOS',
  Clear: 'Clear',
  NoMeasurements: 'No measurements.',
  ExportCSV: 'Export CSV',
  LaudoComingSoon: 'The inline report editor ships in RTV-121.',
};
