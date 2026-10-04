// An app-supplied `masterKey` provider is the only KEK source: with no
// KUMIKO_SECRETS_MASTER_KEY_V* in the env, the env-schema parse, the boot
// probe for `encrypted: true` fields and ctx.secrets all still work. Real
// Postgres + Redis, real /api/write and /api/query calls.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  configValuesTable,
  createConfigFeature,
} from "@cosmicdrift/kumiko-bundled-features/config";
import {
  createSecretsFeature,
  requireSecretsContext,
  tenantSecretsTable,
} from "@cosmicdrift/kumiko-bundled-features/secrets";
import {
  createTenantFeature,
  tenantEntity,
  tenantMembershipsTable,
} from "@cosmicdrift/kumiko-bundled-features/tenant";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { buildEntityTable, createDbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createTextField,
  defineEntityCreateHandler,
  defineEntityListHandler,
  defineFeature,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { composeEnvSchema } from "@cosmicdrift/kumiko-framework/env";
import {
  createArchivedStreamsTable,
  createEventsTable,
} from "@cosmicdrift/kumiko-framework/event-store";
import {
  createEventConsumerStateTable,
  createProjectionStateTable,
} from "@cosmicdrift/kumiko-framework/pipeline";
import { createEnvMasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import { unsafeEnsureEntityTable, unsafePushTables } from "@cosmicdrift/kumiko-framework/stack";
import postgres from "postgres";
import * as z from "zod";
import { type ProdAppHandle, runProdApp } from "../run-prod-app.js";

const TENANT_ID = "00000000-0000-4000-8000-000000000001" as TenantId;
const TEST_DB = `kumiko_runprod_masterkey_${Date.now().toString(36)}`;
const ADMIN_URL = process.env["TEST_DATABASE_URL"] ?? "";
const TEST_DB_URL = ADMIN_URL.replace(/\/[^/]+$/, `/${TEST_DB}`);

const NOTE_PLAINTEXT = "plain-note-body";

const vaultNoteEntity = createEntity({
  fields: {
    body: createTextField({ personal: false, reason: "test_fixture", encrypted: true }),
  },
  table: "master_key_vault_notes",
});

const vaultFeature = defineFeature("vault", (r) => {
  r.entity("note", vaultNoteEntity);
  r.writeHandler(
    defineEntityCreateHandler("note", vaultNoteEntity, { access: { roles: ["User"] } }),
  );
  r.queryHandler(defineEntityListHandler("note", vaultNoteEntity, { access: { roles: ["User"] } }));
});

const SECRET_KEY = "vault:credential";

// ctx.secrets round trip inside one handler, the way a feature consumes it.
const secretProbeFeature = defineFeature("secret-probe", (r) => {
  r.writeHandler({
    name: "stash",
    schema: z.object({ value: z.string() }),
    access: { roles: ["TenantAdmin"] },
    handler: async (event, ctx) => {
      const secrets = requireSecretsContext(ctx, "secret-probe");
      await secrets.set(event.user.tenantId, SECRET_KEY, event.payload.value);
      const revealed = (await secrets.get(event.user.tenantId, SECRET_KEY))?.reveal();
      return { isSuccess: true as const, data: { revealed } };
    },
  });
});

const features = [
  createConfigFeature(),
  createSecretsFeature(),
  createTenantFeature(),
  vaultFeature,
  secretProbeFeature,
];

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
    await unsafePushTables(db, {
      configValuesTable,
      tenantMembershipsTable,
      tenant_secrets: tenantSecretsTable,
    });
    await unsafeEnsureEntityTable(db, tenantEntity, "tenant");
    await unsafeEnsureEntityTable(db, vaultNoteEntity, "note");
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

// No KUMIKO_SECRETS_MASTER_KEY_V* in here, on purpose.
function envWithoutKek(): Record<string, string> {
  return {
    DATABASE_URL: TEST_DB_URL,
    REDIS_URL: process.env["REDIS_URL"] ?? "redis://localhost:16379",
    JWT_SECRET: "test-runprod-secret-32-chars-min!!",
    PORT: "0",
  };
}

async function bootApp(withMasterKey: boolean): Promise<ProdAppHandle> {
  const booted = await runProdApp({
    features,
    envSchema: composeEnvSchema({ features }),
    envSource: envWithoutKek(),
    // The default reporter exits the process; the error is rethrown after it.
    bootErrorReporter: () => {},
    autoListen: false,
    migrations: false,
    allowPlaintextPii: "test: master key wiring, not PII crypto",
    ...(withMasterKey && {
      masterKey: createEnvMasterKeyProvider({
        env: {
          KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
          KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
        },
      }),
    }),
    jobs: { queueNamePrefix: `test-masterkey-${Date.now().toString(36)}` },
  });
  handle = booted;
  return booted;
}

async function call(
  app: ProdAppHandle,
  route: "write" | "query",
  type: string,
  payload: Record<string, unknown>,
): Promise<{ readonly status: number; readonly body: { data?: unknown } }> {
  const token = await app.entrypoint.jwt.sign({
    id: "vault-admin",
    tenantId: TENANT_ID,
    roles: ["TenantAdmin", "User"],
  });
  const res = await app.entrypoint.app.fetch(
    new Request(`http://test/api/${route}`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ type, payload }),
    }),
  );
  return { status: res.status, body: (await res.json()) as { data?: unknown } };
}

describe("runProdApp with masterKey and no env KEK", () => {
  test("encrypted entity fields round-trip over HTTP and are ciphertext at rest", async () => {
    const app = await bootApp(true);

    const created = await call(app, "write", "vault:write:note:create", { body: NOTE_PLAINTEXT });
    expect(created.status).toBe(200);

    const listed = await call(app, "query", "vault:query:note:list", {});
    expect(listed.status).toBe(200);
    expect(JSON.stringify(listed.body.data)).toContain(NOTE_PLAINTEXT);

    const { db, close } = createDbConnection(TEST_DB_URL);
    try {
      const rows = await selectMany<Record<string, unknown>>(
        db,
        buildEntityTable("note", vaultNoteEntity),
        {},
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(String(row["body"])).not.toContain(NOTE_PLAINTEXT);
      }
    } finally {
      await close();
    }
  });

  test("ctx.secrets set/get works through the app-supplied provider", async () => {
    const app = await bootApp(true);

    const stashed = await call(app, "write", "secret-probe:write:stash", {
      value: "s3cret-value",
    });
    expect(stashed.status).toBe(200);
    expect(stashed.body.data).toEqual({ revealed: "s3cret-value" });
  });

  test("without masterKey and without env KEK the boot fails", async () => {
    await expect(bootApp(false)).rejects.toThrow(/KUMIKO_SECRETS_MASTER_KEY_V1/);
  });
});
