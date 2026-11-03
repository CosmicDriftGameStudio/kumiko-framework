// The read rule on the message entity is hand-written SQL that mirrors isVisibleToCaller; a
// document gated on a mail attachment must show for exactly those callers for whom the JS check
// says yes, whatever the stored owner looks like.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createFileField,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { fileRefsTable } from "@cosmicdrift/kumiko-framework/files";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import {
  patchFileInstanceofForBunTest,
  resetPiiSubjectKmsForTests,
  seedRows,
} from "@cosmicdrift/kumiko-testing/helpers";
import { unsafeCreateEntityTable } from "@cosmicdrift/kumiko-testing/stack";
import { INBOUND_MESSAGE_AGGREGATE_TYPE } from "../events.ts";
import { isVisibleToCaller } from "../handlers/scope-visibility.ts";
import { inboundMessagesProjectionTable } from "../projection.ts";
import { adminFor, type MailTestStack, setupMailStack } from "./mail-test-support.ts";

const documentEntity = createEntity({
  table: "mail_parity_documents",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture" }),
    file: createFileField(),
  },
  readGate: { fileOwner: { field: "file" } },
});
const documentTable = buildEntityTable("document", documentEntity);

const documentFeature = defineFeature("mailparity", (r) => {
  r.crud("document", documentEntity, {
    write: { access: { roles: ["SystemAdmin"] } },
    read: { access: { roles: ["User", "TenantAdmin", "SystemAdmin"] } },
  });
});

const LIST = "mailparity:query:document:list";

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

const uuid = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("message read rule against isVisibleToCaller", () => {
  test("a document on a mail attachment shows for the same callers as the JS check, for every owner shape", async () => {
    const { tenantId } = adminFor(6951);
    const reader = createTestUser({ id: 6951, tenantId, roles: ["User"] });
    const stranger = createTestUser({ id: 6952, tenantId, roles: ["User"] });
    const owners: ReadonlyArray<string | null> = [null, "", reader.id, stranger.id];

    for (const [index, ownerUserId] of owners.entries()) {
      const messageId = uuid(100 + index);
      await seedRows(env.stack.db, inboundMessagesProjectionTable, [
        {
          id: messageId,
          tenantId,
          accountId: uuid(1),
          ownerUserId,
          messageIdHeader: `parity-${index}@example.org`,
          threadKey: `parity-${index}`,
          from: "sender@example.org",
          receivedAt: new Date("2026-01-01T00:00:00Z"),
        },
      ]);
      const fileId = uuid(200 + index);
      await seedRows(env.stack.db, fileRefsTable, [
        {
          id: fileId,
          tenantId,
          storageKey: `parity-${index}`,
          fileName: "a.pdf",
          mimeType: "application/pdf",
          size: 1n,
          entityType: INBOUND_MESSAGE_AGGREGATE_TYPE,
          entityId: messageId,
          fieldName: "attachmentFileIds",
        },
      ]);
      await seedRows(env.stack.db, documentTable, [
        { id: uuid(300 + index), tenantId, title: "doc", file: fileId },
      ]);
    }

    for (const caller of [reader, stranger]) {
      const result = await env.stack.http.queryOk<{ rows: { id: string }[] }>(
        LIST,
        { limit: 50 },
        caller,
      );
      const shown = result.rows.map((row) => row.id).sort();
      const expected = owners
        .map((ownerUserId, index) => ({ ownerUserId, id: uuid(300 + index) }))
        .filter((row) => isVisibleToCaller(row, caller))
        .map((row) => row.id)
        .sort();
      expect(shown).toEqual(expected);
      expect(expected.length).toBeGreaterThan(0);
    }
  });
});
