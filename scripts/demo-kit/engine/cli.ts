#!/usr/bin/env bun
/** Demo-kit CLI — hydrate + schema validation (Phase 1). */

import { join } from "node:path";
import { hydrateDemo } from "./hydrate";
import { listDemoIds, validateDemoSchema } from "./validate-schema";

const KIT_ROOT = join(import.meta.dir, "..");

const [cmd, demoId] = Bun.argv.slice(2);

function usage(): never {
  console.error("usage: bun scripts/demo-kit/engine/cli.ts <validate|hydrate|list> [demo-id]");
  process.exit(2);
}

if (!cmd) usage();

if (cmd === "list") {
  for (const id of listDemoIds(KIT_ROOT)) console.log(id);
  process.exit(0);
}

if (!demoId) usage();

if (cmd === "validate") {
  const errors = validateDemoSchema(demoId, KIT_ROOT);
  if (errors.length > 0) {
    for (const e of errors) console.error(`✗ ${e}`);
    process.exit(1);
  }
  console.log(`✓ demo-kit validate ${demoId}`);
  process.exit(0);
}

if (cmd === "hydrate") {
  const def = hydrateDemo({ demoId, kitRoot: KIT_ROOT });
  console.log(JSON.stringify(def, null, 2));
  process.exit(0);
}

usage();
