// Reloading the content of snippet-only mails: attached once, terminal when nothing usable comes back
// or the mail is gone, and a repeated attach for a mail that has its content touches no storage.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import { createSystemUser, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import {
  contentFetchesOf,
  resetInboundInMemory,
  setInboundFullContent,
} from "../../inbound-provider-inmemory/index.ts";
import { inboundMessageAggregateId } from "../aggregate-id.ts";
import {
  InboundMailFoundationHandlers,
  InboundMailFoundationQueries,
  type InboundMessageContent,
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
  env.setFileStorageDown(false);
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

  test("a second attach for a mail that has its content uploads nothing", async () => {
    const admin = adminFor(6123);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    await ingestSnippetOnly(admin, accountId, "twice-1");
    const full = rawMsg({
      providerMessageId: "twice-1",
      text: "the complete text",
      rawMime: EML_BYTES,
      attachments: [{ fileName: "late.pdf", mimeType: "application/pdf", data: PDF_BYTES }],
    });
    setInboundFullContent(accountId, full);
    await createMailSupervisor(env.stack).pollOnce();
    expect((await contentOf(admin, accountId, "twice-1"))?.contentState).toBe("complete");

    // A broken storage makes any upload fail, so success proves the second call never uploaded.
    env.setFileStorageDown(true);
    const second = await env.stack.dispatcher.write(
      InboundMailFoundationHandlers.attachMessageContent,
      {
        accountId,
        providerMessageId: "twice-1",
        outcome: "fetched",
        bodyText: "the complete text",
        rawMime: EML_BYTES,
        attachments: full.attachments,
      },
      createSystemUser(admin.tenantId as TenantId, [ROLES.SystemAdmin]),
    );

    expect(second).toMatchObject({ isSuccess: true, data: { duplicate: true } });
    expect((await contentOf(admin, accountId, "twice-1"))?.attachmentFileIds).toHaveLength(1);
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
