/**
 * REAL-case jest fixture for the BEV parser/geometry (trimmed).
 *
 * Source: DICOMweb hex-tag JSON of RTPLAN beam 1 "1int" (Siemens Primus,
 * Varian Eclipse export) + the matching RTIMAGE (DRR) series of the same
 * study, converted to the *naturalized* keyword form that OHIF instance
 * metadata / dcmjs produce (single values unwrapped, DS kept as strings —
 * on purpose, so tests exercise the string→Number() coercion path).
 *
 * Beam 1 highlights:
 * - MLCX with 29 leaf pairs → LeafPositionBoundaries has 30 values.
 * - CP0 carries ASYMX [-93, 48] mm, ASYMY [-182, 0] mm and 58 MLCX
 *   LeafJawPositions (bank A = first 29, bank B = last 29).
 * - CP1 is SPARSE (only ControlPointIndex + CumulativeMetersetWeight):
 *   gantry/collimator/jaws/leaves must be inherited from CP0.
 */

/** 30 boundaries = 29 leaf pairs + 1, mm at isocenter, along IEC Y for MLCX. */
export const LEAF_POSITION_BOUNDARIES: string[] = [
  '-200', '-135', '-125', '-115', '-105', '-95', '-85', '-75', '-65', '-55',
  '-45', '-35', '-25', '-15', '-5', '5', '15', '25', '35', '45',
  '55', '65', '75', '85', '95', '105', '115', '125', '135', '200',
];

/** 58 = 2 × 29 MLCX LeafJawPositions of CP0 (bank A first, then bank B). */
export const CP0_MLCX_LEAF_JAW_POSITIONS: string[] = [
  // ---- bank A (29) ----
  '-90.69', '-90.69', '-90.69', '-90.69', '-90.69', '-90.69', '-90.69',
  '-90.69', '-90.69', '-90.69', '-90.69', '-90.69', '-90.69', '-90.69',
  '-92.39',
  '47.51', '47.51', '47.51', '47.51', '47.51', '47.51', '47.51',
  '47.51', '47.51', '47.51', '47.51', '47.51', '47.51', '47.51',
  // ---- bank B (29) ----
  '3.1', '16.27', '19.17', '22.25', '25.03', '28.43', '31.85', '34.62',
  '36.97', '41.7', '44.56', '45.4', '46.82', '47.6',
  '47.51', '47.51', '47.51', '47.51', '47.51', '47.51', '47.51', '47.51',
  '47.51', '47.51', '47.51', '47.51', '47.51', '47.51', '47.51',
];

/** Naturalized RTPLAN instance (keyword tags), trimmed to what BEV needs. */
export const rtPlanInstance: Record<string, any> = {
  SOPClassUID: '1.2.840.10008.5.1.4.1.1.481.5',
  Manufacturer: 'Siemens',
  ManufacturerModelName: 'Siemens Primus',
  BeamSequence: [
    {
      TreatmentMachineName: 'Primus5770',
      PrimaryDosimeterUnit: 'MU',
      SourceAxisDistance: '1000',
      BeamLimitingDeviceSequence: [
        { RTBeamLimitingDeviceType: 'ASYMX', NumberOfLeafJawPairs: 1 },
        { RTBeamLimitingDeviceType: 'ASYMY', NumberOfLeafJawPairs: 1 },
        {
          RTBeamLimitingDeviceType: 'MLCX',
          SourceToBeamLimitingDeviceDistance: '2585',
          NumberOfLeafJawPairs: 29,
          LeafPositionBoundaries: LEAF_POSITION_BOUNDARIES,
        },
      ],
      BeamNumber: 1,
      BeamName: '1int',
      BeamType: 'STATIC',
      RadiationType: 'PHOTON',
      TreatmentDeliveryType: 'TREATMENT',
      NumberOfWedges: 0,
      NumberOfCompensators: 0,
      NumberOfBoli: 0,
      NumberOfBlocks: 0,
      FinalCumulativeMetersetWeight: '1',
      NumberOfControlPoints: 2,
      ControlPointSequence: [
        {
          ControlPointIndex: 0,
          NominalBeamEnergy: '6',
          DoseRateSet: '200',
          BeamLimitingDevicePositionSequence: [
            { RTBeamLimitingDeviceType: 'ASYMX', LeafJawPositions: ['-93', '48'] },
            { RTBeamLimitingDeviceType: 'ASYMY', LeafJawPositions: ['-182', '0'] },
            {
              RTBeamLimitingDeviceType: 'MLCX',
              LeafJawPositions: CP0_MLCX_LEAF_JAW_POSITIONS,
            },
          ],
          GantryAngle: '40',
          GantryRotationDirection: 'NONE',
          BeamLimitingDeviceAngle: '0',
          BeamLimitingDeviceRotationDirection: 'NONE',
          PatientSupportAngle: '0',
          TableTopEccentricAngle: '0',
          TableTopVerticalPosition: '0',
          IsocenterPosition: ['-108.463541543', '42.604166796', '349.699981838349'],
          SourceToSurfaceDistance: '962.606072687548',
          CumulativeMetersetWeight: '0',
        },
        {
          ControlPointIndex: 1,
          CumulativeMetersetWeight: '1',
        },
      ],
    },
  ],
};

/**
 * REAL geometry of the matching RTIMAGE (DRR referencing beam 1, gantry 40):
 * 512×512, ImagePlanePixelSpacing 0.9765625 (square), RTImagePosition
 * [-249.51171875, 249.51171875], RTImageSID = RadiationMachineSAD = 1000
 * (Eclipse DRR: plane already retro-projected to the isocenter → mag 1).
 * `pixelSpacingMm` is [xSpacing, ySpacing]; the raw ImagePlanePixelSpacing
 * attribute is [row, col] — identical here because pixels are square.
 */
export const rtImageGeometry = {
  rtImagePositionMm: [-249.51171875, 249.51171875] as [number, number],
  pixelSpacingMm: [0.9765625, 0.9765625] as [number, number],
  sidMm: 1000,
  sadMm: 1000,
};

/**
 * The same DRR as a *naturalized* RTIMAGE instance (keyword tags, DS values
 * kept as strings), trimmed to what the overlay resolution path reads —
 * `parseRtImageBevGeometry` + `referencedBeamNumber` must reproduce
 * {@link rtImageGeometry} and beam 1 from it. ReferencedBeamNumber is
 * TOP-LEVEL in this dataset (300C,0006 at the root of the RTIMAGE).
 */
export const rtImageInstance: Record<string, any> = {
  SOPClassUID: '1.2.840.10008.5.1.4.1.1.481.1',
  Modality: 'RTIMAGE',
  Rows: 512,
  Columns: 512,
  RTImageLabel: '1int',
  // Raw attribute order is [rowSpacing, colSpacing] (square here).
  ImagePlanePixelSpacing: ['0.9765625', '0.9765625'],
  RTImagePosition: ['-249.51171875', '249.51171875'],
  RadiationMachineSAD: '1000',
  RTImageSID: '1000',
  GantryAngle: '40',
  BeamLimitingDeviceAngle: '90',
  ReferencedBeamNumber: '1',
  ReferencedRTPlanSequence: [
    {
      ReferencedSOPClassUID: '1.2.840.10008.5.1.4.1.1.481.5',
      ReferencedSOPInstanceUID: '1.2.246.352.71.5.1039211570.106466.20090424083406',
    },
  ],
};
