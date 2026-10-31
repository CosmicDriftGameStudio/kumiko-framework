// Full text, original and attachments of an imported mail: stored by default, readable through
// message:content, absent from message:list, encrypted at rest, and removed with the mail by the
// retention sweep. Also the v1 event upcast; the reload of snippet-only mails is in content-refetch.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createTenantDb, selectMany } from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser } from "@cosmicdrift/kumiko-framework/engine";
import { type StoredEvent, upcastStoredEvent } from "@cosmicdrift/kumiko-framework/event-store";
import { deleteFileRefsBoundToRecord, fileRefsTable } from "@cosmicdrift/kumiko-framework/files";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { resetInboundInMemory, seedInboundMessage } from "../../inbound-provider-inmemory/index.ts";
import { inboundMessageAggregateId } from "../aggregate-id.ts";
import {
  INBOUND_MESSAGE_AGGREGATE_TYPE,
  INBOUND_MESSAGE_CONTENT_FETCHED_EVENT_QN,
} from "../events.ts";
import {
  INBOUND_MESSAGE_RECEIVED_EVENT_QN,
  InboundMailFoundationQueries,
  type InboundMessageContent,
  inboundMessagesProjectionTable,
} from "../index.ts";
import { runInboundMailRetention } from "../retention-sweep.ts";
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

const PDF_BYTES = new TextEncoder().encode("%PDF-1.4 test attachment");
const EML_BYTES = new TextEncoder().encode("From: a@example.com\r\nSubject: original\r\n\r\nbody");

function contentOf(
  admin: ReturnType<typeof adminFor>,
  accountId: string,
  providerMessageId: string,
) {
  return env.stack.http.queryOk<InboundMessageContent | null>(
    InboundMailFoundationQueries.messageContent,
    { messageId: inboundMessageAggregateId(accountId, providerMessageId) },
    admin,
  );
}

describe("content stored at ingest", () => {
  test("text, original and attachment are stored and readable", async () => {
    const admin = adminFor(6101);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    await seedInboundMessage(
      accountId,
      rawMsg({
        providerMessageId: "full-1",
        text: "Hello with attachment",
        html: "<p>Hello</p>",
        rawMime: EML_BYTES,
        attachments: [{ fileName: "invoice.pdf", mimeType: "application/pdf", data: PDF_BYTES }],
      }),
    );

    await createMailSupervisor(env.stack).pollOnce();

    const content = await contentOf(admin, accountId, "full-1");
    expect(content?.bodyText).toBe("Hello with attachment");
    expect(content?.bodyTextTruncated).toBe(false);
    expect(content?.contentState).toBe("complete");
    expect(content?.attachmentFileIds).toHaveLength(1);
    const refs = await selectMany(env.stack.db, fileRefsTable, {
      id: content?.attachmentFileIds[0],
    });
    expect(refs).toHaveLength(1);
    expect(content?.bodyRef.endsWith(".eml")).toBe(true);
    expect(await env.files?.read(content?.bodyRef ?? "")).toEqual(EML_BYTES);
  });

  test("an HTML-only mail keeps the HTML as its original", async () => {
    const admin = adminFor(6102);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    await seedInboundMessage(
      accountId,
      rawMsg({ providerMessageId: "html-1", html: "<p>only html</p>", rawMime: null }),
    );

    await createMailSupervisor(env.stack).pollOnce();

    const content = await contentOf(admin, accountId, "html-1");
    expect(content?.bodyRef.endsWith(".html")).toBe(true);
    expect(content?.contentState).toBe("complete");
  });

  test("message:list carries no body text or HTML, the column is encrypted at rest", async () => {
    const admin = adminFor(6103);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    const secretText = "confidential body text";
    await seedInboundMessage(
      accountId,
      rawMsg({ providerMessageId: "list-1", text: secretText, html: "<p>confidential html</p>" }),
    );

    await createMailSupervisor(env.stack).pollOnce();

    const list = await env.stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
      InboundMailFoundationQueries.listMessages,
      { accountId },
      admin,
    );
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]).not.toHaveProperty("bodyText");
    expect(list.rows[0]).not.toHaveProperty("bodyHtml");
    const [stored] = await selectMany(env.stack.db, inboundMessagesProjectionTable, { accountId });
    expect(stored?.["bodyText"]).not.toBe(secretText);
    expect(String(stored?.["bodyText"])).not.toContain(secretText);
  });

  test("a body beyond 32,000 characters is cut and flagged", async () => {
    const admin = adminFor(6104);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    await seedInboundMessage(
      accountId,
      rawMsg({ providerMessageId: "long-1", text: "x".repeat(40_000) }),
    );

    await createMailSupervisor(env.stack).pollOnce();

    const content = await contentOf(admin, accountId, "long-1");
    expect(content?.bodyText).toHaveLength(32_000);
    expect(content?.bodyTextTruncated).toBe(true);
  });

  test("an attachment above the 10 MB upload default but within the mail limit is stored", async () => {
    const admin = adminFor(6106);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    const twelveMegabytes = 12 * 1024 * 1024;
    await seedInboundMessage(
      accountId,
      rawMsg({
        providerMessageId: "twelve-1",
        text: "see attachment",
        attachments: [
          {
            fileName: "scan.bin",
            mimeType: "application/octet-stream",
            data: new Uint8Array(twelveMegabytes),
          },
        ],
      }),
    );

    await createMailSupervisor(env.stack).pollOnce();

    const content = await contentOf(admin, accountId, "twelve-1");
    expect(content?.skippedAttachments).toEqual([]);
    expect(content?.attachmentFileIds).toHaveLength(1);
    const [ref] = await selectMany(env.stack.db, fileRefsTable, {
      id: content?.attachmentFileIds[0],
    });
    expect(Number(ref?.["size"])).toBe(twelveMegabytes);
  });

  test("an oversized attachment is skipped with its reason, the mail still arrives", async () => {
    const admin = adminFor(6105);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    await seedInboundMessage(
      accountId,
      rawMsg({
        providerMessageId: "big-1",
        text: "see attachment",
        attachments: [
          {
            fileName: "huge.bin",
            mimeType: "application/octet-stream",
            data: new Uint8Array(25 * 1024 * 1024 + 1),
          },
        ],
      }),
    );

    await createMailSupervisor(env.stack).pollOnce();

    const content = await contentOf(admin, accountId, "big-1");
    expect(content?.attachmentFileIds).toEqual([]);
    expect(content?.skippedAttachments).toEqual([
      { mimeType: "application/octet-stream", size: 25 * 1024 * 1024 + 1, reason: "too_large" },
    ]);
  });
});

