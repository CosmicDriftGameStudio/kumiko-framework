import type { NotificationRecordMapping } from "@cosmicdrift/kumiko-framework/engine";

function readPath(row: Readonly<Record<string, unknown>>, path: string): unknown {
  let current: unknown = row;
  for (const segment of path.split(".")) {
    if (typeof current !== "object" || current === null || !Object.hasOwn(current, segment)) {
      return undefined;
    }
    current = Object.getOwnPropertyDescriptor(current, segment)?.value;
  }
  return current;
}

// Variables whose path is missing on the row are left out, so the template
// renders them empty instead of printing "undefined".
export function mapRecordToVariables(
  mapping: NotificationRecordMapping,
  row: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const variables: Record<string, unknown> = {};
  for (const [variable, path] of Object.entries(mapping.map)) {
    const value = readPath(row, path);
    if (value !== undefined) variables[variable] = value;
  }
  return variables;
}
