import {
  IMGSRC_RTIMAGE_KV,
  IMGSRC_RTIMAGE_MV,
  imgSrcBuildMetadata,
  imgSrcIsImagingDisplaySet,
  imgSrcMapDisplaySet,
  imgSrcMapDisplaySets,
  imgSrcNumber,
  imgSrcParseDicomDateTime,
  imgSrcQuantity,
  imgSrcResolveModality,
  imgSrcSoleInstanceUid,
} from './imageDetailsSource';
import {
  IMG_DISPLAY_ABSENT,
  IMG_DISPLAY_NOT_APPLICABLE,
  IMG_UNIT_STATE_DECLARED,
  IMG_VALUE_STATE_NOT_APPLICABLE,
  IMG_VALUE_STATE_PRESENT,
  imgBuildDetailRows,
  imgFindRow,
} from './imageDetails';

/* ------------------------------------------------------------------ */
/* Numbers                                                             */
/* ------------------------------------------------------------------ */

describe('imgSrcNumber: uma string vazia nao e zero', () => {
  it('le numero', () => {
    expect(imgSrcNumber(80)).toBe(80);
  });

  it('le numero em string', () => {
    expect(imgSrcNumber('80')).toBe(80);
    expect(imgSrcNumber(' 80.5 ')).toBe(80.5);
  });

  it('le valor unico em array, como o DICOM naturalizado entrega VM=1', () => {
    expect(imgSrcNumber(['80'])).toBe(80);
  });

  it('string vazia e ausencia, nao zero', () => {
    expect(imgSrcNumber('')).toBe(undefined);
    expect(imgSrcNumber('   ')).toBe(undefined);
  });

  it('texto nao numerico e ausencia', () => {
    expect(imgSrcNumber('abc')).toBe(undefined);
  });

  it('nulo, indefinido e nao finito sao ausencia', () => {
    expect(imgSrcNumber(null)).toBe(undefined);
    expect(imgSrcNumber(undefined)).toBe(undefined);
    expect(imgSrcNumber(Infinity)).toBe(undefined);
    expect(imgSrcNumber(NaN)).toBe(undefined);
  });

  it('zero declarado continua sendo zero', () => {
    expect(imgSrcNumber(0)).toBe(0);
    expect(imgSrcNumber('0')).toBe(0);
  });
});

describe('imgSrcQuantity: unidade declarada, nunca adivinhada', () => {
  it('devolve valor e unidade', () => {
    expect(imgSrcQuantity(120, 'kV')).toEqual({ value: 120, unit: 'kV' });
  });

  it('atributo ausente nao produz quantidade', () => {
    expect(imgSrcQuantity(undefined, 'kV')).toBe(undefined);
    expect(imgSrcQuantity('', 'kV')).toBe(undefined);
  });

  it('converte microampere-segundo para mAs de forma exata', () => {
    expect(imgSrcQuantity(4500, 'mAs', 1 / 1000)).toEqual({ value: 4.5, unit: 'mAs' });
  });
});

/* ------------------------------------------------------------------ */
/* Timestamps                                                          */
/* ------------------------------------------------------------------ */