describe("retention removes the attachments of a purged mail", () => {
  test("the attachment FileRef is deleted with the mail", async () => {
    const admin = adminFor(6110);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    await seedInboundMessage(
      accountId,
      rawMsg({
        providerMessageId: "old-1",
        receivedAtIso: "2024-01-01T10:00:00Z",
        text: "old mail",
        attachments: [{ fileName: "keep.pdf", mimeType: "application/pdf", data: PDF_BYTES }],
      }),
    );
    await createMailSupervisor(env.stack).pollOnce();
    const content = await contentOf(admin, accountId, "old-1");
    const fileId = content?.attachmentFileIds[0];
    expect(fileId).toBeDefined();

    const [boundRef] = await selectMany(env.stack.db, fileRefsTable, { id: fileId });
    expect(boundRef?.["entityType"]).toBe(INBOUND_MESSAGE_AGGREGATE_TYPE);
    expect(boundRef?.["entityId"]).toBe(inboundMessageAggregateId(accountId, "old-1"));
    expect(boundRef?.["fieldName"]).toBe("attachmentFileIds");

    const tenantDb = createTenantDb({ db: env.stack.db, tenantId: admin.tenantId });
    const report = await runInboundMailRetention({
      db: env.stack.db,
      tenantId: admin.tenantId,
      now: getTemporal().Instant.from("2026-07-13T00:00:00Z"),
      seenRetentionDays: 100000,
      deleteAttachments: async (messageId) => {
        await deleteFileRefsBoundToRecord({
          db: tenantDb,
          user: createSystemUser(admin.tenantId),
          entityType: INBOUND_MESSAGE_AGGREGATE_TYPE,
          entityId: messageId,
        });
      },
    });

    expect(report.messagesPurged).toBe(1);
    expect(await selectMany(env.stack.db, inboundMessagesProjectionTable, { accountId })).toEqual(
      [],
    );
    const [afterSweep] = await selectMany(env.stack.db, fileRefsTable, { id: fileId });
    expect(afterSweep?.["isDeleted"]).toBe(true);
  });
});

describe("sanitized HTML body", () => {
  test("only the sanitized HTML is stored and returned by message:content", async () => {
    const admin = adminFor(6140);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    await seedInboundMessage(
      accountId,
      rawMsg({
        providerMessageId: "html-1",
        text: "Hello",
        html: '<p onclick="steal()">Hello</p><script>alert(1)</script><img src="cid:logo">',
      }),
    );
    await createMailSupervisor(env.stack).pollOnce();

    const content = await contentOf(admin, accountId, "html-1");
    expect(content?.bodyHtml).toBe("<p>Hello</p>");
  });

  test("multi-byte HTML near the byte cap is stored, beyond it the mail arrives without HTML", async () => {
    const admin = adminFor(6142);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    // "€" takes three UTF-8 bytes: the first mail stays just under 500,000 bytes. The second has only
    // 400,000 characters but 1.2 MB, whose ciphertext would exceed the event's bodyHtml maximum.
    const nearCap = `<p>${"€".repeat(166_000)}</p>`;
    await seedInboundMessage(
      accountId,
      rawMsg({ providerMessageId: "euro-near", text: "near", html: nearCap }),
    );
    await seedInboundMessage(
      accountId,
      rawMsg({
        providerMessageId: "euro-over",
        text: "over",
        html: `<p>${"€".repeat(400_000)}</p>`,
      }),
    );
    await createMailSupervisor(env.stack).pollOnce();

    expect((await contentOf(admin, accountId, "euro-near"))?.bodyHtml).toBe(nearCap);
    const over = await contentOf(admin, accountId, "euro-over");
    expect(over?.bodyText).toBe("over");
    expect(over?.bodyHtml).toBeNull();
  });

  test("a mail without HTML reads bodyHtml null", async () => {
    const admin = adminFor(6141);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    await seedInboundMessage(
      accountId,
      rawMsg({ providerMessageId: "plain-1", text: "Only text" }),
    );
    await createMailSupervisor(env.stack).pollOnce();

    expect((await contentOf(admin, accountId, "plain-1"))?.bodyHtml).toBeNull();
  });
});

