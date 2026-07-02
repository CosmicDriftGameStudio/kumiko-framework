// Emitter für e2e/.e2e-data.json. Läuft unter bun, lädt die volle
// framework-runtime, baut die Registry und schreibt generateE2ESpec()-
// Output als JSON. Playwrights globalSetup ruft dieses Script vor
// jedem Run als Subprozess — dadurch landet framework-runtime NIE im
// Playwright-Worker (wo sie mit Playwrights expect kollidiert).

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createRegistry } from "@cosmicdrift/kumiko-framework/engine";
import { generateE2ESpec } from "@cosmicdrift/kumiko-framework/testing/e2e-generator";
import { taskFeature } from "../src/features/tasks";

const outPath = resolve(import.meta.dir, "..", "e2e", ".e2e-data.json");
const specs = generateE2ESpec(createRegistry([taskFeature]));

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(specs, null, 2), "utf8");

console.log(`[emit-e2e-data] wrote ${specs.length} spec(s) → ${outPath}`);
