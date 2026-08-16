/**
 * @ohif/extension-thorax-abdomen
 *
 * Thorax & abdomen analysis for OHIF v3.
 *
 * - **Lung-RADS v2022** (RTV-68): turning a measured pulmonary nodule into a
 *   category and a management recommendation.
 *
 * The detection half of RTV-68 is a MONAI sidecar and is not in this
 * repository. What is here is the half that decides what happens to the
 * patient — and the parts of it that are easy to get wrong: the mean diameter
 * is rounded the way the standard rounds it, part-solid nodules are classified
 * by their solid component and not their total size, and a nodule cannot be
 * classified at all without knowing whether it is new, at baseline, or being
 * followed.
 *
 * Follows RTV-114 (extension-first, zero fork).
 */
export * from './lungRads';
export * from './virtualEndoscopy';
export * from './abdominalOrgans';
export * from './aorticDiameter';
export * from './muscleIndex';
export * from './airwayMetrics';

const id = '@ohif/extension-thorax-abdomen';

const thoraxAbdomenExtension = { id };

export { id };
export default thoraxAbdomenExtension;
