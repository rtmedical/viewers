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
  // --- Wave 4/5 TPS UI (Info Window tabs) ---
  tab_fields: 'Campos',
  tab_dose: 'Dose',
  tab_dvh: 'DVH',
  tab_isodoses: 'Isodoses',
  tab_course: 'Curso',
  tab_record: 'Registro',
  tab_unavailable: 'Painel indisponível.',
  tab_no_data: 'Sem dados para esta aba.',
  no_rt_plan: 'Nenhum RT Plan carregado.',
  // Fields table
  fields_title: 'Campos',
  fields_count: '{{count}} campos',
  col_name: 'Nome',
  col_technique: 'Técnica',
  col_machine_energy: 'Máquina/Energia',
  col_field_x: 'Campo X [cm]',
  col_field_y: 'Campo Y [cm]',
  total: 'Total',
  // Dose tab
  dose_plan: 'Plano',
  dose_machine: 'Máquina',
  dose_approval: 'Aprovação',
  dose_manufacturer: 'Fabricante',
  dose_total_prescribed: 'Dose total prescrita',
  dose_total_mu: 'MU total',
  dose_prescriptions: 'Prescrições',
  dose_type: 'Tipo',
  dose_structure: 'Estrutura',
  dose_description: 'Descrição',
  dose_dose_gy: 'Dose [Gy]',
  dose_fractionation: 'Fracionamento',
  dose_group: 'Grupo',
  dose_fractions: 'Frações',
  dose_beams: 'Campos',
  dose_per_fraction: 'Dose/fração [Gy]',
  dose_group_dose: 'Dose grupo [Gy]',
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
  // --- Wave 4/5 TPS UI (Info Window tabs) ---
  tab_fields: 'Fields',
  tab_dose: 'Dose',
  tab_dvh: 'DVH',
  tab_isodoses: 'Isodoses',
  tab_course: 'Course',
  tab_record: 'Record',
  tab_unavailable: 'Panel unavailable.',
  tab_no_data: 'No data for this tab.',
  no_rt_plan: 'No RT Plan loaded.',
  fields_title: 'Fields',
  fields_count: '{{count}} fields',
  col_name: 'Name',
  col_technique: 'Technique',
  col_machine_energy: 'Machine/Energy',
  col_field_x: 'Field X [cm]',
  col_field_y: 'Field Y [cm]',
  total: 'Total',
  dose_plan: 'Plan',
  dose_machine: 'Machine',
  dose_approval: 'Approval',
  dose_manufacturer: 'Manufacturer',
  dose_total_prescribed: 'Total prescribed dose',
  dose_total_mu: 'Total MU',
  dose_prescriptions: 'Prescriptions',
  dose_type: 'Type',
  dose_structure: 'Structure',
  dose_description: 'Description',
  dose_dose_gy: 'Dose [Gy]',
  dose_fractionation: 'Fractionation',
  dose_group: 'Group',
  dose_fractions: 'Fractions',
  dose_beams: 'Beams',
  dose_per_fraction: 'Dose/fraction [Gy]',
  dose_group_dose: 'Group dose [Gy]',
};
