#!/usr/bin/env bun
// biome-ignore-all lint/suspicious/noConsole: CLI-Script.
//
// Vendors samples/apps/use-all-bundled/feature-manifest.json into this
// package as manifest.json. The published package can't reach the
// sample-app at runtime (different workspace), so we checked-in copy.
// CI drift-test (manifest-drift.test.ts) fails when source and vendor
// diverge — run `bun run vendor:manifest` to refresh.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(
  HERE,
  "..",
  "..",
  "..",
  "samples",
  "apps",
  "use-all-bundled",
  "feature-manifest.json",
);
const VENDOR = resolve(HERE, "..", "feature-manifest.json");

const content = readFileSync(SOURCE, "utf-8");
writeFileSync(VENDOR, content);
console.log(`vendored ${SOURCE}\n      → ${VENDOR}`);
