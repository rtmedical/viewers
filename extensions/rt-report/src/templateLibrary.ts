/**
 * Built-in report templates by modality and region, and the suggestion engine —
 * pure core (RTV-105).
 *
 * Uses the canonical model from `reportTemplate.ts` (RTV-218), so a built-in template and
 * an imported RadReport one are the same kind of object and the editor only learns one.
 *
 * ## A pre-filled normal template is the most dangerous thing in a reporting system
 *
 * This is the reason the module is written the way it is. "TC de crânio normal" loaded as
 * text means the report *starts* as a fully negative study. Every section the radiologist
 * does not overwrite is then a **negative assertion nobody made** — signed, in the patient's
 * record, indistinguishable from a finding that was actually looked for and excluded.
 * Copy-forward and auto-text are among the most common sources of error in radiology
 * reports precisely because the wrong text is fluent, plausible and already there.
 *
 * So negative prose in these templates is marked `assertive`, and
 * {@link unconfirmedAssertions} lists every assertive field the reader never touched. The
 * report is not complete while that list is non-empty. The point is not to make the
 * template less useful — it is to make *not reading it* impossible to do silently.
 *
 * ## Suggesting is not applying
 *
 * {@link suggestTemplates} returns a ranked list and never a decision. Auto-applying on
 * modality and body part means a mis-coded study quietly loads a template whose prose is
 * about a different organ, and the radiologist edits the findings without noticing that
 * the technique paragraph describes a study they did not perform.
 *
 * `BodyPartExamined` earns no trust here: it is free text, often absent, and vendor
 * conventions disagree. Matching uses the study description as well, and the confidence
 * says which signals actually fired.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

import { ReportTemplate, TemplateField, TemplateSection } from './reportTemplate';

export interface StudyContext {
  modality?: string;
  studyDescription?: string;
  bodyPartExamined?: string;
}

interface TemplateSpec {
  id: string;
  title: string;
  modality: string;
  regions: string[];
  keywords: string[];
  technique: string;
  findings: string[];
  /** Negative prose that would be signed if nobody edited it. */
  normal: string;
}

/**
 * The library.
 *
 * Every entry carries a `normal` line, and every one of those is an assertive default —
 * see {@link unconfirmedAssertions}.
 */
