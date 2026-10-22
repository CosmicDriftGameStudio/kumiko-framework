import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  type CreateKumikoServerOptions,
  type KumikoServerHandle,
  runDevApp,
} from "@cosmicdrift/kumiko-dev-server";
import { createE2eSeedRoutes } from "@cosmicdrift/kumiko-dev-server/testing";
import { buildEntityTable, selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createTextField,
  defineEntityCreateHandler,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  PLAYWRIGHT_DEMO_ENV,
  SEED_ENABLE_ENV,
  SEED_ROUTES,
  SEED_TOKEN_ENV,
  SEED_TOKEN_HEADER,
} from "../e2e/constants";
import { seedTenantResponseSchema } from "../e2e/seed-contract";
import type { E2eExtraSeeder } from "../e2e/seed-route";

const ENV_KEYS = [
  SEED_ENABLE_ENV,
  SEED_TOKEN_ENV,
  "JWT_SECRET",
  "KUMIKO_SECRETS_MASTER_KEY_V1",
  "KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION",
] as const;

const SEED_TOKEN = "write-as-test-seed-token";

const ledgerNoteEntity = createEntity({
  table: "read_testing_ledger_notes",
  fields: {
    title: createTextField({ required: true, personal: false, reason: "test_fixture" }),
  },
});
const ledgerNoteTable = buildEntityTable("ledger-note", ledgerNoteEntity);
const LEDGER_NOTE_CREATE = "testing-ledger:write:ledger-note:create";

const ledgerFeature = defineFeature("testing-ledger", (r) => {
  r.entity({ name: "ledger-note", ...ledgerNoteEntity });
  r.writeHandler(
    defineEntityCreateHandler("ledger-note", ledgerNoteEntity, {
      access: { roles: ["TenantAdmin"] },
    }),
  );
});

const seeders: Record<string, E2eExtraSeeder> = {
  asTenantAdmin: async (ctx) => {
    await ctx.writeAs(["TenantAdmin"], LEDGER_NOTE_CREATE, { title: "as-admin" });
    return null;
  },
  asSystemAdmin: async (ctx) => {
    await ctx.write(LEDGER_NOTE_CREATE, { title: "as-system" });
    return null;
  },
};

let handle: KumikoServerHandle | undefined;
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env["JWT_SECRET"] = PLAYWRIGHT_DEMO_ENV.JWT_SECRET;
  process.env["KUMIKO_SECRETS_MASTER_KEY_V1"] = PLAYWRIGHT_DEMO_ENV.KUMIKO_SECRETS_MASTER_KEY_V1;
  process.env["KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION"] = "1";
  process.env[SEED_ENABLE_ENV] = "1";
  process.env[SEED_TOKEN_ENV] = SEED_TOKEN;
});

afterEach(async () => {
  await handle?.stop();
  handle = undefined;
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function post(h: KumikoServerHandle, path: string, body: unknown) {
  return h.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", [SEED_TOKEN_HEADER]: SEED_TOKEN },
      body: JSON.stringify(body),
    }),
  );
}

async function bootSeededTenant() {
  const extraRoutes: NonNullable<CreateKumikoServerOptions["extraRoutes"]> = createE2eSeedRoutes({
    extraSeeders: seeders,
  });
  handle = await runDevApp({
    features: [ledgerFeature],
    port: 0,
    auth: {
      admin: {
        email: "write-as-admin@example.test",
        password: "write-as-pw-1",
        displayName: "Admin",
        memberships: [],
      },
    },
    extraRoutes,
  });
  const res = await post(handle, SEED_ROUTES.seedTenant, {});
  expect(res.status).toBe(200);
  return { h: handle, tenant: seedTenantResponseSchema.parse(await res.json()) };
}

async function ledgerTitles(h: KumikoServerHandle): Promise<string[]> {
  const rows = await selectMany(h.stack.db, ledgerNoteTable);
  return rows.map((row) => String(row["title"]));
}

test("writeAs reaches a handler that only TenantAdmin may call", async () => {
  const { h, tenant } = await bootSeededTenant();

  const res = await post(h, SEED_ROUTES.extraSeed, {
    tenantId: tenant.id,
    seeder: "asTenantAdmin",
  });

  expect(res.status).toBe(200);
  expect(await ledgerTitles(h)).toEqual(["as-admin"]);
});

test("the same write through write() runs as SystemAdmin and is rejected", async () => {
  const { h, tenant } = await bootSeededTenant();

  const res = await post(h, SEED_ROUTES.extraSeed, {
    tenantId: tenant.id,
    seeder: "asSystemAdmin",
  });

  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({
    error: expect.stringMatching(new RegExp(`${LEDGER_NOTE_CREATE} failed:.*access_denied`)),
  });
  expect(await ledgerTitles(h)).toEqual([]);
});
