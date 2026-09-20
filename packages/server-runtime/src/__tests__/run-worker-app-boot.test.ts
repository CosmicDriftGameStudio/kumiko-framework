// Boot-mode + KMS-gate tests for runWorkerApp — no real Postgres/Redis
// needed (like run-prod-app-env-source.test.ts): KUMIKO_DRY_RUN_ENV=boot
// exits BEFORE any connection, and the KMS health gate runs BEFORE
// createDbConnection/new Redis(...) — so neither path needs real infra.

import { describe, expect, spyOn, test } from "bun:test";
import type { KmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { runWorkerApp } from "../run-worker-app";
import { makeProbeFeature, withClearedBootEnv } from "./boot-probe-fixture";

const probeFeature = makeProbeFeature({
  name: "worker-boot-probe",
  table: "worker_boot_probe",
});

const DUMMY_ENV = {
  DATABASE_URL: "postgres://smoke:smoke@127.0.0.1:1/smoke",
  REDIS_URL: "redis://127.0.0.1:1",
  JWT_SECRET: "smokesmokesmokesmokesmokesmokesmokesmoke",
} as const;

describe("runWorkerApp boot-mode", () => {
  withClearedBootEnv();

  test("KUMIKO_DRY_RUN_ENV=boot returns an inert handle without opening DB/Redis", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    let handle: Awaited<ReturnType<typeof runWorkerApp>>;
    try {
      handle = await runWorkerApp({
        features: [probeFeature],
        migrations: false,
        envSource: { ...DUMMY_ENV, KUMIKO_DRY_RUN_ENV: "boot" },
      });
    } finally {
      console.log = originalLog;
    }

    expect(handle).toBeDefined();
    expect(typeof handle.stop).toBe("function");
    expect(logs.some((line) => line.includes("boot validation OK"))).toBe(true);
    await handle.stop();
  });

  test("ensureTemporalPolyfill runs even in boot-mode — Temporal is defined right after boot validation", async () => {
    // Regression pin for fw#1725: the bug that cost real time was a
    // missing polyfill call. Boot-mode boots without running any job —
    // this test only proves "the polyfill call happens"; the ordering-
    // before-composeFeatures guarantee is covered by the integration
    // test (run-worker-app.integration.test.ts) via a real job.
    const originalLog = console.log;
    console.log = () => {};
    try {
      const handle = await runWorkerApp({
        features: [probeFeature],
        migrations: false,
        envSource: { ...DUMMY_ENV, KUMIKO_DRY_RUN_ENV: "boot" },
      });
      await handle.stop();
    } finally {
      console.log = originalLog;
    }
    expect(typeof (globalThis as { Temporal?: unknown }).Temporal).toBe("object");
  });

  test("unhealthy KMS aborts boot before any DB/Redis connection is opened", async () => {
    let healthChecked = false;
    const unhealthyKms: KmsAdapter = {
      capabilities: { mode: "local-key" },
      createKey: async () => {},
      getKey: async () => {
        throw new Error("unreachable");
      },
      eraseKey: async () => {},
      health: async () => {
        healthChecked = true;
        return { ok: false, latencyMs: 3 };
      },
    };
    const originalLog = console.log;
    console.log = () => {};
    try {
      await expect(
        runWorkerApp({
          features: [probeFeature],
          migrations: false,
          kms: unhealthyKms,
          envSource: { ...DUMMY_ENV },
        }),
      ).rejects.toThrow(/KMS health check failed/);
    } finally {
      console.log = originalLog;
    }
    expect(healthChecked).toBe(true);
  });

  test("validateBootOptions reaches validateBoot — an opt-in warning fires only when passed", async () => {
    // Reach-the-boot proof, not an acceptance proof: the probe feature's
    // single "anonymous" handler makes warnOnUniqueAccessRoles emit a
    // warning naming that role, and validateBoot emits it only when the
    // option arrives (fw#3080).
    const originalLog = console.log;
    console.log = () => {};
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    const roleWarnings = (): string[] =>
      warnSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.includes('Access role "anonymous"'));
    try {
      const withOption = await runWorkerApp({
        features: [probeFeature],
        migrations: false,
        validateBootOptions: { warnOnUniqueAccessRoles: true },
        envSource: { ...DUMMY_ENV, KUMIKO_DRY_RUN_ENV: "boot" },
      });
      await withOption.stop();
      expect(roleWarnings().length).toBeGreaterThan(0);

      warnSpy.mockClear();
      const withoutOption = await runWorkerApp({
        features: [probeFeature],
        migrations: false,
        envSource: { ...DUMMY_ENV, KUMIKO_DRY_RUN_ENV: "boot" },
      });
      await withoutOption.stop();
      expect(roleWarnings()).toEqual([]);
    } finally {
      warnSpy.mockRestore();
      console.log = originalLog;
    }
  });

  test("kmsSlots: a master key that exists only as ciphertext reaches the boot probe", async () => {
    const encryptedFeature = defineFeature("worker-kms-probe", (r) => {
      r.entity(
        "note",
        createEntity({
          table: "worker_kms_probe_note",
          fields: {
            body: createTextField({ personal: false, reason: "test_fixture", encrypted: true }),
          },
        }),
      );
    });
    const originalFetch = globalThis.fetch;
    const originalLog = console.log;
    const originalInfo = console.info;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ plaintext: Buffer.alloc(32, 7).toString("base64") }), {
        status: 200,
      })) as unknown as typeof globalThis.fetch;
    console.log = () => {};
    console.info = () => {};
    const env = {
      ...DUMMY_ENV,
      KUMIKO_DRY_RUN_ENV: "boot",
      KUMIKO_SECRETS_MASTER_KEY_V1_CIPHERTEXT: "Y2lwaGVy",
      PLATFORM_KEK_KMS_KEY_ID: "key-1",
      PLATFORM_KEK_KMS_TOKEN: "token",
    };
    try {
      await expect(
        runWorkerApp({ features: [encryptedFeature], migrations: false, envSource: env }),
      ).rejects.toThrow(/no usable master key/);

      const handle = await runWorkerApp({
        features: [encryptedFeature],
        migrations: false,
        envSource: env,
        kmsSlots: ["KUMIKO_SECRETS_MASTER_KEY_V1"],
      });
      await handle.stop();
    } finally {
      globalThis.fetch = originalFetch;
      console.log = originalLog;
      console.info = originalInfo;
    }
  });
});
