/**
 * DICOM print: scale, greyscale and the copy that leaves the system — pure core (RTV-102).
 *
 * `printLayout.ts` (RTV-140) lays images out on a film. This is what has to be true about
 * the film once it exists, and film is unusual among outputs because **it carries no
 * metadata at all**. Every other artefact the viewer produces can be interrogated later;
 * a sheet of transparent plastic cannot.
 *
 * ## A film that is not 1:1 invites a ruler
 *
 * Orthopaedic and surgical planning is done on film with a physical ruler, and the film
 * does not say what scale it was printed at. Print a hip at 87% to fit the sheet and every
 * measurement taken from it is 13% short — consistently, plausibly, and with no way for the
 * person holding the ruler to know.
 *
 * So {@link scalePlan} distinguishes "fit the film" from "true size" as different requests
 * rather than as one with a different zoom, and refuses true size when the anatomy does not
 * fit: a true-size print that silently became a fit-to-film print is the failure.
 *
 * ## The film and the screen are two different greyscales
 *
 * DICOM print has its own presentation pipeline. Printed without the presentation LUT, or
 * with the printer's default, the film has different contrast from the monitor the study
 * was read on — so the referring physician is looking at a different image and both parties
 * believe they are looking at the same one.
 *
 * ## A printed film cannot be recalled
 *
 * It is a disclosure with no delivery confirmation, no read receipt and no supersession. An
 * amended report reaches everyone who received the report; it does not reach a film in a
 * folder. {@link printDisclosure} says so, and connects to the distribution rules in
 * `distribution.ts` (RTV-110) — film is an unauthenticated channel that happens to be made
 * of plastic.
 *
 * Framework-free, no `@ohif/*`. Zero-fork per RTV-114.
 */

export type FilmSize = '8INX10IN' | '10INX12IN' | '11INX14IN' | '14INX14IN' | '14INX17IN' | 'A4' | 'A3';

/** Printable area, millimetres, after the border the printer cannot reach. */
export const FILM_DIMENSIONS_MM: Record<FilmSize, { width: number; height: number }> = {
  '8INX10IN': { width: 195, height: 248 },
  '10INX12IN': { width: 248, height: 300 },
  '11INX14IN': { width: 273, height: 350 },
  '14INX14IN': { width: 350, height: 350 },
  '14INX17IN': { width: 350, height: 426 },
  A4: { width: 200, height: 287 },
  A3: { width: 287, height: 410 },
};

export type ScaleIntent = 'fit-to-film' | 'true-size';

export const INTENT_LABELS: Record<ScaleIntent, string> = {
  'fit-to-film': 'ajustar ao filme',
  'true-size': 'tamanho real (1:1)',
};

export interface ImageExtent {
  /** Physical extent of the image content, millimetres. */
  widthMm: number;
  heightMm: number;
}

export interface ScaleResult {
  intent: ScaleIntent;
  /** Printed size divided by real size. 1 is true size. */
  scale: number;
  fits: boolean;
  ok: boolean;
  /** Whether a ruler on this film gives real millimetres. */
  measurable: boolean;
  reason?: string;
  warnings: string[];
  message: string;
}

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * How the image will be scaled onto the film.
 *
 * True size is a separate request, not a zoom setting. When the anatomy does not fit at
 * 1:1 the answer is a bigger film or a refusal — quietly shrinking it produces exactly the
 * film that gets measured with a ruler.
 */