describe('imgSrcParseDicomDateTime: os digitos sao preservados', () => {
  it('DA mais TM', () => {
    const at = imgSrcParseDicomDateTime('20260814', '143005');
    expect(new Date(at).toISOString()).toBe('2026-08-14T14:30:05.000Z');
  });

  it('TM fracionado e aceito, e a fracao nao muda o segundo', () => {
    const at = imgSrcParseDicomDateTime('20260814', '143005.500000');
    expect(new Date(at).toISOString()).toBe('2026-08-14T14:30:05.000Z');
  });

  it('TM curto vale como hora e minuto', () => {
    expect(new Date(imgSrcParseDicomDateTime('20260814', '1430')).toISOString()).toBe(
      '2026-08-14T14:30:00.000Z'
    );
    expect(new Date(imgSrcParseDicomDateTime('20260814', '14')).toISOString()).toBe(
      '2026-08-14T14:00:00.000Z'
    );
  });

  it('DA sem TM e meia-noite', () => {
    expect(new Date(imgSrcParseDicomDateTime('20260814')).toISOString()).toBe(
      '2026-08-14T00:00:00.000Z'
    );
  });

  it('DT num unico campo', () => {
    expect(new Date(imgSrcParseDicomDateTime('20260814143005')).toISOString()).toBe(
      '2026-08-14T14:30:05.000Z'
    );
  });

  it('data com formatacao ainda e lida', () => {
    expect(new Date(imgSrcParseDicomDateTime('2026.08.14', '14:30:05')).toISOString()).toBe(
      '2026-08-14T14:30:05.000Z'
    );
  });

  it('segundo bissexto nao descarta a aquisicao', () => {
    expect(new Date(imgSrcParseDicomDateTime('20261231', '235960')).toISOString()).toBe(
      '2026-12-31T23:59:59.000Z'
    );
  });

  it('data que nao existe e RECUSADA, nao rolada para o mes seguinte', () => {
    expect(imgSrcParseDicomDateTime('20260231', '120000')).toBe(undefined);
    expect(imgSrcParseDicomDateTime('20260431', '120000')).toBe(undefined);
  });

  it('29 de fevereiro em ano bissexto e valido', () => {
    expect(new Date(imgSrcParseDicomDateTime('20240229')).toISOString()).toBe(
      '2024-02-29T00:00:00.000Z'
    );
  });

  it('mes, dia e hora fora de faixa sao recusados', () => {
    expect(imgSrcParseDicomDateTime('20261301')).toBe(undefined);
    expect(imgSrcParseDicomDateTime('20260100')).toBe(undefined);
    expect(imgSrcParseDicomDateTime('20260814', '250000')).toBe(undefined);
    expect(imgSrcParseDicomDateTime('20260814', '006100')).toBe(undefined);
  });

  it('vazio, curto e ausente nao produzem instante', () => {
    expect(imgSrcParseDicomDateTime('')).toBe(undefined);
    expect(imgSrcParseDicomDateTime('2026')).toBe(undefined);
    expect(imgSrcParseDicomDateTime(undefined)).toBe(undefined);
    expect(imgSrcParseDicomDateTime(null)).toBe(undefined);
  });
});

/* ------------------------------------------------------------------ */
/* Modalidade                                                          */
/* ------------------------------------------------------------------ */

describe('imgSrcResolveModality: RTIMAGE e classificado pelo que o objeto declara', () => {
  it('modalidade comum passa direto', () => {
    expect(imgSrcResolveModality({ Modality: 'CT' }, {})).toBe('CT');
    expect(imgSrcResolveModality({ Modality: 'CBCT' }, {})).toBe('CBCT');
  });

  it('normaliza caixa', () => {
    expect(imgSrcResolveModality({ Modality: 'ct' }, {})).toBe('CT');
  });

  it('RTIMAGE com KVP e kV', () => {
    expect(imgSrcResolveModality({ Modality: 'RTIMAGE' }, { KVP: 120 })).toBe(IMGSRC_RTIMAGE_KV);
  });

  it('RTIMAGE com energia de feixe e sem KVP e MV', () => {
    expect(imgSrcResolveModality({ Modality: 'RTIMAGE' }, { NominalBeamEnergy: 6 })).toBe(
      IMGSRC_RTIMAGE_MV
    );
  });

  it('KVP vence quando os dois estao declarados, porque o tubo disparou', () => {
    expect(
      imgSrcResolveModality({ Modality: 'RTIMAGE' }, { KVP: 120, NominalBeamEnergy: 6 })
    ).toBe(IMGSRC_RTIMAGE_KV);
  });

  it('RTIMAGE sem parametro nenhum fica sem classificar, e o nucleo recusa a tabela', () => {
    expect(imgSrcResolveModality({ Modality: 'RTIMAGE' }, {})).toBe('RTIMAGE');
    const rows = imgBuildDetailRows({
      eventId: 'e1',
      metadata: { instanceUid: '1.2.3', modality: 'RTIMAGE' },
    });
    expect(rows.ok).toBe(false);
  });

  it('KVP vazio nao classifica como kV', () => {
    expect(imgSrcResolveModality({ Modality: 'RTIMAGE' }, { KVP: '' })).toBe('RTIMAGE');
  });

  it('a serie NAO e usada para classificar', () => {
    expect(
      imgSrcResolveModality({ Modality: 'RTIMAGE' }, { SeriesDescription: 'kV setup AP' })
    ).toBe('RTIMAGE');
  });
});

/* ------------------------------------------------------------------ */
/* O lado da previa                                                    */
/* ------------------------------------------------------------------ */

