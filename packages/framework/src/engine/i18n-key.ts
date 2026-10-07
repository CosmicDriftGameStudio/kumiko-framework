// Dot-form labels are indistinguishable from literal display text ("actions.open"),
// so authors mark the i18n ones explicitly; the registry is what boot validation reads.
// Marking is by string value and therefore global across features. The registry sits on
// globalThis so a second installed copy of the framework still reads the marks the
// other copy wrote; otherwise they are silently ignored and #2313 reopens.
const REGISTRY_KEY = Symbol.for("kumiko.i18n.explicitDotFormKeys");

function explicitDotFormKeys(): Set<string> {
  const existing: unknown = Reflect.get(globalThis, REGISTRY_KEY);
  if (existing instanceof Set) return existing;
  const created = new Set<string>();
  Reflect.set(globalThis, REGISTRY_KEY, created);
  return created;
}

export function i18nKey(value: string): string {
  explicitDotFormKeys().add(value);
  return value;
}

export function isExplicitDotFormKey(value: string): boolean {
  return explicitDotFormKeys().has(value);
}
