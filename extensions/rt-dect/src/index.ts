/**
 * @ohif/extension-rt-dect
 *
 * Dual-energy CT.
 *
 * - **Two-material decomposition and VMI** (RTV-87): the 2×2 solve that every
 *   other dual-energy product is a reading of, plus virtual monochromatic
 *   image synthesis with its noise cost stated.
 * - **Iodine map and quantification** (RTV-85): mg/mL from the iodine basis
 *   density, a noise floor below which the answer is "no iodine" rather than a
 *   small number, and a refusal to call a calcium-suspect voxel enhancing.
 * - **Virtual non-contrast** (RTV-86): the water basis as HU, with the
 *   uncertainty that makes it usable and the two refusals that keep it safe —
 *   no Agatston scoring, and no "absence excludes" for a small stone.
 * - **Material classification** (RTV-88): the dual-energy ratio as a material
 *   signature, with an attenuation floor below which it is noise, and a
 *   deliberate refusal to name the mineral of a calcium stone.
 * - **Renal stones** (RTV-89): size (window-corrected), composition and
 *   lithotripsy prediction, composed from the modules above so every caveat
 *   they established survives into the report sentence.
 * - **Urate deposition** (RTV-90): the gout study, with the five documented
 *   false positives applied as rules rather than as a footnote, and a volume
 *   that reports what it excluded.
 * - **Metal artefact reduction** (RTV-91): separating beam hardening (which a
 *   high-keV VMI fixes) from photon starvation (which it cannot), and saying
 *   which one is in front of the reader.
 *
 * The decomposition is an ill-conditioned inverse problem and the module treats
 * it as one: the condition number is computed, reported on every result, and a
 * decomposition that would amplify noise past usefulness is refused rather than
 * returned. Iodine maps (RTV-85), virtual non-contrast (RTV-86), material
 * classification (RTV-88) and stone characterisation (RTV-89) are all further
 * readings of the same two basis densities and build on this file.
 *
 * Follows RTV-114 (extension-first, zero fork).
 */
export * from './dectDecomposition';
export * from './iodineMap';
export * from './virtualNonContrast';
export * from './materialClassification';
export * from './renalStones';
export * from './urateDeposition';
export * from './metalArtifact';

const id = '@ohif/extension-rt-dect';

const rtDectExtension = { id };

export { id };
export default rtDectExtension;
