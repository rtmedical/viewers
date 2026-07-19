import type { BrandingConfig } from './types';

/** Returns true for plain objects (excludes arrays and null). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Deep-merges `override` onto `base`, returning a NEW object (inputs are never
 * mutated). Nested plain objects are merged recursively; arrays and primitives
 * from `override` replace the base value. `undefined` override values are
 * ignored so a partial override never erases an existing base value.
 */
export function mergeBranding(
  base: BrandingConfig,
  override?: Partial<BrandingConfig>
): BrandingConfig {
  if (!override) {
    return { ...base };
  }

  const result: Record<string, unknown> = { ...base };

  for (const key of Object.keys(override)) {
    const overrideValue = (override as Record<string, unknown>)[key];
    if (overrideValue === undefined) {
      continue;
    }

    const baseValue = result[key];
    if (isPlainObject(overrideValue) && isPlainObject(baseValue)) {
      result[key] = mergeBranding(
        baseValue as BrandingConfig,
        overrideValue as Partial<BrandingConfig>
      );
    } else {
      result[key] = overrideValue;
    }
  }

  return result as BrandingConfig;
}
