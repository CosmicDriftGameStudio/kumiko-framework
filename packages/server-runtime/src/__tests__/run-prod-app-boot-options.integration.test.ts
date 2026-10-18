// Boot options end to end: a real runProdApp boot against Postgres + Redis.
// demoMode gates writes in the fetch chain and serves /demo-mode, the seed
// shortcuts create the demo tenant and the env-provided sysadmin, and listen()
// installs the shutdown signals that stop() removes again.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { createPersonalAccessTokensFeature } from "@cosmicdrift/kumiko-bundled-features/personal-access-tokens";
import {
  createSessionsFeature,
  userSessionEntity,
} from "@cosmicdrift/kumiko-bundled-features/sessions";
import { templateResourceEntity } from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { tenantEntity, tenantMembershipsTable } from "@cosmicdrift/kumiko-bundled-features/tenant";
import { userEntity, userTable } from "@cosmicdrift/kumiko-bundled-features/user";
import { createDbConnection, selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  createArchivedStreamsTable,
  createEventsTable,
} from "@cosmicdrift/kumiko-framework/event-store";
import {
  createEventConsumerStateTable,
  createProjectionStateTable,
} from "@cosmicdrift/kumiko-framework/pipeline";
import { unsafeEnsureEntityTable, unsafePushTables } from "@cosmicdrift/kumiko-testing/stack";
import postgres from "postgres";
import { type ProdAppHandle, type RunProdAppOptions, runProdApp } from "../run-prod-app.js";

const TEST_DB = `kumiko_runprod_bootopts_${Date.now().toString(36)}`;
const ADMIN_URL = process.env["TEST_DATABASE_URL"] ?? "";
const TEST_DB_URL = ADMIN_URL.replace(/\/[^/]+$/, `/${TEST_DB}`);
const DEMO_TENANT_ID = "00000000-0000-4000-8000-000000000310";
const SYSADMIN_EMAIL = "sysadmin@boot-options.example";

const BASE_ENV = {
  DATABASE_URL: TEST_DB_URL,
  REDIS_URL: process.env["REDIS_URL"] ?? "redis://localhost:16379",
  JWT_SECRET: "test-runprod-secret-32-chars-min!!",
  PORT: "0",
};

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
    await unsafeEnsureEntityTable(db, userEntity, "user");
    await unsafeEnsureEntityTable(db, userSessionEntity, "user-session");
    await unsafeEnsureEntityTable(db, tenantEntity, "tenant");
    await unsafeEnsureEntityTable(db, templateResourceEntity, "template-resource");
    await unsafePushTables(db, { tenantMembershipsTable });
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

function authBoot(extra: Partial<RunProdAppOptions>, env: Record<string, string> = {}) {
  return runProdApp({
    features: [
      createAuthFoundationFeature(),
      createPersonalAccessTokensFeature({ scopes: {} }),
      createSessionsFeature(),
    ],
    auth: { allowedOrigins: ["https://app.example.eu"] },
    kmsMode: { plaintextReason: "test: boot-options focus, not crypto" },
    envSource: { ...BASE_ENV, ...env },
    autoListen: false,
    migrations: false,
    ...extra,
  });
}

describe("runProdApp boot options (integration)", () => {
  test("demoMode blocks writes and serves the notice, queries still pass", async () => {
    handle = await authBoot({
      demoMode: { readOnly: true, notice: { text: { en: "Read-only demo" } } },
    });

    const blocked = await handle.fetch(
      new Request("http://test/api/write", { method: "POST", body: "{}" }),
    );
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({ error: { code: "demo_read_only" } });
    // Security headers still wrap the gate's own response.
    expect(blocked.headers.get("x-content-type-options")).toBe("nosniff");

    const notice = await handle.fetch(new Request("http://test/demo-mode"));
    expect(notice.status).toBe(200);
    expect(await notice.json()).toEqual({
      readOnly: true,
      notice: { text: { en: "Read-only demo" }, accounts: [] },
    });

    const query = await handle.fetch(
      new Request("http://test/api/query", { method: "POST", body: "{}" }),
    );
    expect(query.status).not.toBe(403);
  });

  test("seed shortcuts create the demo tenant and the sysadmin from the env", async () => {
    const seeds = {
      demoTenant: { key: "demo", name: "Demo" },
      sysadminFromEnv: true,
    } as const;
    const env = {
      DEMO_TENANT_ID,
      DEMO_SYSADMIN_EMAIL: SYSADMIN_EMAIL,
      DEMO_SYSADMIN_PASSWORD: "sysadmin-password-1234",
    };
    handle = await authBoot({ seeds }, env);
    await handle.stop();
    // Second boot: idempotent, no duplicate user.
    handle = await authBoot({ seeds }, env);

    const { db, close } = createDbConnection({ url: TEST_DB_URL });
    try {
      const users = await selectMany<{ email: string; roles: unknown }>(db, userTable, {
        email: SYSADMIN_EMAIL,
      });
      expect(users).toHaveLength(1);
      expect(JSON.stringify(users[0]?.roles)).toContain("SystemAdmin");
      const memberships = await selectMany<{ tenantId: string }>(db, tenantMembershipsTable);
      expect(memberships.map((row) => row.tenantId)).toContain(DEMO_TENANT_ID);
    } finally {
      await close();
    }
  });

  test("listen() installs SIGTERM/SIGINT handlers, stop() removes them", async () => {
    const before = process.listenerCount("SIGTERM");
    handle = await authBoot({});
    await handle.listen(0);
    expect(process.listenerCount("SIGTERM")).toBe(before + 1);
    expect(process.listenerCount("SIGINT")).toBeGreaterThan(0);

    await handle.stop();
    handle = undefined;
    expect(process.listenerCount("SIGTERM")).toBe(before);
  });

  test("signals: false leaves the process signals alone", async () => {
    const before = process.listenerCount("SIGTERM");
    handle = await authBoot({ signals: false });
    await handle.listen(0);
    expect(process.listenerCount("SIGTERM")).toBe(before);
  });
});
