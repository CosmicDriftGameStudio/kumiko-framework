// A prod seed that writes through a handler using createFileRefFromBytes needs
// ctx.files on the seed dispatcher's context, same as on the HTTP path.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  configValuesTable,
  createConfigFeature,
  createConfigResolver,
} from "@cosmicdrift/kumiko-bundled-features/config";
import { fileFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/file-foundation";
import { fileProviderInMemoryFeature } from "@cosmicdrift/kumiko-bundled-features/file-provider-inmemory";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { createDbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  defineFeature,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createArchivedStreamsTable,
  createEventsTable,
} from "@cosmicdrift/kumiko-framework/event-store";
import {
  createFileRefFromBytes,
  createFilesFeature,
  fileRefsTable,
} from "@cosmicdrift/kumiko-framework/files";
import {
  createEventConsumerStateTable,
  createProjectionStateTable,
} from "@cosmicdrift/kumiko-framework/pipeline";
import { unsafePushTables } from "@cosmicdrift/kumiko-framework/stack";
import postgres from "postgres";
import * as z from "zod";
import { type ProdAppHandle, runProdApp } from "../run-prod-app.js";

const TENANT_ID = "00000000-0000-4000-8000-000000000001" as TenantId;
const TEST_DB = `kumiko_runprod_seedfiles_${Date.now().toString(36)}`;
const ADMIN_URL = process.env["TEST_DATABASE_URL"] ?? "";
const TEST_DB_URL = ADMIN_URL.replace(/\/[^/]+$/, `/${TEST_DB}`);

const PDF_BYTES = new TextEncoder().encode("%PDF-1.4 seeded");

const seedFilesProbeFeature = defineFeature("seed-files-probe", (r) => {
  r.writeHandler(
    "store",
    z.object({}),
    (_event, ctx) =>
      createFileRefFromBytes(ctx, {
        fileName: "seeded.pdf",
        mimeType: "application/pdf",
        data: PDF_BYTES,
      }),
    { access: { roles: ["SystemAdmin"] } },
  );
});

let handle: ProdAppHandle | undefined;

beforeAll(async () => {
  if (!ADMIN_URL) throw new Error("TEST_DATABASE_URL must be set");
  const adminClient = postgres(ADMIN_URL.replace(/\/[^/]+$/, "/postgres"));
  try {
    await adminClient.unsafe(`CREATE DATABASE "${TEST_DB}"`);
  } finally {
    await adminClient.end();
  }
  const { db, close } = createDbConnection(TEST_DB_URL);
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

describe("runProdApp seeds with file storage", () => {
  test("a seed can create a fileRef through a handler that uses createFileRefFromBytes", async () => {
    let seedResult: { isSuccess: boolean; message?: string } | undefined;

    handle = await runProdApp({
      features: [
        createConfigFeature(),
        fileFoundationFeature,
        fileProviderInMemoryFeature,
        createFilesFeature(),
        seedFilesProbeFeature,
      ],
      envSource: {
        DATABASE_URL: TEST_DB_URL,
        REDIS_URL: process.env["REDIS_URL"] ?? "redis://localhost:16379",
        JWT_SECRET: "test-runprod-secret-32-chars-min!!",
        PORT: "0",
      },
      allowPlaintextPii: "test: file storage wiring, not PII crypto",
      extraContext: {
        configResolver: createConfigResolver({
          appOverrides: new Map([["file-foundation:config:provider", "inmemory"]]),
        }),
      },
      autoListen: false,
      migrations: false,
      seeds: [
        async ({ dispatcher }) => {
          const result = await dispatcher.write(
            "seed-files-probe:write:store",
            {},
            createSystemUser(TENANT_ID, ["SystemAdmin"]),
          );
          seedResult = result.isSuccess
            ? { isSuccess: true }
            : { isSuccess: false, message: result.error.message };
        },
      ],
    });

    expect(seedResult).toEqual({ isSuccess: true });

    const { db, close } = createDbConnection(TEST_DB_URL);
    try {
      const rows = await selectMany(db, fileRefsTable, { tenantId: TENANT_ID });
      expect(rows.map((row) => row.fileName)).toEqual(["seeded.pdf"]);
    } finally {
      await close();
    }
  });
});
