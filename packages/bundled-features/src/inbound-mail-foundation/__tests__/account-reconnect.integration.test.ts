// Disconnect and reconnect: the same address cannot be connected twice, a disconnected mailbox comes
// back as the same account (same stream, same sync cursor), so nothing is imported twice.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import { resetInboundInMemory, seedInboundMessage } from "../../inbound-provider-inmemory/index.ts";
import {
  InboundMailAccountStatuses,
  InboundMailConnectErrors,
  InboundMailFoundationHandlers,
  inboundCredentialSecretKey,
  inboundMessagesProjectionTable,
  mailAccountsProjectionTable,
  syncCursorTable,
} from "../index.ts";
import {
  adminFor,
  connectInMemoryAccount,
  createMailSupervisor,
  type MailTestStack,
  rawMsg,
  setupMailStack,
  storeAccountCredential,
} from "./mail-test-support.ts";

let env: MailTestStack;

beforeAll(async () => {
  env = await setupMailStack({ withFiles: false });
});

afterAll(async () => {
  await env.stack.cleanup();
  resetPiiSubjectKmsForTests();
});

beforeEach(() => {
  resetInboundInMemory();
});

function connectPayload(address: string, authMethod = "password") {
  return {
    provider: "inmemory",
    authMethod,
    displayName: "Team-Inbox",
    address,
    scope: "shared",
  };
}

describe("one mailbox per address", () => {
  test("connecting a live address again is refused, regardless of case", async () => {
    const admin = adminFor(6301);
    await connectInMemoryAccount(env.stack, admin, "inbox@tenant.example");

    const error = await env.stack.http.writeErr(
      InboundMailFoundationHandlers.connectAccount,
      connectPayload("Inbox@Tenant.example"),
      admin,
    );

    expect(JSON.stringify(error)).toContain(
      InboundMailConnectErrors.addressAlreadyConnected.reason,
    );
    expect(
      await selectMany(env.stack.db, mailAccountsProjectionTable, {
        tenantId: admin.tenantId,
      }),
    ).toHaveLength(1);
  });

  test("a disconnected password mailbox is not silently duplicated", async () => {
    const admin = adminFor(6302);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    await env.stack.http.writeOk(
      InboundMailFoundationHandlers.disconnectAccount,
      { accountId },
      admin,
    );

    const error = await env.stack.http.writeErr(
      InboundMailFoundationHandlers.connectAccount,
      connectPayload("inbox@tenant.example"),
      admin,
    );

    expect(JSON.stringify(error)).toContain(InboundMailConnectErrors.addressDisconnected.reason);
  });

  test("a disconnected OAuth mailbox is not reopened without the OAuth callback's owner override", async () => {
    const admin = adminFor(6304);
    const first = (await env.stack.http.writeOk(
      InboundMailFoundationHandlers.connectAccount,
      connectPayload("oauth-plain@tenant.example", "oauth"),
      admin,
    )) as { accountId: string };
    await env.stack.http.writeOk(
      InboundMailFoundationHandlers.disconnectAccount,
      { accountId: first.accountId },
      admin,
    );

    const error = await env.stack.http.writeErr(
      InboundMailFoundationHandlers.connectAccount,
      connectPayload("oauth-plain@tenant.example", "oauth"),
      admin,
    );

    expect(JSON.stringify(error)).toContain(InboundMailConnectErrors.addressDisconnected.reason);
    const [row] = await selectMany(env.stack.db, mailAccountsProjectionTable, {
      id: first.accountId,
    });
    expect(row?.["status"]).toBe(InboundMailAccountStatuses.disconnected);
  });

  test("the OAuth callback's connect finds the disconnected mailbox and leaves it off until the token is stored", async () => {
    const admin = adminFor(6303);
    const first = (await env.stack.http.writeOk(
      InboundMailFoundationHandlers.connectAccount,
      connectPayload("oauth@tenant.example", "oauth"),
      admin,
    )) as { accountId: string };
    await env.stack.http.writeOk(
      InboundMailFoundationHandlers.disconnectAccount,
      { accountId: first.accountId },
      admin,
    );

    const second = (await env.stack.http.writeOk(
      InboundMailFoundationHandlers.connectAccount,
      { ...connectPayload("oauth@tenant.example", "oauth"), ownerUserIdOverride: null },
      admin,
    )) as { accountId: string; reconnected?: boolean };

    expect(second.accountId).toBe(first.accountId);
    expect(second.reconnected).toBe(true);
    const [row] = await selectMany(env.stack.db, mailAccountsProjectionTable, {
      id: first.accountId,
    });
    expect(row?.["status"]).toBe(InboundMailAccountStatuses.disconnected);
  });
});

