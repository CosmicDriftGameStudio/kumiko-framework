import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composeEnvSchema } from "@cosmicdrift/kumiko-framework/env";
import { withEnv } from "@cosmicdrift/kumiko-testing/helpers";
import { runStandaloneCli, type StandaloneCliOut } from "../standalone-cli.ts";

function captureOut(): { out: StandaloneCliOut; log: string[]; err: string[] } {
  const log: string[] = [];
  const err: string[] = [];
  return { out: { log: (l) => log.push(l), err: (l) => err.push(l) }, log, err };
}

const options = { features: [], envSchema: composeEnvSchema({ features: [] }) };

describe("runStandaloneCli", () => {
  let appCwd: string;
  beforeEach(() => {
    appCwd = mkdtempSync(join(tmpdir(), "kumiko-standalone-cli-"));
  });
  afterEach(() => {
    rmSync(appCwd, { recursive: true, force: true });
  });

  test("rejects an unknown command", async () => {
    const { out, err } = captureOut();
    expect(await runStandaloneCli(["nope"], appCwd, out, options)).toBe(1);
    expect(err.join("\n")).toContain("Unknown: kumiko nope");
  });

  test("rejects a missing command", async () => {
    const { out, err } = captureOut();
    expect(await runStandaloneCli([], appCwd, out, options)).toBe(1);
    expect(err.join("\n")).toContain("Unknown: kumiko");
  });

  test("dispatches schema to the schema CLI", async () => {
    const { out, log } = captureOut();
    expect(await runStandaloneCli(["schema", "--help"], appCwd, out, options)).toBe(0);
    expect(log.join("\n")).toContain("Subcommands:");
    expect(log.join("\n")).toContain("apply");
  });

  for (const devOnly of ["generate", "baseline"]) {
    test(`rejects the development-only schema ${devOnly} in the bundle`, async () => {
      const { out, err } = captureOut();
      expect(await runStandaloneCli(["schema", devOnly, "test"], appCwd, out, options)).toBe(1);
      expect(err.join("\n")).toContain("Unknown subcommand");
      expect(err.join("\n")).toContain("bun kumiko-schema");
    });
  }

  test("keeps schema validate reachable", async () => {
    const { out, err } = captureOut();
    await runStandaloneCli(["schema", "validate"], appCwd, out, options);
    expect(err.join("\n")).not.toContain("only runs in development");
  });

  test("dispatches events to the events CLI", async () => {
    const { out, log } = captureOut();
    expect(await runStandaloneCli(["events"], appCwd, out, options)).toBe(0);
    expect(log.join("\n")).toContain("prune");
  });

  test("dispatches consumer to the consumer CLI", async () => {
    const { out, err } = captureOut();
    const code = await withEnv({ DATABASE_URL: undefined }, () =>
      runStandaloneCli(["consumer", "status", "orders"], appCwd, out, options),
    );
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("DATABASE_URL not set.");
  });
});
