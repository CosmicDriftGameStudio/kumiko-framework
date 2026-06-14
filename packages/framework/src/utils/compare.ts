// Locale-independent string ordering for sorts that feed byte-exact serialized
// artifacts (manifest JSON, snapshot.json, generated migration SQL). Unlike
// String.localeCompare — whose order depends on the runner's ICU locale and so
// can drift between a macOS dev box and Linux CI (#330) — this compares by
// UTF-16 code unit, which is stable across machines and, for the BMP identifier
// strings we sort here (table / column / feature / qualified names), equals
// codepoint order.
export function compareByCodepoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
