/** Line-level lcov merge for the coverage badge: per file the union of hit lines across all
 *  sources (max count per line), never the larger of two file-level LH totals. */

export type LineMap = Map<string, Map<number, number>>;

export function parseLcovLines(lcov: string, isIgnored: (file: string) => boolean): LineMap {
  const perFile: LineMap = new Map();
  for (const rec of lcov.split("end_of_record")) {
    const sf = /SF:(.+)/.exec(rec)?.[1]?.trim();
    if (!sf) continue;
    const key = sf.replace(/\\/g, "/");
    if (isIgnored(key)) continue;
    const lines = perFile.get(key) ?? new Map<number, number>();
    for (const m of rec.matchAll(/^DA:(\d+),(\d+)/gm)) {
      const line = Number(m[1]);
      const count = Number(m[2]);
      lines.set(line, Math.max(lines.get(line) ?? 0, count));
    }
    perFile.set(key, lines);
  }
  return perFile;
}

export function mergeLineCoverage(sources: readonly LineMap[]): { lines: number; hit: number } {
  let lines = 0;
  let hit = 0;
  for (const file of new Set(sources.flatMap((source) => [...source.keys()]))) {
    const merged = new Map<number, number>();
    for (const src of sources.map((source) => source.get(file))) {
      if (!src) continue;
      for (const [line, count] of src) merged.set(line, Math.max(merged.get(line) ?? 0, count));
    }
    lines += merged.size;
    hit += [...merged.values()].filter((c) => c > 0).length;
  }
  return { lines, hit };
}
