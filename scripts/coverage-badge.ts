#!/usr/bin/env bun
/** Merges unit + integration lcov (line-level union, not per-file max — a
 *  file exercised by different lines in each suite needs the union of hit
 *  lines, not the larger of two file-level LH counts) → shields.io endpoint JSON. */

type LineMap = Map<string, Map<number, number>>;

async function parseLines(path: string): Promise<LineMap> {
  const perFile: LineMap = new Map();
  const file = Bun.file(path);
  if (!(await file.exists())) return perFile;
  const lcov = await file.text();
  for (const rec of lcov.split("end_of_record")) {
    const sf = /SF:(.+)/.exec(rec)?.[1]?.trim();
    if (!sf) continue;
    const key = sf.replace(/\\/g, "/");
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

const unit = await parseLines("coverage/unit/lcov.info");
const integ = await parseLines("coverage/integration/lcov.info");
// dom run (bunfig.dom.toml) — only suite executing the tsx-covered UI files.
const dom = await parseLines("coverage/dom/lcov.info");

let totalLf = 0;
let totalLh = 0;
for (const file of new Set([...unit.keys(), ...integ.keys(), ...dom.keys()])) {
  const lines = new Map<number, number>();
  for (const src of [unit.get(file), integ.get(file), dom.get(file)]) {
    if (!src) continue;
    for (const [line, count] of src) lines.set(line, Math.max(lines.get(line) ?? 0, count));
  }
  totalLf += lines.size;
  totalLh += [...lines.values()].filter((c) => c > 0).length;
}

const pct = totalLf ? (100 * totalLh) / totalLf : 0;
const color = pct >= 80 ? "brightgreen" : pct >= 60 ? "yellow" : "red";
const badge = { schemaVersion: 1, label: "coverage", message: `${pct.toFixed(1)}%`, color };

await Bun.write(".github/badges/coverage.json", JSON.stringify(badge));
console.log(`coverage: ${pct.toFixed(1)}% (${totalLh}/${totalLf} lines, unit+integration+dom merged)`);
