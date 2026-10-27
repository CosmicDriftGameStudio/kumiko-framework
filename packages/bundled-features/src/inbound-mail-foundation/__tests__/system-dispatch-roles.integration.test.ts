// An app that names its own roles and leaves SystemAdmin out of them (solon does): the handlers the
// supervisor and the OAuth callback dispatch as the system user must still accept it.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import {
  resetInboundInMemory,
  seedInboundMessage,
  seedRejectedInboundMessage,
} from "../../inbound-provider-inmemory/index.ts";
import {
  InboundMailAccountStatuses,
  InboundMailFoundationHandlers,
  InboundMailLastErrors,
  mailAccountsProjectionTable,
} from "../index.ts";
import {
  createMailSupervisor,
  type MailTestStack,
  rawMsg,
  setupMailStack,
  storeAccountCredential,
  updateAccountAsSystem,
} from "./mail-test-support.ts";

const APP_ROLES = { userRoles: ["PropertyManager"], adminRoles: ["Admin"] } as const;
const TENANT = 7001;

let env: MailTestStack;

beforeAll(async () => {
  env = await setupMailStack({ withFiles: true, roles: APP_ROLES });
});

afterAll(async () => {
  await env.stack.cleanup();
  resetPiiSubjectKmsForTests();
});

beforeEach(() => {
  resetInboundInMemory();
});

const tenantId = testTenantId(TENANT);
const admin = () => createTestUser({ id: TENANT, tenantId, roles: ["Admin"] });
const asSystem = () => createSystemUser(tenantId as TenantId, [ROLES.SystemAdmin]);

async function connectSharedAccount(address: string): Promise<string> {
  const { accountId } = await env.stack.http.writeOk<{ accountId: string }>(
    InboundMailFoundationHandlers.connectAccount,
    {
      provider: "inmemory",
      authMethod: "password",
      displayName: "Team inbox",
      address,
      scope: "shared",
    },
    admin(),
  );
  return accountId;
}

async function accountRow(accountId: string) {
  const [row] = await selectMany(env.stack.db, mailAccountsProjectionTable, { id: accountId });
  return row;
}

describe("supervisor writes with app roles that exclude SystemAdmin", () => {
  test("a quarantined mail degrades the mailbox without a rejected health update", async () => {
    const accountId = await connectSharedAccount("shared1@tenant.example");
    await seedInboundMessage(accountId, rawMsg({ providerMessageId: "good", text: "fine" }));
    seedRejectedInboundMessage(accountId, "poison");
    const log: string[] = [];

    await createMailSupervisor(env.stack, { log: (line) => log.push(line) }).pollOnce();

    expect(log.filter((line) => line.includes("was rejected"))).toEqual([]);
    const row = await accountRow(accountId);
    expect(row?.["status"]).toBe(InboundMailAccountStatuses.degraded);
    expect(row?.["lastError"]).toBe(InboundMailLastErrors.messageQuarantined);
  });

  test("system-only fields of update-account are accepted", async () => {
    const accountId = await connectSharedAccount("shared2@tenant.example");

    const result = await updateAccountAsSystem(env.stack, tenantId, {
      accountId,
      watchState: "watching",
      reason: "watch_supervisor",
    });

    expect(result.isSuccess).toBe(true);
    expect((await accountRow(accountId))?.["watchState"]).toBe("watching");
  });
});

describe("OAuth callback writes with app roles that exclude SystemAdmin", () => {
  test("the system user connects a shared mailbox and reactivates it", async () => {
    const connected = await env.stack.dispatcher.write(
      InboundMailFoundationHandlers.connectAccount,
      {
        provider: "inmemory",
        authMethod: "password",
        displayName: "Callback inbox",
        address: "callback@tenant.example",
        scope: "shared",
      },
      asSystem(),
    );
    expect(JSON.stringify(connected)).toContain("accountId");
    const accountId = (connected as { data: { accountId: string } }).data.accountId;
    await updateAccountAsSystem(env.stack, tenantId, {
      accountId,
      status: InboundMailAccountStatuses.authError,
      reason: "oauth_refresh",
    });

    await storeAccountCredential(env, tenantId, accountId, "system");
    const reactivated = await env.stack.dispatcher.write(
      InboundMailFoundationHandlers.reactivateAccount,
      { accountId },
      asSystem(),
    );

    expect(reactivated.isSuccess).toBe(true);
    expect((await accountRow(accountId))?.["status"]).toBe(InboundMailAccountStatuses.active);
  });
});

describe("real users keep the configured roles", () => {
  test("SystemAdmin-less plain member cannot connect a shared mailbox", async () => {
    const member = createTestUser({ id: TENANT + 1, tenantId, roles: ["PropertyManager"] });

    const result = await env.stack.http.write(
      InboundMailFoundationHandlers.connectAccount,
      {
        provider: "inmemory",
        authMethod: "password",
        displayName: "x",
        address: "x@tenant.example",
        scope: "shared",
      },
      member,
    );

    expect(result.status).toBe(403);
  });
});