describe("reactivating a disconnected mailbox", () => {
  test("keeps the account id and the cursor, so nothing is imported twice", async () => {
    const admin = adminFor(6310);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    await seedInboundMessage(accountId, rawMsg({ providerMessageId: "before-1", text: "one" }));
    const supervisor = createMailSupervisor(env.stack);
    await supervisor.pollOnce();
    const [cursorBefore] = await selectMany(env.stack.db, syncCursorTable, { accountId });
    expect(cursorBefore).toBeDefined();

    await env.stack.http.writeOk(
      InboundMailFoundationHandlers.disconnectAccount,
      { accountId },
      admin,
    );
    await seedInboundMessage(accountId, rawMsg({ providerMessageId: "while-off-1", text: "two" }));
    await supervisor.pollOnce();
    expect(
      await selectMany(env.stack.db, inboundMessagesProjectionTable, { accountId }),
    ).toHaveLength(1);

    await storeAccountCredential(env, admin.tenantId, accountId, admin.id);
    await env.stack.http.writeOk(
      InboundMailFoundationHandlers.reactivateAccount,
      { accountId },
      admin,
    );
    await supervisor.pollOnce();

    const [row] = await selectMany(env.stack.db, mailAccountsProjectionTable, { id: accountId });
    expect(row?.["status"]).toBe(InboundMailAccountStatuses.active);
    const messages = await selectMany(env.stack.db, inboundMessagesProjectionTable, { accountId });
    expect(messages.map((m) => m["messageIdHeader"]).sort()).toEqual([
      "before-1@example.com",
      "while-off-1@example.com",
    ]);
    expect(await selectMany(env.stack.db, syncCursorTable, { accountId })).toHaveLength(1);
  });

  test("disconnecting removes the credential secret", async () => {
    const admin = adminFor(6312);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    await storeAccountCredential(env, admin.tenantId, accountId, admin.id);
    expect(await env.secrets.has(admin.tenantId, inboundCredentialSecretKey(accountId))).toBe(true);

    await env.stack.http.writeOk(
      InboundMailFoundationHandlers.disconnectAccount,
      { accountId },
      admin,
    );

    expect(await env.secrets.has(admin.tenantId, inboundCredentialSecretKey(accountId))).toBe(
      false,
    );
  });

  test("reactivating a disconnected mailbox without a new credential is refused", async () => {
    const admin = adminFor(6313);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    await storeAccountCredential(env, admin.tenantId, accountId, admin.id);
    await env.stack.http.writeOk(
      InboundMailFoundationHandlers.disconnectAccount,
      { accountId },
      admin,
    );

    const error = await env.stack.http.writeErr(
      InboundMailFoundationHandlers.reactivateAccount,
      { accountId },
      admin,
    );

    expect(JSON.stringify(error)).toContain("credential_required");
    const [row] = await selectMany(env.stack.db, mailAccountsProjectionTable, { id: accountId });
    expect(row?.["status"]).toBe(InboundMailAccountStatuses.disconnected);
  });

  test("only the owner reactivates a personal mailbox, not another tenant admin", async () => {
    const owner = adminFor(6314);
    const otherAdmin = createTestUser({
      id: 6315,
      tenantId: owner.tenantId,
      roles: ["TenantAdmin", "SystemAdmin"],
    });
    const { accountId } = (await env.stack.http.writeOk(
      InboundMailFoundationHandlers.connectAccount,
      { ...connectPayload("personal@tenant.example"), scope: "user" },
      owner,
    )) as { accountId: string };
    await env.stack.http.writeOk(
      InboundMailFoundationHandlers.disconnectAccount,
      { accountId },
      owner,
    );
    await storeAccountCredential(env, owner.tenantId, accountId, owner.id);

    const denied = await env.stack.http.writeErr(
      InboundMailFoundationHandlers.reactivateAccount,
      { accountId },
      otherAdmin,
    );
    expect(JSON.stringify(denied)).toContain("not_mailbox_owner");
    const [stillOff] = await selectMany(env.stack.db, mailAccountsProjectionTable, {
      id: accountId,
    });
    expect(stillOff?.["status"]).toBe(InboundMailAccountStatuses.disconnected);

    await env.stack.http.writeOk(
      InboundMailFoundationHandlers.reactivateAccount,
      { accountId },
      owner,
    );
    const [row] = await selectMany(env.stack.db, mailAccountsProjectionTable, { id: accountId });
    expect(row?.["status"]).toBe(InboundMailAccountStatuses.active);
  });

  test("reactivating an active mailbox changes nothing", async () => {
    const admin = adminFor(6311);
    const accountId = await connectInMemoryAccount(env.stack, admin);

    await env.stack.http.writeOk(
      InboundMailFoundationHandlers.reactivateAccount,
      { accountId },
      admin,
    );

    const [row] = await selectMany(env.stack.db, mailAccountsProjectionTable, { id: accountId });
    expect(row?.["status"]).toBe(InboundMailAccountStatuses.active);
  });
});