describe('imgSrcSoleInstanceUid: so afirma o que a rolagem nao pode invalidar', () => {
  it('display set de uma instancia devolve o UID dela', () => {
    expect(imgSrcSoleInstanceUid({ instances: [{ SOPInstanceUID: '1.2.3' }] })).toBe('1.2.3');
  });

  it('pilha de varias instancias NAO afirma nada', () => {
    expect(
      imgSrcSoleInstanceUid({
        instances: [{ SOPInstanceUID: '1.2.3' }, { SOPInstanceUID: '1.2.4' }],
      })
    ).toBe(undefined);
  });

  it('lista vazia nao afirma nada', () => {
    expect(imgSrcSoleInstanceUid({ instances: [] })).toBe(undefined);
  });

  it('aceita a forma de instancia unica sem array', () => {
    expect(imgSrcSoleInstanceUid({ instance: { SOPInstanceUID: '1.2.5' } })).toBe('1.2.5');
  });

  it('sem instancia, sem UID e sem display set nao afirma nada', () => {
    expect(imgSrcSoleInstanceUid({ instances: [{}] })).toBe(undefined);
    expect(imgSrcSoleInstanceUid({})).toBe(undefined);
    expect(imgSrcSoleInstanceUid(undefined)).toBe(undefined);
  });
});

/* ------------------------------------------------------------------ */
/* Mapeamento                                                          */
/* ------------------------------------------------------------------ */

function kvDisplaySet(over: Record<string, unknown> = {}) {
  return {
    Modality: 'RTIMAGE',
    displaySetInstanceUID: 'ds-1',
    instances: [
      {
        SOPInstanceUID: '1.2.3.4',
        PatientID: 'MRN-9',
        Modality: 'RTIMAGE',
        AcquisitionDate: '20260814',
        AcquisitionTime: '081500',
        RadiationMachineName: 'TrueBeam-1',
        KVP: 120,
        XRayTubeCurrent: 80,
        Exposure: 12,
        ExposureTime: 150,
        RTImageSID: 1500,
        GantryAngle: 0,
        BeamLimitingDeviceAngle: 90,
        ...over,
      },
    ],
  };
}

describe('imgSrcBuildMetadata: le o que existe e deixa faltar o que falta', () => {
  it('mapeia os parametros de kV com as unidades do padrao', () => {
    const meta = imgSrcBuildMetadata(kvDisplaySet());
    expect(meta.modality).toBe(IMGSRC_RTIMAGE_KV);
    expect(meta.instanceUid).toBe('1.2.3.4');
    expect(meta.machineName).toBe('TrueBeam-1');
    expect(meta.kvp).toEqual({ value: 120, unit: 'kV' });
    expect(meta.tubeCurrent).toEqual({ value: 80, unit: 'mA' });
    expect(meta.exposure).toEqual({ value: 12, unit: 'mAs' });
    expect(meta.exposureTime).toEqual({ value: 150, unit: 'ms' });
    expect(meta.sid).toEqual({ value: 1500, unit: 'mm' });
    expect(meta.gantryAngle).toEqual({ value: 0, unit: 'deg' });
    expect(meta.collimatorAngle).toEqual({ value: 90, unit: 'deg' });
  });

  it('os campos deliberadamente nao mapeados ficam ausentes', () => {
    const meta = imgSrcBuildMetadata(
      kvDisplaySet({ ReferencedFractionGroupNumber: 1, SourceToSurfaceDistance: 900 })
    );
    expect(meta.fractionNumber).toBe(undefined);
    expect(meta.sessionRef).toBe(undefined);
    expect(meta.ssd).toBe(undefined);
    expect(meta.imagingDose).toBe(undefined);
  });

  it('cai para as unidades em microampere quando so elas existem', () => {
    const meta = imgSrcBuildMetadata(
      kvDisplaySet({
        XRayTubeCurrent: undefined,
        XRayTubeCurrentInuA: 80000,
        Exposure: undefined,
        ExposureInuAs: 12000,
        ExposureTime: undefined,
        ExposureTimeInuS: 150000,
      })
    );
    expect(meta.tubeCurrent).toEqual({ value: 80, unit: 'mA' });
    expect(meta.exposure).toEqual({ value: 12, unit: 'mAs' });
    expect(meta.exposureTime).toEqual({ value: 150, unit: 'ms' });
  });

  it('prefere o atributo em unidade cheia quando os dois existem', () => {
    const meta = imgSrcBuildMetadata(kvDisplaySet({ Exposure: 12, ExposureInuAs: 999000 }));
    expect(meta.exposure).toEqual({ value: 12, unit: 'mAs' });
  });

  it('usa StationName quando nao ha RadiationMachineName', () => {
    const meta = imgSrcBuildMetadata(
      kvDisplaySet({ RadiationMachineName: undefined, StationName: 'CT-2' })
    );
    expect(meta.machineName).toBe('CT-2');
  });

  it('cai de AcquisitionDate para ContentDate e depois SeriesDate', () => {
    const c = imgSrcBuildMetadata(
      kvDisplaySet({
        AcquisitionDate: undefined,
        AcquisitionTime: undefined,
        ContentDate: '20260813',
        ContentTime: '070000',
      })
    );
    expect(new Date(c.acquiredAtMs).toISOString()).toBe('2026-08-13T07:00:00.000Z');
    const s = imgSrcBuildMetadata(
      kvDisplaySet({
        AcquisitionDate: undefined,
        AcquisitionTime: undefined,
        SeriesDate: '20260812',
        SeriesTime: '060000',
      })
    );
    expect(new Date(s.acquiredAtMs).toISOString()).toBe('2026-08-12T06:00:00.000Z');
  });

  it('sem nenhuma data o instante fica ausente, e nao vira agora', () => {
    const meta = imgSrcBuildMetadata(
      kvDisplaySet({ AcquisitionDate: undefined, AcquisitionTime: undefined })
    );
    expect(meta.acquiredAtMs).toBe(undefined);
  });
});

