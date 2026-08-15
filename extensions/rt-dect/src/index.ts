/**
 * @ohif/extension-rt-dect
 *
 * Dual-energy CT.
 *
 * - **Two-material decomposition and VMI** (RTV-87): the 2×2 solve that every
 *   other dual-energy product is a reading of, plus virtual monochromatic
 *   image synthesis with its noise cost stated.
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

const id = '@ohif/extension-rt-dect';

const rtDectExtension = { id };

export { id };
export default rtDectExtension;
