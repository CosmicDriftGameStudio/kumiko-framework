// A mail that goes out in beforeTransaction can carry bytes the handler produced in the same
// hook (a PDF it just rendered), next to stored files, under the same count and size limits.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  defineFeature,
  type HandlerContext,
  type WriteResult,
} from "@cosmicdrift/kumiko-framework/engine";
import { createFileRefFromBytes } from "@cosmicdrift/kumiko-framework/files";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import * as z from "zod";
import {
  resetInboundInMemory,
  type SentMail,
  sentMailsOf,
} from "../../inbound-provider-inmemory/index.ts";
import {
  MAIL_SEND_ERRORS,
  OUTBOUND_ATTACHMENTS_MAX_BYTES,
  OUTBOUND_ATTACHMENTS_MAX_COUNT,
  type OutboundAttachment,
  outboundMailMessageSchema,
  sendMailFromAccount,
} from "../index.ts";
import {
  adminFor,
  connectInMemoryAccount,
  type MailTestStack,
  setupMailStack,
} from "./mail-test-support.ts";

const RENDERED_PDF = new TextEncoder().encode("%PDF-1.4 freshly rendered");
const STORED_BYTES = new TextEncoder().encode("stored file");

const sendFeature = defineFeature("outbound-bytes-test", (r) => {
  r.writeHandler({
    name: "send",
    description:
      "Sends a mail with bytes produced in the same hook, as an app's own handler would.",
    agent: { expose: false },
    schema: z.object({
      accountId: z.string(),
      message: outboundMailMessageSchema,
      attachedCount: z.number().int(),
      attachedByteSize: z.number().int().optional(),
    }),
    access: { roles: ["TenantAdmin"] },
    beforeTransaction: async (event, ctx) => {
      const { accountId, message, attachedCount, attachedByteSize } = event.payload;
      const attachedBytes: OutboundAttachment[] = Array.from({ length: attachedCount }, () => ({
        fileName: "rendered.pdf",
        mimeType: "application/pdf",
        data: attachedByteSize === undefined ? RENDERED_PDF : new Uint8Array(attachedByteSize),
      }));
      return sendMailFromAccount(ctx, { accountId, message, attachedBytes });
    },
    handler: async (event) => ({ isSuccess: true, data: event.prepared }),
  });
  r.writeHandler({
    name: "store-file",
    description: "Stores a file of the caller's tenant.",
    agent: { expose: false },
    schema: z.object({}),
    access: { roles: ["TenantAdmin"] },
    handler: async (_event, ctx: HandlerContext): Promise<WriteResult<{ id: string }>> =>
      createFileRefFromBytes(ctx, {
        fileName: "stored.txt",
        mimeType: "text/plain",
        data: Buffer.from(STORED_BYTES),
      }),
  });
});

let env: MailTestStack;
const admin = adminFor(6801);
let accountId: string;

beforeAll(async () => {
  env = await setupMailStack({ withFiles: true, extraFeatures: [sendFeature] });
  accountId = await connectInMemoryAccount(env.stack, admin);
});

afterAll(async () => {
  await env.stack.cleanup();
  resetPiiSubjectKmsForTests();
});

beforeEach(() => {
  resetInboundInMemory();
});

const message = (extra: Record<string, unknown> = {}) => ({
  to: ["kunde@example.org"],
  subject: "Mahnung",
  text: "Siehe Anhang",
  ...extra,
});

function lastSent(): SentMail {
  const sent = sentMailsOf(accountId).at(-1);
  if (sent === undefined) throw new Error("expected a sent mail");
  return sent;
}

describe("attachedBytes of sendMailFromAccount", () => {
  test("the mail carries the bytes the handler rendered, after the stored files", async () => {
    const stored = await env.stack.http.writeOk<{ id: string }>(
      "outbound-bytes-test:write:store-file",
      {},
      admin,
    );

    await env.stack.http.writeOk(
      "outbound-bytes-test:write:send",
      {
        accountId,
        message: message({ attachmentFileIds: [stored.id] }),
        attachedCount: 1,
      },
      admin,
    );

    const { attachments } = lastSent();
    expect(attachments.map((attachment) => attachment.fileName)).toEqual([
      "stored.txt",
      "rendered.pdf",
    ]);
    expect(Buffer.from(attachments[0]?.data ?? []).toString()).toBe("stored file");
    expect(Buffer.from(attachments[1]?.data ?? []).toString()).toBe("%PDF-1.4 freshly rendered");
  });

  test("bytes count against the size limit together with stored files", async () => {
    const error = await env.stack.http.writeErr(
      "outbound-bytes-test:write:send",
      {
        accountId,
        message: message(),
        attachedCount: 1,
        attachedByteSize: OUTBOUND_ATTACHMENTS_MAX_BYTES + 1,
      },
      admin,
    );

    expect(error.i18nKey).toBe(MAIL_SEND_ERRORS.attachmentsTooLarge.i18nKey);
    expect(sentMailsOf(accountId)).toHaveLength(0);
  });

  test("bytes count against the attachment count together with stored files", async () => {
    const error = await env.stack.http.writeErr(
      "outbound-bytes-test:write:send",
      { accountId, message: message(), attachedCount: OUTBOUND_ATTACHMENTS_MAX_COUNT + 1 },
      admin,
    );

    expect(error.i18nKey).toBe(MAIL_SEND_ERRORS.attachmentInvalid.i18nKey);
    expect(sentMailsOf(accountId)).toHaveLength(0);
  });
});
