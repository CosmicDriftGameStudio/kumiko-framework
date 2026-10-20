// Feature-level integration test for secrets. Pins that the CRUD handlers
// actually encrypt end-to-end: set stores an envelope (no plaintext), list
// returns the redactedPreview only, get decrypts back. The sample
// (samples/secrets-demo) shows the broader rotation + cross-feature flow;
// this test covers just the feature's own handlers.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
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
import { type StoredEnvelope, tenantSecretsTable } from "../table.ts";
import { SecretsHandlers, SecretsQueries } from "../web/constants.ts";
import { createDeclaredKeysFeature } from "./declared-keys-feature.ts";

const admin = createTestUser({
  id: "00000000-0000-4000-8000-000000000010",
  tenantId: "00000000-0000-4000-8000-000000000001",
  roles: ["TenantAdmin"],
});

const systemAdmin = createTestUser({
  id: "00000000-0000-4000-8000-000000000011",
  tenantId: admin.tenantId,
  roles: ["SystemAdmin"],
});

const declared = createDeclaredKeysFeature();
const PLAIN_KEY = declared.keys.plain.name;
const SYSTEM_ONLY_KEY = declared.keys.systemOnly.name;

let stack: TestStack;
let secretsContext: ReturnType<typeof createSecretsContext>;

