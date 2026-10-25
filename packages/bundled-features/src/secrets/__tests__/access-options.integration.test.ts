// createSecretsFeature() took no options at all: set/delete/list were
// hard-wired to ["TenantAdmin"], so an app with its own role vocabulary
// (e.g. ["Admin","Editor"]) could not let its own admins manage secrets
// without also granting the framework "TenantAdmin" role — the same
// Role-Naming-Drift documented on custom-fields' valueWriteRoles. Verifies
// the new `roles`/`access` options actually gate set/delete/list, that the
// framework-default role loses access once overridden, and that `openToAll`
// really does open the surface to any authenticated tenant user.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { createSystemUser } from "@cosmicdrift/kumiko-framework/engine";
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
import { createDeclaredKeysFeature } from "./declared-keys-feature.ts";

function masterKeyProvider(): MasterKeyProvider {
  return createEnvMasterKeyProvider({
    env: {
      KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
    },
  });
}

const declared = createDeclaredKeysFeature();
const SECRET_KEY = declared.keys.plain.name;

async function buildStack(feature: ReturnType<typeof createSecretsFeature>): Promise<TestStack> {
  const provider = masterKeyProvider();
  const stack = await setupTestStack({
    features: [feature, declared.feature],
    extraContext: ({ db, registry }) => ({
      secrets: createSecretsContext({ db, masterKeyProvider: provider, registry: registry }),
    }),
  });
  await unsafePushTables(stack.db, { tenant_secrets: tenantSecretsTable });
  return stack;
}

const admin = createTestUser({ roles: ["TenantAdmin"] });
const customRoleUser = createTestUser({ roles: ["Admin"] });
const unprivileged = createTestUser({ roles: ["Viewer"] });

describe("secrets — roles option", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await buildStack(createSecretsFeature({ roles: ["Admin"] }));
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("a custom-role user can set, list and delete", async () => {
    await stack.http.writeOk(
      "secrets:write:set",
      { key: SECRET_KEY, value: "shh" },
      customRoleUser,
    );
    const list = await stack.http.queryOk<Array<{ key: string }>>(
      "secrets:query:list",
      {},
      customRoleUser,
    );
    expect(list.some((r) => r.key === SECRET_KEY)).toBe(true);
    await stack.http.writeOk("secrets:write:delete", { key: SECRET_KEY }, customRoleUser);
  });

  test("the framework-default TenantAdmin role is denied once `roles` overrides it", async () => {
    const deniedSet = await stack.http.writeErr(
      "secrets:write:set",
      { key: SECRET_KEY, value: "x" },
      admin,
    );
    expect(deniedSet.code).toBe("access_denied");

    const deniedList = await stack.http.queryErr("secrets:query:list", {}, admin);
    expect(deniedList.code).toBe("access_denied");

    const deniedDelete = await stack.http.writeErr(
      "secrets:write:delete",
      { key: SECRET_KEY },
      admin,
    );
    expect(deniedDelete.code).toBe("access_denied");
  });
});

describe("secrets — access: { openToAll: { reason } }", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await buildStack(
      createSecretsFeature({
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      }),
    );
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("any authenticated tenant user can set, list and delete", async () => {
    await stack.http.writeOk("secrets:write:set", { key: SECRET_KEY, value: "shh" }, unprivileged);
    const list = await stack.http.queryOk<Array<{ key: string }>>(
      "secrets:query:list",
      {},
      unprivileged,
    );
    expect(list.some((r) => r.key === SECRET_KEY)).toBe(true);
    await stack.http.writeOk("secrets:write:delete", { key: SECRET_KEY }, unprivileged);
  });
});

describe("secrets — server-side system writes", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await buildStack(createSecretsFeature({ roles: ["Admin"] }));
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("the system dispatcher sets and deletes a declared secret through the handler gate", async () => {
    const systemUser = createSystemUser(customRoleUser.tenantId, ["SystemAdmin"]);
    const set = await stack.dispatcher.write(
      "secrets:write:set",
      { key: SECRET_KEY, value: "migrated" },
      systemUser,
    );
    expect(set.isSuccess).toBe(true);
    const list = await stack.http.queryOk<Array<{ key: string }>>(
      "secrets:query:list",
      {},
      customRoleUser,
    );
    expect(list.some((r) => r.key === SECRET_KEY)).toBe(true);

    const undeclared = await stack.dispatcher.write(
      "secrets:write:set",
      { key: "not-declared:secret:x", value: "x" },
      systemUser,
    );
    expect(undeclared.isSuccess).toBe(false);

    const deleted = await stack.dispatcher.write(
      "secrets:write:delete",
      { key: SECRET_KEY },
      systemUser,
    );
    expect(deleted.isSuccess).toBe(true);
  });

  test("a human SystemAdmin session stays denied", async () => {
    const platformAdmin = createTestUser({ roles: ["SystemAdmin"] });
    const denied = await stack.http.writeErr(
      "secrets:write:set",
      { key: SECRET_KEY, value: "x" },
      platformAdmin,
    );
    expect(denied.code).toBe("access_denied");
  });
});
