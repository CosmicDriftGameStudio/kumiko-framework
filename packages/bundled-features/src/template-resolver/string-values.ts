export function stringValuesOf(record: Readonly<Record<string, unknown>>): Record<string, string> {
  const strings: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string") strings[key] = value;
  }
  return strings;
}
