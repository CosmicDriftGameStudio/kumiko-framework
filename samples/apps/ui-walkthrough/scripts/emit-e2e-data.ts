// Emitter for e2e/.e2e-data.json. Runs under bun, loads the full
// framework-runtime, builds the registry and writes the generateE2ESpec()
// output as JSON. Playwright's globalSetup calls this script before
// every run as a subprocess — so framework-runtime NEVER lands in the
// Playwright worker (where it collides with Playwright's expect).

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createRegistry } from "@cosmicdrift/kumiko-framework/engine";
import { generateE2ESpec } from "@cosmicdrift/kumiko-testing/helpers/e2e-generator";
import { taskFeature } from "../src/features/tasks";

const outPath = resolve(import.meta.dir, "..", "e2e", ".e2e-data.json");
const specs = generateE2ESpec(createRegistry([taskFeature]));

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(specs, null, 2), "utf8");

console.log(`[emit-e2e-data] wrote ${specs.length} spec(s) → ${outPath}`);
