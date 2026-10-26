// Which stored files a caller may attach to an outgoing mail: the file's own read rule, plus the
// attachments of inbound mails in mailboxes the caller can see. A refusal answers like an unknown id.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createFileField,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDetailHandler,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { fileRefsTable } from "@cosmicdrift/kumiko-framework/files";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import {
  buildMultipartBody,
  patchFileInstanceofForBunTest,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-testing/helpers";
import { unsafeCreateEntityTable } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { resetInboundInMemory, seedInboundMessage } from "../../inbound-provider-inmemory/index.ts";
import { inboundMessageAggregateId } from "../aggregate-id.ts";
import { InboundMailFoundationHandlers, InboundMailFoundationQueries } from "../index.ts";
import { resolveOutboundAttachments } from "../outbound-attachments.ts";
import {
  adminFor,
  connectInMemoryAccount,
  createMailSupervisor,
  type MailTestStack,
  rawMsg,
  setupMailStack,
} from "./mail-test-support.ts";

const dossierEntity = createEntity({
  table: "outbound_access_dossiers",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
    scan: createFileField(),
  },
});

const probeFeature = defineFeature("outbound-access-test", (r) => {
  r.entity({ name: "dossier", ...dossierEntity });
  r.writeHandler(
    defineEntityCreateHandler("dossier", dossierEntity, {
      access: { roles: ["TenantAdmin", "User"] },
    }),
  );
  r.queryHandler(
    defineEntityDetailHandler("dossier", dossierEntity, { access: { roles: ["TenantAdmin"] } }),
  );
  r.writeHandler({
    name: "resolve",
    description: "Runs the attachment resolution of an outgoing mail, as sendMailFromAccount does.",
    agent: { expose: false },
    schema: z.object({ fileIds: z.array(z.string()) }),
    access: { roles: ["TenantAdmin", "User"] },
    handler: async (event, ctx) => {
      const resolved = await resolveOutboundAttachments(ctx, event.payload.fileIds);
      return {
        isSuccess: true as const,
        data: resolved.isSuccess
          ? { ok: true, count: resolved.attachments.length }
          : { ok: false, failure: resolved.failure },
      };
    },
  });
});

const PDF_BYTES = new TextEncoder().encode("%PDF-1.4 test attachment");

let env: MailTestStack;

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  env = await setupMailStack({ withFiles: true, extraFeatures: [probeFeature] });
  await unsafeCreateEntityTable(env.stack.db, dossierEntity, "dossier");
});

afterAll(async () => {
  await env.stack.cleanup();
  resetPiiSubjectKmsForTests();
});

beforeEach(() => {
  resetInboundInMemory();
});

type Resolved = { ok: boolean; count?: number; failure?: string };

function resolveAs(user: ReturnType<typeof createTestUser>, fileIds: string[]) {
  return env.stack.http.writeOk<Resolved>("outbound-access-test:write:resolve", { fileIds }, user);
}

async function importedAttachmentOf(
  owner: ReturnType<typeof adminFor>,
  accountId: string,
): Promise<string> {
  await seedInboundMessage(
    accountId,
    rawMsg({
      providerMessageId: "att-1",
      text: "with attachment",
      attachments: [{ fileName: "invoice.pdf", mimeType: "application/pdf", data: PDF_BYTES }],
    }),
  );
  await createMailSupervisor(env.stack).pollOnce();
  const content = await env.stack.http.queryOk<{ attachmentFileIds: string[] } | null>(
    InboundMailFoundationQueries.messageContent,
    { messageId: inboundMessageAggregateId(accountId, "att-1") },
    owner,
  );
  const fileId = content?.attachmentFileIds[0];
  if (fileId === undefined) throw new Error("expected the imported attachment");
  return fileId;
}

async function uploadForDossier(as: ReturnType<typeof createTestUser>): Promise<string> {
  const token = await env.stack.jwt.sign(as);
  const fd = new FormData();
  fd.append("entityType", "dossier");
  fd.append("fieldName", "scan");
  fd.append("file", new File([Buffer.from(PDF_BYTES)], "scan.pdf", { type: "application/pdf" }));
  const { body, contentType } = await buildMultipartBody(fd);
  const res = await env.stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body,
  });
  expect(res.status).toBe(201);
  return z.object({ id: z.string() }).parse(await res.json()).id;
}

describe("attachments of an imported mail", () => {
  test("only callers who can see the mailbox may attach them", async () => {
    const owner = adminFor(6701);
    const other = createTestUser({ id: 6702, tenantId: owner.tenantId, roles: ["User"] });
    const { accountId } = await env.stack.http.writeOk<{ accountId: string }>(
      InboundMailFoundationHandlers.connectAccount,
      {
        provider: "inmemory",
        authMethod: "password",
        displayName: "Mine",
        address: "mine@tenant.example",
        scope: "user",
      },
      owner,
    );
    const fileId = await importedAttachmentOf(owner, accountId);

    expect(await resolveAs(owner, [fileId])).toEqual({ ok: true, count: 1 });
    expect(await resolveAs(other, [fileId])).toEqual({ ok: false, failure: "attachmentInvalid" });
  });

  test("a shared mailbox's attachments are open to every caller of the tenant", async () => {
    const admin = adminFor(6703);
    const member = createTestUser({ id: 6704, tenantId: admin.tenantId, roles: ["User"] });
    const accountId = await connectInMemoryAccount(env.stack, admin);
    const fileId = await importedAttachmentOf(admin, accountId);

    expect(await resolveAs(member, [fileId])).toEqual({ ok: true, count: 1 });
  });
});

describe("other stored files", () => {
  test("a file bound to a record the caller cannot read is refused like an unknown id", async () => {
    const admin = adminFor(6705);
    const member = createTestUser({ id: 6706, tenantId: admin.tenantId, roles: ["User"] });
    const fileId = await uploadForDossier(admin);
    await env.stack.http.writeOk(
      "outbound-access-test:write:dossier:create",
      { title: "Private", scan: fileId },
      admin,
    );
    const [ref] = await selectMany(env.stack.db, fileRefsTable, { id: fileId });
    expect(ref?.["entityType"]).toBe("dossier");

    expect(await resolveAs(admin, [fileId])).toEqual({ ok: true, count: 1 });
    const refused = await resolveAs(member, [fileId]);
    const unknown = await resolveAs(member, [crypto.randomUUID()]);
    expect(refused).toEqual({ ok: false, failure: "attachmentInvalid" });
    expect(refused).toEqual(unknown);
  });
});
