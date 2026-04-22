// Feature-level integration test for secrets. Pins that the CRUD handlers
// actually encrypt end-to-end: set stores an envelope (no plaintext), list
// returns the redactedPreview only, get decrypts back. The sample
// (samples/secrets-demo) shows the broader rotation + cross-feature flow;
// this test covers just the feature's own handlers.

import { randomBytes } from "node:crypto";
import { createEventsTable } from "@kumiko/framework/event-store";
import { createEnvMasterKeyProvider, type MasterKeyProvider } from "@kumiko/framework/secrets";
import {
  createTestUser,
  pushTables,
  setupTestStack,
  type TestStack,
} from "@kumiko/framework/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createSecretsContext } from "../secrets-context";
import { createSecretsFeature } from "../secrets-feature";
import { type StoredEnvelope, tenantSecretsAuditTable, tenantSecretsTable } from "../table";

const admin = createTestUser({
  id: "00000000-0000-4000-8000-000000000010",
  tenantId: "00000000-0000-4000-8000-000000000001",
  roles: ["TenantAdmin"],
});

let stack: TestStack;

beforeAll(async () => {
  const provider: MasterKeyProvider = createEnvMasterKeyProvider({
    env: {
      KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
    },
  });

  stack = await setupTestStack({
    features: [createSecretsFeature()],
    extraContext: ({ db }) => ({
      secrets: createSecretsContext({ db, masterKeyProvider: provider }),
    }),
  });
  await pushTables(stack.db.db, {
    tenant_secrets: tenantSecretsTable,
    tenant_secret_reads: tenantSecretsAuditTable,
  });
  await createEventsTable(stack.db.db);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("secrets feature — CRUD round-trip", () => {
  test("set + list + delete over HTTP", async () => {
    // SET: encrypts and stores
    await stack.http.writeOk(
      "secrets:write:set",
      { key: "api.key.x", value: "this-is-secret-value-xyz" },
      admin,
    );

    // LIST: preview only, never plaintext
    const list = await stack.http.queryOk<
      Array<{ key: string; redactedPreview: string | null; kekVersion: number }>
    >("secrets:query:list", {}, admin);
    const row = list.find((r) => r.key === "api.key.x");
    expect(row).toBeDefined();
    expect(row?.redactedPreview).not.toBe("this-is-secret-value-xyz");
    expect(row?.kekVersion).toBe(1);

    // DB row holds an envelope, no plaintext
    const [dbRow] = await stack.db.db
      .select()
      .from(tenantSecretsTable)
      .where(
        and(
          eq(tenantSecretsTable.tenantId, admin.tenantId),
          eq(tenantSecretsTable.key, "api.key.x"),
        ),
      );
    if (!dbRow) throw new Error("row missing");
    const env = dbRow.envelope as StoredEnvelope;
    expect(env.ciphertext).toBeTruthy();
    expect(env.kekVersion).toBe(1);
    expect(JSON.stringify(dbRow)).not.toContain("this-is-secret-value-xyz");

    // DELETE: removes row
    await stack.http.writeOk("secrets:write:delete", { key: "api.key.x" }, admin);
    const afterDelete = await stack.http.queryOk<Array<{ key: string }>>(
      "secrets:query:list",
      {},
      admin,
    );
    expect(afterDelete.some((r) => r.key === "api.key.x")).toBe(false);
  });

  test("delete on missing key returns 404", async () => {
    const err = await stack.http.writeErr("secrets:write:delete", { key: "never.set.this" }, admin);
    expect(err.code).toBe("not_found");
  });

  test("non-TenantAdmin cannot set", async () => {
    const user = createTestUser({
      id: "00000000-0000-4000-8000-000000000099",
      tenantId: admin.tenantId,
      roles: ["User"],
    });
    const err = await stack.http.writeErr("secrets:write:set", { key: "attack", value: "x" }, user);
    expect(err.code).toBe("access_denied");
  });
});
