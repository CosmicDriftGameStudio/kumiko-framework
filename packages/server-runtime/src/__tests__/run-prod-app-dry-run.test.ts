// Dry-run + bootErrorReporter paths — no DB/Redis. envSource avoids process.exit(0).

import { describe, expect, test } from "bun:test";
import { composeEnvSchema, KumikoBootError } from "@cosmicdrift/kumiko-framework/env";
import { z } from "zod";
import { runProdApp } from "../run-prod-app";
import { makeProbeFeature, withClearedBootEnv } from "./boot-probe-fixture";

const probeFeature = makeProbeFeature({
  name: "dry-run-probe",
  table: "dry_run_probe",
  extraSetup: (r) => {
    r.envSchema(z.object({ DRY_RUN_PROBE: z.string().optional().describe("probe var") }));
  },
});

describe("runProdApp dry-run / bootErrorReporter", () => {
  withClearedBootEnv();

  test("KUMIKO_DRY_RUN_ENV=human + envSource → render + dry-run handle (no exit)", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    const envSchema = composeEnvSchema({ features: [probeFeature] });
    let handle: Awaited<ReturnType<typeof runProdApp>>;
    try {
      handle = await runProdApp({
        features: [probeFeature],
        envSchema,
        autoListen: false,
        migrations: false,
        envSource: { KUMIKO_DRY_RUN_ENV: "human" },
      });
    } finally {
      console.log = originalLog;
    }

    expect(logs.some((l) => l.includes("DRY_RUN_PROBE"))).toBe(true);
    const res = await handle!.fetch(new Request("http://test/"));
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("dry-run");
    await handle!.stop();
  });

  test("KUMIKO_DRY_RUN_ENV=json → structured dry-run output", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    const envSchema = composeEnvSchema({ features: [probeFeature] });
    try {
      const handle = await runProdApp({
        features: [probeFeature],
        envSchema,
        autoListen: false,
        migrations: false,
        envSource: { KUMIKO_DRY_RUN_ENV: "json" },
      });
      await handle.stop();
    } finally {
      console.log = originalLog;
    }
    const jsonLine = logs.find((l) => l.trimStart().startsWith("{"));
    if (!jsonLine) throw new Error(`No JSON line in logs: ${JSON.stringify(logs)}`);
    const parsed = JSON.parse(jsonLine) as {
      optional: Array<{ name: string; feature: string }>;
    };
    expect(parsed.optional).toContainEqual(
      expect.objectContaining({ name: "DRY_RUN_PROBE", feature: "dry-run-probe" }),
    );
  });

  test("unrecognized KUMIKO_DRY_RUN_ENV warns then hits envSchema parse", async () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    const envSchema = composeEnvSchema({
      features: [],
      extend: z.object({ MUST_HAVE: z.string().describe("required for test") }),
    });
    try {
      await expect(
        runProdApp({
          features: [probeFeature],
          envSchema,
          autoListen: false,
          migrations: false,
          envSource: { KUMIKO_DRY_RUN_ENV: "not-a-real-mode" },
          bootErrorReporter: (err) => {
            throw err;
          },
        }),
      ).rejects.toBeInstanceOf(KumikoBootError);
    } finally {
      console.warn = originalWarn;
    }
    expect(
      warnings.some(
        (w) => w.includes('KUMIKO_DRY_RUN_ENV="not-a-real-mode"') && w.includes("unrecognized"),
      ),
    ).toBe(true);
  });

  test("bootErrorReporter receives KumikoBootError instead of process.exit", async () => {
    const envSchema = composeEnvSchema({
      features: [],
      extend: z.object({ MUST_HAVE: z.string().describe("required for test") }),
    });
    let reported: KumikoBootError | undefined;
    await expect(
      runProdApp({
        features: [probeFeature],
        envSchema,
        autoListen: false,
        migrations: false,
        envSource: {
          // no MUST_HAVE → parseEnv throws KumikoBootError
          DATABASE_URL: "postgres://x",
          REDIS_URL: "redis://x",
        },
        bootErrorReporter: (err) => {
          reported = err;
          throw err;
        },
      }),
    ).rejects.toBeInstanceOf(KumikoBootError);
    expect(reported).toBeInstanceOf(KumikoBootError);
    expect(reported!.errors.some((e) => e.name === "MUST_HAVE")).toBe(true);
  });
});
