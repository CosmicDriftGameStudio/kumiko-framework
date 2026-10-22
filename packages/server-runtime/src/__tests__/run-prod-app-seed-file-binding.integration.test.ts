// A file a seed uploads as pending (attachTo without entityId) is bound to the record the seed
// then writes, because the seed dispatcher runs the same save lifecycle as the API dispatcher.
// Without the binding the file keeps entity_id null and only the uploader can read it.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  configValuesTable,
  createConfigFeature,
  createConfigResolver,
} from "@cosmicdrift/kumiko-bundled-features/config";
import { createFileFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/file-foundation";
import { createFileProviderInMemoryFeature } from "@cosmicdrift/kumiko-bundled-features/file-provider-inmemory";
import { createDbConnection, selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createFileField,
  createSystemUser,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDetailHandler,
  defineFeature,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { composeEnvSchema } from "@cosmicdrift/kumiko-framework/env";
import {
  createArchivedStreamsTable,
  createEventsTable,
} from "@cosmicdrift/kumiko-framework/event-store";
import {
  createFilesFeature,
  fileRefsTable,
  fileUploadLedgerTable,
} from "@cosmicdrift/kumiko-framework/files";
import {
  createEventConsumerStateTable,
  createProjectionStateTable,
} from "@cosmicdrift/kumiko-framework/pipeline";
import { unsafeEnsureEntityTable, unsafePushTables } from "@cosmicdrift/kumiko-testing/stack";
import { type ProdAppHandle, runProdApp } from "../run-prod-app.ts";

const TENANT_ID = "00000000-0000-4000-8000-000000000001" as TenantId;
const TEST_DB = `kumiko_runprod_seedbind_${Date.now().toString(36)}`;
const ADMIN_URL = process.env["TEST_DATABASE_URL"] ?? "";
const TEST_DB_URL = ADMIN_URL.replace(/\/[^/]+$/, `/${TEST_DB}`);

const PNG_BYTES = new Uint8Array([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  ...Array(10).fill(0),
]);

const manualEntity = createEntity({
  table: "seed_binding_manuals",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
    cover: createFileField({ accept: ["png"], personal: false, reason: "is_business_data" }),
  },
});

const manualFeature = defineFeature("seed-binding", (r) => {
  r.entity({ name: "manual", ...manualEntity });
  r.writeHandler(
    defineEntityCreateHandler("manual", manualEntity, {
      access: { roles: ["SystemAdmin", "User"] },
    }),
  );
  r.queryHandler(
    defineEntityDetailHandler("manual", manualEntity, { access: { roles: ["User"] } }),
  );
});

let handle: ProdAppHandle | undefined;

beforeAll(async () => {
  if (!ADMIN_URL) throw new Error("TEST_DATABASE_URL must be set");
  const adminClient = new Bun.SQL(ADMIN_URL.replace(/\/[^/]+$/, "/postgres"));
  try {
    await adminClient.unsafe(`CREATE DATABASE "${TEST_DB}"`);
  } finally {
    await adminClient.close();
  }
  const { db, close } = createDbConnection({ url: TEST_DB_URL });
  try {
    await createEventsTable(db);
    await createArchivedStreamsTable(db);
    await createProjectionStateTable(db);
    await createEventConsumerStateTable(db);
    await unsafePushTables(db, { configValuesTable, fileRefsTable, fileUploadLedgerTable });
    await unsafeEnsureEntityTable(db, manualEntity, "manual");
  } finally {
    await close();
  }
});

afterEach(async () => {
  await handle?.stop();
  handle = undefined;
});

afterAll(async () => {
  const adminClient = new Bun.SQL(ADMIN_URL.replace(/\/[^/]+$/, "/postgres"));
  try {
    await adminClient.unsafe(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  } finally {
    await adminClient.close();
  }
});

describe("runProdApp seed file binding", () => {
  test("a pending file uploaded by a seed is bound to the record the seed writes and readable by members", async () => {
    let manualId: string | undefined;
    let fileId: string | undefined;

    handle = await runProdApp({
      features: [
        createConfigFeature(),
        createFileFoundationFeature(),
        createFileProviderInMemoryFeature(),
        createFilesFeature(),
        manualFeature,
      ],
      envSource: {
        DATABASE_URL: TEST_DB_URL,
        REDIS_URL: process.env["REDIS_URL"] ?? "redis://localhost:16379",
        JWT_SECRET: "test-runprod-secret-32-chars-min!!",
        PORT: "0",
        FILE_STORAGE_PROVIDER: "inmemory",
      },
      allowPlaintextPii: "test: file binding, not PII crypto",
      extraContext: {
        configResolver: createConfigResolver({
          appOverrides: new Map([["file-foundation:config:provider", "inmemory"]]),
        }),
      },
      envSchema: composeEnvSchema({ features: [] }),
      autoListen: false,
      migrations: false,
      seeds: [
        async ({ dispatcher, createFileRef }) => {
          const upload = await createFileRef(TENANT_ID, {
            fileName: "cover.png",
            mimeType: "image/png",
            data: PNG_BYTES,
            attachTo: { entityType: "manual", fieldName: "cover" },
          });
          if (!upload.isSuccess) throw new Error(`seed upload failed: ${upload.error.message}`);
          fileId = upload.data.id;
          const written = await dispatcher.write(
            "seed-binding:write:manual:create",
            { title: "Pump manual", cover: fileId },
            createSystemUser(TENANT_ID, ["SystemAdmin"]),
          );
          if (!written.isSuccess) throw new Error(`seed write failed: ${written.error.message}`);
          const data = written.data;
          if (typeof data !== "object" || data === null || !("id" in data)) {
            throw new Error("seed write returned no id");
          }
          manualId = String(data.id);
        },
      ],
    });

    if (!fileId || !manualId) throw new Error("seed did not run");

    const { db, close } = createDbConnection({ url: TEST_DB_URL });
    try {
      const rows = await selectMany(db, fileRefsTable, { tenantId: TENANT_ID });
      expect(rows.find((row) => row.id === fileId)?.entityId).toBe(manualId);
    } finally {
      await close();
    }

    const token = await handle.entrypoint.jwt.sign({
      id: "00000000-0000-4000-8000-0000000000aa",
      tenantId: TENANT_ID,
      roles: ["User"],
    });
    const res = await handle.fetch(
      new Request(`http://test/api/files/${fileId}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(200);
  });
});