export function scalePlan(
  image: ImageExtent,
  film: FilmSize,
  intent: ScaleIntent,
  options: { rotate?: boolean } = {}
): ScaleResult {
  const sheet = FILM_DIMENSIONS_MM[film];
  const warnings: string[] = [];

  if (!sheet) {
    return {
      intent,
      scale: NaN,
      fits: false,
      ok: false,
      measurable: false,
      reason: `Tamanho de filme desconhecido: ${String(film)}.`,
      warnings,
      message: '',
    };
  }

  const imageWidth = num(image?.widthMm);
  const imageHeight = num(image?.heightMm);
  if (!(imageWidth > 0) || !(imageHeight > 0)) {
    return {
      intent,
      scale: NaN,
      fits: false,
      ok: false,
      measurable: false,
      reason: 'Extensão física da imagem desconhecida — sem ela não há escala a calcular.',
      warnings,
      message: '',
    };
  }

  const [w, h] = options.rotate ? [imageHeight, imageWidth] : [imageWidth, imageHeight];
  const fits = w <= sheet.width && h <= sheet.height;

  if (intent === 'true-size') {
    if (!fits) {
      return {
        intent,
        scale: 1,
        fits: false,
        ok: false,
        measurable: false,
        reason:
          `A anatomia mede ${w.toFixed(0)} x ${h.toFixed(0)} mm e o filme ${film} tem ${sheet.width} x ${sheet.height} mm de área útil. ` +
          'Em tamanho real não cabe. Encolher em silêncio produz exatamente o filme que alguém mede com régua: ' +
          'a medida sai curta de forma consistente e plausível, e quem segura a régua não tem como saber.',
        warnings,
        message: '',
      };
    }
    return {
      intent,
      scale: 1,
      fits: true,
      ok: true,
      measurable: true,
      warnings,
      message: `Tamanho real em ${film}. Régua sobre este filme dá milímetros reais.`,
    };
  }

  const scale = Math.min(sheet.width / w, sheet.height / h);
  if (scale < 1) {
    warnings.push(
      `Impresso a ${(scale * 100).toFixed(0)}% do tamanho real. O filme não diz isso em lugar nenhum — ` +
        'toda medida feita com régua sobre ele sai errada nessa proporção.'
    );
  }
  return {
    intent,
    scale,
    fits: true,
    ok: true,
    measurable: Math.abs(scale - 1) < 1e-6,
    warnings,
    message: `Ajustado ao filme ${film} a ${(scale * 100).toFixed(0)}%.`,
  };
}

export interface PresentationCheck {
  ok: boolean;
  matchesDisplay: boolean;
  warnings: string[];
  reason?: string;
}

/**
 * Whether the film will look like the screen.
 *
 * DICOM print has its own presentation pipeline. Without the presentation LUT the printer
 * applies its default, and the referring physician ends up looking at a different image
 * from the one the study was read on — while both parties believe otherwise.
 */
export function checkPresentation(input: {
  /** Presentation LUT shape sent with the print job, when one was. */
  presentationLutShape?: 'IDENTITY' | 'LIN OD' | string;
  /** Whether the reading display is calibrated to GSDF. */
  displayCalibrated: boolean;
  /** Whether the printer is characterised to the same standard. */
  printerCharacterised: boolean;
  /** Window centre and width applied on screen. */
  windowCentre?: number;
  windowWidth?: number;
  /** Window baked into the print job. */
  printWindowCentre?: number;
  printWindowWidth?: number;
}): PresentationCheck {
  const warnings: string[] = [];

  if (!input?.presentationLutShape) {
    return {
      ok: false,
      matchesDisplay: false,
      warnings,
      reason:
        'Trabalho de impressão sem LUT de apresentação. A impressora aplica o padrão dela, e o médico solicitante passa a olhar ' +
        'uma imagem diferente daquela em que o estudo foi lido — com as duas partes acreditando que é a mesma.',
    };
  }

  if (!input.displayCalibrated || !input.printerCharacterised) {
    warnings.push(
      'Monitor de leitura ou impressora sem caracterização comum: mesmo com LUT, filme e tela não são a mesma escala de cinza.'
    );
  }

  const sameWindow =
    !Number.isFinite(num(input.printWindowCentre)) ||
    (num(input.printWindowCentre) === num(input.windowCentre) &&
      num(input.printWindowWidth) === num(input.windowWidth));
  if (!sameWindow) {
    warnings.push(
      `Janela impressa (${input.printWindowCentre}/${input.printWindowWidth}) difere da janela de leitura ` +
        `(${input.windowCentre}/${input.windowWidth}) — o filme mostra outro achado que não o que foi lido.`
    );
  }

  return { ok: true, matchesDisplay: warnings.length === 0, warnings };
}

export interface IdentityCheck {
  ok: boolean;
  refusals: string[];
  warnings: string[];
}

