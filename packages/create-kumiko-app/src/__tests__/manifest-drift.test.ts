// Vendored manifest.json must match the source-of-truth in
// samples/apps/use-all-bundled/feature-manifest.json. The picker reads
// the vendored copy at runtime; a stale copy lets the picker show old
// features or miss new ones. Refresh with `bun run vendor:manifest`.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const VENDOR = resolve(HERE, "..", "..", "feature-manifest.json");
const SOURCE = resolve(
  HERE,
  "..",
  "..",
  "..",
  "..",
  "samples",
  "apps",
  "use-all-bundled",
  "feature-manifest.json",
);

describe("vendored manifest", () => {
  test("byte-identical to samples/apps/use-all-bundled/feature-manifest.json", () => {
    const vendor = readFileSync(VENDOR, "utf-8");
    const source = readFileSync(SOURCE, "utf-8");
    expect(vendor).toBe(source);
  });
});
