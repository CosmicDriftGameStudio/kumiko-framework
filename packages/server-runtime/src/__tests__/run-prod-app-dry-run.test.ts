// Dry-run + bootErrorReporter paths — no DB/Redis. envSource avoids process.exit(0).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createBooleanField,
  createEntity,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { composeEnvSchema, KumikoBootError } from "@cosmicdrift/kumiko-framework/env";
import { z } from "zod";
import { runProdApp } from "../run-prod-app";

const probeEntity = createEntity({
  fields: {
    name: createTextField({ required: true }),
    active: createBooleanField({ default: true }),
  },
  table: "dry_run_probe",
});

const probeFeature = defineFeature("dry-run-probe", (r) => {
  r.entity("widget", probeEntity);
  r.envSchema(z.object({ DRY_RUN_PROBE: z.string().optional().describe("probe var") }));
  r.queryHandler({
    name: "ping",
    schema: z.object({}),
    access: { roles: ["anonymous"] },
    handler: async () => ({ pong: true }),
  });
});

const CLEARED = ["DATABASE_URL", "REDIS_URL", "JWT_SECRET", "PORT"] as const;

describe("runProdApp dry-run / bootErrorReporter", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of CLEARED) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of CLEARED) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

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

    expect(logs.some((l) => l.includes("DRY_RUN_PROBE") || l.includes("Optional"))).toBe(true);
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
    const joined = logs.join("\n");
    expect(joined).toContain("required");
    expect(joined).toContain("optional");
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
    expect(warnings.some((w) => w.includes("unrecognized"))).toBe(true);
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
