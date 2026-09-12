// Dot-form labels are indistinguishable from literal display text ("actions.open"),
// so authors mark the i18n ones explicitly; the registry is what boot validation reads.
const explicitDotFormKeys = new Set<string>();

export function i18nKey(value: string): string {
  explicitDotFormKeys.add(value);
  return value;
}

export function isExplicitDotFormKey(value: string): boolean {
  return explicitDotFormKeys.has(value);
}
