import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type DbConnection, fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/db";
import { defineFeature, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { createRendererMailHtmlFeature } from "@cosmicdrift/kumiko-renderer-mail-html";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { createRendererFoundationFeature } from "../../renderer-foundation/feature.ts";
import { createTemplateResolverFeature } from "../feature.ts";
import { seedNotificationTemplates, seedSystemTemplate } from "../seeding.ts";
import {
  type TemplateResourceRow,
  templateResourceEntity,
  templateResourcesTable,
} from "../table.ts";
import { TemplateResolverHandlers } from "../web/qualified-names.ts";
import { tenantEditableTemplates } from "./tenant-editable-fixture.ts";

const KEPT = "mailer:notify:kept";
const REMOVED = "mailer:notify:removed";
const RENAMED_AWAY = "mailer:notify:old-name";
const UNMOUNTED = "elsewhere:notify:unknown";

let stack: TestStack;
let db: DbConnection;

const tenantAdmin = createTestUser({
  id: 301,
  roles: ["TenantAdmin"],
  tenantId: testTenantId(1),
});

const mailerFeature = defineFeature("mailer", (r) => {
  r.writeHandler({
    name: "create",
    schema: z.object({}),
    access: { roles: ["TenantAdmin"] },
    handler: async () => ({ isSuccess: true as const, data: {} }),
  });
  r.notification("kept", {
    trigger: { on: "create" },
    recipient: () => null,
    data: () => ({}),
    renamedFrom: [RENAMED_AWAY],
    template: { en: { body: "<p>Hello</p>" } },
    meta: { en: { subject: "Hello" } },
  });
});

function row(tenantId: string, slug: string) {
  return fetchOne<TemplateResourceRow>(db, templateResourcesTable, {
    tenantId,
    slug,
    kind: "mail",
    locale: "en",
  });
}

async function seedSystem(slug: string) {
  return seedSystemTemplate(db, {
    slug,
    kind: "mail",
    locale: "en",
    content: "<p>Old</p>",
    contentFormat: "html",
    meta: { subject: "Old" },
  });
}

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createTemplateResolverFeature({
        tenantEditable: tenantEditableTemplates(["mail"], [REMOVED]),
      }),
      createRendererFoundationFeature(),
      createRendererMailHtmlFeature(),
      mailerFeature,
    ],
  });
  db = stack.db;
  await unsafeCreateEntityTable(db, templateResourceEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("seedNotificationTemplates orphan cleanup", () => {
  test("deletes system rows of removed and renamed notifications, keeps the rest", async () => {
    const removed = await seedSystem(REMOVED);
    const renamedAway = await seedSystem(RENAMED_AWAY);
    await seedSystem(UNMOUNTED);
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      {
        slug: REMOVED,
        kind: "mail",
        locale: "en",
        meta: { subject: "Ours" },
        content: "<p>Ours</p>",
        contentFormat: "html",
        variableSchema: {},
        linkedResources: {},
        status: "active",
      },
      tenantAdmin,
    );

    await seedNotificationTemplates(db, stack.registry);

    expect(await row(SYSTEM_TENANT_ID, REMOVED)).toBeUndefined();
    expect(await row(SYSTEM_TENANT_ID, RENAMED_AWAY)).toBeUndefined();
    for (const id of [removed.id, renamedAway.id]) {
      const events = await selectMany(db, eventsTable, { aggregateId: id });
      expect(events.map((event) => String(event["type"])).some((t) => t.endsWith("deleted"))).toBe(
        true,
      );
    }
    expect(await row(SYSTEM_TENANT_ID, KEPT)).not.toBeUndefined();
    expect(await row(SYSTEM_TENANT_ID, UNMOUNTED)).not.toBeUndefined();
    expect(await row(testTenantId(1), REMOVED)).not.toBeUndefined();
  });
});