beforeAll(async () => {
  const provider: MasterKeyProvider = createEnvMasterKeyProvider({
    env: {
      KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
    },
  });

  stack = await setupTestStack({
    features: [createSecretsFeature({ roles: ["TenantAdmin", "SystemAdmin"] }), declared.feature],
    extraContext: ({ db, registry }) => {
      secretsContext = createSecretsContext({
        db,
        masterKeyProvider: provider,
        registry: registry,
      });
      return { secrets: secretsContext };
    },
  });
  // Post-ES: the pre-ES audit table is gone — read-audit rides on the
  // events-table as tenantSecretRead domain-events. Only the projection
  // table (tenant_secrets) still needs an explicit push here, since it
  // belongs to an ES entity (and entity-tables aren't auto-pushed by
  // setupTestStack).
  await unsafePushTables(stack.db, { tenant_secrets: tenantSecretsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("secrets feature — CRUD round-trip", () => {
  test("set + list + delete over HTTP", async () => {
    // SET: encrypts and stores
    await stack.http.writeOk(
      SecretsHandlers.set,
      { key: PLAIN_KEY, value: "this-is-secret-value-xyz" },
      admin,
    );

    // LIST: preview only, never plaintext
    const list = await stack.http.queryOk<
      Array<{ key: string; redactedPreview: string | null; kekVersion: number }>
    >(SecretsQueries.list, {}, admin);
    const row = list.find((r) => r.key === PLAIN_KEY);
    expect(row).toBeDefined();
    expect(row?.redactedPreview).not.toBe("this-is-secret-value-xyz");
    expect(row?.kekVersion).toBe(1);

    // DB row holds an envelope, no plaintext
    const [dbRow] = await selectMany(stack.db, tenantSecretsTable, {
      tenantId: admin.tenantId,
      key: PLAIN_KEY,
    });
    if (!dbRow) throw new Error("row missing");
    const env = dbRow.envelope as StoredEnvelope;
    expect(env.ciphertext).toBeTruthy();
    expect(env.kekVersion).toBe(1);
    expect(JSON.stringify(dbRow)).not.toContain("this-is-secret-value-xyz");

    // DELETE: removes row
    await stack.http.writeOk(SecretsHandlers.delete, { key: PLAIN_KEY }, admin);
    const afterDelete = await stack.http.queryOk<Array<{ key: string }>>(
      SecretsQueries.list,
      {},
      admin,
    );
    expect(afterDelete.some((r) => r.key === PLAIN_KEY)).toBe(false);
  });

  test("delete of a declared key that was never set returns tenant-secret not_found", async () => {
    const err = await stack.http.writeErr(
      SecretsHandlers.delete,
      { key: declared.keys.extra.name },
      admin,
    );
    expect(err.code).toBe("not_found");
    expect(err.details).toMatchObject({ entity: "tenant-secret" });
  });

  test("non-TenantAdmin cannot set", async () => {
    const user = createTestUser({
      id: "00000000-0000-4000-8000-000000000099",
      tenantId: admin.tenantId,
      roles: ["User"],
    });
    const err = await stack.http.writeErr(
      SecretsHandlers.set,
      { key: PLAIN_KEY, value: "x" },
      user,
    );
    expect(err.code).toBe("access_denied");
  });
});

describe("secrets feature — only declared keys are writable", () => {
  test("set with an undeclared key is rejected as unknown", async () => {
    const err = await stack.http.writeErr(
      SecretsHandlers.set,
      { key: "never.declared", value: "x" },
      admin,
    );
    expect(err.code).toBe("not_found");
    expect(err.i18nKey).toBe("secrets.errors.unknownKey");

    const rows = await selectMany(stack.db, tenantSecretsTable, {
      tenantId: admin.tenantId,
      key: "never.declared",
    });
    expect(rows).toHaveLength(0);
  });

  test("delete of an undeclared key that was never stored is a plain not_found", async () => {
    const err = await stack.http.writeErr(SecretsHandlers.delete, { key: "never.declared" }, admin);
    expect(err.code).toBe("not_found");
    expect(err.details).toMatchObject({ entity: "tenant-secret" });
  });

  test("a legacy row under an undeclared key stays deletable for TenantAdmin", async () => {
    const legacyKey = "incident-hook";
    await secretsContext.set(admin.tenantId, legacyKey, "legacy-token");

    await stack.http.writeOk(SecretsHandlers.delete, { key: legacyKey }, admin);

    const rows = await selectMany(stack.db, tenantSecretsTable, {
      tenantId: admin.tenantId,
      key: legacyKey,
    });
    expect(rows).toHaveLength(0);
  });

  test("a declared key without writeRoles stays writable for TenantAdmin", async () => {
    await stack.http.writeOk(SecretsHandlers.set, { key: PLAIN_KEY, value: "plain-value" }, admin);
    await stack.http.writeOk(SecretsHandlers.delete, { key: PLAIN_KEY }, admin);
  });
});

describe("secrets feature — declared namespaces", () => {
  test("a valid key under the namespace is accepted for TenantAdmin", async () => {
    const key = declared.keys.namespace.keyFor("deploy-hook");
    await stack.http.writeOk(SecretsHandlers.set, { key, value: "hook-token" }, admin);
    await stack.http.writeOk(SecretsHandlers.delete, { key }, admin);
  });

  test("the bare prefix is rejected as unknown", async () => {
    const err = await stack.http.writeErr(
      SecretsHandlers.set,
      { key: declared.keys.namespace.prefix, value: "x" },
      admin,
    );
    expect(err.code).toBe("not_found");
    expect(err.i18nKey).toBe("secrets.errors.unknownKey");
  });

  test("a key whose suffix fails the namespace rule is rejected as unknown", async () => {
    const err = await stack.http.writeErr(
      SecretsHandlers.set,
      { key: declared.keys.namespace.keyFor("Not Valid!"), value: "x" },
      admin,
    );
    expect(err.code).toBe("not_found");
    expect(err.i18nKey).toBe("secrets.errors.unknownKey");
  });
});

describe("secrets feature — namespace writeRoles", () => {
  const operatorKey = declared.keys.systemOnlyNamespace.keyFor("deploy");

  test("TenantAdmin cannot set under a namespace restricted to SystemAdmin", async () => {
    const err = await stack.http.writeErr(
      SecretsHandlers.set,
      { key: operatorKey, value: "x" },
      admin,
    );
    expect(err.code).toBe("access_denied");
    expect(err.i18nKey).toBe("secrets.errors.writeDenied");
    expect(err.details).toMatchObject({ requiredRoles: ["SystemAdmin"] });
  });

  test("TenantAdmin cannot delete under a namespace restricted to SystemAdmin, SystemAdmin can", async () => {
    await stack.http.writeOk(
      SecretsHandlers.set,
      { key: operatorKey, value: "operator-value" },
      systemAdmin,
    );
    const err = await stack.http.writeErr(SecretsHandlers.delete, { key: operatorKey }, admin);
    expect(err.code).toBe("access_denied");
    expect(err.i18nKey).toBe("secrets.errors.writeDenied");

    await stack.http.writeOk(SecretsHandlers.delete, { key: operatorKey }, systemAdmin);
    const rows = await selectMany(stack.db, tenantSecretsTable, {
      tenantId: admin.tenantId,
      key: operatorKey,
    });
    expect(rows).toHaveLength(0);
  });
});

describe("secrets feature — per-key writeRoles", () => {
  test("TenantAdmin cannot set a key restricted to SystemAdmin", async () => {
    const err = await stack.http.writeErr(
      SecretsHandlers.set,
      { key: SYSTEM_ONLY_KEY, value: "x" },
      admin,
    );
    expect(err.code).toBe("access_denied");
    expect(err.i18nKey).toBe("secrets.errors.writeDenied");
    expect(err.details).toMatchObject({ requiredRoles: ["SystemAdmin"] });
  });

  test("TenantAdmin cannot delete a key restricted to SystemAdmin", async () => {
    await stack.http.writeOk(
      SecretsHandlers.set,
      { key: SYSTEM_ONLY_KEY, value: "operator-value" },
      systemAdmin,
    );
    const err = await stack.http.writeErr(SecretsHandlers.delete, { key: SYSTEM_ONLY_KEY }, admin);
    expect(err.code).toBe("access_denied");
    expect(err.i18nKey).toBe("secrets.errors.writeDenied");

    const rows = await selectMany(stack.db, tenantSecretsTable, {
      tenantId: admin.tenantId,
      key: SYSTEM_ONLY_KEY,
    });
    expect(rows).toHaveLength(1);
    await stack.http.writeOk(SecretsHandlers.delete, { key: SYSTEM_ONLY_KEY }, systemAdmin);
  });

  test("SystemAdmin can set and delete a key restricted to SystemAdmin", async () => {
    await stack.http.writeOk(
      SecretsHandlers.set,
      { key: SYSTEM_ONLY_KEY, value: "operator-value" },
      systemAdmin,
    );
    await stack.http.writeOk(SecretsHandlers.delete, { key: SYSTEM_ONLY_KEY }, systemAdmin);
  });
});
