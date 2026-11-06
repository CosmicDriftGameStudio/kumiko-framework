// Without file storage a stored original cannot be deleted, so forget-message must refuse instead of
// dropping the row that holds the only reference to it.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import { inboundMessageAggregateId } from "../aggregate-id.ts";
import { InboundMailFoundationHandlers, inboundMessagesProjectionTable } from "../index.ts";
import { ingestPayloadOf } from "../ingest-payload.ts";
import { normalizeRawInboundMessage } from "../normalize-inbound-message.ts";
import {
  adminFor,
  connectInMemoryAccount,
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

describe("forget-message without file storage", () => {
  test("a mail with a stored original is kept and the call fails", async () => {
    const admin = adminFor(7111);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    const msg = normalizeRawInboundMessage(rawMsg({ providerMessageId: "no-storage-1" }));
    const ingested = await env.stack.dispatcher.write(
      InboundMailFoundationHandlers.ingestMessage,
      ingestPayloadOf(
        {
          id: accountId,
          tenantId: admin.tenantId,
          provider: "inmemory",
          authMethod: "password",
          ownerUserId: null,
          address: "inbox@tenant.example",
          displayName: "Inbox",
          status: "active",
          watchState: "off",
        },
        msg,
        { providerCursor: "test", bodyRef: "stored/original.eml" },
      ),
      createSystemUser(admin.tenantId as TenantId, [ROLES.SystemAdmin]),
    );
    expect(ingested.isSuccess).toBe(true);
    const messageId = inboundMessageAggregateId(accountId, "no-storage-1");

    const error = await env.stack.http.writeErr(
      InboundMailFoundationHandlers.forgetMessage,
      { messageId },
      admin,
    );

    expect(error.httpStatus).toBe(500);
    const rows = await selectMany(env.stack.db, inboundMessagesProjectionTable, {
      tenantId: admin.tenantId,
      id: messageId,
    });
    expect(rows).toHaveLength(1);
  });
});
