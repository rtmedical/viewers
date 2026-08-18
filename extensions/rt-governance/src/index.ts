/**
 * @ohif/extension-rt-governance
 *
 * Access governance for OHIF v3: who may open a study (**RTV-193**) and an auditable
 * record of what they did with it (**RTV-206**).
 *
 * Both are pure policy: a deny-by-default access decision with a machine-readable
 * reason, and an audit event that carries structured fields only — no free text, so
 * there is no PHI to scrub.
 *
 * Follows RTV-114 (extension-first, zero fork).
 */
export * from './accessPolicy';
export * from './auditLog';

const id = '@ohif/extension-rt-governance';

const rtGovernanceExtension = { id };

export { id };
export default rtGovernanceExtension;
export * from './adminGovernance';
