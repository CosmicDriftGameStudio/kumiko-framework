// Prod seeds receive the boot registry and a system dispatcher: a seed that
// writes through `dispatcher.write` goes through the full pipeline (event
// stream + read model), which a raw `db` insert would bypass. Real Postgres +
// Redis, real /api/query call.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createDbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createSystemUser,
  createTextField,
  defineEntityCreateHandler,
  defineEntityListHandler,
  defineFeature,
  type Registry,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createArchivedStreamsTable,
  createEventsTable,
  getStreamVersion,
} from "@cosmicdrift/kumiko-framework/event-store";
import {
  createEventConsumerStateTable,
  createProjectionStateTable,
} from "@cosmicdrift/kumiko-framework/pipeline";
import { unsafeEnsureEntityTable } from "@cosmicdrift/kumiko-framework/stack";
import postgres from "postgres";
import { type ProdAppHandle, runProdApp } from "../run-prod-app.js";

const TENANT_ID = "00000000-0000-4000-8000-000000000001" as TenantId;
const TEST_DB = `kumiko_runprod_seeddeps_${Date.now().toString(36)}`;
const ADMIN_URL = process.env["TEST_DATABASE_URL"] ?? "";
const TEST_DB_URL = ADMIN_URL.replace(/\/[^/]+$/, `/${TEST_DB}`);

const seededNoteEntity = createEntity({
  fields: { title: createTextField({ personal: false, reason: "test_fixture", required: true }) },
  table: "seed_deps_notes",
});

const seedProbeFeature = defineFeature("seed-probe", (r) => {
  r.entity("note", seededNoteEntity);
  r.writeHandler(
    defineEntityCreateHandler("note", seededNoteEntity, {
      access: { roles: ["SystemAdmin", "User"] },
    }),
  );
  r.queryHandler(
    defineEntityListHandler("note", seededNoteEntity, { access: { roles: ["User"] } }),
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
    await unsafeEnsureEntityTable(db, seededNoteEntity, "note");
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

describe("runProdApp seeds", () => {
  test("a seed gets the boot registry and a dispatcher that writes through the pipeline", async () => {
    let seenRegistry: Registry | undefined;
    let createdId: string | undefined;

    handle = await runProdApp({
      features: [seedProbeFeature],
      envSource: {
        DATABASE_URL: TEST_DB_URL,
        REDIS_URL: process.env["REDIS_URL"] ?? "redis://localhost:16379",
        JWT_SECRET: "test-runprod-secret-32-chars-min!!",
        PORT: "0",
      },
      autoListen: false,
      migrations: false,
      seeds: [
        async ({ registry, dispatcher }) => {
          seenRegistry = registry;
          const result = await dispatcher.write(
            "seed-probe:write:note:create",
            { title: "seeded-note" },
            createSystemUser(TENANT_ID, ["SystemAdmin"]),
          );
          if (!result.isSuccess) throw new Error("seed write failed");
          const data = result.data;
          if (typeof data !== "object" || data === null || !("id" in data)) {
            throw new Error("seed write returned no id");
          }
          createdId = String(data.id);
        },
      ],
    });

    expect(seenRegistry?.features.has("seed-probe")).toBe(true);
    if (!createdId) throw new Error("seed did not run");

    const token = await handle.entrypoint.jwt.sign({
      id: "seed-reader",
      tenantId: TENANT_ID,
      roles: ["User"],
    });
    const res = await handle.entrypoint.app.fetch(
      new Request("http://test/api/query", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type: "seed-probe:query:note:list", payload: {} }),
      }),
    );
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).toContain("seeded-note");

    const { db, close } = createDbConnection(TEST_DB_URL);
    try {
      expect(await getStreamVersion(db, createdId, TENANT_ID)).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });
});
