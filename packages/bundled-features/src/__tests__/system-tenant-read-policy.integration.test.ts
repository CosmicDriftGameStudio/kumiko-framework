import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  runInRowLevelSecurityScope,
  runInSystemRowLevelSecurityScope,
  tenantRowLevelSecurityScope,
} from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { createAuthEmailPasswordFeature } from "../auth-email-password/feature.ts";
import { createAuthFoundationFeature } from "../auth-foundation/index.ts";
import { createAuthMfaFeature } from "../auth-mfa/index.ts";
import { createConfigFeature } from "../config/index.ts";
import { createPersonalAccessTokensFeature } from "../personal-access-tokens/feature.ts";
import { createSessionsFeature } from "../sessions/index.ts";
import { createTenantFeature } from "../tenant/index.ts";
import { createUserFeature } from "../user/feature.ts";
import { testAuthMfaOptions } from "./auth-mfa-test-options.ts";

const CREDENTIAL_TABLES = [
  "read_users",
  "read_user_mfa",
  "store_api_tokens",
  "store_user_sessions",
] as const;
const SYSTEM_READABLE_TABLES = ["read_config_values"] as const;

const tenantA = testTenantId(1);

let stack: TestStack;

type ColumnInfo = {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
};

const DUMMY_VALUE_BY_DATA_TYPE: Readonly<Record<string, string>> = {
  uuid: "gen_random_uuid()",
  text: "'x'",
  "character varying": "'x'",
  "timestamp with time zone": "now()",
  "timestamp without time zone": "now()",
  date: "current_date",
  integer: "0",
  bigint: "0",
  smallint: "0",
  numeric: "0",
  boolean: "false",
  jsonb: "'{}'::jsonb",
};

async function insertSystemTenantRow(tableName: string): Promise<void> {
  const columns = await asRawClient(stack.unscopedDb).unsafe<ColumnInfo>(
    `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [tableName],
  );
  const required = columns.filter(
    (column) => column.is_nullable === "NO" && column.column_default === null,
  );
  const values = required.map((column) => {
    if (column.column_name === "tenant_id") return `'${SYSTEM_TENANT_ID}'`;
    const value = DUMMY_VALUE_BY_DATA_TYPE[column.data_type];
    if (value === undefined) {
      throw new Error(
        `no dummy value for ${tableName}.${column.column_name} (${column.data_type})`,
      );
    }
    return value;
  });
  const names = required.map((column) => `"${column.column_name}"`).join(", ");
  await runInSystemRowLevelSecurityScope("test seeds a system tenant row per table", () =>
    asRawClient(stack.unscopedDb).unsafe(
      `INSERT INTO "${tableName}" (${names}) VALUES (${values.join(", ")})`,
    ),
  );
}

async function tenantIdsVisibleToTenantA(tableName: string): Promise<readonly string[]> {
  const rows = await runInRowLevelSecurityScope(tenantRowLevelSecurityScope(tenantA), () =>
    asRawClient(stack.unscopedDb).unsafe<{ tenant_id: string }>(
      `SELECT tenant_id::text AS tenant_id FROM "${tableName}"`,
    ),
  );
  return rows.map((row) => row.tenant_id);
}

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createAuthEmailPasswordFeature(),
      createAuthFoundationFeature(),
      createSessionsFeature(),
      createAuthMfaFeature(testAuthMfaOptions),
      createPersonalAccessTokensFeature({ scopes: {} }),
    ],
  });
  for (const tableName of [...CREDENTIAL_TABLES, ...SYSTEM_READABLE_TABLES]) {
    await insertSystemTenantRow(tableName);
  }
});

afterAll(async () => {
  await stack.cleanup();
});

describe("system tenant rows under a tenant scope (role kumiko_app, row level security on)", () => {
  test.each(CREDENTIAL_TABLES)(
    "%s keeps its system tenant rows hidden from a tenant session",
    async (tableName) => {
      expect(await tenantIdsVisibleToTenantA(tableName)).toEqual([]);
    },
  );

  test.each(SYSTEM_READABLE_TABLES)(
    "%s, marked systemRowsReadable, still shows them",
    async (tableName) => {
      expect(await tenantIdsVisibleToTenantA(tableName)).toEqual([SYSTEM_TENANT_ID]);
    },
  );

  test("exactly the marked tables carry the system read policy", async () => {
    const rows = await asRawClient(stack.unscopedDb).unsafe<{ tablename: string }>(
      `SELECT tablename FROM pg_policies
       WHERE schemaname = 'public' AND policyname = 'kumiko_system_tenant_read'
       ORDER BY tablename COLLATE "C"`,
    );
    expect(rows.map((row) => row.tablename)).toEqual([...SYSTEM_READABLE_TABLES]);
  });
});