const SPECS: TemplateSpec[] = [
  // ---- CT ----
  { id: 'RTV-CT-CRANIO', title: 'TC de crânio sem contraste', modality: 'CT', regions: ['Crânio'],
    keywords: ['cranio', 'craneo', 'head', 'encefalo', 'skull'],
    technique: 'Cortes axiais do vértice à base do crânio, sem contraste endovenoso.',
    findings: ['Parênquima encefálico', 'Sistema ventricular e espaços liquóricos', 'Estruturas da linha média', 'Coleções extra-axiais', 'Estruturas ósseas', 'Seios paranasais e mastoides'],
    normal: 'Parênquima encefálico com atenuação preservada, sem sinais de sangramento agudo, área de infarto estabelecido ou efeito de massa. Sistema ventricular de morfologia e dimensões normais. Estruturas da linha média centradas.' },
  { id: 'RTV-CT-CRANIO-AVC', title: 'TC de crânio no AVC agudo', modality: 'CT', regions: ['Crânio'],
    keywords: ['avc', 'stroke', 'isquemia', 'trombolise', 'protocolo avc'],
    technique: 'Cortes axiais sem contraste, protocolo de AVC agudo.',
    findings: ['Sinais precoces de isquemia', 'ASPECTS', 'Hemorragia intracraniana', 'Sinal da artéria hiperdensa', 'Efeito de massa e desvio de linha média'],
    normal: 'Ausência de hemorragia intracraniana. Sem sinais precoces de isquemia; ASPECTS 10.' },
  { id: 'RTV-CT-TORAX', title: 'TC de tórax', modality: 'CT', regions: ['Tórax'],
    keywords: ['torax', 'chest', 'pulmao', 'thorax'],
    technique: 'Cortes axiais volumétricos do ápice pulmonar às bases, com reconstruções multiplanares.',
    findings: ['Parênquima pulmonar', 'Nódulos pulmonares', 'Vias aéreas', 'Pleura e derrame', 'Mediastino e linfonodos', 'Coração e grandes vasos', 'Estruturas osteomusculares'],
    normal: 'Parênquima pulmonar com transparência preservada, sem consolidações, nódulos ou opacidades em vidro fosco. Ausência de derrame pleural. Mediastino centrado, sem linfonodomegalias.' },
  { id: 'RTV-CT-TEP', title: 'Angio-TC de artérias pulmonares', modality: 'CT', regions: ['Tórax'],
    keywords: ['tep', 'embolia', 'angiotc pulmonar', 'pulmonary embolism'],
    technique: 'Aquisição volumétrica após injeção endovenosa de contraste iodado, sincronizada ao pico arterial pulmonar.',
    findings: ['Falhas de enchimento arterial', 'Nível de acometimento', 'Sinais de sobrecarga de câmaras direitas', 'Relação VD/VE', 'Parênquima pulmonar', 'Derrame pleural'],
    normal: 'Artérias pulmonares centrais e segmentares opacificadas de modo homogêneo, sem falhas de enchimento. Relação VD/VE preservada.' },
  { id: 'RTV-CT-ABDOME', title: 'TC de abdome total', modality: 'CT', regions: ['Abdome', 'Pelve'],
    keywords: ['abdome', 'abdomen', 'abdominal', 'pelve'],
    technique: 'Cortes axiais do diafragma à sínfise púbica, antes e após contraste endovenoso.',
    findings: ['Fígado e vias biliares', 'Vesícula biliar', 'Pâncreas', 'Baço', 'Rins e vias urinárias', 'Adrenais', 'Alças intestinais', 'Cólon e apêndice', 'Peritônio e cavidade', 'Grandes vasos', 'Linfonodos'],
    normal: 'Órgãos parenquimatosos abdominais de dimensões, contornos e densidade preservados, sem lesões focais. Ausência de líquido livre ou coleções.' },
  { id: 'RTV-CT-APENDICE', title: 'TC de abdome no abdome agudo', modality: 'CT', regions: ['Abdome'],
    keywords: ['apendicite', 'abdome agudo', 'dor abdominal', 'apendice'],
    technique: 'Cortes axiais do abdome e pelve com contraste endovenoso, protocolo de abdome agudo.',
    findings: ['Apêndice cecal', 'Densificação de gordura mesentérica', 'Líquido livre', 'Pneumoperitônio', 'Alças intestinais e sinais obstrutivos', 'Diverticulose e diverticulite', 'Vias urinárias'],
    normal: 'Apêndice cecal de calibre normal, sem densificação da gordura adjacente. Ausência de pneumoperitônio, líquido livre ou sinais de obstrução.' },
  { id: 'RTV-CT-SEIOS', title: 'TC de seios da face', modality: 'CT', regions: ['Face'],
    keywords: ['seios da face', 'sinusal', 'sinus', 'paranasal'],
    technique: 'Cortes axiais finos com reconstruções coronais e sagitais, sem contraste.',
    findings: ['Seios maxilares', 'Seios frontais', 'Células etmoidais', 'Seio esfenoidal', 'Complexo ostiomeatal', 'Septo nasal e cornetos'],
    normal: 'Seios paranasais pneumatizados e transparentes. Complexos ostiomeatais pérvios. Septo nasal centrado.' },
  { id: 'RTV-CT-COLUNA-LOMBAR', title: 'TC de coluna lombar', modality: 'CT', regions: ['Coluna'],
    keywords: ['coluna lombar', 'lombar', 'lumbar spine'],
    technique: 'Cortes axiais nos espaços discais com reconstruções sagitais e coronais.',
    findings: ['Alinhamento vertebral', 'Corpos vertebrais', 'Discos intervertebrais', 'Canal vertebral', 'Forames de conjugação', 'Articulações facetárias'],
    normal: 'Alinhamento vertebral preservado. Corpos vertebrais de altura e densidade normais. Canal vertebral de amplitude normal.' },
  { id: 'RTV-CT-PESCOCO', title: 'TC de pescoço com contraste', modality: 'CT', regions: ['Pescoço'],
    keywords: ['pescoco', 'cervical', 'neck'],
    technique: 'Cortes axiais da base do crânio ao opérculo torácico após contraste endovenoso.',
    findings: ['Espaços cervicais profundos', 'Glândulas salivares', 'Tireoide', 'Cadeias linfonodais', 'Vias aerodigestivas', 'Vasos cervicais'],
    normal: 'Espaços cervicais profundos preservados. Ausência de coleções ou linfonodomegalias.' },
  { id: 'RTV-CT-URO', title: 'Uro-TC', modality: 'CT', regions: ['Abdome', 'Pelve'],
    keywords: ['urotc', 'uro-tc', 'urografia', 'hematuria'],
    technique: 'Aquisição sem contraste, fase nefrográfica e fase excretora.',
    findings: ['Rins', 'Cálices e pelves renais', 'Ureteres', 'Bexiga', 'Cálculos', 'Realce de lesões focais'],
    normal: 'Rins de dimensões e realce simétricos, sem cálculos ou lesões focais. Sistema coletor sem dilatação. Bexiga de paredes finas.' },

  // ---- MR ----
  { id: 'RTV-MR-CRANIO', title: 'RM de crânio', modality: 'MR', regions: ['Crânio'],
    keywords: ['cranio', 'encefalo', 'brain'],
    technique: 'Sequências ponderadas em T1, T2, FLAIR, difusão e gradiente-eco.',
    findings: ['Substância branca', 'Substância cinzenta', 'Difusão', 'Sistema ventricular', 'Fossa posterior', 'Realce pelo contraste', 'Estruturas vasculares'],
    normal: 'Parênquima encefálico com sinal preservado nas sequências realizadas, sem restrição à difusão, lesões focais ou realce anômalo.' },
  { id: 'RTV-MR-COLUNA-LOMBAR', title: 'RM de coluna lombar', modality: 'MR', regions: ['Coluna'],
    keywords: ['coluna lombar', 'lombar', 'lumbar'],
    technique: 'Sequências sagitais T1 e T2, axiais T2 nos espaços discais.',
    findings: ['Alinhamento', 'Medula e cone medular', 'Discos intervertebrais por nível', 'Canal vertebral', 'Forames', 'Facetas', 'Partes moles paravertebrais'],
    normal: 'Alinhamento preservado. Discos intervertebrais com sinal e altura normais, sem protrusões ou herniações. Canal vertebral amplo.' },
  { id: 'RTV-MR-JOELHO', title: 'RM de joelho', modality: 'MR', regions: ['Joelho'],
    keywords: ['joelho', 'knee'],
    technique: 'Sequências nos três planos ponderadas em DP com saturação de gordura e T1.',
    findings: ['Menisco medial', 'Menisco lateral', 'Ligamento cruzado anterior', 'Ligamento cruzado posterior', 'Ligamentos colaterais', 'Cartilagem articular', 'Aparelho extensor', 'Derrame articular', 'Medula óssea'],
    normal: 'Meniscos de morfologia e sinal preservados. Ligamentos cruzados e colaterais íntegros. Cartilagem articular sem falhas. Ausência de derrame significativo.' },
  { id: 'RTV-MR-OMBRO', title: 'RM de ombro', modality: 'MR', regions: ['Ombro'],
    keywords: ['ombro', 'shoulder', 'manguito'],
    technique: 'Sequências oblíquas coronais, oblíquas sagitais e axiais.',
    findings: ['Supraespinal', 'Infraespinal', 'Subescapular', 'Redondo menor', 'Cabeça longa do bíceps', 'Labrum', 'Espaço subacromial', 'Articulação acromioclavicular'],
    normal: 'Tendões do manguito rotador íntegros, com sinal preservado. Labrum sem roturas. Espaço subacromial preservado.' },
  { id: 'RTV-MR-ABDOME', title: 'RM de abdome superior', modality: 'MR', regions: ['Abdome'],
    keywords: ['abdome superior', 'figado', 'hepatica'],
    technique: 'Sequências T1 em fase e fora de fase, T2, difusão e dinâmico após gadolínio.',
    findings: ['Fígado', 'Esteatose e siderose', 'Lesões focais hepáticas', 'Vias biliares', 'Vesícula', 'Pâncreas', 'Baço', 'Rins e adrenais'],
    normal: 'Fígado de dimensões e sinal preservados, sem lesões focais. Vias biliares não dilatadas. Pâncreas e baço sem alterações.' },
  { id: 'RTV-MR-PROSTATA', title: 'RM multiparamétrica de próstata', modality: 'MR', regions: ['Pelve'],
    keywords: ['prostata', 'pirads', 'multiparametrica'],
    technique: 'Sequências T2 nos três planos, difusão com mapa ADC e perfusão dinâmica após gadolínio.',
    findings: ['Volume prostático', 'Zona periférica', 'Zona de transição', 'Difusão e ADC', 'Perfusão', 'Categoria PI-RADS', 'Extensão extraprostática', 'Vesículas seminais', 'Linfonodos pélvicos'],
    normal: 'Próstata de contornos regulares, com sinal habitual nas zonas periférica e de transição. Sem lesões com restrição à difusão. PI-RADS 1.' },
  { id: 'RTV-MR-PELVE-FEM', title: 'RM de pelve feminina', modality: 'MR', regions: ['Pelve'],
    keywords: ['pelve feminina', 'utero', 'ovario', 'endometriose'],
    technique: 'Sequências T2 de alta resolução nos três planos, T1 com e sem saturação de gordura.',
    findings: ['Útero e zona juncional', 'Endométrio', 'Miométrio e miomas', 'Colo uterino', 'Ovários', 'Fundo de saco', 'Focos de endometriose', 'Linfonodos'],
    normal: 'Útero de dimensões e sinal preservados. Endométrio de espessura normal. Ovários tópicos, sem lesões. Ausência de líquido livre significativo.' },
  { id: 'RTV-MR-MAMA', title: 'RM de mamas', modality: 'MR', regions: ['Mama'],
    keywords: ['mama', 'breast', 'mamas'],
    technique: 'Sequências T1, T2 e dinâmico após gadolínio com subtração, em decúbito ventral.',
    findings: ['Composição e realce de fundo', 'Mama direita', 'Mama esquerda', 'Curva de realce', 'Linfonodos axilares', 'Categoria BI-RADS'],
    normal: 'Realce de fundo mínimo. Ausência de realce nodular ou não nodular suspeito em ambas as mamas. BI-RADS 1.' },

  // ---- Mamografia ----
  { id: 'RTV-MG-RASTREIO', title: 'Mamografia de rastreamento', modality: 'MG', regions: ['Mama'],
    keywords: ['mamografia', 'rastreamento', 'screening'],
    technique: 'Incidências craniocaudal e médio-lateral oblíqua bilaterais.',
    findings: ['Densidade mamária', 'Nódulos', 'Assimetrias', 'Distorções arquiteturais', 'Calcificações', 'Linfonodos axilares', 'Categoria BI-RADS', 'Conduta'],
    normal: 'Ausência de nódulos, distorções ou calcificações suspeitas em ambas as mamas. BI-RADS 1. Manter rastreamento de rotina.' },
  { id: 'RTV-MG-DIAGNOSTICA', title: 'Mamografia diagnóstica', modality: 'MG', regions: ['Mama'],
    keywords: ['mamografia diagnostica', 'nodulo palpavel', 'compressao'],
    technique: 'Incidências de rotina complementadas por compressão localizada e magnificação.',
    findings: ['Correlação com o achado clínico', 'Marcação cutânea', 'Nódulo', 'Calcificações', 'Distorção', 'Complemento ultrassonográfico', 'Categoria BI-RADS', 'Conduta'],
    normal: 'Sem correspondente mamográfico para o achado palpável referido. BI-RADS 1 — a ausência de achado mamográfico não exclui lesão palpável.' },

  // ---- US ----
  { id: 'RTV-US-ABDOME', title: 'US de abdome total', modality: 'US', regions: ['Abdome'],
    keywords: ['abdome total', 'ultrassom abdome', 'abdominal'],
    technique: 'Exame realizado com transdutor convexo, em jejum.',
    findings: ['Fígado', 'Vesícula biliar', 'Vias biliares', 'Pâncreas', 'Baço', 'Rins', 'Bexiga', 'Aorta', 'Líquido livre'],
    normal: 'Fígado de dimensões e ecotextura normais. Vesícula biliar sem cálculos. Rins tópicos, sem hidronefrose. Ausência de líquido livre.' },
  { id: 'RTV-US-TIREOIDE', title: 'US de tireoide', modality: 'US', regions: ['Pescoço'],
    keywords: ['tireoide', 'tireoides', 'thyroid', 'tirads'],
    technique: 'Exame com transdutor linear de alta frequência.',
    findings: ['Volume e ecotextura', 'Lobo direito', 'Lobo esquerdo', 'Istmo', 'Nódulos e categoria TI-RADS', 'Vascularização', 'Linfonodos cervicais'],
    normal: 'Tireoide de dimensões e ecotextura preservadas, sem nódulos. Ausência de linfonodomegalias cervicais.' },
  { id: 'RTV-US-MAMA', title: 'US de mamas', modality: 'US', regions: ['Mama'],
    keywords: ['ultrassom mama', 'mamaria', 'mamas'],
    technique: 'Exame bilateral com transdutor linear de alta frequência, incluindo axilas.',
    findings: ['Composição', 'Mama direita por quadrante', 'Mama esquerda por quadrante', 'Nódulos', 'Cistos', 'Ductos', 'Linfonodos axilares', 'Categoria BI-RADS'],
    normal: 'Parênquima mamário sem nódulos sólidos ou císticos. Linfonodos axilares de aspecto habitual. BI-RADS 1.' },
  { id: 'RTV-US-OBST-1T', title: 'US obstétrico de primeiro trimestre', modality: 'US', regions: ['Pelve'],
    keywords: ['obstetrico', 'primeiro trimestre', 'gestacional', 'translucencia'],
    technique: 'Exame transvaginal e/ou transabdominal.',
    findings: ['Saco gestacional', 'Vesícula vitelínica', 'Embrião e CCN', 'Batimentos cardíacos', 'Idade gestacional', 'Translucência nucal', 'Ovários e anexos', 'Corio e âmnio'],
    normal: 'Saco gestacional tópico, único, com embrião apresentando batimentos cardíacos presentes. Idade gestacional compatível.' },
  { id: 'RTV-US-OBST-23T', title: 'US obstétrico de segundo e terceiro trimestres', modality: 'US', regions: ['Pelve'],
    keywords: ['obstetrico', 'morfologico', 'terceiro trimestre', 'biometria'],
    technique: 'Exame transabdominal com biometria fetal e avaliação morfológica.',
    findings: ['Situação e apresentação', 'Biometria fetal', 'Peso fetal estimado', 'Líquido amniótico', 'Placenta e inserção', 'Cordão umbilical', 'Morfologia fetal', 'Doppler quando indicado'],
    normal: 'Feto único, vivo, com biometria adequada para a idade gestacional. Líquido amniótico em volume normal. Placenta de inserção e aspecto normais.' },
  { id: 'RTV-US-RINS', title: 'US de rins e vias urinárias', modality: 'US', regions: ['Abdome'],
    keywords: ['rins', 'vias urinarias', 'renal', 'urinario'],
    technique: 'Exame com transdutor convexo, bexiga repleta.',
    findings: ['Rim direito', 'Rim esquerdo', 'Diferenciação córtico-medular', 'Cálculos', 'Hidronefrose', 'Bexiga', 'Resíduo pós-miccional', 'Próstata quando aplicável'],
    normal: 'Rins tópicos, de dimensões normais e boa diferenciação córtico-medular, sem cálculos ou hidronefrose. Bexiga de paredes finas.' },
  { id: 'RTV-US-PELVICO', title: 'US pélvico transvaginal', modality: 'US', regions: ['Pelve'],
    keywords: ['transvaginal', 'pelvico', 'ginecologico'],
    technique: 'Exame com transdutor endocavitário.',
    findings: ['Útero', 'Endométrio', 'Miométrio', 'Colo', 'Ovário direito', 'Ovário esquerdo', 'Fundo de saco', 'Vascularização ao Doppler'],
    normal: 'Útero de dimensões e ecotextura normais. Endométrio homogêneo, de espessura adequada à fase do ciclo. Ovários de aspecto habitual.' },
  { id: 'RTV-US-CAROTIDAS', title: 'Doppler de carótidas e vertebrais', modality: 'US', regions: ['Pescoço'],
    keywords: ['carotida', 'doppler carotidas', 'vertebral'],
    technique: 'Exame com transdutor linear, modo B, Doppler colorido e espectral.',
    findings: ['Espessura médio-intimal', 'Placas ateroscleróticas', 'Grau de estenose', 'Velocidades de pico sistólico', 'Artérias vertebrais e sentido do fluxo', 'Simetria'],
    normal: 'Espessura médio-intimal preservada. Ausência de placas ou estenoses hemodinamicamente significativas. Artérias vertebrais pérvias, com fluxo anterógrado.' },
  { id: 'RTV-US-VENOSO-MMII', title: 'Doppler venoso de membros inferiores', modality: 'US', regions: ['Membros'],
    keywords: ['doppler venoso', 'trombose', 'tvp', 'membros inferiores'],
    technique: 'Exame com compressão segmentar, Doppler colorido e espectral.',
    findings: ['Veia femoral comum', 'Veia femoral', 'Veia poplítea', 'Veias da panturrilha', 'Compressibilidade', 'Trombos e extensão', 'Sistema venoso superficial', 'Refluxo'],
    normal: 'Sistema venoso profundo pérvio e compressível em toda a extensão avaliada, sem sinais de trombose. Ausência de refluxo significativo.' },

  // ---- Radiografia ----
  { id: 'RTV-RX-TORAX', title: 'Radiografia de tórax', modality: 'CR', regions: ['Tórax'],
    keywords: ['torax', 'rx torax', 'chest', 'radiografia de torax'],
    technique: 'Incidências póstero-anterior e perfil, em inspiração e ortostatismo.',
    findings: ['Parênquima pulmonar', 'Seios costofrênicos', 'Área cardíaca e índice cardiotorácico', 'Mediastino', 'Hilos pulmonares', 'Estruturas ósseas', 'Partes moles', 'Dispositivos'],
    normal: 'Campos pulmonares com transparência preservada, sem consolidações. Seios costofrênicos livres. Área cardíaca dentro dos limites da normalidade.' },
  { id: 'RTV-RX-TORAX-PED', title: 'Radiografia de tórax pediátrica', modality: 'CR', regions: ['Tórax'],
    keywords: ['torax pediatrico', 'pediatrica', 'crianca'],
    technique: 'Incidência ântero-posterior, adequada à faixa etária.',
    findings: ['Grau de insuflação', 'Parênquima pulmonar', 'Espessamento peribrônquico', 'Timo', 'Área cardíaca', 'Estruturas ósseas'],
    normal: 'Insuflação pulmonar adequada. Parênquima sem consolidações. Área cardíaca compatível com a faixa etária.' },
  { id: 'RTV-RX-ABDOME', title: 'Radiografia de abdome agudo', modality: 'CR', regions: ['Abdome'],
    keywords: ['abdome agudo', 'rx abdome', 'abdome simples'],
    technique: 'Incidências em decúbito dorsal e ortostatismo, com cúpulas diafragmáticas.',
    findings: ['Distribuição gasosa', 'Níveis hidroaéreos', 'Distensão de alças', 'Pneumoperitônio', 'Calcificações', 'Estruturas ósseas'],
    normal: 'Distribuição gasosa intestinal habitual, sem distensão de alças ou níveis hidroaéreos anormais. Ausência de pneumoperitônio.' },
  { id: 'RTV-RX-COLUNA-LOMBAR', title: 'Radiografia de coluna lombar', modality: 'CR', regions: ['Coluna'],
    keywords: ['coluna lombar', 'lombossacra', 'rx coluna'],
    technique: 'Incidências ântero-posterior e perfil.',
    findings: ['Alinhamento', 'Altura dos corpos vertebrais', 'Espaços discais', 'Osteófitos', 'Articulações sacroilíacas', 'Partes moles'],
    normal: 'Alinhamento e curvatura preservados. Corpos vertebrais de altura normal. Espaços discais conservados.' },
  { id: 'RTV-RX-JOELHO', title: 'Radiografia de joelho', modality: 'CR', regions: ['Joelho'],
    keywords: ['joelho', 'rx joelho'],
    technique: 'Incidências ântero-posterior e perfil.',
    findings: ['Interlinhas articulares', 'Osteófitos', 'Esclerose subcondral', 'Alinhamento', 'Derrame articular', 'Fraturas'],
    normal: 'Interlinhas articulares preservadas. Ausência de osteófitos, fraturas ou derrame significativo.' },
  { id: 'RTV-RX-PUNHO', title: 'Radiografia de punho e mão', modality: 'CR', regions: ['Membros'],
    keywords: ['punho', 'mao', 'wrist'],
    technique: 'Incidências ântero-posterior, perfil e oblíqua.',
    findings: ['Rádio distal', 'Ulna distal', 'Ossos do carpo', 'Escafoide', 'Metacarpos e falanges', 'Alinhamento e espaços articulares'],
    normal: 'Estruturas ósseas com trabeculado preservado, sem traços de fratura ou luxação. Espaços articulares conservados.' },
  { id: 'RTV-RX-TORNOZELO', title: 'Radiografia de tornozelo e pé', modality: 'CR', regions: ['Membros'],
    keywords: ['tornozelo', 'pe', 'ankle'],
    technique: 'Incidências ântero-posterior, perfil e oblíqua.',
    findings: ['Maléolos', 'Tálus', 'Calcâneo', 'Médio-pé', 'Metatarsos e falanges', 'Espaço tibiotalar', 'Partes moles'],
    normal: 'Ausência de traços de fratura ou luxação. Espaços articulares preservados. Partes moles sem alterações.' },
  { id: 'RTV-RX-SEIOS', title: 'Radiografia de seios da face', modality: 'CR', regions: ['Face'],
    keywords: ['seios da face', 'caldwell', 'waters'],
    technique: 'Incidências de Caldwell e Waters.',
    findings: ['Seios maxilares', 'Seios frontais', 'Células etmoidais', 'Nível hidroaéreo', 'Estruturas ósseas'],
    normal: 'Seios da face com transparência preservada, sem velamentos ou níveis hidroaéreos.' },
];

