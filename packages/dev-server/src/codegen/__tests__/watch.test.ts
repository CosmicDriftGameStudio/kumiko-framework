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
 *
 * `retry`/`retryIntervalMs`: for predicates gated on a native `fs.watch`
 * event, a single write only gets one chance at delivery — under macOS
 * FSEvents backlog (hundreds of concurrent recursive watches in a full
 * `bun test` run), events aren't just delayed, they're sometimes dropped
 * entirely, and Node doesn't surface a rescan signal. `retry` re-fires the
 * triggering action on a cadence so a dropped event costs one interval,
 * not the whole timeout. `retryIntervalMs` must stay well above the
 * watcher's `debounceMs` — a retry that lands mid-debounce just resets
 * the timer and can starve `fire()` forever.
 */
async function waitFor(
  predicate: () => boolean,
  opts: {
    timeout?: number;
    interval?: number;
    label?: string;
    retry?: () => void;
    retryIntervalMs?: number;
  } = {},
): Promise<void> {
  const timeout = opts.timeout ?? 5000;
  const interval = opts.interval ?? 25;
  const retryIntervalMs = opts.retryIntervalMs ?? 250;
  const deadline = Date.now() + timeout;
  let nextRetryAt = Date.now() + retryIntervalMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`waitFor: ${opts.label ?? "predicate"} not satisfied within ${timeout}ms`);
    }
    if (opts.retry && Date.now() >= nextRetryAt) {
      opts.retry();
      nextRetryAt = Date.now() + retryIntervalMs;
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

    const rewrite = () =>
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

    // Add a second event-definition by rewriting the feature.
    rewrite();

    // Poll until the watcher's debounced re-run has landed, re-touching
    // the file every 250ms in case the triggering fs.watch event was
    // dropped rather than merely delayed (see waitFor's `retry` doc).
    // Waits on the expected *state* (eventCount 2), not just a length
    // bump — writeFileSync truncates then writes, so an event fired
    // mid-write would satisfy a length-only predicate with a stale
    // (0 or 1) eventCount, especially with retries widening that window.
    try {
      await waitFor(() => results.some((r) => r.eventCount === 2), {
        timeout: 12000,
        label: "second codegen result",
        retry: rewrite,
      });
      expect(results.at(-1)?.eventCount).toBe(2);
    } finally {
      handle.close();
    }
  }, 15000);

  test("close() is idempotent", () => {
    const appRoot = makeAppDir();
    writeFile(appRoot, "src/feature.ts", FEATURE_TEMPLATE("nope", "evt"));
    const handle = watchAndRegenerate({ appRoot, onResult: () => {} });
    handle.close();
    expect(() => handle.close()).not.toThrow();
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
    // Re-touched on retry in case the triggering event is dropped
    // rather than merely delayed under a loaded fs.watch backlog.
    const triggerRewrite = () =>
      writeFile(appRoot, "src/feature.ts", FEATURE_TEMPLATE("ignore-css", "after"));
    triggerRewrite();
    await waitFor(() => results.length > afterNonTs, {
      timeout: 12000,
      label: "ts-change result after non-ts noise",
      retry: triggerRewrite,
    });

    // The non-ts writes should not have advanced the count past the
    // baseline. If they did, the watcher's filter is broken.
    expect(afterNonTs).toBe(baseline);
    handle.close();
  }, 15000);
});
