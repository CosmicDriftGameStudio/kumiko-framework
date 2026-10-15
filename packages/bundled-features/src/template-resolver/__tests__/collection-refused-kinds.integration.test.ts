import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type DbConnection, fetchOne } from "@cosmicdrift/kumiko-framework/db";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { createTemplateResolverFeature } from "../feature.js";
import { collectionHandlerName } from "../qualified-names.js";
import {
  type TemplateResourceRow,
  templateResourceEntity,
  templateResourcesTable,
} from "../table.js";

let stack: TestStack;
let db: DbConnection;

const agent = createTestUser({ id: 3, roles: ["Agent"], tenantId: testTenantId(31) });

const REFUSED = [
  { id: "mail-entries", kind: "mail" },
  { id: "mail-layout-entries", kind: "mail-layout" },
  { id: "pdf-layout-entries", kind: "pdf-layout" },
] as const;

const feature = createTemplateResolverFeature({
  collections: REFUSED.map(({ id, kind }) => ({
    id,
    kind,
    access: { roles: ["Agent"] },
    nav: { label: "mail:nav.snippets" },
  })),
});

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
  db = stack.db;
  await unsafeCreateEntityTable(db, templateResourceEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

// A tenant row of these kinds would shadow the system notification template
// without the meta and placeholder gates, so the collection path refuses them.
describe("collection-set refuses mail and layout kinds", () => {
  for (const { id, kind } of REFUSED) {
    test(`${kind} is rejected on the kind field and nothing is stored`, async () => {
      const err = await stack.http.writeErr(
        collectionHandlerName(id),
        {
          slug: "welcome",
          locale: "de",
          title: "Welcome",
          content: "<p>Hi</p>",
          contentFormat: kind === "mail-layout" ? "mjml" : "html",
        },
        agent,
      );
      expect(err.code).toBe("validation_error");
      expect(JSON.stringify(err)).toContain("kindNotAllowed");

      const row = await fetchOne<TemplateResourceRow>(db, templateResourcesTable, {
        tenantId: agent.tenantId,
        slug: "welcome",
        kind,
        locale: "de",
      });
      expect(row).toBeUndefined();
    });
  }
});
