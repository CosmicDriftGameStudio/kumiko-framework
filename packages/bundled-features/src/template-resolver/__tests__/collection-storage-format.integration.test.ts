// The storage format of a collection entry follows from the collection's editor format on the
// server; a client cannot pick it.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type DbConnection, fetchOne } from "@cosmicdrift/kumiko-framework/db";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { createTemplateResolverFeature } from "../feature.ts";
import {
  type TemplateResourceRow,
  templateResourceEntity,
  templateResourcesTable,
} from "../table.ts";
import { collectionHandlerName } from "../web/qualified-names.ts";

let stack: TestStack;
let db: DbConnection;

const agent = createTestUser({ id: 4, roles: ["Agent"] });

const NOTES_SET = collectionHandlerName("notes");
const LETTERS_SET = collectionHandlerName("letters");

const feature = createTemplateResolverFeature({
  collections: [
    {
      id: "notes",
      kind: "ai-prompt",
      access: { roles: ["Agent"] },
      nav: { label: "mail:nav.notes" },
    },
    {
      id: "letters",
      kind: "document-pdf",
      contentFormat: "document",
      access: { roles: ["Agent"] },
      nav: { label: "mail:nav.letters" },
    },
  ],
});

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
  db = stack.db;
  await unsafeCreateEntityTable(db, templateResourceEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

function rowOf(kind: string, slug: string) {
  return fetchOne<TemplateResourceRow>(db, templateResourcesTable, {
    tenantId: agent.tenantId,
    slug,
    kind,
    locale: "de",
  });
}

describe("collection storage format", () => {
  test("a plain collection stores plain text, whatever the client sends", async () => {
    await stack.http.writeOk(
      NOTES_SET,
      { slug: "a", locale: "de", title: "A", content: "Hallo {{name}}", contentFormat: "html" },
      agent,
    );
    const row = await rowOf("ai-prompt", "a");
    expect(row?.contentFormat).toBe("plain");
    expect(row?.content).toBe("Hallo {{name}}");
  });

  test("a document collection stores HTML, whatever the client sends", async () => {
    await stack.http.writeOk(
      LETTERS_SET,
      {
        slug: "b",
        locale: "de",
        title: "B",
        content: '<p>Hallo <span data-variable="name"></span></p>',
        contentFormat: "plain",
      },
      agent,
    );
    const row = await rowOf("document-pdf", "b");
    expect(row?.contentFormat).toBe("html");
    expect(row?.content).toContain("data-variable");
  });

  test("a document body with a script element is rejected, not stored", async () => {
    const error = await stack.http.writeErr(
      LETTERS_SET,
      { slug: "c", locale: "de", title: "C", content: "<p>x</p><script>alert(1)</script>" },
      agent,
    );
    expect(error.code).toBe("validation_error");
    expect(await rowOf("document-pdf", "c")).toBeUndefined();
  });

  test("createOnly reports a taken slug and keeps the existing entry", async () => {
    const error = await stack.http.writeErr(
      NOTES_SET,
      { slug: "a", locale: "de", title: "Neu", content: "überschrieben", createOnly: true },
      agent,
    );
    expect(error.code).toBe("validation_error");
    const row = await rowOf("ai-prompt", "a");
    expect(row?.title).toBe("A");
    expect(row?.content).toBe("Hallo {{name}}");
  });

  test("createOnly with a free slug creates the entry", async () => {
    const result = await stack.http.writeOk<{ isNew: boolean }>(
      NOTES_SET,
      { slug: "d", locale: "de", title: "D", content: "x", createOnly: true },
      agent,
    );
    expect(result.isNew).toBe(true);
  });
});
