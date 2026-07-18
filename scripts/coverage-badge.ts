#!/usr/bin/env bun
/** Merges unit + integration lcov (same dedupe as analyze-coverage.ts) → shields.io endpoint JSON. */

async function totals(path: string) {
  let lf = 0;
  let lh = 0;
  const perFile = new Map<string, { lf: number; lh: number }>();
  const file = Bun.file(path);
  if (!(await file.exists())) return perFile;
  const lcov = await file.text();
  for (const rec of lcov.split("end_of_record")) {
    const sf = /SF:(.+)/.exec(rec)?.[1]?.trim();
    if (!sf) continue;
    lf = Number(/LF:(\d+)/.exec(rec)?.[1] ?? 0);
    lh = Number(/LH:(\d+)/.exec(rec)?.[1] ?? 0);
    perFile.set(sf.replace(/\\/g, "/"), { lf, lh });
  }
  return perFile;
}

const unit = await totals("coverage/unit/lcov.info");
const integ = await totals("coverage/integration/lcov.info");

let totalLf = 0;
let totalLh = 0;
for (const file of new Set([...unit.keys(), ...integ.keys()])) {
  const u = unit.get(file);
  const i = integ.get(file);
  const lf = Math.max(u?.lf ?? 0, i?.lf ?? 0);
  const lh = Math.min(lf, Math.max(u?.lh ?? 0, i?.lh ?? 0));
  totalLf += lf;
  totalLh += lh;
}

const pct = totalLf ? (100 * totalLh) / totalLf : 0;
const color = pct >= 80 ? "brightgreen" : pct >= 60 ? "yellow" : "red";
const badge = { schemaVersion: 1, label: "coverage", message: `${pct.toFixed(1)}%`, color };

await Bun.write(".github/badges/coverage.json", JSON.stringify(badge));
console.log(`coverage: ${pct.toFixed(1)}% (${totalLh}/${totalLf} lines, unit+integration merged)`);
