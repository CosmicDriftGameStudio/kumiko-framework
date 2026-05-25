// Accepts both camelCase (`tenantMembership`) and kebab-case (`tenant-membership`)
// names. Kebab is canonical for new multi-word identifiers; camelCase remains
// supported for shipped code.
export function toSnakeCase(str: string): string {
  return str.replace(/-/g, "_").replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}