const NORMAL_FIELD_ID = 'normal_statement';

function buildTemplate(spec: TemplateSpec): ReportTemplate {
  const findings: TemplateField[] = spec.findings.map((label, i) => ({
    id: `${slug(label)}_${i}`,
    label,
    type: 'textarea',
    required: false,
  }));

  const sections: TemplateSection[] = [
    {
      name: 'technique',
      heading: 'Técnica',
      text: [],
      fields: [
        {
          id: 'technique',
          label: 'Técnica',
          type: 'textarea',
          required: true,
          defaultValue: spec.technique,
          // Asserting a technique that was not performed misdescribes the examination.
          assertive: true,
        },
      ],
    },
    {
      name: 'findings',
      heading: 'Achados',
      text: [],
      fields: [
        {
          id: NORMAL_FIELD_ID,
          label: 'Achados normais (texto padrão)',
          type: 'textarea',
          required: false,
          defaultValue: spec.normal,
          assertive: true,
        },
        ...findings,
      ],
    },
    {
      name: 'impression',
      heading: 'Impressão',
      text: [],
      fields: [{ id: 'impression', label: 'Impressão', type: 'textarea', required: true }],
    },
  ];

  return {
    id: spec.id,
    version: '1',
    title: spec.title,
    language: 'pt-BR',
    modality: [spec.modality],
    bodyRegion: spec.regions,
    sections,
    provenance: { origin: 'local' },
  };
}

