// Manual plural convention for locale bundles that hold plain strings: `<base>.one` for a
// count of exactly 1, `<base>.other` for everything else (0 included).
export function pluralKey(baseKey: string, count: number): string {
  return `${baseKey}.${count === 1 ? "one" : "other"}`;
}
