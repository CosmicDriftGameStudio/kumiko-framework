// The seed-mode boot guard reads process.env (not envSource) and must fire in the
// prod and worker entrypoints before any DB/Redis connection is attempted.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { composeEnvSchema } from "@cosmicdrift/kumiko-framework/env";
import { SEED_MODE_ENV, SeedModeDisabledError } from "@cosmicdrift/kumiko-framework/event-store";
import { runProdApp } from "../run-prod-app.ts";
import { runWorkerApp } from "../run-worker-app.ts";
import { makeProbeFeature } from "./boot-probe-fixture.ts";

const noAppEnvSchema = composeEnvSchema({ features: [] });

const probeFeature = makeProbeFeature({
  name: "seed-guard-probe",
  table: "seed_guard_probe",
});

const UNREACHABLE_ENV = {
  DATABASE_URL: "postgres://smoke:smoke@127.0.0.1:1/smoke",
  REDIS_URL: "redis://127.0.0.1:1",
  JWT_SECRET: "x".repeat(32),
} as const;

const GUARDED_VARS = [SEED_MODE_ENV, "NODE_ENV"] as const;

describe("seed mode under NODE_ENV=production", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of GUARDED_VARS) saved[k] = process.env[k];
    process.env[SEED_MODE_ENV] = "1";
    process.env["NODE_ENV"] = "production";
  });
  afterEach(() => {
    for (const k of GUARDED_VARS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test("runProdApp refuses to boot", async () => {
    await expect(
      runProdApp({
        features: [probeFeature],
        envSchema: noAppEnvSchema,
        autoListen: false,
        migrations: false,
        envSource: { ...UNREACHABLE_ENV },
      }),
    ).rejects.toBeInstanceOf(SeedModeDisabledError);
  });

  test("runWorkerApp refuses to boot", async () => {
    await expect(
      runWorkerApp({
        features: [probeFeature],
        migrations: false,
        envSource: { ...UNREACHABLE_ENV },
      }),
    ).rejects.toBeInstanceOf(SeedModeDisabledError);
  });
});
