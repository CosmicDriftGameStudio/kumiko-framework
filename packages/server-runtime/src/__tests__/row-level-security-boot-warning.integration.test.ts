// Boot warning for rowLevelSecurity "off": runProdApp and runWorkerApp log it once the boot state check passed,
// and stay silent at "on". Real Postgres + Redis; the stack databases are created once per mode.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { composeEnvSchema } from "@cosmicdrift/kumiko-framework/env";
import type { Logger } from "@cosmicdrift/kumiko-framework/logging";
import {
  setupTestStack,
  TEST_APPLICATION_ROLE,
  type TestStack,
} from "@cosmicdrift/kumiko-testing/stack";
import { runProdApp } from "../run-prod-app.ts";
import { runWorkerApp } from "../run-worker-app.ts";
import { makeProbeFeature } from "./boot-probe-fixture.ts";

const probeFeature = makeProbeFeature({ name: "rls-warning-probe", table: "rls_warning_probe" });
const ADMIN_URL = process.env["TEST_DATABASE_URL"] ?? "";
const SUFFIX = Date.now().toString(36);
const OFF_DB = `kumiko_rlswarn_off_${SUFFIX}`;
const ON_DB = `kumiko_rlswarn_on_${SUFFIX}`;
const WARNING = /Postgres row level security is not enforced/;

let offStack: TestStack;
let onStack: TestStack;
const stoppers: Array<() => Promise<void>> = [];

function recordingLogger(warnings: string[]): Logger {
  const logger: Logger = {
    info: () => undefined,
    debug: () => undefined,
    error: () => undefined,
    warn: (msg) => {
      warnings.push(msg);
    },
    child: () => logger,
  };
  return logger;
}

function envFor(dbName: string, role?: string) {
  const url = new URL(ADMIN_URL.replace(/\/[^/]+$/, `/${dbName}`));
  if (role !== undefined) url.username = role;
  return {
    DATABASE_URL: url.toString(),
    REDIS_URL: process.env["REDIS_URL"] ?? "redis://localhost:16379",
    JWT_SECRET: "test-rls-warning-secret-32-chars!!",
    PORT: "0",
  };
}

beforeAll(async () => {
  if (!ADMIN_URL) throw new Error("TEST_DATABASE_URL must be set");
  offStack = await setupTestStack({
    features: [probeFeature],
    dbName: OFF_DB,
    rowLevelSecurity: "off",
  });
  onStack = await setupTestStack({ features: [probeFeature], dbName: ON_DB });
});

afterEach(async () => {
  for (const stop of stoppers.splice(0)) await stop();
});

afterAll(async () => {
  await offStack.cleanup();
  await onStack.cleanup();
});

async function bootWorker(mode: "on" | "off", warnings: string[]): Promise<void> {
  const handle = await runWorkerApp({
    features: [probeFeature],
    rowLevelSecurity: mode,
    migrations: false,
    jobs: { queueNamePrefix: `test-rlswarn-${SUFFIX}-${mode}` },
    extraContext: { log: recordingLogger(warnings) },
    envSource: mode === "off" ? envFor(OFF_DB) : envFor(ON_DB, TEST_APPLICATION_ROLE),
  });
  stoppers.push(() => handle.stop());
}

async function bootProd(mode: "on" | "off", warnings: string[]): Promise<void> {
  const handle = await runProdApp({
    features: [probeFeature],
    rowLevelSecurity: mode,
    kmsMode: { plaintextReason: "test: row level security warning focus, not crypto" },
    envSource: mode === "off" ? envFor(OFF_DB) : envFor(ON_DB, TEST_APPLICATION_ROLE),
    envSchema: composeEnvSchema({ features: [] }),
    extraContext: { log: recordingLogger(warnings) },
    autoListen: false,
    migrations: false,
  });
  stoppers.push(() => handle.stop());
}

describe("rowLevelSecurity boot warning", () => {
  test("runWorkerApp warns at off", async () => {
    const warnings: string[] = [];
    await bootWorker("off", warnings);
    expect(warnings.filter((w) => WARNING.test(w))).toHaveLength(1);
  });

  test("runWorkerApp stays silent at on", async () => {
    const warnings: string[] = [];
    await bootWorker("on", warnings);
    expect(warnings.filter((w) => WARNING.test(w))).toHaveLength(0);
  });

  test("runProdApp warns at off", async () => {
    const warnings: string[] = [];
    await bootProd("off", warnings);
    expect(warnings.filter((w) => WARNING.test(w))).toHaveLength(1);
  });

  test("runProdApp stays silent at on", async () => {
    const warnings: string[] = [];
    await bootProd("on", warnings);
    expect(warnings.filter((w) => WARNING.test(w))).toHaveLength(0);
  });
});
