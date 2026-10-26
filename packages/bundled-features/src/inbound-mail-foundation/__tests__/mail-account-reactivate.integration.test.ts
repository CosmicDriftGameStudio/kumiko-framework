// Reactivation in the mailbox list: the row action "Reactivate" shows only where the caller may
// re-arm the mailbox, "Reconnect" is left to sign-in errors, and a disconnected mailbox without a
// stored credential answers with a plain-text message instead of a bare reason code.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import {
  InboundMailAccountStatuses,
  InboundMailConnectErrors,
  InboundMailFoundationHandlers,
  InboundMailFoundationQueries,
} from "../constants.ts";
import { mailAccountListScreen } from "../screens.ts";
import {
  adminFor,
  type MailTestAdmin,
  type MailTestStack,
  setupMailStack,
} from "./mail-test-support.ts";

type ListedAccount = {
  readonly id: string;
  readonly status: string;
  readonly canReactivate: boolean;
};

let env: MailTestStack;

beforeAll(async () => {
  env = await setupMailStack({ withFiles: true });
});

afterAll(async () => {
  await env.stack.cleanup();
  resetPiiSubjectKmsForTests();
});

async function connect(admin: MailTestAdmin, scope: "shared" | "user", address: string) {
  const result = (await env.stack.http.writeOk(
    InboundMailFoundationHandlers.connectAccount,
    { provider: "inmemory", authMethod: "password", displayName: "Inbox", address, scope },
    admin,
  )) as { accountId: string };
  return result.accountId;
}

async function disconnect(admin: MailTestAdmin, accountId: string) {
  await env.stack.http.writeOk(
    InboundMailFoundationHandlers.disconnectAccount,
    { accountId },
    admin,
  );
}

async function listed(user: MailTestAdmin): Promise<Map<string, ListedAccount>> {
  const { rows } = await env.stack.http.queryOk<{ rows: ListedAccount[] }>(
    InboundMailFoundationQueries.listAccounts,
    {},
    user,
  );
  return new Map(rows.map((row) => [row.id, row]));
}

describe("canReactivate", () => {
  test("true only for a disconnected mailbox the caller may re-arm", async () => {
    const owner = adminFor(6901);
    const otherAdmin = createTestUser({
      id: 6902,
      tenantId: owner.tenantId,
      roles: ["TenantAdmin"],
    });
    const shared = await connect(owner, "shared", "shared@tenant.example");
    const personal = await connect(owner, "user", "personal@tenant.example");
    const live = await connect(owner, "shared", "live@tenant.example");
    await disconnect(owner, shared);
    await disconnect(owner, personal);

    const forOwner = await listed(owner);
    expect(forOwner.get(shared)?.canReactivate).toBe(true);
    expect(forOwner.get(personal)?.canReactivate).toBe(true);
    expect(forOwner.get(live)?.canReactivate).toBe(false);

    const forOtherAdmin = await listed(otherAdmin);
    expect(forOtherAdmin.get(shared)?.canReactivate).toBe(true);
    expect(forOtherAdmin.get(personal)?.canReactivate).toBe(false);

    const denied = await env.stack.http.writeErr(
      InboundMailFoundationHandlers.reactivateAccount,
      { accountId: personal },
      otherAdmin,
    );
    expect(JSON.stringify(denied)).toContain("not_mailbox_owner");
  });

  test("a disconnected mailbox without a stored credential names the missing sign-in", async () => {
    const admin = adminFor(6903);
    const accountId = await connect(admin, "shared", "nocred@tenant.example");
    await disconnect(admin, accountId);

    const error = await env.stack.http.writeErr(
      InboundMailFoundationHandlers.reactivateAccount,
      { accountId },
      admin,
    );

    expect(error.i18nKey).toBe(InboundMailConnectErrors.credentialRequired.i18nKey);
  });
});

describe("mailbox list row actions", () => {
  const action = (id: string) =>
    mailAccountListScreen.rowActions?.find((candidate) => candidate.id === id);

  test("reactivate follows canReactivate, reconnect only sign-in errors", () => {
    expect(action("reactivate")?.visible).toEqual({ field: "canReactivate", eq: true });
    expect(action("reconnect")?.visible).toEqual({
      field: "status",
      eq: InboundMailAccountStatuses.authError,
    });
  });
});
