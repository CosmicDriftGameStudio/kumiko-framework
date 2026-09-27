/** Reads `[test].coveragePathIgnorePatterns` from a bunfig TOML and matches paths
 *  against it — the source of truth bun itself enforces for `bun test --coverage`. */

interface ParsedBunfig {
  readonly test?: {
    readonly coveragePathIgnorePatterns?: unknown;
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export async function readCoverageIgnorePatterns(bunfigPath: string): Promise<string[]> {
  const raw = await Bun.file(bunfigPath).text();
  const parsed: ParsedBunfig = Bun.TOML.parse(raw);
  const patterns = parsed.test?.coveragePathIgnorePatterns;
  if (!isStringArray(patterns)) {
    throw new Error(
      `${bunfigPath}: [test].coveragePathIgnorePatterns is missing or not a string[]`,
    );
  }
  return patterns;
}

export function isIgnoredCoverageFile(path: string, patterns: readonly string[]): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
  return patterns.some((pattern) => new Bun.Glob(pattern).match(normalized));
}
