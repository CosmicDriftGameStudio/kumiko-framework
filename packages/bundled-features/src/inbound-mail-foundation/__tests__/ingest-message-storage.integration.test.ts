// ingest-message writes original and attachments before its transaction (top level) or inside it
// (when a wrapper handler dispatches it, the way an app's own ingest handler does). A storage outage
// at top level answers with its own code and leaves nothing behind.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  defineFeature,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import * as z from "zod";
import { resetInboundInMemory } from "../../inbound-provider-inmemory/index.ts";
import { inboundMessageAggregateId } from "../aggregate-id.ts";
import { FILE_STORAGE_WRITE_FAILED_CODE } from "../file-storage-failure.ts";
import {
  InboundMailFoundationHandlers,
  InboundMailFoundationQueries,
  type InboundMessageContent,
  inboundMessagesProjectionTable,
  seenMessageTable,
} from "../index.ts";
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

const PDF_BYTES = new TextEncoder().encode("%PDF-1.4 test attachment");
const EML_BYTES = new TextEncoder().encode("From: a@example.com\r\nSubject: original\r\n\r\nbody");
const WRAPPER_HANDLER = "ingest-wrapper:write:wrap-ingest";

const wrapperFeature = defineFeature("ingest-wrapper", (r) => {
  r.requires({ features: ["inbound-mail-foundation"] });
  r.writeHandler({
    name: "wrap-ingest",
    schema: z.object({ accountId: z.uuid(), providerMessageId: z.string() }),
    access: { roles: ["SystemAdmin"] },
    handler: async (event, ctx) => {
      const msg = normalizeRawInboundMessage(
        rawMsg({
          providerMessageId: event.payload.providerMessageId,
          text: "wrapped",
          rawMime: EML_BYTES,
          attachments: [{ fileName: "invoice.pdf", mimeType: "application/pdf", data: PDF_BYTES }],
        }),
      );
      const result = await ctx.dispatch.write(
        InboundMailFoundationHandlers.ingestMessage,
        ingestPayloadOf(accountOf(event.payload.accountId, event.user.tenantId), msg, {
          providerCursor: "wrapper",
          bodyRef: "",
        }),
      );
      if (!result.isSuccess)
        throw new Error(`nested ingest failed: ${JSON.stringify(result.error)}`);
      return { isSuccess: true as const, data: result.data };
    },
  });
});

let env: MailTestStack;

beforeAll(async () => {
  env = await setupMailStack({ withFiles: true, extraFeatures: [wrapperFeature] });
});

afterAll(async () => {
  await env.stack.cleanup();
  resetPiiSubjectKmsForTests();
});

beforeEach(() => {
  resetInboundInMemory();
  env.setFileStorageDown(false);
});

function systemWrite(tenantId: string, handlerQn: string, payload: unknown) {
  return env.stack.dispatcher.write(
    handlerQn,
    payload,
    createSystemUser(tenantId as TenantId, [ROLES.SystemAdmin]),
  );
}

describe("top level", () => {
  test("a storage outage answers with its own code and writes nothing", async () => {
    const admin = adminFor(6801);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    const msg = normalizeRawInboundMessage(
      rawMsg({
        providerMessageId: "t-1",
        text: "hello",
        rawMime: EML_BYTES,
        attachments: [{ fileName: "invoice.pdf", mimeType: "application/pdf", data: PDF_BYTES }],
      }),
    );
    env.setFileStorageDown(true);

    const result = await systemWrite(
      admin.tenantId,
      InboundMailFoundationHandlers.ingestMessage,
      ingestPayloadOf(accountOf(accountId, admin.tenantId), msg, {
        providerCursor: "test",
        bodyRef: "",
      }),
    );

    expect(result.isSuccess).toBe(false);
    expect(JSON.stringify(result)).toContain(FILE_STORAGE_WRITE_FAILED_CODE);
    expect(await selectMany(env.stack.db, inboundMessagesProjectionTable, { accountId })).toEqual(
      [],
    );
    expect(await selectMany(env.stack.db, seenMessageTable, { accountId })).toEqual([]);
  });
});

describe("nested in a wrapper handler", () => {
  test("original and attachment are stored inside the wrapper's transaction", async () => {
    const admin = adminFor(6802);
    const accountId = await connectInMemoryAccount(env.stack, admin);

    const result = await systemWrite(admin.tenantId, WRAPPER_HANDLER, {
      accountId,
      providerMessageId: "n-1",
    });

    expect(result.isSuccess).toBe(true);
    const content = await env.stack.http.queryOk<InboundMessageContent | null>(
      InboundMailFoundationQueries.messageContent,
      { messageId: inboundMessageAggregateId(accountId, "n-1") },
      admin,
    );
    expect(content?.contentState).toBe("complete");
    expect(content?.attachmentFileIds).toHaveLength(1);
    expect(await env.files?.read(content?.bodyRef ?? "")).toEqual(EML_BYTES);
  });
});
