// watchAndRegenerate — file-watcher-Tests. Verifiziert: initial-Pass
// läuft synchron, file-changes triggern einen erneuten Pass mit Debounce,
// close() ist idempotent.
//
// Fixtures liegen wie bei strict-mode-diagnostics.test.ts unter
// `__tests__/.tmp-fixtures/` (gitignored), damit Node's natürliches
// `node_modules`-Hochsuchen 'zod' findet — auch wenn watch-Tests
// 'zod' nicht direct nutzen, runCodegen scant feature-files die
// `import { z } from "zod"` haben.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import type { CodegenResult } from "../run-codegen";
import { watchAndRegenerate } from "../watch";

const TEST_FIXTURE_DIR = join(__dirname, ".tmp-fixtures");
const createdDirs: string[] = [];

function makeAppDir(): string {
  mkdirSync(TEST_FIXTURE_DIR, { recursive: true });
  const dir = mkdtempSync(join(TEST_FIXTURE_DIR, "watch-"));
  createdDirs.push(dir);
  return dir;
}

function writeFile(dir: string, relPath: string, content: string): string {
  const full = join(dir, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, "utf-8");
  return full;
}

afterAll(() => {
  for (const d of createdDirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

const FEATURE_TEMPLATE = (featureName: string, eventName: string) => `
import { defineFeature } from "@kumiko/framework/engine";
import { z } from "zod";

export default defineFeature("${featureName}", (r) => {
  r.defineEvent("${eventName}", z.object({ id: z.string() }));
});
`;

describe("watchAndRegenerate", () => {
  test("initial run produces output synchronously", () => {
    const appRoot = makeAppDir();
    writeFile(appRoot, "src/feature.ts", FEATURE_TEMPLATE("billing", "first-event"));

    const results: CodegenResult[] = [];
    const handle = watchAndRegenerate({
      appRoot,
      onResult: (r) => results.push(r),
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.eventCount).toBe(1);
    handle.close();
  });

  test("file change triggers a re-run after debounce", async () => {
    const appRoot = makeAppDir();
    writeFile(appRoot, "src/feature.ts", FEATURE_TEMPLATE("orders", "first"));

    const results: CodegenResult[] = [];
    const handle = watchAndRegenerate({
      appRoot,
      debounceMs: 30,
      onResult: (r) => results.push(r),
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.eventCount).toBe(1);

    // Add a second event-definition by rewriting the feature.
    writeFile(
      appRoot,
      "src/feature.ts",
      `
import { defineFeature } from "@kumiko/framework/engine";
import { z } from "zod";

export default defineFeature("orders", (r) => {
  r.defineEvent("first", z.object({ id: z.string() }));
  r.defineEvent("second", z.object({ tag: z.string() }));
});
`,
    );

    // Wait for debounce + a small slack — fs.watch-events on macOS land
    // within 1-5ms, but the OS scheduler can stretch this under load.
    await new Promise((r) => setTimeout(r, 200));

    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.at(-1)?.eventCount).toBe(2);
    handle.close();
  });

  test("close() is idempotent", () => {
    const appRoot = makeAppDir();
    writeFile(appRoot, "src/feature.ts", FEATURE_TEMPLATE("nope", "evt"));
    const handle = watchAndRegenerate({ appRoot, onResult: () => {} });
    handle.close();
    handle.close(); // must not throw
    expect(true).toBe(true);
  });

  test("non-ts file changes do not trigger codegen", async () => {
    const appRoot = makeAppDir();
    writeFile(appRoot, "src/feature.ts", FEATURE_TEMPLATE("ignore-css", "evt"));

    const results: CodegenResult[] = [];
    const handle = watchAndRegenerate({
      appRoot,
      debounceMs: 30,
      onResult: (r) => results.push(r),
    });
    expect(results).toHaveLength(1);

    writeFile(appRoot, "src/styles.css", `body { color: red; }`);
    writeFile(appRoot, "src/README.md", `# hi`);

    await new Promise((r) => setTimeout(r, 150));
    expect(results).toHaveLength(1); // no extra codegen
    handle.close();
  });
});
