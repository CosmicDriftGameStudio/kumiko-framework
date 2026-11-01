// A document gated by readGate.fileOwner whose file is a mail attachment passes exactly for
// those who may read the mail: its owner for a personal mailbox (no admin exception), every
// member for a shared one, nobody of another tenant.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createFileField,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { fileRefsTable } from "@cosmicdrift/kumiko-framework/files";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  patchFileInstanceofForBunTest,
  resetPiiSubjectKmsForTests,
  seedRows,
} from "@cosmicdrift/kumiko-testing/helpers";
import { unsafeCreateEntityTable } from "@cosmicdrift/kumiko-testing/stack";
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

const documentEntity = createEntity({
  table: "mail_gate_documents",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture" }),
    file: createFileField(),
  },
  readGate: { fileOwner: { field: "file" } },
});
const documentTable = buildEntityTable("document", documentEntity);

const documentFeature = defineFeature("mailgate", (r) => {
  r.crud("document", documentEntity, {
    write: { access: { roles: ["SystemAdmin"] } },
    read: { access: { roles: ["User", "TenantAdmin", "SystemAdmin"] } },
  });
});

const LIST = "mailgate:query:document:list";

let env: MailTestStack;

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  env = await setupMailStack({ withFiles: true, extraFeatures: [documentFeature] });
  await unsafeCreateEntityTable(env.stack.db, documentEntity, "document");
});

afterAll(async () => {
  await env.stack.cleanup();
  resetPiiSubjectKmsForTests();
});

type User = ReturnType<typeof createTestUser>;

async function importedMessage(accountId: string, reader: User, providerMessageId: string) {
  await seedInboundMessage(
    accountId,
    rawMsg({
      providerMessageId,
      text: "with attachment",
      attachments: [{ fileName: "invoice.pdf", mimeType: "application/pdf", data: PDF_BYTES }],
    }),
  );
  await createMailSupervisor(env.stack).pollOnce();
  const messageId = inboundMessageAggregateId(accountId, providerMessageId);
  const content = await env.stack.http.queryOk<{ attachmentFileIds: string[] } | null>(
    InboundMailFoundationQueries.messageContent,
    { messageId },
    reader,
  );
  const fileId = content?.attachmentFileIds[0];
  if (fileId === undefined) throw new Error("expected the imported attachment");
  return { messageId, fileId };
}

async function seedDocument(tenantId: string, id: string, file: string) {
  await seedRows(env.stack.db, documentTable, [{ id, tenantId, title: "doc", file }]);
}

async function listedIds(as: User): Promise<string[]> {
  const result = await env.stack.http.queryOk<{ rows: { id: string }[] }>(LIST, { limit: 50 }, as);
  return result.rows.map((row) => row.id);
}

const PERSONAL_DOC = "d0000000-0000-4000-8000-000000000001";
const SHARED_DOC = "d0000000-0000-4000-8000-000000000002";
const FOREIGN_DOC = "d0000000-0000-4000-8000-000000000003";

describe("document whose file is an inbound-message attachment", () => {
  test("follows the visibility of the mail across personal, shared and foreign tenants", async () => {
    resetInboundInMemory();
    const connector = adminFor(6901);
    const tenantId = connector.tenantId;
    const personalAccount = (
      await env.stack.http.writeOk<{ accountId: string }>(
        InboundMailFoundationHandlers.connectAccount,
        {
          provider: "inmemory",
          authMethod: "password",
          displayName: "Mine",
          address: "mine@tenant.example",
          scope: "user",
        },
        connector,
      )
    ).accountId;
    const owner = createTestUser({ id: connector.id, tenantId, roles: ["User"] });
    const otherMember = createTestUser({ id: 6902, tenantId, roles: ["User"] });
    const tenantAdmin = createTestUser({ id: 6903, tenantId, roles: ["TenantAdmin"] });
    const sharedAccount = await connectInMemoryAccount(env.stack, connector);

    const personal = await importedMessage(personalAccount, owner, "personal-doc");
    const shared = await importedMessage(sharedAccount, owner, "shared-doc");
    await seedDocument(tenantId, PERSONAL_DOC, personal.fileId);
    await seedDocument(tenantId, SHARED_DOC, shared.fileId);

    // A file record in another tenant that names this tenant's mail: only the owner table's
    // tenant scope keeps the other tenant's document hidden.
    const foreignTenant = testTenantId(91);
    const foreignUser = createTestUser({ id: 6905, tenantId: foreignTenant, roles: ["User"] });
    const FOREIGN_FILE = "f0000000-0000-4000-8000-000000000003";
    await seedRows(env.stack.db, fileRefsTable, [
      {
        id: FOREIGN_FILE,
        tenantId: foreignTenant,
        storageKey: "foreign-key",
        fileName: "invoice.pdf",
        mimeType: "application/pdf",
        size: 1n,
        entityType: INBOUND_MESSAGE_AGGREGATE_TYPE,
        entityId: shared.messageId,
        fieldName: "attachmentFileIds",
      },
    ]);
    await seedDocument(foreignTenant, FOREIGN_DOC, FOREIGN_FILE);

    expect((await listedIds(owner)).sort()).toEqual([PERSONAL_DOC, SHARED_DOC]);
    expect(await listedIds(otherMember)).toEqual([SHARED_DOC]);
    expect(await listedIds(tenantAdmin)).toEqual([SHARED_DOC]);
    expect(await listedIds(foreignUser)).toEqual([]);
  });
});
