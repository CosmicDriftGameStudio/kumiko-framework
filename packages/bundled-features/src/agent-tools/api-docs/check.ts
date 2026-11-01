export type ApiDocsDiff = {
  readonly missing: readonly string[];
  readonly changed: readonly string[];
  readonly extra: readonly string[];
};

const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** `expected` is what the generator produces, `actual` what is on disk. */
export function diffApiDocsOutput(
  expected: ReadonlyMap<string, string>,
  actual: ReadonlyMap<string, string>,
): ApiDocsDiff {
  const missing = [...expected.keys()].filter((path) => !actual.has(path));
  const changed = [...expected].filter(([path, content]) => {
    const onDisk = actual.get(path);
    return onDisk !== undefined && onDisk !== content;
  });
  const extra = [...actual.keys()].filter((path) => !expected.has(path));
  return {
    missing: missing.sort(byCodePoint),
    changed: changed.map(([path]) => path).sort(byCodePoint),
    extra: extra.sort(byCodePoint),
  };
}