describe('imgSrcMapDisplaySet: previa so quando o viewport confirma', () => {
  it('sem UID renderizado nao ha previa', () => {
    const event = imgSrcMapDisplaySet(kvDisplaySet());
    expect(event.preview).toBe(undefined);
  });

  it('a previa e emparelhada quando o renderizado e a mesma instancia', () => {
    const event = imgSrcMapDisplaySet(kvDisplaySet(), { renderedInstanceUid: '1.2.3.4' });
    expect(event.preview).toEqual({ instanceUid: '1.2.3.4' });
  });

  it('outro UID renderizado NAO produz previa para este evento', () => {
    const event = imgSrcMapDisplaySet(kvDisplaySet(), { renderedInstanceUid: '9.9.9' });
    expect(event.preview).toBe(undefined);
  });

  it('sem identificador o evento nao e produzido', () => {
    const event = imgSrcMapDisplaySet({
      Modality: 'CT',
      instances: [{ Modality: 'CT' }],
    });
    expect(event).toBe(undefined);
  });

  it('cai para o SOPInstanceUID como eventId quando nao ha displaySetInstanceUID', () => {
    const event = imgSrcMapDisplaySet({
      Modality: 'CT',
      instances: [{ Modality: 'CT', SOPInstanceUID: '1.2.7' }],
    });
    expect(event.eventId).toBe('1.2.7');
  });

  it('leva paciente e curso quando existem', () => {
    const event = imgSrcMapDisplaySet(kvDisplaySet(), { courseId: 'curso-1' });
    expect(event.patientId).toBe('MRN-9');
    expect(event.courseId).toBe('curso-1');
  });
});

