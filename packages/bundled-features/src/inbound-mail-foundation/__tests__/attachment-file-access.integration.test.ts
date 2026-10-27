// Who may open the attachment of an imported mail through GET /files/:id: the mail's own
// visibility (personal mailbox: owner and admins, shared mailbox: every user of the tenant), and
// a client upload can never attach to the mail.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { fileRefsTable, fileUploadLedgerTable } from "@cosmicdrift/kumiko-framework/files";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import {
  buildMultipartBody,
  patchFileInstanceofForBunTest,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-testing/helpers";
import { resetInboundInMemory, seedInboundMessage } from "../../inbound-provider-inmemory/index.ts";
import { inboundMessageAggregateId } from "../aggregate-id.ts";
import { INBOUND_MESSAGE_AGGREGATE_TYPE } from "../events.ts";
import { InboundMailFoundationHandlers, InboundMailFoundationQueries } from "../index.ts";
import {
  adminFor,
  connectInMemoryAccount,
  createMailSupervisor,
  type MailTestStack,
  rawMsg,
  setupMailStack,
} from "./mail-test-support.ts";

const PDF_BYTES = new TextEncoder().encode("%PDF-1.4 mail attachment");

let env: MailTestStack;

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  env = await setupMailStack({ withFiles: true });
});

afterAll(async () => {
  await env.stack.cleanup();
  resetPiiSubjectKmsForTests();
});

beforeEach(() => {
  resetInboundInMemory();
});

async function attachmentOf(
  accountId: string,
  reader: ReturnType<typeof createTestUser>,
  providerMessageId: string,
): Promise<string> {
  await seedInboundMessage(
    accountId,
    rawMsg({
      providerMessageId,
      text: "with attachment",
      attachments: [{ fileName: "invoice.pdf", mimeType: "application/pdf", data: PDF_BYTES }],
    }),
  );
  await createMailSupervisor(env.stack).pollOnce();
  const content = await env.stack.http.queryOk<{ attachmentFileIds: string[] } | null>(
    InboundMailFoundationQueries.messageContent,
    { messageId: inboundMessageAggregateId(accountId, providerMessageId) },
    reader,
  );
  const fileId = content?.attachmentFileIds[0];
  if (fileId === undefined) throw new Error("expected the imported attachment");
  return fileId;
}

async function fileStatusAs(user: ReturnType<typeof createTestUser>, fileId: string) {
  const token = await env.stack.jwt.sign(user);
  const res = await env.stack.app.request(`/api/files/${fileId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.status;
}

describe("download of a mail attachment", () => {
  test("personal mailbox: owner and admin may open it, another user gets 404", async () => {
    const connector = adminFor(6801);
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
    const owner = createTestUser({
      id: connector.id,
      tenantId: connector.tenantId,
      roles: ["User"],
    });
    const tenantAdmin = createTestUser({
      id: 6802,
      tenantId: connector.tenantId,
      roles: ["TenantAdmin"],
    });
    const stranger = createTestUser({ id: 6803, tenantId: connector.tenantId, roles: ["User"] });
    const fileId = await attachmentOf(accountId, connector, "personal-1");

    expect(await fileStatusAs(owner, fileId)).toBe(200);
    expect(await fileStatusAs(tenantAdmin, fileId)).toBe(200);
    expect(await fileStatusAs(stranger, fileId)).toBe(404);
  });

  test("shared mailbox: every user of the tenant may open it", async () => {
    const admin = adminFor(6804);
    const reader = createTestUser({ id: 6805, tenantId: admin.tenantId, roles: ["User"] });
    const accountId = await connectInMemoryAccount(env.stack, admin);
    const fileId = await attachmentOf(accountId, admin, "shared-1");

    expect(await fileStatusAs(reader, fileId)).toBe(200);
  });
});

describe("client upload to the mail record", () => {
  test("POST /files naming the mail as target is refused and leaves no file behind", async () => {
    const admin = adminFor(6806);
    const accountId = await connectInMemoryAccount(env.stack, admin);
    await seedInboundMessage(accountId, rawMsg({ providerMessageId: "target-1", text: "x" }));
    await createMailSupervisor(env.stack).pollOnce();
    const rowsBefore = await selectMany(env.stack.db, fileRefsTable, { tenantId: admin.tenantId });
    const storedBefore = env.files ? (await env.files.list("")).length : 0;
    const ledgerBefore = await selectMany(env.stack.db, fileUploadLedgerTable, {});

    const fd = new FormData();
    fd.append("entityType", INBOUND_MESSAGE_AGGREGATE_TYPE);
    fd.append("entityId", inboundMessageAggregateId(accountId, "target-1"));
    fd.append("fieldName", "attachmentFileIds");
    fd.append("file", new File([Buffer.from(PDF_BYTES)], "evil.pdf", { type: "application/pdf" }));
    const { body, contentType } = await buildMultipartBody(fd);
    const token = await env.stack.jwt.sign(admin);
    const res = await env.stack.app.request("/api/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
      body,
    });

    expect(res.status).toBe(400);
    expect(
      await selectMany(env.stack.db, fileRefsTable, { tenantId: admin.tenantId }),
    ).toHaveLength(rowsBefore.length);
    expect(env.files ? (await env.files.list("")).length : 0).toBe(storedBefore);
    expect(await selectMany(env.stack.db, fileUploadLedgerTable, {})).toHaveLength(
      ledgerBefore.length,
    );
  });
});
