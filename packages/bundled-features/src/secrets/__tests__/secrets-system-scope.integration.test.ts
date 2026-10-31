// scope "system": a SystemAdmin working inside an ordinary tenant manages the platform-wide
// secrets (stored under SYSTEM_TENANT_ID); everyone else is turned away on all three handlers.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import {
  createEnvMasterKeyProvider,
  type MasterKeyProvider,
} from "@cosmicdrift/kumiko-framework/secrets";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createSecretsFeature } from "../feature.ts";
import { createSecretsContext } from "../secrets-context.ts";
import { tenantSecretsTable } from "../table.ts";
import { SecretsHandlers, SecretsQueries } from "../web/constants.ts";
import { createDeclaredKeysFeature } from "./declared-keys-feature.ts";

const TENANT_ID = "00000000-0000-4000-8000-000000000001";
const tenantAdmin = createTestUser({
  id: "00000000-0000-4000-8000-000000000010",
  tenantId: TENANT_ID,
  roles: ["TenantAdmin"],
});
const systemAdmin = createTestUser({
  id: "00000000-0000-4000-8000-000000000011",
  tenantId: TENANT_ID,
  roles: ["SystemAdmin"],
});

const declared = createDeclaredKeysFeature();
const KEY = declared.keys.plain.name;
const VALUE = "platform-wide-secret-value";

type ListRow = { key: string; redactedPreview: string | null };

let stack: TestStack;

beforeAll(async () => {
  const provider: MasterKeyProvider = createEnvMasterKeyProvider({
    env: {
      KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
    },
  });
  // The SystemAdmin role has to be part of the handler access rule; scope system then narrows it per call.
  stack = await setupTestStack({
    features: [createSecretsFeature({ roles: ["TenantAdmin", "SystemAdmin"] }), declared.feature],
    extraContext: ({ db, registry }) => ({
      secrets: createSecretsContext({ db, masterKeyProvider: provider, registry }),
    }),
  });
  await unsafePushTables(stack.db, { tenant_secrets: tenantSecretsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("secrets scope system", () => {
  test("a SystemAdmin in another tenant stores, lists and deletes under the system tenant", async () => {
    await stack.http.writeOk(
      SecretsHandlers.set,
      { key: KEY, value: VALUE, scope: "system" },
      systemAdmin,
    );

    const systemRows = await selectMany(stack.db, tenantSecretsTable, {
      tenantId: SYSTEM_TENANT_ID,
      key: KEY,
    });
    expect(systemRows).toHaveLength(1);
    expect(JSON.stringify(systemRows)).not.toContain(VALUE);
    expect(
      await selectMany(stack.db, tenantSecretsTable, { tenantId: TENANT_ID, key: KEY }),
    ).toHaveLength(0);

    const systemList = await stack.http.queryOk<ListRow[]>(
      SecretsQueries.list,
      { scope: "system" },
      systemAdmin,
    );
    const row = systemList.find((r) => r.key === KEY);
    expect(row).toBeDefined();
    expect(JSON.stringify(systemList)).not.toContain(VALUE);

    const ownList = await stack.http.queryOk<ListRow[]>(SecretsQueries.list, {}, systemAdmin);
    expect(ownList.some((r) => r.key === KEY)).toBe(false);

    await stack.http.writeOk(SecretsHandlers.delete, { key: KEY, scope: "system" }, systemAdmin);
    expect(
      await selectMany(stack.db, tenantSecretsTable, { tenantId: SYSTEM_TENANT_ID, key: KEY }),
    ).toHaveLength(0);
  });

  test("a TenantAdmin is denied scope system on set, delete and list", async () => {
    const set = await stack.http.writeErr(
      SecretsHandlers.set,
      { key: KEY, value: VALUE, scope: "system" },
      tenantAdmin,
    );
    expect(set.httpStatus).toBe(403);
    const del = await stack.http.writeErr(
      SecretsHandlers.delete,
      { key: KEY, scope: "system" },
      tenantAdmin,
    );
    expect(del.httpStatus).toBe(403);
    const list = await stack.http.queryErr(SecretsQueries.list, { scope: "system" }, tenantAdmin);
    expect(list.httpStatus).toBe(403);
    expect(
      await selectMany(stack.db, tenantSecretsTable, { tenantId: SYSTEM_TENANT_ID, key: KEY }),
    ).toHaveLength(0);
  });
});
