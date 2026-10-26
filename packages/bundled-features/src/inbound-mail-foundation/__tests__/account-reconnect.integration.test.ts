// Disconnect and reconnect: the same address cannot be connected twice, a disconnected mailbox comes
// back as the same account (same stream, same sync cursor), so nothing is imported twice.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import { resetInboundInMemory, seedInboundMessage } from "../../inbound-provider-inmemory/index.ts";
import {
  InboundMailAccountStatuses,
  InboundMailConnectErrors,
  InboundMailFoundationHandlers,
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

  test("a disconnected OAuth mailbox is reopened in place", async () => {
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
      connectPayload("oauth@tenant.example", "oauth"),
      admin,
    )) as { accountId: string; reconnected?: boolean };

    expect(second.accountId).toBe(first.accountId);
    expect(second.reconnected).toBe(true);
    const [row] = await selectMany(env.stack.db, mailAccountsProjectionTable, {
      id: first.accountId,
    });
    expect(row?.["status"]).toBe(InboundMailAccountStatuses.active);
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
