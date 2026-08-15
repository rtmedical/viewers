/**
 * @ohif/extension-rt-pet
 *
 * PET/CT quantification.
 *
 * - **SUV and SUL** (RTV-198): the arithmetic, and the things that make two
 *   SUVs from the same patient incomparable — uptake time, body composition
 *   and the syringe residual.
 * - **PERCIST 1.0 and TMTV** (RTV-198): measurable-before-responding, the two
 *   conditions that both have to hold, and a metabolic tumour volume that
 *   refuses to be quoted without the threshold that defined it.
 *
 * The arithmetic in here is small. Almost all of the code is the set of
 * refusals that stop a number being compared with another number it cannot be
 * compared with.
 *
 * Follows RTV-114 (extension-first, zero fork). Note this is separate from the
 * upstream `tmtv` extension, which is not modified.
 */
export * from './suv';
export * from './percist';

const id = '@ohif/extension-rt-pet';

const rtPetExtension = { id };

export { id };
export default rtPetExtension;
