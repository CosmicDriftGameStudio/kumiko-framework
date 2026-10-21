// Shared helpers for registrar methods that take a single object argument
// (`r.entity({ name: "item", ... })`).

export function splitNamedDefinition<T extends { readonly name: string }>(
  definition: T,
): [string, Omit<T, "name">] {
  const { name, ...rest } = definition;
  return [name, rest];
}

// The `(name, options)` overloads make `options` required for typed callers;
// the implementation signature has to stay optional, so untyped callers are caught here.
export function requireArgument<T>(
  value: T | undefined,
  featureName: string,
  method: string,
  argument: string,
): T {
  if (value === undefined) {
    throw new Error(`[Feature ${featureName}] r.${method}() needs its ${argument} argument`);
  }
  return value;
}

function isStringList(args: readonly unknown[]): args is readonly string[] {
  return args.every((arg) => typeof arg === "string");
}

// `optionalRequires` and `readConfig` still accept variadic strings next to a
// single object wrapping the same string array under `key`.
export function unwrapArrayForm<K extends string>(
  args: readonly [Record<K, readonly string[]>] | readonly string[],
  key: K,
): readonly string[] {
  if (isStringList(args)) return args;
  const [first] = args;
  return first[key];
}

export function isObjectArgument(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}

// Untyped JS callers bypass the types; without this check a positional call would
// register a definition built from undefined fields instead of failing.
export function throwObjectArgumentRequired(featureName: string, method: string): never {
  throw new Error(`[Feature ${featureName}] r.${method}() takes one options object`);
}