describe("event versions", () => {
  test("a v1 received event reads with the content defaults", async () => {
    const upcasters = env.stack.registry.getEventUpcasters();
    const v1: StoredEvent = {
      id: "1",
      aggregateId: "00000000-0000-4000-8000-0000000000a1",
      aggregateType: "inbound-message",
      tenantId: adminFor(6130).tenantId,
      version: 1,
      type: INBOUND_MESSAGE_RECEIVED_EVENT_QN,
      eventVersion: 1,
      payload: {
        accountId: "00000000-0000-4000-8000-0000000000a2",
        ownerUserId: null,
        messageIdHeader: "old@example.com",
        threadKey: "inmemory:old",
        from: "f",
        to: "[]",
        cc: "[]",
        subject: "s",
        snippet: "n",
        receivedAtIso: "2026-01-01T00:00:00Z",
        bodyRef: "",
        scope: "inbox",
      },
      metadata: { userId: "1" },
      createdAt: Temporal.Now.instant(),
      createdBy: "1",
    };

    const upcast = await upcastStoredEvent(v1, upcasters, {
      db: env.stack.db,
      tenantId: v1.tenantId,
    });

    expect(upcast.eventVersion).toBe(4);
    expect(upcast.payload).toMatchObject({
      bodyHtml: null,
      bodyText: "",
      bodyTextTruncated: false,
      attachmentFileIds: [],
      skippedAttachments: [],
      contentState: "snippet",
      contentUnavailableReason: null,
    });
  });

  test("a v1 content-fetched event reads without an unavailable reason", async () => {
    const upcasters = env.stack.registry.getEventUpcasters();
    const v1: StoredEvent = {
      id: "2",
      aggregateId: "00000000-0000-4000-8000-0000000000a1",
      aggregateType: "inbound-message",
      tenantId: adminFor(6131).tenantId,
      version: 2,
      type: INBOUND_MESSAGE_CONTENT_FETCHED_EVENT_QN,
      eventVersion: 1,
      payload: {
        bodyRef: "",
        bodyText: "",
        bodyTextTruncated: false,
        attachmentFileIds: [],
        skippedAttachments: [],
        contentState: "unavailable",
      },
      metadata: { userId: "1" },
      createdAt: Temporal.Now.instant(),
      createdBy: "1",
    };

    const upcast = await upcastStoredEvent(v1, upcasters, {
      db: env.stack.db,
      tenantId: v1.tenantId,
    });

    expect(upcast.eventVersion).toBe(4);
    expect(upcast.payload).toMatchObject({
      contentUnavailableReason: null,
      accountId: null,
      ownerUserId: null,
    });
  });

  test("a v2 content-fetched event reads with null accountId and ownerUserId", async () => {
    const upcasters = env.stack.registry.getEventUpcasters();
    const v2: StoredEvent = {
      id: "3",
      aggregateId: "00000000-0000-4000-8000-0000000000a2",
      aggregateType: "inbound-message",
      tenantId: adminFor(6132).tenantId,
      version: 2,
      type: INBOUND_MESSAGE_CONTENT_FETCHED_EVENT_QN,
      eventVersion: 2,
      payload: {
        bodyRef: "",
        bodyText: "",
        bodyTextTruncated: false,
        attachmentFileIds: [],
        skippedAttachments: [],
        contentState: "unavailable",
        contentUnavailableReason: "gone_from_server",
      },
      metadata: { userId: "1" },
      createdAt: Temporal.Now.instant(),
      createdBy: "1",
    };

    const upcast = await upcastStoredEvent(v2, upcasters, {
      db: env.stack.db,
      tenantId: v2.tenantId,
    });

    expect(upcast.eventVersion).toBe(4);
    expect(upcast.payload).toMatchObject({
      contentUnavailableReason: "gone_from_server",
      accountId: null,
      ownerUserId: null,
    });
  });
});
