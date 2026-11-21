import { isPlainObject, propertyOf } from "@cosmicdrift/kumiko-types/type-guards";

// A chip inside a repeat row carries the bare item field name, so date item fields are listed by that name.
export function dateVariableNames(variables: Readonly<Record<string, unknown>>): readonly string[] {
  const names = new Set<string>();
  for (const [name, variable] of Object.entries(variables)) {
    if (propertyOf(variable, "type") === "date") names.add(name);
    const item = propertyOf(variable, "item");
    if (!isPlainObject(item)) continue;
    for (const [itemName, itemVariable] of Object.entries(item)) {
      if (propertyOf(itemVariable, "type") === "date") names.add(itemName);
    }
  }
  return [...names];
}
