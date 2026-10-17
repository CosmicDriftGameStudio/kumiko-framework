// A prod seed gets the same file-provider context and dispatcher options as the HTTP
// path: it can store files directly, sees handler failures, and honours effectiveFeatures.

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
import { unsafePushTables } from "@cosmicdrift/kumiko-testing/stack";
import postgres from "postgres";
import * as z from "zod";
import { type ProdAppHandle, runProdApp } from "../run-prod-app.js";

const TENANT_ID = "00000000-0000-4000-8000-000000000001" as TenantId;
const TEST_DB = `kumiko_runprod_seedfiles_${Date.now().toString(36)}`;
const ADMIN_URL = process.env["TEST_DATABASE_URL"] ?? "";
const TEST_DB_URL = ADMIN_URL.replace(/\/[^/]+$/, `/${TEST_DB}`);

const PDF_BYTES = new TextEncoder().encode("%PDF-1.4 seeded");

const seedFilesProbeFeature = defineFeature("seed-files-probe", (r) => {
  r.writeHandler({
    name: "explode",
    schema: z.object({}),
    handler: () => {
      throw new Error("handler blew up on purpose");
    },
    access: { roles: ["SystemAdmin"] },
  });
  r.writeHandler({
    name: "store",
    schema: z.object({}),
    handler: (_event, ctx) =>
      createFileRefFromBytes(ctx, {
        fileName: "seeded.pdf",
        mimeType: "application/pdf",
        data: PDF_BYTES,
      }),
    access: { roles: ["SystemAdmin"] },
  });
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

type SeedFn = NonNullable<Parameters<typeof runProdApp>[0]["seeds"]>[number];

async function bootWithSeed(
  seed: SeedFn,
  extra: Partial<Parameters<typeof runProdApp>[0]> = {},
): Promise<void> {
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
    seeds: [seed],
    ...extra,
  });
}

async function storedFileNames(): Promise<string[]> {
  const { db, close } = createDbConnection(TEST_DB_URL);
  try {
    const rows = await selectMany(db, fileRefsTable, { tenantId: TENANT_ID });
    return rows.map((row) => row.fileName).sort();
  } finally {
    await close();
  }
}

describe("runProdApp seeds with file storage", () => {
  test("a seed can create a fileRef through a handler that uses createFileRefFromBytes", async () => {
    let seedResult: { isSuccess: boolean; message?: string } | undefined;
    await bootWithSeed(async ({ dispatcher }) => {
      const result = await dispatcher.write(
        "seed-files-probe:write:store",
        {},
        createSystemUser(TENANT_ID, ["SystemAdmin"]),
      );
      seedResult = result.isSuccess
        ? { isSuccess: true }
        : { isSuccess: false, message: result.error.message };
    });

    expect(seedResult).toEqual({ isSuccess: true });
    expect(await storedFileNames()).toContain("seeded.pdf");
  });

  test("a seed creates a fileRef through deps.createFileRef without a helper handler", async () => {
    let created: { isSuccess: boolean; fileName?: string } | undefined;
    await bootWithSeed(async ({ createFileRef }) => {
      const result = await createFileRef(TENANT_ID, {
        fileName: "direct.pdf",
        mimeType: "application/pdf",
        data: PDF_BYTES,
      });
      created = result.isSuccess
        ? { isSuccess: true, fileName: result.data.fileName }
        : { isSuccess: false };
    });

    expect(created).toEqual({ isSuccess: true, fileName: "direct.pdf" });
    expect(await storedFileNames()).toContain("direct.pdf");
  });

  test("a throwing seed handler surfaces its qualified name and cause to the seed", async () => {
    let message: string | undefined;
    await bootWithSeed(async ({ dispatcher }) => {
      const result = await dispatcher.write(
        "seed-files-probe:write:explode",
        {},
        createSystemUser(TENANT_ID, ["SystemAdmin"]),
      );
      message = result.isSuccess ? undefined : result.error.message;
    });

    expect(message).toContain("seed-files-probe:write:explode");
    expect(message).toContain("handler blew up on purpose");
  });

  test("the seed dispatcher honours the app's effectiveFeatures like the entrypoint dispatcher", async () => {
    let code: string | undefined;
    await bootWithSeed(
      async ({ dispatcher }) => {
        const result = await dispatcher.write(
          "seed-files-probe:write:store",
          {},
          createSystemUser(TENANT_ID, ["SystemAdmin"]),
        );
        code = result.isSuccess ? undefined : result.error.code;
      },
      { effectiveFeatures: () => new Set(["config"]) },
    );

    expect(code).toBe("feature_disabled");
  });
});
