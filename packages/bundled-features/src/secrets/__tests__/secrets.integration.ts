// Feature-level integration test for secrets. Pins that the CRUD handlers
// actually encrypt end-to-end: set stores an envelope (no plaintext), list
// returns the redactedPreview only, get decrypts back. The sample
// (samples/secrets-demo) shows the broader rotation + cross-feature flow;
// this test covers just the feature's own handlers.

import { randomBytes } from "node:crypto";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createEnvMasterKeyProvider,
  type MasterKeyProvider,
} from "@cosmicdrift/kumiko-framework/secrets";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createSecretsFeature } from "../feature";
import { createSecretsContext } from "../secrets-context";
import { type StoredEnvelope, tenantSecretsTable } from "../table";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";

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
  // Post-ES: the pre-ES audit table is gone — read-audit rides on the
  // events-table as tenantSecretRead domain-events. Only the projection
  // table (tenant_secrets) still needs an explicit push here, since it
  // belongs to an ES entity (and entity-tables aren't auto-pushed by
  // setupTestStack).
  await unsafePushTables(stack.db, { tenant_secrets: tenantSecretsTable });
  await createEventsTable(stack.db);
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
    const [dbRow] = await selectMany(stack.db, tenantSecretsTable, { tenantId: admin.tenantId, key: "api.key.x" });
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
