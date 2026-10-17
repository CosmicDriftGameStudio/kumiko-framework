// Shared helpers for registrar methods that take a single object argument
// (`r.entity({ name: "item", ... })`). The positional overloads are gone; the
// runtime check below turns a leftover positional call into a pointer at the codemod.

export function splitNamedDefinition<T extends { readonly name: string }>(
  definition: T,
): [string, Omit<T, "name">] {
  const { name, ...rest } = definition;
  return [name, rest];
}

// `optionalRequires` and `readConfig` still accept variadic strings next to a
// single object wrapping the same string array under `key`.
export function unwrapArrayForm<K extends string>(
  args: readonly [Record<K, readonly string[]>] | readonly string[],
  key: K,
): readonly string[] {
  const [first] = args;
  if (typeof first === "object" && first !== null && key in first) {
    return (first as Record<K, readonly string[]>)[key];
  }
  return args as readonly string[];
}

export function isObjectArgument(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}

// Removed in the first release after 2026-10-29; until then a positional call fails with
// a pointer at the codemod instead of an obscure "undefined is not a function".
export function throwPositionalFormRemoved(featureName: string, method: string): never {
  throw new Error(
    `[Feature ${featureName}] positional r.${method}(…) removed in 0.366, run \`bun kumiko-upgrade --apply\``,
  );
}
