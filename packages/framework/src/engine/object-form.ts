// Shared helper for registrar methods that accept an Object-Form call
// (`r.entity({ name: "item", ... })`) alongside the classic positional form
// (`r.entity("item", { ... })`). Object-Form is the shape the feature-ast
// renderer emits for Designer/AI-generated code — a single object argument
// with named fields is easier to generate correctly than positional args
// whose count/order vary per method.
export function splitNamedDefinition<T extends { readonly name: string }>(
  definition: T,
): [string, Omit<T, "name">] {
  const { name, ...rest } = definition;
  return [name, rest];
}

// Shared helper for registrar methods that accept either variadic strings
// (hand-written call sites) or a single Object-Form object wrapping the
// same string array under `key` (the feature-ast renderer's canonical
// shape for Designer/AI-generated code).
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
