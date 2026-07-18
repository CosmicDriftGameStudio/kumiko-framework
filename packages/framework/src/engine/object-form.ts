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
