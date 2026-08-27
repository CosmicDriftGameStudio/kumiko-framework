// #2296 — createSecretsFeature() took no options at all: set/delete/list were
// hard-wired to ["TenantAdmin"], so an app with its own role vocabulary
// (e.g. ["Admin","Editor"]) could not let its own admins manage secrets
// without also granting the framework "TenantAdmin" role — the same
// Role-Naming-Drift documented on custom-fields' valueWriteRoles. Verifies
// the new `roles`/`access` options actually gate set/delete/list, that the
// framework-default role loses access once overridden, and that `openToAll`
// really does open the surface to any authenticated tenant user.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
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
import { createSecretsFeature } from "../feature";
import { createSecretsContext } from "../secrets-context";
import { tenantSecretsTable } from "../table";

function masterKeyProvider(): MasterKeyProvider {
  return createEnvMasterKeyProvider({
    env: {
      KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
    },
  });
}

async function buildStack(feature: ReturnType<typeof createSecretsFeature>): Promise<TestStack> {
  const provider = masterKeyProvider();
  const stack = await setupTestStack({
    features: [feature],
    extraContext: ({ db }) => ({
      secrets: createSecretsContext({ db, masterKeyProvider: provider }),
    }),
  });
  await unsafePushTables(stack.db, { tenant_secrets: tenantSecretsTable });
  await createEventsTable(stack.db);
  return stack;
}

const admin = createTestUser({ roles: ["TenantAdmin"] });
const customRoleUser = createTestUser({ roles: ["Admin"] });
const unprivileged = createTestUser({ roles: ["Viewer"] });

describe("secrets — roles option (#2296)", () => {
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
      { key: "api.key.role-opt", value: "shh" },
      customRoleUser,
    );
    const list = await stack.http.queryOk<Array<{ key: string }>>(
      "secrets:query:list",
      {},
      customRoleUser,
    );
    expect(list.some((r) => r.key === "api.key.role-opt")).toBe(true);
    await stack.http.writeOk("secrets:write:delete", { key: "api.key.role-opt" }, customRoleUser);
  });

  test("the framework-default TenantAdmin role is denied once `roles` overrides it", async () => {
    const deniedSet = await stack.http.writeErr(
      "secrets:write:set",
      { key: "api.key.denied", value: "x" },
      admin,
    );
    expect(deniedSet.code).toBe("access_denied");

    const deniedList = await stack.http.queryErr("secrets:query:list", {}, admin);
    expect(deniedList.code).toBe("access_denied");

    const deniedDelete = await stack.http.writeErr(
      "secrets:write:delete",
      { key: "api.key.denied" },
      admin,
    );
    expect(deniedDelete.code).toBe("access_denied");
  });
});

describe("secrets — access: { openToAll: true } (#2296)", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await buildStack(createSecretsFeature({ access: { openToAll: true } }));
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("any authenticated tenant user can set, list and delete", async () => {
    await stack.http.writeOk(
      "secrets:write:set",
      { key: "api.key.open", value: "shh" },
      unprivileged,
    );
    const list = await stack.http.queryOk<Array<{ key: string }>>(
      "secrets:query:list",
      {},
      unprivileged,
    );
    expect(list.some((r) => r.key === "api.key.open")).toBe(true);
    await stack.http.writeOk("secrets:write:delete", { key: "api.key.open" }, unprivileged);
  });
});