function slug(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

let cache: ReportTemplate[] | null = null;

/** The built-in library. */
export function builtinTemplates(): ReportTemplate[] {
  if (!cache) {
    cache = SPECS.map(buildTemplate);
  }
  return cache;
}

export function templatesForModality(modality: string): ReportTemplate[] {
  const wanted = String(modality ?? '').trim().toUpperCase();
  return builtinTemplates().filter(t => t.modality.some(m => m.toUpperCase() === wanted));
}

export type Confidence = 'high' | 'medium' | 'low';

export interface Suggestion {
  template: ReportTemplate;
  score: number;
  confidence: Confidence;
  reasons: string[];
}

export interface SuggestionResult {
  suggestions: Suggestion[];
  /**
   * Always false. Auto-applying on modality and body part means a mis-coded study quietly
   * loads a template whose technique paragraph describes an examination that was not
   * performed.
   */
  autoApply: false;
  message: string;
}

const normalise = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/**
 * Ranked candidates, never a decision.
 *
 * `BodyPartExamined` earns no trust of its own: it is free text, often absent, and vendor
 * conventions disagree, so it contributes a point rather than selecting the answer. The
 * study description is where the useful signal usually is.
 */
export function suggestTemplates(
  context: StudyContext,
  templates: ReportTemplate[] = builtinTemplates(),
  limit = 5
): SuggestionResult {
  const modality = String(context?.modality ?? '').trim().toUpperCase();
  const description = normalise(context?.studyDescription);
  const bodyPart = normalise(context?.bodyPartExamined);

  if (!modality && !description && !bodyPart) {
    return {
      suggestions: [],
      autoApply: false,
      message: 'Sem modalidade nem descrição do estudo — nada em que basear uma sugestão.',
    };
  }

  const scored: Suggestion[] = [];
  for (const template of templates) {
    const spec = SPECS.find(s => s.id === template.id);
    const reasons: string[] = [];
    let score = 0;

    const modalityMatches = modality
      ? template.modality.some(m => m.toUpperCase() === modality)
      : false;
    if (modality && !modalityMatches) {
      continue;
    }
    if (modalityMatches) {
      score += 2;
      reasons.push(`modalidade ${modality}`);
    }

    const keywords = spec ? spec.keywords : [];
    const titleWords = normalise(template.title).split(/\s+/).filter(w => w.length > 3);
    const hit = [...keywords, ...titleWords].find(k => description.includes(normalise(k)));
    if (hit) {
      score += 3;
      reasons.push(`descrição contém "${hit}"`);
    }

    const regionHit = template.bodyRegion.find(r => bodyPart && normalise(r).includes(bodyPart));
    if (regionHit) {
      score += 1;
      reasons.push(`BodyPartExamined ${context.bodyPartExamined}`);
    }

    if (score > 0) {
      scored.push({
        template,
        score,
        confidence: score >= 5 ? 'high' : score >= 3 ? 'medium' : 'low',
        reasons,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.template.title.localeCompare(b.template.title));
  const suggestions = scored.slice(0, Math.max(1, Math.floor(Number(limit) || 5)));

  if (!suggestions.length) {
    return {
      suggestions: [],
      autoApply: false,
      message: `Nenhum template da biblioteca corresponde a ${context.modality ?? ''} ${context.studyDescription ?? ''}`.trim(),
    };
  }

  const best = suggestions[0];
  return {
    suggestions,
    autoApply: false,
    message:
      best.confidence === 'low'
        ? `Sugestão fraca (${best.template.title}): só a modalidade bateu. Confira antes de carregar.`
        : `${suggestions.length} template(s) sugerido(s); o primeiro é ${best.template.title} (${best.reasons.join(', ')}).`,
  };
}

export interface FieldValue {
  value: string;
  /** Whether the reader actually edited or confirmed this field. */
  touched: boolean;
}

export interface AssertionCheck {
  ok: boolean;
  /** Assertive fields still carrying their default, untouched. */
  unconfirmed: Array<{ id: string; label: string; text: string }>;
  message: string;
}

/**
 * Assertive defaults the reader never touched.
 *
 * The report is not complete while this list is non-empty. Every untouched negative
 * statement is a finding nobody looked for, signed into the patient's record and
 * indistinguishable from one that was actually excluded — and the text is fluent and
 * plausible, which is exactly why nobody catches it on re-reading.
 */
export function unconfirmedAssertions(
  template: ReportTemplate,
  values: Record<string, FieldValue>
): AssertionCheck {
  const unconfirmed: Array<{ id: string; label: string; text: string }> = [];
  for (const section of template?.sections ?? []) {
    for (const field of section.fields) {
      if (!field.assertive || !field.defaultValue) {
        continue;
      }
      const entry = values ? values[field.id] : undefined;
      const untouched = !entry || (!entry.touched && entry.value === field.defaultValue);
      if (untouched) {
        unconfirmed.push({ id: field.id, label: field.label, text: field.defaultValue });
      }
    }
  }

  if (!unconfirmed.length) {
    return { ok: true, unconfirmed, message: '' };
  }

  return {
    ok: false,
    unconfirmed,
    message:
      `${unconfirmed.length} texto(s) padrão não confirmado(s): ${unconfirmed.map(u => u.label).join(', ')}. ` +
      'Cada afirmação negativa que ninguém tocou é um achado que ninguém procurou, assinado no prontuário e indistinguível de um que foi de fato excluído.',
  };
}

/** Line for the template picker. */
export function describeSuggestion(suggestion: Suggestion): string {
  return `${suggestion.template.title} · ${suggestion.template.modality.join('/')} · confiança ${suggestion.confidence} (${suggestion.reasons.join(', ')})`;
}
