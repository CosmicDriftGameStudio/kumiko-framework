// Full text, original and attachments of an imported mail: stored by default, readable through
// message:content, absent from message:list, encrypted at rest, and kept when the retention sweep
// removes the mail. Also the reload of snippet-only mails and the v1 event upcast.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { type StoredEvent, upcastStoredEvent } from "@cosmicdrift/kumiko-framework/event-store";
import { fileRefsTable } from "@cosmicdrift/kumiko-framework/files";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import {
  contentFetchesOf,
  resetInboundInMemory,
  seedInboundMessage,
  setInboundFullContent,
} from "../../inbound-provider-inmemory/index.ts";
import { inboundMessageAggregateId } from "../aggregate-id.ts";
import {
  INBOUND_MESSAGE_RECEIVED_EVENT_QN,
  InboundMailFoundationHandlers,
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

  test("message:list carries no body text, the column is encrypted at rest", async () => {
    const admin = adminFor(6103);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    const secretText = "confidential body text";
    await seedInboundMessage(accountId, rawMsg({ providerMessageId: "list-1", text: secretText }));

    await createMailSupervisor(env.stack).pollOnce();

    const list = await env.stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
      InboundMailFoundationQueries.listMessages,
      { accountId },
      admin,
    );
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]).not.toHaveProperty("bodyText");
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

describe("retention does not delete attachments", () => {
  test("the attachment FileRef survives when the mail is purged", async () => {
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

    const report = await runInboundMailRetention({
      db: env.stack.db,
      tenantId: admin.tenantId,
      now: getTemporal().Instant.from("2026-07-13T00:00:00Z"),
      seenRetentionDays: 100000,
    });

    expect(report.messagesPurged).toBe(1);
    expect(await selectMany(env.stack.db, inboundMessagesProjectionTable, { accountId })).toEqual(
      [],
    );
    expect(await selectMany(env.stack.db, fileRefsTable, { id: fileId })).toHaveLength(1);
  });
});

describe("snippet-only mails are reloaded", () => {
  async function ingestSnippetOnly(
    admin: ReturnType<typeof adminFor>,
    accountId: string,
    providerMessageId: string,
  ) {
    await env.stack.http.writeOk(
      InboundMailFoundationHandlers.ingestMessage,
      {
        accountId,
        ownerUserId: null,
        providerName: "inmemory",
        providerMessageId,
        messageIdHeader: `${providerMessageId}@example.com`,
        providerThreadId: null,
        references: [],
        from: "sender@example.com",
        to: ["inbox@tenant.example"],
        cc: [],
        subject: "Old import",
        snippet: "only the snippet",
        receivedAtIso: Temporal.Now.instant().toString(),
        bodyRef: "",
        scope: "inbox",
        providerCursor: '{"offset":0}',
      },
      admin,
    );
  }

  test("the full content is attached once, a second poll fetches nothing", async () => {
    const admin = adminFor(6120);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    await ingestSnippetOnly(admin, accountId, "snip-1");
    expect((await contentOf(admin, accountId, "snip-1"))?.contentState).toBe("snippet");
    setInboundFullContent(
      accountId,
      rawMsg({
        providerMessageId: "snip-1",
        text: "the complete text",
        rawMime: EML_BYTES,
        attachments: [{ fileName: "late.pdf", mimeType: "application/pdf", data: PDF_BYTES }],
      }),
    );
    const supervisor = createMailSupervisor(env.stack);

    await supervisor.pollOnce();

    const content = await contentOf(admin, accountId, "snip-1");
    expect(content?.bodyText).toBe("the complete text");
    expect(content?.contentState).toBe("complete");
    expect(content?.attachmentFileIds).toHaveLength(1);
    expect(contentFetchesOf(accountId)).toEqual([["snip-1"]]);

    await supervisor.pollOnce();

    expect(contentFetchesOf(accountId)).toEqual([["snip-1"]]);
    expect((await contentOf(admin, accountId, "snip-1"))?.attachmentFileIds).toHaveLength(1);
  });

  test("a fetch that returns neither text nor original ends as unavailable, not asked again", async () => {
    const admin = adminFor(6122);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    await ingestSnippetOnly(admin, accountId, "empty-1");
    setInboundFullContent(accountId, rawMsg({ providerMessageId: "empty-1", rawMime: null }));
    const supervisor = createMailSupervisor(env.stack);

    await supervisor.pollOnce();
    await supervisor.pollOnce();

    expect((await contentOf(admin, accountId, "empty-1"))?.contentState).toBe("unavailable");
    expect(contentFetchesOf(accountId)).toEqual([["empty-1"]]);
  });

  test("a mail that is gone from the server becomes unavailable and is not asked for again", async () => {
    const admin = adminFor(6121);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    await ingestSnippetOnly(admin, accountId, "gone-1");
    const supervisor = createMailSupervisor(env.stack);

    await supervisor.pollOnce();
    await supervisor.pollOnce();

    expect((await contentOf(admin, accountId, "gone-1"))?.contentState).toBe("unavailable");
    expect(contentFetchesOf(accountId)).toEqual([["gone-1"]]);
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

    expect(upcast.eventVersion).toBe(2);
    expect(upcast.payload).toMatchObject({
      bodyText: "",
      bodyTextTruncated: false,
      attachmentFileIds: [],
      skippedAttachments: [],
      contentState: "snippet",
    });
  });
});