/**
 * Whether the film can be attributed to a patient.
 *
 * A film with no identity is an unidentifiable image that will be found in a folder in six
 * months. A film with identity burned in cannot be anonymised afterwards — the trade is
 * unavoidable and both sides of it belong to the person requesting the print.
 */
export function checkIdentity(input: {
  patientName?: string;
  patientId?: string;
  studyDate?: string;
  institution?: string;
  burnedIn: boolean;
}): IdentityCheck {
  const refusals: string[] = [];
  const warnings: string[] = [];

  if (!String(input?.patientName ?? '').trim() || !String(input?.patientId ?? '').trim()) {
    refusals.push(
      'Filme sem identificação do paciente. Uma folha sem nome é uma imagem inidentificável que vai aparecer numa pasta daqui a seis meses.'
    );
  }
  if (!String(input?.studyDate ?? '').trim()) {
    warnings.push('Filme sem data do exame — não dá para saber de qual estudo ele veio.');
  }
  if (!String(input?.institution ?? '').trim()) {
    warnings.push('Filme sem instituição.');
  }
  if (input?.burnedIn) {
    warnings.push(
      'Identificação queimada na imagem: o filme não pode ser anonimizado depois. É a troca inevitável da mídia impressa, e quem pede a impressão é quem a faz.'
    );
  }

  return { ok: refusals.length === 0, refusals, warnings };
}

export interface DisclosureNote {
  recallable: false;
  hasDeliveryConfirmation: false;
  message: string;
}

/**
 * What printing commits to.
 *
 * A film is a disclosure with no delivery confirmation, no read receipt and no
 * supersession. An amendment reaches everyone who received the report; it does not reach a
 * film in a folder. The same reasoning as `distribution.ts` (RTV-110): film is an
 * unauthenticated channel that happens to be made of plastic.
 */
export function printDisclosure(input: {
  reportVersion?: number;
  criticalFinding?: boolean;
}): DisclosureNote {
  const parts = [
    'Filme impresso não pode ser recolhido, corrigido nem auditado. Não há confirmação de entrega, ' +
      'não há confirmação de leitura, e uma retificação alcança quem recebeu o laudo mas não alcança um filme numa pasta.',
  ];
  if (Number.isFinite(num(input?.reportVersion))) {
    parts.push(`Este filme fica preso à versão ${input.reportVersion} do laudo.`);
  }
  if (input?.criticalFinding) {
    parts.push(
      'Achado crítico: imprimir não fecha o ciclo de comunicação — é canal sem autenticação e sem retorno, do mesmo jeito que o WhatsApp (RTV-110).'
    );
  }
  return { recallable: false, hasDeliveryConfirmation: false, message: parts.join(' ') };
}

export interface PrintJobAssessment {
  ok: boolean;
  measurable: boolean;
  blocking: string[];
  warnings: string[];
  message: string;
}

/** Everything that has to be true before the job is sent. */
export function assessPrintJob(input: {
  image: ImageExtent;
  film: FilmSize;
  intent: ScaleIntent;
  rotate?: boolean;
  presentation: Parameters<typeof checkPresentation>[0];
  identity: Parameters<typeof checkIdentity>[0];
  disclosure?: Parameters<typeof printDisclosure>[0];
}): PrintJobAssessment {
  const scale = scalePlan(input.image, input.film, input.intent, { rotate: input.rotate });
  const presentation = checkPresentation(input.presentation);
  const identity = checkIdentity(input.identity);
  const disclosure = printDisclosure(input.disclosure ?? {});

  const blocking = [
    ...(scale.ok ? [] : [scale.reason as string]),
    ...(presentation.ok ? [] : [presentation.reason as string]),
    ...identity.refusals,
  ].filter(Boolean);

  const warnings = [...scale.warnings, ...presentation.warnings, ...identity.warnings];

  return {
    ok: blocking.length === 0,
    measurable: scale.measurable,
    blocking,
    warnings,
    message: blocking.length
      ? blocking.join(' ')
      : [scale.message, ...warnings, disclosure.message].filter(Boolean).join(' '),
  };
}

/** One line for the print dialog. */
export function describePrintJob(assessment: PrintJobAssessment): string {
  return assessment.message;
}
