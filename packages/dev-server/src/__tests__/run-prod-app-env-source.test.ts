// Regression: the boot-path must read the injected `envSource`, not the real
// process.env. Boot-mode (KUMIKO_DRY_RUN_ENV=boot) validates wiring + builds
// the registry, then tears down the lazy DB/Redis clients before any socket
// opens — so this runs without a real Postgres/Redis (same as the CI boot
// smoke). Before the fix, requireEnv/readEnv read process.env directly, so the
// required-var test would throw "required env var DATABASE_URL is missing" and
// the PORT test would bind the default instead of the injected port.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createBooleanField,
  createEntity,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { runProdApp } from "../run-prod-app";

const probeEntity = createEntity({
  fields: {
    name: createTextField({ required: true }),
    active: createBooleanField({ default: true }),
  },
  table: "env_source_probe",
});

const probeFeature = defineFeature("env-source-probe", (r) => {
  r.entity("widget", probeEntity);
  r.queryHandler({
    name: "ping",
    schema: z.object({}),
    access: { roles: ["anonymous"] },
    handler: async () => ({ pong: true }),
  });
});

// Cleared from process.env so the test fully controls config via envSource.
// DATABASE_URL/REDIS_URL/JWT_SECRET are required (their read throws pre-fix);
// PORT is non-throwing, cleared only so ambient PORT can't mask the second
// test's "PORT comes from envSource" assertion.
const CLEARED_VARS = ["DATABASE_URL", "REDIS_URL", "JWT_SECRET", "PORT"] as const;

const DUMMY_ENV = {
  KUMIKO_DRY_RUN_ENV: "boot",
  DATABASE_URL: "postgres://smoke:smoke@127.0.0.1:1/smoke",
  REDIS_URL: "redis://127.0.0.1:1",
  JWT_SECRET: "smokesmokesmokesmokesmokesmokesmokesmoke",
} as const;

describe("runProdApp boot-mode env-source", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of CLEARED_VARS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of CLEARED_VARS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test("boots from injected envSource even when process.env lacks the required vars", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    let handle: Awaited<ReturnType<typeof runProdApp>>;
    try {
      handle = await runProdApp({
        features: [probeFeature],
        autoListen: false,
        migrations: false,
        // REDIS_URL points at an unreachable port — boot-mode must NOT
        // construct the (eager) Redis client, so this never tries to connect.
        envSource: { ...DUMMY_ENV },
      });
    } finally {
      console.log = originalLog;
    }

    // Boot-mode with an injected envSource returns an inert dry-run handle.
    expect(handle).toBeDefined();
    expect(typeof handle.stop).toBe("function");
    // The registry was built + validated before any connection was opened.
    expect(logs.some((line) => line.includes("boot validation OK"))).toBe(true);
    await handle.stop();
  });

  test("resolves PORT from envSource, not process.env", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      const handle = await runProdApp({
        features: [probeFeature],
        autoListen: false,
        migrations: false,
        envSource: { ...DUMMY_ENV, PORT: "8123" },
      });
      await handle.stop();
    } finally {
      console.log = originalLog;
    }

    // The boot logs "booting Kumiko stack on port <port>" — pre-fix this read
    // process.env["PORT"] (deleted here) and would log the 3000 default.
    expect(logs.some((line) => line.includes("port 8123"))).toBe(true);
    expect(logs.some((line) => line.includes("port 3000"))).toBe(false);
  });
});
