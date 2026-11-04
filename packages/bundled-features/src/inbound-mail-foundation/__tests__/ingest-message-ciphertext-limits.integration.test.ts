// The event payload holds PII ciphertext, which is longer than the plaintext limits of the ingest
// schema: a field at its plaintext maximum must still append, and the list query returns it whole.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import { createSystemUser, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import { InboundMailFoundationHandlers, InboundMailFoundationQueries } from "../index.ts";
import { ingestPayloadOf } from "../ingest-payload.ts";
import { normalizeRawInboundMessage } from "../normalize-inbound-message.ts";
import type { MailAccountRecord } from "../types.ts";
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

function accountOf(id: string, tenantId: string): MailAccountRecord {
  return {
    id,
    tenantId,
    provider: "inmemory",
    authMethod: "password",
    ownerUserId: null,
    address: "inbox@tenant.example",
    displayName: "Inbox",
    status: "active",
    watchState: "off",
  };
}

describe("ingest-message with PII encryption", () => {
  test("from, subject and snippet at their plaintext maximum are appended and read back whole", async () => {
    const admin = adminFor(6811);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    const from = "f".repeat(2000);
    const subject = "s".repeat(4000);
    const snippet = "n".repeat(4000);
    const msg = normalizeRawInboundMessage(
      rawMsg({ providerMessageId: "limits-1", from, subject, snippet }),
    );

    const result = await env.stack.dispatcher.write(
      InboundMailFoundationHandlers.ingestMessage,
      ingestPayloadOf(accountOf(accountId, admin.tenantId), msg, {
        providerCursor: "test",
        bodyRef: "",
      }),
      createSystemUser(admin.tenantId as TenantId, [ROLES.SystemAdmin]),
    );

    expect(result.isSuccess).toBe(true);
    const list = (await env.stack.http.queryOk(
      InboundMailFoundationQueries.listMessages,
      { accountId },
      admin,
    )) as { rows: Array<Record<string, unknown>> };
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]?.["from"]).toBe(from);
    expect(list.rows[0]?.["subject"]).toBe(subject);
    expect(list.rows[0]?.["snippet"]).toBe(snippet);
  });
});
