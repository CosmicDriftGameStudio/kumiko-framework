import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSchemaCli, type SchemaCliOut } from "../schema-cli";
import * as timeModule from "../time";

function captureOut(): { out: SchemaCliOut; log: string[]; err: string[] } {
  const log: string[] = [];
  const err: string[] = [];
  return { out: { log: (l) => log.push(l), err: (l) => err.push(l) }, log, err };
}

describe("runSchemaCli — Temporal polyfill", () => {
  let appCwd: string;

  afterEach(() => {
    if (appCwd) rmSync(appCwd, { recursive: true, force: true });
  });

  test("calls ensureTemporalPolyfill on every invocation", async () => {
    // runProdApp/runDevApp call ensureTemporalPolyfill() at boot; the
    // standalone CLI (migrate-db initContainer, `bun kumiko.js schema apply`)
    // never goes through that boot path. Without this, a projection rebuild's
    // tz/timestamp coercion throws "Temporal is not defined" on any runtime
    // that lacks native Temporal — deterministically, since the crashed
    // process still records the migration as applied and the rebuild is
    // never retried on the next run.
    //
    // Asserting on globalThis.Temporal directly doesn't work here: the test
    // harness's own preload (test-setup/base.preload.ts) already calls
    // ensureTemporalPolyfill() once per process, and its idempotency cache
    // (a module-level flag, not re-derived from globalThis) short-circuits
    // any later call regardless of what a test does to globalThis.Temporal in
    // between. Spying on the imported binding sidesteps that cache entirely.
    appCwd = mkdtempSync(join(tmpdir(), "kumiko-schema-cli-temporal-"));
    mkdirSync(join(appCwd, "kumiko"), { recursive: true });
    const spy = spyOn(timeModule, "ensureTemporalPolyfill");
    try {
      const cap = captureOut();
      const code = await runSchemaCli([], appCwd, cap.out);
      expect(code).toBe(0);
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
