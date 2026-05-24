// watchAndRegenerate — file-watcher-Tests. Verifiziert: initial-Pass
// läuft synchron, file-changes triggern einen erneuten Pass mit Debounce,
// close() ist idempotent.
//
// Fixtures liegen wie bei strict-mode-diagnostics.test.ts unter
// `__tests__/.tmp-fixtures/` (gitignored), damit Node's natürliches
// `node_modules`-Hochsuchen 'zod' findet — auch wenn watch-Tests
// 'zod' nicht direct nutzen, runCodegen scant feature-files die
// `import { z } from "zod"` haben.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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

/**
 * Polls a predicate at `interval` ms until it returns true, or rejects
 * after `timeout`. Replaces fixed `setTimeout(...)` waits — those
 * implicitly assume "this many ms is enough", which is brittle on
 * loaded CI runners. The polling form converges as fast as the system
 * allows AND fails loudly with a useful message if the event never lands.
 */
async function waitFor(
  predicate: () => boolean,
  opts: { timeout?: number; interval?: number; label?: string } = {},
): Promise<void> {
  // Default 5000ms — fchokidar-FS-watch events take >2s under CI load on
  // the cdgs-runner (Memory feedback_watch_test_flaky, observed 3× in
  // a row on PR #80). 5s gives headroom without slowing the happy-path.
  const timeout = opts.timeout ?? 5000;
  const interval = opts.interval ?? 25;
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`waitFor: ${opts.label ?? "predicate"} not satisfied within ${timeout}ms`);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

const FEATURE_TEMPLATE = (featureName: string, eventName: string) => `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
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
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

export default defineFeature("orders", (r) => {
  r.defineEvent("first", z.object({ id: z.string() }));
  r.defineEvent("second", z.object({ tag: z.string() }));
});
`,
    );

    // Poll until the watcher's debounced re-run has landed. fs.watch
    // events on macOS arrive in 1-5ms; CI runners can stretch that —
    // polling adapts to the actual schedule instead of guessing a fixed
    // sleep.
    await waitFor(() => results.length >= 2, {
      timeout: 5000,
      label: "second codegen result",
    });

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
    // Negative-assertion shape: prove that .css/.md changes do NOT add
    // a codegen result. Naïve "sleep N ms then assert length stayed"
    // is racy on macOS, where fs.watch can deliver stale events from
    // pre-watcher writes after the watcher is attached. We sidestep
    // that by anchoring on a POSITIVE control: a known-triggering .ts
    // change at the end. waitFor proves the watcher is alive — so the
    // pre-trigger count is trustworthy.
    const appRoot = makeAppDir();
    writeFile(appRoot, "src/feature.ts", FEATURE_TEMPLATE("ignore-css", "evt"));

    const results: CodegenResult[] = [];
    const handle = watchAndRegenerate({
      appRoot,
      debounceMs: 30,
      onResult: (r) => results.push(r),
    });
    expect(results).toHaveLength(1);

    // Drain any stale events from the pre-watcher feature.ts write —
    // some platforms deliver these to a watcher attached after the
    // write. Long enough to outlast debounce + scheduler jitter.
    await new Promise((r) => setTimeout(r, 200));
    const baseline = results.length;

    // Non-ts writes — the regression we want to catch.
    writeFile(appRoot, "src/styles.css", `body { color: red; }`);
    writeFile(appRoot, "src/README.md", `# hi`);
    await new Promise((r) => setTimeout(r, 200));
    const afterNonTs = results.length;

    // Positive control: a .ts change MUST trigger. waitFor exits as
    // soon as the new result lands, confirming the watcher is alive.
    writeFile(appRoot, "src/feature.ts", FEATURE_TEMPLATE("ignore-css", "after"));
    await waitFor(() => results.length > afterNonTs, {
      timeout: 5000,
      label: "ts-change result after non-ts noise",
    });

    // The non-ts writes should not have advanced the count past the
    // baseline. If they did, the watcher's filter is broken.
    expect(afterNonTs).toBe(baseline);
    handle.close();
  });
});
