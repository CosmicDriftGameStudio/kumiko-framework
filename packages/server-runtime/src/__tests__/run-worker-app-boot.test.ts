// Boot-mode + KMS-Gate Tests für runWorkerApp — kein echtes Postgres/Redis
// nötig (wie run-prod-app-env-source.test.ts): KUMIKO_DRY_RUN_ENV=boot
// exits VOR jeder Connection, und der KMS-Health-Gate läuft VOR
// createDbConnection/new Redis(...) — beide Pfade brauchen also keine
// echte Infra.

import { describe, expect, test } from "bun:test";
import type { KmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
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
    // Regression-Pin für fw#1725: der Bug, den es gekostet hat, war ein
    // fehlender Polyfill-Aufruf. Boot-mode bootet, ohne einen Job laufen zu
    // lassen — dieser Test beweist nur "der Polyfill-Aufruf passiert",
    // die Ordering-vor-composeFeatures-Garantie deckt der Integration-Test
    // (run-worker-app.integration.test.ts) über einen echten Job ab.
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
});