describe('imgSrcMapDisplaySets: filtra e ordena', () => {
  it('descarta o que nao e evento de imagem', () => {
    const events = imgSrcMapDisplaySets([
      kvDisplaySet(),
      { Modality: 'RTPLAN', displaySetInstanceUID: 'p', instances: [{ Modality: 'RTPLAN' }] },
      { Modality: 'RTSTRUCT', displaySetInstanceUID: 's', instances: [{ Modality: 'RTSTRUCT' }] },
      { Modality: 'RTDOSE', displaySetInstanceUID: 'd', instances: [{ Modality: 'RTDOSE' }] },
    ]);
    expect(events.length).toBe(1);
  });

  it('ordena do mais antigo para o mais novo', () => {
    const a = kvDisplaySet({ SOPInstanceUID: 'a', AcquisitionDate: '20260810' });
    a.displaySetInstanceUID = 'ds-a';
    const b = kvDisplaySet({ SOPInstanceUID: 'b', AcquisitionDate: '20260801' });
    b.displaySetInstanceUID = 'ds-b';
    const events = imgSrcMapDisplaySets([a, b]);
    expect(events.map(e => e.eventId)).toEqual(['ds-b', 'ds-a']);
  });

  it('o sem data vai para o FIM, nao para o comeco', () => {
    const dated = kvDisplaySet({ AcquisitionDate: '20260810' });
    dated.displaySetInstanceUID = 'ds-dated';
    const undated = kvDisplaySet({ AcquisitionDate: undefined, AcquisitionTime: undefined });
    undated.displaySetInstanceUID = 'ds-undated';
    const events = imgSrcMapDisplaySets([undated, dated]);
    expect(events.map(e => e.eventId)).toEqual(['ds-dated', 'ds-undated']);
  });

  it('lista vazia ou ausente devolve lista vazia', () => {
    expect(imgSrcMapDisplaySets([])).toEqual([]);
    expect(imgSrcMapDisplaySets(undefined)).toEqual([]);
  });

  it('reconhece as modalidades de imagem que o painel trata', () => {
    for (const modality of ['CT', 'DX', 'CR', 'MV', 'KV', 'CBCT', 'MVCT', 'RTIMAGE']) {
      expect(imgSrcIsImagingDisplaySet({ Modality: modality })).toBe(true);
    }
    expect(imgSrcIsImagingDisplaySet({ Modality: 'RTPLAN' })).toBe(false);
    expect(imgSrcIsImagingDisplaySet({})).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* O que o nucleo faz com o que este modulo produz                     */
/* ------------------------------------------------------------------ */

describe('imageDetailsSource ligado ao nucleo', () => {
  it('um evento de kV produz tabela com as linhas de kV informadas', () => {
    const event = imgSrcMapDisplaySet(kvDisplaySet());
    const rows = imgBuildDetailRows(event);
    expect(rows.ok).toBe(true);
    const kvp = imgFindRow(rows.value, 'kvp');
    expect(kvp.state).toBe(IMG_VALUE_STATE_PRESENT);
    expect(kvp.unitState).toBe(IMG_UNIT_STATE_DECLARED);
    expect(kvp.display).toContain('120');
  });

  it('num evento de kV a energia de feixe e NAO APLICAVEL, e nao ausente', () => {
    const event = imgSrcMapDisplaySet(kvDisplaySet());
    const rows = imgBuildDetailRows(event);
    const energy = imgFindRow(rows.value, 'beamEnergy');
    expect(energy.state).toBe(IMG_VALUE_STATE_NOT_APPLICABLE);
    expect(energy.display).toBe(IMG_DISPLAY_NOT_APPLICABLE);
  });

  it('num evento de MV as linhas de tubo sao NAO APLICAVEIS', () => {
    const mv = {
      Modality: 'RTIMAGE',
      displaySetInstanceUID: 'ds-mv',
      instances: [
        {
          SOPInstanceUID: '1.2.9',
          Modality: 'RTIMAGE',
          NominalBeamEnergy: 6,
          AcquisitionDate: '20260814',
          AcquisitionTime: '090000',
        },
      ],
    };
    const rows = imgBuildDetailRows(imgSrcMapDisplaySet(mv));
    expect(rows.ok).toBe(true);
    expect(imgFindRow(rows.value, 'kvp').state).toBe(IMG_VALUE_STATE_NOT_APPLICABLE);
    expect(imgFindRow(rows.value, 'beamEnergy').state).toBe(IMG_VALUE_STATE_PRESENT);
  });

  it('o que este modulo nao mapeia sai como NAO INFORMADO, que e verdade', () => {
    const rows = imgBuildDetailRows(imgSrcMapDisplaySet(kvDisplaySet()));
    expect(imgFindRow(rows.value, 'fractionNumber').display).toBe(IMG_DISPLAY_ABSENT);
    expect(imgFindRow(rows.value, 'sessionRef').display).toBe(IMG_DISPLAY_ABSENT);
  });

  it('a data mapeada aparece na linha de aquisicao', () => {
    const rows = imgBuildDetailRows(imgSrcMapDisplaySet(kvDisplaySet()));
    const row = imgFindRow(rows.value, 'acquiredAt');
    expect(row.state).toBe(IMG_VALUE_STATE_PRESENT);
    expect(row.display).toContain('2026');
  });
});
