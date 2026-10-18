// extraContext factories get the env the boot runs on, including the defaults
// the declarative boot options put underneath (fileStorage -> FILE_STORAGE_PROVIDER).

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  configValuesTable,
  createConfigFeature,
  createConfigResolver,
} from "@cosmicdrift/kumiko-bundled-features/config";
import { createFileFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/file-foundation";
import { createDbConnection } from "@cosmicdrift/kumiko-framework/db";
import { FILE_STORAGE_PROVIDER_ENV } from "@cosmicdrift/kumiko-framework/engine";
import { composeEnvSchema } from "@cosmicdrift/kumiko-framework/env";
import {
  createArchivedStreamsTable,
  createEventsTable,
} from "@cosmicdrift/kumiko-framework/event-store";
import { createFilesFeature, fileRefsTable } from "@cosmicdrift/kumiko-framework/files";
import {
  createEventConsumerStateTable,
  createProjectionStateTable,
} from "@cosmicdrift/kumiko-framework/pipeline";
import { unsafePushTables } from "@cosmicdrift/kumiko-testing/stack";
import postgres from "postgres";
import { type ProdAppHandle, type RunProdAppDeps, runProdApp } from "../run-prod-app.ts";

const TEST_DB = `kumiko_runprod_extractxenv_${Date.now().toString(36)}`;
const ADMIN_URL = process.env["TEST_DATABASE_URL"] ?? "";
const TEST_DB_URL = ADMIN_URL.replace(/\/[^/]+$/, `/${TEST_DB}`);

let handle: ProdAppHandle | undefined;

beforeAll(async () => {
  if (!ADMIN_URL) throw new Error("TEST_DATABASE_URL must be set");
  const adminClient = postgres(ADMIN_URL.replace(/\/[^/]+$/, "/postgres"));
  try {
    await adminClient.unsafe(`CREATE DATABASE "${TEST_DB}"`);
  } finally {
    await adminClient.end();
  }
  const { db, close } = createDbConnection({ url: TEST_DB_URL });
  try {
    await createEventsTable(db);
    await createArchivedStreamsTable(db);
    await createProjectionStateTable(db);
    await createEventConsumerStateTable(db);
    await unsafePushTables(db, { configValuesTable, fileRefsTable });
  } finally {
    await close();
  }
});

afterEach(async () => {
  await handle?.stop();
  handle = undefined;
});

afterAll(async () => {
  const adminClient = postgres(ADMIN_URL.replace(/\/[^/]+$/, "/postgres"));
  try {
    await adminClient.unsafe(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  } finally {
    await adminClient.end();
  }
});

describe("runProdApp extraContext deps.env", () => {
  test("carries the FILE_STORAGE_PROVIDER default from the fileStorage option", async () => {
    let seenEnv: RunProdAppDeps["env"] | undefined;
    handle = await runProdApp({
      features: [createConfigFeature(), createFileFoundationFeature(), createFilesFeature()],
      fileStorage: { provider: "inmemory" },
      envSource: {
        DATABASE_URL: TEST_DB_URL,
        REDIS_URL: process.env["REDIS_URL"] ?? "redis://localhost:16379",
        JWT_SECRET: "test-runprod-secret-32-chars-min!!",
        PORT: "0",
      },
      allowPlaintextPii: "test: file storage wiring, not PII crypto",
      extraContext: (deps) => {
        seenEnv = deps.env;
        return { configResolver: createConfigResolver() };
      },
      envSchema: composeEnvSchema({ features: [] }),
      autoListen: false,
      migrations: false,
    });

    expect(seenEnv?.[FILE_STORAGE_PROVIDER_ENV]).toBe("inmemory");
  });
});
