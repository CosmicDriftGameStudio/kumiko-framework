// Shared helpers for registrar methods that take a single object argument
// (`r.entity({ name: "item", ... })`).

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

// Untyped JS callers bypass the types; without this check a positional call would
// register a definition built from undefined fields instead of failing.
export function throwObjectArgumentRequired(featureName: string, method: string): never {
  throw new Error(`[Feature ${featureName}] r.${method}() takes one options object`);
}
