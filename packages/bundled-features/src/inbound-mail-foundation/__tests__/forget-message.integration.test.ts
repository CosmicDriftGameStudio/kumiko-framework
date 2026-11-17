// forget-message: one mail is removed for good (row, stored original, attachment files), the intake
// does not bring it back, and only the people who may see the mailbox can do it.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
  PII_ERASED_SENTINEL,
} from "@cosmicdrift/kumiko-framework/crypto";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { fileRefsTable } from "@cosmicdrift/kumiko-framework/files";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import { resetInboundInMemory, seedInboundMessage } from "../../inbound-provider-inmemory/index.ts";
import { inboundMessageAggregateId } from "../aggregate-id.ts";
import {
  InboundMailFoundationHandlers,
  InboundMailFoundationQueries,
  type InboundMessageContent,
  inboundMessagesProjectionTable,
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
  env = await setupMailStack({ withFiles: true });
});

afterAll(async () => {
  await env.stack.cleanup();
  resetPiiSubjectKmsForTests();
});

beforeEach(() => {
  resetInboundInMemory();
});

const PDF_BYTES = new TextEncoder().encode("%PDF-1.4 forgotten attachment");
const EML_BYTES = new TextEncoder().encode("From: a@example.com\r\nSubject: original\r\n\r\nbody");

async function importMailWithAttachment(accountId: string, providerMessageId: string) {
  await seedInboundMessage(
    accountId,
    rawMsg({
      providerMessageId,
      text: "to be forgotten",
      rawMime: EML_BYTES,
      attachments: [{ fileName: "invoice.pdf", mimeType: "application/pdf", data: PDF_BYTES }],
    }),
  );
  await createMailSupervisor(env.stack).pollOnce();
  return inboundMessageAggregateId(accountId, providerMessageId);
}

function rowsOf(tenantId: string, messageId: string) {
  return selectMany(env.stack.db, inboundMessagesProjectionTable, { tenantId, id: messageId });
}

describe("forget-message", () => {
  test("removes row, original and attachment, and a re-ingest does not bring the mail back", async () => {
    const admin = adminFor(7101);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    const messageId = await importMailWithAttachment(accountId, "forget-1");
    const content = await env.stack.http.queryOk<InboundMessageContent | null>(
      InboundMailFoundationQueries.messageContent,
      { messageId },
      admin,
    );
    const attachmentId = content?.attachmentFileIds[0] ?? "";
    expect(await env.files?.read(content?.bodyRef ?? "")).toEqual(EML_BYTES);

    await env.stack.http.writeOk(InboundMailFoundationHandlers.forgetMessage, { messageId }, admin);

    expect(await rowsOf(admin.tenantId, messageId)).toHaveLength(0);
    expect(await env.files?.exists(content?.bodyRef ?? "")).toBe(false);
    const refs = await selectMany<{ isDeleted: boolean }>(env.stack.db, fileRefsTable, {
      id: attachmentId,
    });
    expect(refs.every((ref) => ref.isDeleted)).toBe(true);

    await seedInboundMessage(
      accountId,
      rawMsg({ providerMessageId: "forget-1", text: "to be forgotten" }),
    );
    await createMailSupervisor(env.stack).pollOnce();
    expect(await rowsOf(admin.tenantId, messageId)).toHaveLength(0);
  });

  test("forgetting a mail makes its text in the event log unreadable, another mail stays readable", async () => {
    const admin = adminFor(7107);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    const forgottenId = await importMailWithAttachment(accountId, "forget-log-1");
    const keptId = await importMailWithAttachment(accountId, "forget-log-2");

    await env.stack.http.writeOk(
      InboundMailFoundationHandlers.forgetMessage,
      { messageId: forgottenId },
      admin,
    );

    const kms = configuredPiiSubjectKms();
    if (!kms) throw new Error("expected a configured PII-subject KMS in this test stack");
    const readReceived = async (messageId: string) => {
      const events = await selectMany<{ type: string; payload: { from?: string; bodyText?: string } }>(
        env.stack.db,
        eventsTable,
        { aggregateId: messageId },
      );
      const received = events.find((e) => e.type.endsWith("inbound-message-received"));
      const { from, bodyText } = received?.payload ?? {};
      if (!from || !bodyText) throw new Error("expected a received event with from and bodyText");
      return decryptPiiFieldValues({ from, bodyText }, ["from", "bodyText"], kms, {
        requestId: `test:forget-read:${messageId}`,
      });
    };

    const forgotten = await readReceived(forgottenId);
    expect(forgotten["from"]).toBe(PII_ERASED_SENTINEL);
    expect(forgotten["bodyText"]).toBe(PII_ERASED_SENTINEL);
    const kept = await readReceived(keptId);
    expect(kept["from"]).toBe("sender@example.com");
  });

  test("a mail of another tenant is not found and survives", async () => {
    const admin = adminFor(7102);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    const messageId = await importMailWithAttachment(accountId, "foreign-1");

    const error = await env.stack.http.writeErr(
      InboundMailFoundationHandlers.forgetMessage,
      { messageId },
      adminFor(7103),
    );

    expect(error.httpStatus).toBe(404);
    expect(await rowsOf(admin.tenantId, messageId)).toHaveLength(1);
  });

  test("a member without admin rights may not forget a shared mail", async () => {
    const admin = adminFor(7104);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    const messageId = await importMailWithAttachment(accountId, "shared-1");
    const member = createTestUser({ id: 7105, tenantId: admin.tenantId, roles: ["User"] });

    const error = await env.stack.http.writeErr(
      InboundMailFoundationHandlers.forgetMessage,
      { messageId },
      member,
    );

    expect(error.httpStatus).toBe(403);
    expect(await rowsOf(admin.tenantId, messageId)).toHaveLength(1);
  });

  test("the owner of a personal mailbox may forget its mail, an admin sees it as not found", async () => {
    const connector = adminFor(7106);
    const owner = createTestUser({
      id: connector.id,
      tenantId: connector.tenantId,
      roles: ["User"],
    });
    const { accountId } = await env.stack.http.writeOk<{ accountId: string }>(
      InboundMailFoundationHandlers.connectAccount,
      {
        provider: "inmemory",
        authMethod: "password",
        displayName: "Mine",
        address: "mine@tenant.example",
        scope: "user",
      },
      connector,
    );
    const messageId = await importMailWithAttachment(accountId, "personal-1");
    const otherAdmin = createTestUser({
      id: 7107,
      tenantId: owner.tenantId,
      roles: ["TenantAdmin"],
    });

    const refused = await env.stack.http.writeErr(
      InboundMailFoundationHandlers.forgetMessage,
      { messageId },
      otherAdmin,
    );
    expect(refused.httpStatus).toBe(404);
    expect(await rowsOf(owner.tenantId, messageId)).toHaveLength(1);

    await env.stack.http.writeOk(InboundMailFoundationHandlers.forgetMessage, { messageId }, owner);
    expect(await rowsOf(owner.tenantId, messageId)).toHaveLength(0);
  });
});
